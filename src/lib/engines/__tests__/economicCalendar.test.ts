/**
 * Economic calendar engine. NOTE: the feed samples below are SYNTHETIC FORMAT FIXTURES built
 * from each format's structure (RFC 5545 iCalendar, a JSON release list, the FOMC calendar
 * page layout) — they are test inputs, not the real release schedule.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { snapshotOf } from '@/lib/engines/firmRulesEngine';
import { makeAccount } from '@/test/fixtures';

import {
  calendarFreshness,
  classify,
  DEFAULT_NEWS_RULES,
  easternToUtc,
  FeedFormatError,
  isRelevant,
  makeEvent,
  newsRisk,
  parseBeaSchedule,
  parseBlsIcs,
  parseFedCalendar,
  planSourceSync,
  upcoming,
  utcToEastern,
  type EconomicEvent,
} from '../economicCalendar';
import { firmNewsRule } from '../economicCalendar/firmNewsRule';

const AT = '2026-11-01T12:00:00.000Z';

describe('Eastern time ↔ UTC (DST-aware, platform tz data)', () => {
  it('converts standard and daylight time correctly and rejects impossible local times', () => {
    expect(easternToUtc('2026-01-09', '08:30')).toBe('2026-01-09T13:30:00.000Z'); // EST (UTC−5)
    expect(easternToUtc('2026-07-02', '08:30')).toBe('2026-07-02T12:30:00.000Z'); // EDT (UTC−4)
    expect(easternToUtc('2026-03-08', '02:30')).toBeNull(); // skipped by the spring-forward change
    expect(utcToEastern('2026-11-13T13:30:00.000Z')).toEqual({ dateET: '2026-11-13', timeET: '08:30' });
  });
});

describe('BLS iCalendar reader', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:fixture-cpi',
    'DTSTART;TZID=US-Eastern:20261113T083000',
    'SUMMARY:Consumer Price Index',
    'URL:https://www.bls.gov/schedule/news_release/cpi.htm',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-nfp',
    'DTSTART:20261204T133000Z',
    'SUMMARY:The Employment Situation',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-jolts',
    'DTSTART;VALUE=DATE:20261208',
    'SUMMARY:Job Openings and Labor Turnover Survey',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-other-zone',
    'DTSTART;TZID=Europe/London:20261210T083000',
    'SUMMARY:Producer Price Index',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-folded',
    'DTSTART;TZID=America/New_York:20261211T100000',
    'SUMMARY:Productivity and Costs\\, Revised',
    '  Q3', // RFC 5545 fold: the first space is the fold marker
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-dup',
    'DTSTART;TZID=US-Eastern:20261113T083000',
    'SUMMARY:Consumer Price Index',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('reads published times (Eastern TZID or UTC), keeps date-only releases with an unknown time and never guesses another zone', () => {
    const ev = parseBlsIcs(ics, AT);
    const by = (c: string) => ev.find((e) => e.code === c)!;
    expect(by('CPI')).toMatchObject({ dateET: '2026-11-13', timeET: '08:30', timeStatus: 'published', startsAt: '2026-11-13T13:30:00.000Z', source: 'bls', sourceEventId: 'fixture-cpi', kind: 'scheduled_release' });
    expect(by('CPI').sourceUrl).toBe('https://www.bls.gov/schedule/news_release/cpi.htm');
    expect(by('NFP')).toMatchObject({ dateET: '2026-12-04', timeET: '08:30', timeStatus: 'published' });
    expect(by('JOLTS')).toMatchObject({ dateET: '2026-12-08', timeET: null, timeStatus: 'unknown', startsAt: null });
    expect(by('PPI')).toMatchObject({ dateET: '2026-12-10', timeET: null, timeStatus: 'unknown' }); // London time not converted by guesswork
    expect(by('PRODUCTIVITY').title).toBe('Productivity and Costs, Revised Q3'); // unfolded + unescaped
    expect(ev.filter((e) => e.code === 'CPI')).toHaveLength(1); // listed twice → one release
  });

  it('a non-calendar or empty feed is a format error — never an empty "all clear"', () => {
    expect(() => parseBlsIcs('<html>Access denied</html>', AT)).toThrow(FeedFormatError);
    expect(() => parseBlsIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR', AT)).toThrow(FeedFormatError);
  });

  it('the same release always gets the same id (re-reading never duplicates)', () => {
    expect(parseBlsIcs(ics, AT).map((e) => e.id)).toEqual(parseBlsIcs(ics, '2026-11-02T00:00:00Z').map((e) => e.id));
  });
});

describe('title normalisation', () => {
  it('maps official titles to families; anything unknown stays OTHER (low impact)', () => {
    expect(classify('Employment Situation').code).toBe('NFP');
    expect(classify('Gross Domestic Product, 3rd Quarter 2026 (Advance Estimate)').code).toBe('GDP');
    expect(classify('Personal Income and Outlays, October 2026').code).toBe('PCE');
    expect(classify('County Employment and Wages')).toEqual({ code: 'OTHER', name: 'County Employment and Wages' });
  });
});

describe('BEA JSON reader (tolerant to field names, strict about meaning)', () => {
  it('reads zoned date-times exactly and bare clock times only when declared Eastern', () => {
    const doc = { releases: [
      { release_name: 'Gross Domestic Product (Advance Estimate)', release_date: '2026-10-29T08:30:00-04:00' },
      { name: 'Personal Income and Outlays', date: 'November 25, 2026', time: '8:30 AM' },
      { title: 'U.S. International Trade in Goods and Services', releaseDate: '2026-12-03' },
      { note: 'no name or date — skipped' },
    ] };
    const plain = parseBeaSchedule(doc, AT);
    expect(plain.find((e) => e.code === 'GDP')).toMatchObject({ dateET: '2026-10-29', timeET: '08:30', timeStatus: 'published', startsAt: '2026-10-29T12:30:00.000Z' });
    expect(plain.find((e) => e.code === 'PCE')).toMatchObject({ dateET: '2026-11-25', timeET: null, timeStatus: 'unknown' });
    const eastern = parseBeaSchedule(doc, AT, { timesAreEastern: true });
    expect(eastern.find((e) => e.code === 'PCE')).toMatchObject({ timeET: '08:30', timeStatus: 'published', startsAt: '2026-11-25T13:30:00.000Z' });
    expect(eastern.find((e) => e.code === 'TRADE')).toMatchObject({ timeStatus: 'unknown' });
  });

  it('an unrecognised document is a format error', () => {
    expect(() => parseBeaSchedule({ status: 'maintenance' }, AT)).toThrow(FeedFormatError);
    expect(() => parseBeaSchedule([{ foo: 1 }], AT)).toThrow(FeedFormatError);
  });
});

describe('FOMC calendar reader', () => {
  const html = `<html><body>
    <div class="panel"><h4>2026 FOMC Meetings</h4>
      <div class="row"><div class="fomc-meeting__month"><strong>January</strong></div><div class="fomc-meeting__date">27-28</div></div>
      <div class="row"><div class="fomc-meeting__month"><strong>March</strong></div><div class="fomc-meeting__date">17-18*</div></div>
      <div class="row"><div class="fomc-meeting__month"><strong>April/May</strong></div><div class="fomc-meeting__date">28-29</div></div>
      <div class="row"><div class="fomc-meeting__month"><strong>July/August</strong></div><div class="fomc-meeting__date">31-1</div></div>
      <div class="row"><div class="fomc-meeting__month"><strong>August</strong></div><div class="fomc-meeting__date">9 (notation vote)</div></div>
    </div>
    <div class="panel"><h4>2027 FOMC Meetings</h4>
      <div class="row"><div class="fomc-meeting__month"><strong>Jan/Feb</strong></div><div class="fomc-meeting__date">31-1</div></div>
    </div></body></html>`;

  it('turns scheduled meetings into a statement + press conference on the last day; notation votes are skipped', () => {
    const ev = parseFedCalendar(html, AT);
    const statements = ev.filter((e) => e.code === 'FOMC_STATEMENT');
    expect(statements.map((e) => e.dateET)).toEqual(['2026-01-28', '2026-03-18', '2026-04-29', '2026-08-01', '2027-02-01']);
    expect(statements[1].title).toMatch(/Summary of Economic Projections/);
    expect(statements[0]).toMatchObject({ timeET: '14:00', timeStatus: 'conventional', startsAt: '2026-01-28T19:00:00.000Z', source: 'fed' });
    expect(ev.find((e) => e.code === 'FOMC_PRESS_CONFERENCE' && e.dateET === '2026-01-28')).toMatchObject({ timeET: '14:30', timeStatus: 'conventional' });
    expect(ev.some((e) => e.dateET === '2026-08-09')).toBe(false); // notation vote
  });

  it('a time a person verified for a date is used as published', () => {
    const ev = parseFedCalendar(html, AT, { verifiedTimes: { '2026-03-18': '14:00' } });
    expect(ev.find((e) => e.code === 'FOMC_STATEMENT' && e.dateET === '2026-03-18')!.timeStatus).toBe('published');
  });

  it('a changed page layout is a format error', () => {
    expect(() => parseFedCalendar('<html><body>Maintenance</body></html>', AT)).toThrow(FeedFormatError);
  });
});

// ───────────────────────────── rules ─────────────────────────────
const ev = (o: Partial<EconomicEvent> & { title: string; dateET: string; timeET: string | null }): EconomicEvent =>
  ({ ...makeEvent({ source: 'bls', timeStatus: o.timeET ? 'published' : 'unknown', sourceUrl: 'https://www.bls.gov/', retrievedAt: AT, ...o }), ...(o.active === false ? { active: false } : {}) });

describe('news risk for ES / MES / NQ / MNQ', () => {
  const cpi = ev({ title: 'Consumer Price Index', dateET: '2026-11-13', timeET: '08:30' }); // 13:30Z
  const ppi = ev({ title: 'Producer Price Index', dateET: '2026-11-13', timeET: '10:00' });

  it('clear → approaching → in window → clear, with guidance and never a block', () => {
    expect(newsRisk([cpi], new Date('2026-11-13T11:00:00Z')).state).toBe('clear');
    const soon = newsRisk([cpi], new Date('2026-11-13T12:50:00Z'));
    expect(soon).toMatchObject({ state: 'approaching', minutesToRelease: 40, impact: 'high' });
    expect(soon.headline).toMatch(/CPI .* at 8:30 AM EST — in 40 min/);
    expect(soon.guidance.join(' ')).toMatch(/flat, or reducing size/);
    const during = newsRisk([cpi], new Date('2026-11-13T13:25:00Z'));
    expect(during).toMatchObject({ state: 'in_window', minutesToRelease: 5, windowStart: '2026-11-13T13:15:00.000Z', windowEnd: '2026-11-13T13:45:00.000Z' });
    expect(during.guidance.join(' ')).toMatch(/avoiding new entries until 8:45 AM EST.*50% of usual/);
    expect(newsRisk([cpi], new Date('2026-11-13T13:46:00Z')).state).toBe('clear');
  });

  it('medium-impact releases only count when the trader lowers the threshold', () => {
    expect(isRelevant(ppi)).toBe(false);
    expect(isRelevant(ppi, { ...DEFAULT_NEWS_RULES, minImpact: 'medium' })).toBe(true);
  });

  it('withdrawn releases and non-index instruments are ignored', () => {
    expect(newsRisk([{ ...cpi, active: false }], new Date('2026-11-13T13:25:00Z')).state).toBe('clear');
    expect(newsRisk([cpi], new Date('2026-11-13T13:25:00Z'), { ...DEFAULT_NEWS_RULES, instruments: ['CL', 'GC'] }).state).toBe('clear');
  });

  it('a major release today without a confirmed time says so instead of computing a window', () => {
    const jobs = ev({ title: 'The Employment Situation', dateET: '2026-12-04', timeET: null });
    expect(newsRisk([jobs], new Date('2026-12-04T12:00:00Z'))).toMatchObject({ state: 'time_unconfirmed' });
  });

  it('conventional FOMC times are labelled as usual times to confirm', () => {
    const fomc = makeEvent({ source: 'fed', title: 'FOMC statement', dateET: '2026-12-16', timeET: '14:00', timeStatus: 'conventional', sourceUrl: 'https://www.federalreserve.gov/', retrievedAt: AT });
    expect(newsRisk([fomc], new Date('2026-12-16T18:30:00Z')).headline).toMatch(/usual time — confirm/);
  });

  it('upcoming lists relevant releases soonest first, including a release still inside its window', () => {
    const list = upcoming([ppi, cpi, ev({ title: 'GDP (Advance Estimate)', dateET: '2026-11-20', timeET: '08:30' })], new Date('2026-11-13T13:40:00Z'), 14);
    expect(list.map((e) => e.code)).toEqual(['CPI', 'GDP']);
  });
});

describe('refresh planning (no invented or dropped events)', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const past = ev({ title: 'Consumer Price Index', dateET: '2026-10-15', timeET: '08:30' });
  const future = ev({ title: 'Producer Price Index', dateET: '2026-11-14', timeET: '08:30' });
  const kept = ev({ title: 'Consumer Price Index', dateET: '2026-11-13', timeET: '08:30' });

  it('a failed read changes nothing but the status', () => {
    const p = planSourceSync([past, future], { source: 'bls', ok: false, error: 'HTTP 503' }, { source: 'bls', checkedAt: null, lastSuccessAt: '2026-11-09T00:00:00Z', status: 'ok', error: null, eventCount: 2, coverageUntil: '2026-12-01' }, now);
    expect(p.upserts).toEqual([]);
    expect(p.deactivate).toEqual([]);
    expect(p.status).toMatchObject({ status: 'error', error: 'HTTP 503', lastSuccessAt: '2026-11-09T00:00:00Z' });
  });

  it('a successful read upserts, deactivates future releases the source dropped, and leaves history alone', () => {
    const p = planSourceSync([past, future, kept], { source: 'bls', ok: true, events: [kept] }, null, now);
    expect(p.upserts.map((e) => e.id)).toEqual([kept.id]);
    expect(p.deactivate).toEqual([future.id]);
    expect(p.status).toMatchObject({ status: 'ok', eventCount: 1, coverageUntil: '2026-11-13', lastSuccessAt: now.toISOString() });
  });

  it('not modified (conditional request) refreshes the timestamp only', () => {
    expect(planSourceSync([future], { source: 'bls', ok: true, notModified: true }, null, now)).toMatchObject({ upserts: [], deactivate: [], status: { status: 'not_modified', lastSuccessAt: now.toISOString() } });
  });
});

describe('calendar freshness', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('flags stale, failing and unconfigured sources so the app never presents a gap as "no events"', () => {
    const f = calendarFreshness(
      [
        { source: 'bls', checkedAt: '2026-11-10T11:00:00Z', lastSuccessAt: '2026-11-10T11:00:00Z', status: 'ok', error: null, eventCount: 40, coverageUntil: '2026-12-31' },
        { source: 'fed', checkedAt: '2026-11-10T11:00:00Z', lastSuccessAt: '2026-11-07T11:00:00Z', status: 'error', error: 'HTTP 503', eventCount: 16, coverageUntil: '2027-12-15' },
        { source: 'bea', checkedAt: '2026-11-10T11:00:00Z', lastSuccessAt: null, status: 'error', error: 'not configured', eventCount: 0, coverageUntil: null },
      ],
      now,
    );
    expect(f.perSource.map((p) => [p.source, p.state])).toEqual([['bls', 'fresh'], ['bea', 'not_configured'], ['fed', 'stale']]);
    expect(f.degraded).toBe(true);
    expect(f.lastRefreshedAt).toBe('2026-11-07T11:00:00Z');
    expect(calendarFreshness([], now).perSource.every((p) => p.state === 'never')).toBe(true);
  });
});

describe('prop-firm news rule (verified records only)', () => {
  const firm = FIRM_RULES_SEED.firms.find((f) => f.id === 'topstep')!;
  const program = FIRM_RULES_SEED.programs.find((p) => p.firmId === 'topstep')!;
  const version = program.versions.find((v) => v.verification.status === 'verified')!;

  it('shows the firm’s verified news rule with its source', () => {
    const snapshot = snapshotOf(firm, program, version, AT);
    const r = firmNewsRule(makeAccount({ kind: 'prop', firm: 'Topstep', firmLink: { firmId: 'topstep', programId: program.id, programName: program.name, stage: program.stage, status: 'verified', ruleVersion: version.ruleVersion, effectiveDate: version.effectiveDate, lastVerifiedAt: null, importedAt: AT, imported: {}, overrides: [], snapshot } }));
    expect(r.status).toBe('verified');
    if (r.status === 'verified') {
      expect(r.text).toMatch(/full Maximum Position Size/);
      expect(r.sources.length).toBeGreaterThan(0);
    }
  });

  it('never fills in a news policy for firms without a verified record', () => {
    expect(firmNewsRule(makeAccount({ kind: 'prop', firm: 'Some Firm' }))).toMatchObject({ status: 'none' });
    expect(firmNewsRule(makeAccount({ kind: 'personal' }))).toMatchObject({ status: 'none' });
    expect(firmNewsRule(null)).toMatchObject({ status: 'none' });
  });
});
