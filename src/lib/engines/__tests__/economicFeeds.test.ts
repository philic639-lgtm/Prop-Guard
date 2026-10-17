/**
 * Economic calendar — official update feeds, the BEA schedule page, source status, trader
 * time zones and release-date changes.
 *
 * NOTE: every feed body below is a SYNTHETIC FORMAT FIXTURE (RSS 2.0, RSS 1.0 / RDF, Atom and an
 * HTML schedule page laid out like a release table). They are test inputs, NOT captured from
 * bls.gov, bea.gov or federalreserve.gov, and the dates / titles are invented for the tests.
 */
import {
  calendarFreshness,
  connectionOf,
  ET,
  FeedFormatError,
  feedDate,
  formatClock,
  formatDay,
  makeEvent,
  newsRisk,
  parseBea,
  parseBeaSchedulePage,
  parseUpdateFeed,
  planSourceSync,
  planUpdateSync,
  readSource,
  readUpdateFeed,
  parseIcsCalendar,
  BEA_ICS_URL,
  headerSafe,
  sourceConfigFromEnv,
  DEFAULT_NEWS_RULES,
  type FetchLike,
} from '../economicCalendar';

const AT = '2026-10-15T12:00:00.000Z';

const okFetch =
  (body: string, status = 200, headers: Record<string, string> = {}): FetchLike =>
  async () => ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => body });

describe('official update feeds (RSS / Atom)', () => {
  const rss2 = `<?xml version="1.0"?><rss version="2.0"><channel><title>TEST FEED</title>
    <item><title><![CDATA[TEST — Consumer Price Index – September 2026]]></title><link>https://www.bls.gov/news.release/cpi.htm</link><guid>https://www.bls.gov/news.release/cpi.htm#2026-10</guid><pubDate>Wed, 14 Oct 2026 08:30:00 -0400</pubDate></item>
    <item><title>TEST — Producer Price Index &amp; more</title><link>https://www.bls.gov/news.release/ppi.htm</link><pubDate>Thu, 15 Oct 2026 12:30:00 GMT</pubDate></item>
    <item><title>TEST — duplicate</title><link>https://www.bls.gov/news.release/cpi.htm</link><guid>https://www.bls.gov/news.release/cpi.htm#2026-10</guid></item>
    <item><title>TEST — insecure link is dropped</title><link>http://example.com/x</link></item>
  </channel></rss>`;

  it('reads title, link and publication time exactly; dedupes by guid; newest first', () => {
    const items = parseUpdateFeed(rss2, 'bls_updates', AT);
    expect(items.map((i) => i.title)).toEqual(['TEST — Producer Price Index & more', 'TEST — Consumer Price Index – September 2026']);
    expect(items[1]).toMatchObject({ feed: 'bls_updates', id: 'bls_updates:https://www.bls.gov/news.release/cpi.htm#2026-10', publishedAt: '2026-10-14T12:30:00.000Z', retrievedAt: AT });
    // Nothing but title / link / time is kept — no numbers parsed out of the item.
    expect(Object.keys(items[0]).sort()).toEqual(['feed', 'id', 'link', 'publishedAt', 'retrievedAt', 'title']);
  });

  it('RSS 1.0 (dc:date) and Atom work too', () => {
    const rdf = `<rdf:RDF><item rdf:about="https://www.bls.gov/a"><title>TEST RDF</title><link>https://www.bls.gov/a</link><dc:date>2026-10-14T08:30:00-04:00</dc:date></item></rdf:RDF>`;
    expect(parseUpdateFeed(rdf, 'bls_updates', AT)[0]).toMatchObject({ title: 'TEST RDF', publishedAt: '2026-10-14T12:30:00.000Z' });
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>TEST Atom</title><link href="https://www.federalreserve.gov/x.htm"/><id>tag:fed,2026:x</id><updated>2026-10-14T18:00:00Z</updated></entry></feed>`;
    expect(parseUpdateFeed(atom, 'fed_updates', AT)[0]).toMatchObject({ title: 'TEST Atom', link: 'https://www.federalreserve.gov/x.htm', id: 'fed_updates:tag:fed,2026:x' });
  });

  it('an HTML error page or an empty feed is a format error, never "no updates"', () => {
    expect(() => parseUpdateFeed('<html><body>Access Denied</body></html>', 'fed_updates', AT)).toThrow(FeedFormatError);
    expect(() => parseUpdateFeed('<rss><channel></channel></rss>', 'fed_updates', AT)).toThrow(FeedFormatError);
  });

  it('feed dates: RFC 822 with zone names, ISO; unreadable → null', () => {
    expect(feedDate('Wed, 14 Oct 2026 08:30:00 EDT')).toBe('2026-10-14T12:30:00.000Z');
    expect(feedDate('Wed, 09 Dec 2026 14:00:00 EST')).toBe('2026-12-09T19:00:00.000Z');
    expect(feedDate('soon')).toBeNull();
  });

  it('sync: failures only touch the status; success upserts by id', async () => {
    const now = new Date(AT);
    const fail = await readUpdateFeed('fed_updates', sourceConfigFromEnv(() => undefined), okFetch('', 503), { etag: null, lastModified: null }, now);
    expect(planUpdateSync(fail, { source: 'fed_updates', checkedAt: null, lastSuccessAt: '2026-10-14T00:00:00Z', status: 'ok', error: null, eventCount: 3, coverageUntil: null }, now)).toMatchObject({ upserts: [], status: { status: 'error', error: 'HTTP 503', lastSuccessAt: '2026-10-14T00:00:00Z' } });
    const ok = await readUpdateFeed('bls_updates', sourceConfigFromEnv(() => undefined), okFetch(rss2, 200, { etag: '"v1"' }), { etag: null, lastModified: null }, now);
    expect(ok.validators.etag).toBe('"v1"');
    expect(planUpdateSync(ok, null, now)).toMatchObject({ upserts: [{}, {}], status: { status: 'ok', eventCount: 2 } });
    const notModified = await readUpdateFeed('bls_updates', sourceConfigFromEnv(() => undefined), okFetch('', 304), { etag: '"v1"', lastModified: null }, now);
    expect(planUpdateSync(notModified, null, now)).toMatchObject({ upserts: [], status: { status: 'not_modified', lastSuccessAt: AT } });
  });
});

describe('BEA release-schedule page (HTML)', () => {
  // Constructed table layout (not captured from bea.gov): year heading, date cell, time cell, title cell.
  const page = `<html><body><h1>News Release Schedule</h1>
    <p>All release times are 8:30 a.m. Eastern Time unless otherwise noted.</p>
    <h2>2026</h2>
    <table><tr><th>Date</th><th>Time</th><th>Release</th></tr>
    <tr><td>October 29</td><td>8:30 AM</td><td>GDP (Advance Estimate), 3rd Quarter 2026</td></tr>
    <tr><td>Oct 30</td><td>10:00 AM</td><td>TEST Personal Income and Outlays, September 2026</td></tr>
    <tr><td>November 4</td><td></td><td>TEST U.S. International Trade in Goods and Services, September 2026</td></tr>
    </table>
    <h2>2027</h2>
    <table><tr><td>January 7</td><td>8:30 AM</td><td>TEST U.S. International Trade in Goods and Services, November 2026</td></tr></table>
  </body></html>`;

  it('reads date, Eastern time (the page states it) and title; years from the headings', () => {
    const ev = parseBeaSchedulePage(page, AT);
    const by = (d: string) => ev.find((e) => e.dateET === d)!;
    expect(by('2026-10-29')).toMatchObject({ source: 'bea', code: 'GDP', timeET: '08:30', timeStatus: 'published', startsAt: '2026-10-29T12:30:00.000Z' });
    expect(by('2026-10-30')).toMatchObject({ code: 'PCE', timeET: '10:00', startsAt: '2026-10-30T14:00:00.000Z' });
    expect(by('2026-11-04')).toMatchObject({ code: 'TRADE', timeStatus: 'unknown', startsAt: null });
    expect(by('2027-01-07')).toMatchObject({ code: 'TRADE', startsAt: '2027-01-07T13:30:00.000Z' }); // EST in January
  });

  it('regional GDP releases are not rated as the national GDP report', () => {
    const ev = parseBeaSchedulePage('<h2>2026</h2><table><tr><td>December 18</td><td>GDP by State and Personal Income by State, 3rd Quarter 2026</td></tr><tr><td>December 22</td><td>GDP (Third Estimate), 3rd Quarter 2026</td></tr></table>', AT);
    expect(ev.map((e) => e.code)).toEqual(['OTHER', 'GDP']);
  });

  it('without an Eastern statement (or operator confirmation) clock times are not used', () => {
    const noNote = page.replace(/<p>All release times[^<]*<\/p>/, '');
    expect(parseBeaSchedulePage(noNote, AT).every((e) => e.timeStatus === 'unknown')).toBe(true);
    expect(parseBeaSchedulePage(noNote, AT, { timesAreEastern: true }).find((e) => e.code === 'GDP')).toMatchObject({ timeStatus: 'published' });
  });

  it('a date without a year heading takes the year closest to retrieval', () => {
    const ev = parseBeaSchedulePage('<table><tr><td>January 7</td><td>TEST Gross Domestic Product</td></tr></table>', '2026-12-20T00:00:00Z');
    expect(ev[0].dateET).toBe('2027-01-07');
  });

  it('a redesigned or blocked page is a format error, never an empty schedule', () => {
    expect(() => parseBeaSchedulePage('<html><body><h1>Page not found</h1></body></html>', AT)).toThrow(FeedFormatError);
  });

  it('the configured address may serve JSON or HTML', () => {
    expect(parseBea(JSON.stringify([{ name: 'TEST Gross Domestic Product', date: '2026-10-29T08:30:00-04:00' }]), AT)[0].code).toBe('GDP');
    expect(parseBea(page, AT).length).toBe(4);
  });

  it('a configured BEA page address is read as HTML (ECON_BEA_URL override)', async () => {
    const cfg = sourceConfigFromEnv((k) => (k === 'ECON_BEA_URL' ? 'https://www.bea.gov/news/schedule' : undefined));
    expect(cfg.beaUrl).toBe('https://www.bea.gov/news/schedule');
    let asked = '';
    const r = await readSource('bea', cfg, async (url) => ((asked = url), { status: 200, headers: { get: () => null }, text: async () => page }), { etag: null, lastModified: null }, new Date(AT));
    expect(asked).toBe('https://www.bea.gov/news/schedule');
    expect(r.ok && r.events?.length).toBe(4);
  });
});

describe('source status: Connected / Stale / Unavailable', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  it('maps freshness; a failure with older data is Stale, never-loaded is Unavailable', () => {
    const f = calendarFreshness(
      [
        { source: 'bls', checkedAt: AT, lastSuccessAt: '2026-10-15T11:00:00Z', status: 'ok', error: null, eventCount: 40, coverageUntil: '2026-12-31' },
        { source: 'bea', checkedAt: AT, lastSuccessAt: '2026-10-15T06:00:00Z', status: 'error', error: 'HTTP 503', eventCount: 9, coverageUntil: null },
        { source: 'fed', checkedAt: AT, lastSuccessAt: null, status: 'error', error: 'timeout after 20 s', eventCount: 0, coverageUntil: null },
      ],
      now,
    );
    expect(f.perSource.map((p) => [p.source, p.connection])).toEqual([['bls', 'connected'], ['bea', 'stale'], ['fed', 'unavailable']]);
    expect(calendarFreshness([], now, 36, ['bls_updates', 'fed_updates']).perSource.map((p) => p.connection)).toEqual(['unavailable', 'unavailable']);
    expect(connectionOf('stale', '2026-10-10T00:00:00Z')).toBe('stale');
  });
});

describe('time zones: stored UTC, shown in the trader’s zone with DST', () => {
  // DST in the US starts Sun 2026-03-08 and ends Sun 2026-11-01.
  const before = makeEvent({ source: 'bls', title: 'TEST Consumer Price Index', dateET: '2026-03-06', timeET: '08:30', timeStatus: 'published', sourceUrl: 'https://www.bls.gov/', retrievedAt: AT });
  const after = makeEvent({ source: 'bls', title: 'TEST Consumer Price Index', dateET: '2026-03-13', timeET: '08:30', timeStatus: 'published', sourceUrl: 'https://www.bls.gov/', retrievedAt: AT });

  it('8:30 AM Eastern is stored as the right UTC instant on both sides of the change', () => {
    expect(before.startsAt).toBe('2026-03-06T13:30:00.000Z');
    expect(after.startsAt).toBe('2026-03-13T12:30:00.000Z');
  });

  it('displayed in the trader’s zone with that date’s abbreviation', () => {
    expect(formatClock(before.startsAt!, ET)).toBe('8:30 AM EST');
    expect(formatClock(after.startsAt!, ET)).toBe('8:30 AM EDT');
    expect(formatClock(before.startsAt!, 'America/Los_Angeles')).toBe('5:30 AM PST');
    expect(formatClock(after.startsAt!, 'America/Los_Angeles')).toBe('5:30 AM PDT');
    // Europe changes a few weeks later: on Mar 13 London is still on GMT → 12:30 PM.
    expect(formatClock(after.startsAt!, 'Europe/London')).toBe('12:30 PM GMT');
    // An evening ET release is the next day in Tokyo.
    const fomcMinutes = '2026-10-14T18:00:00.000Z';
    expect(formatDay(fomcMinutes, 'Asia/Tokyo')).toBe('Thu, Oct 15');
    expect(formatClock(fomcMinutes, 'not/a-zone')).toBe('2:00 PM EDT'); // invalid zone → Eastern, never a guess
  });

  it('news warnings use the trader’s zone', () => {
    const r = newsRisk([after], new Date('2026-03-13T12:00:00Z'), { ...DEFAULT_NEWS_RULES, displayZone: 'America/Chicago' });
    expect(r.headline).toMatch(/at 7:30 AM CDT — in 30 min/);
  });
});

describe('changed release dates', () => {
  it('a release moved to another day: the new date is stored, the old one is deactivated (not deleted)', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const old = makeEvent({ source: 'bls', title: 'TEST Employment Situation', dateET: '2026-11-06', timeET: '08:30', timeStatus: 'published', sourceUrl: 'https://www.bls.gov/', retrievedAt: AT });
    const moved = makeEvent({ source: 'bls', title: 'TEST Employment Situation', dateET: '2026-11-13', timeET: '08:30', timeStatus: 'published', sourceUrl: 'https://www.bls.gov/', retrievedAt: AT });
    const p = planSourceSync([old], { source: 'bls', ok: true, events: [moved] }, null, now);
    expect(p.upserts.map((e) => e.id)).toEqual([moved.id]);
    expect(p.deactivate).toEqual([old.id]);
  });
});

describe('request headers', () => {
  it('a contact with non-ASCII characters never breaks the request (header values must be ASCII)', async () => {
    const cfg = sourceConfigFromEnv((k) => (k === 'ECON_CONTACT' ? '\u201cphil@example.com\u201d\u00a0(me) caf\u00e9' : undefined));
    expect(cfg.contact).toBe('phil@example.com me caf');
    let ua = '';
    await readUpdateFeed('bls_updates', cfg, async (_u, init) => ((ua = init.headers['User-Agent']), { status: 304, headers: { get: () => null }, text: async () => '' }), { etag: null, lastModified: null }, new Date(AT));
    expect(ua).toMatch(/^[\x20-\x7E]+$/);
    expect(ua).toContain('contact phil@example.com me caf)');
    expect(headerSafe('\u00e9\u00e9')).toBeNull();
    // A stored validator with a stray character is cleaned too.
    let etag = '';
    await readUpdateFeed('bls_updates', cfg, async (_u, init) => ((etag = init.headers['If-None-Match']), { status: 304, headers: { get: () => null }, text: async () => '' }), { etag: '"v1\u2019"', lastModified: null }, new Date(AT));
    expect(etag).toBe('"v1"');
  });
});

describe('BEA — real data captured from bea.gov on 2026-10-17 (fixtures/econ)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as { readFileSync: (p: string, e: string) => string };
  const fx = (f: string) => readFileSync(`src/lib/engines/__tests__/fixtures/econ/${f}`, 'utf8');

  it('official iCalendar: exact UTC times → Eastern, DST-correct, BEA source and link', () => {
    const ev = parseBea(fx('bea-calendar-2026-10-17.ics'), AT);
    const by = (d: string, code: string) => ev.find((e) => e.dateET === d && e.code === code)!;
    expect(by('2026-10-29', 'GDP')).toMatchObject({ source: 'bea', timeET: '08:30', timeStatus: 'published', startsAt: '2026-10-29T12:30:00.000Z', sourceUrl: 'https://www.bea.gov/news/schedule' }); // EDT
    expect(by('2026-10-29', 'PCE')).toMatchObject({ timeET: '08:30', startsAt: '2026-10-29T12:30:00.000Z' });
    expect(by('2026-11-04', 'TRADE')).toMatchObject({ timeET: '08:30', startsAt: '2026-11-04T13:30:00.000Z' }); // EST
    expect(by('2025-01-07', 'TRADE').timeET).toBe('08:30');
    expect(by('2026-12-02', 'OTHER').title).toBe('GDP by County and Personal Income by County, 2025'); // not national GDP
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length);
  });

  it('the schedule page (fallback) reads the same rows; times stay unknown because the page does not state a zone', () => {
    const ev = parseBea(fx('bea-schedule-page-2026-10-17.html'), AT);
    expect(ev.map((e) => [e.dateET, e.code])).toEqual([
      ['2026-10-29', 'GDP'],
      ['2026-10-29', 'PCE'],
      ['2026-11-04', 'TRADE'],
      ['2026-11-20', 'OTHER'],
    ]);
    expect(ev.every((e) => e.timeStatus === 'unknown')).toBe(true);
    // Same release, same id from either BEA source — switching sources never duplicates.
    const fromIcs = parseBea(fx('bea-calendar-2026-10-17.ics'), AT).map((e) => e.id);
    expect(fromIcs).toEqual(expect.arrayContaining(ev.slice(0, 3).map((e) => e.id)));
  });

  it('BEA defaults to the official iCalendar; the BLS reader still labels BLS', () => {
    expect(sourceConfigFromEnv(() => undefined).beaUrl).toBe(BEA_ICS_URL);
    expect(parseIcsCalendar(fx('bea-calendar-2026-10-17.ics'), AT, 'bls', 'https://www.bls.gov/')[0].source).toBe('bls');
  });
});

