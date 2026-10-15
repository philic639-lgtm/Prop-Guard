/**
 * Phone alerts before scheduled releases: planned deterministically, applied idempotently
 * (no duplicates), moved / withdrawn releases update their alert, nothing for unknown times.
 */
import { makeEvent, type EconomicEvent } from '@/lib/engines/economicCalendar';
import { alertLeads, DEFAULT_ALERT_SETTINGS, diffEconAlerts, planEconAlerts } from '@/lib/engines/economicCalendar/alerts';
import { DEFAULT_NEWS_RULES } from '@/lib/engines/economicCalendar';
import { readEconomicCalendar } from '@/services/economicCalendarService';

const mockScheduled: { identifier: string; content: { data: Record<string, unknown> }; trigger: unknown }[] = [];
let mockGranted = true;
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationChannelAsync: jest.fn(async () => null),
  getAllScheduledNotificationsAsync: jest.fn(async () => mockScheduled.map((r) => ({ ...r }))),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const i = mockScheduled.findIndex((r) => r.identifier === id);
    if (i >= 0) mockScheduled.splice(i, 1);
  }),
  scheduleNotificationAsync: jest.fn(async (req: { identifier: string; content: { data: Record<string, unknown> }; trigger: unknown }) => {
    const i = mockScheduled.findIndex((r) => r.identifier === req.identifier);
    if (i >= 0) mockScheduled.splice(i, 1); // same identifier replaces (as on iOS / Android)
    mockScheduled.push(req);
    return req.identifier;
  }),
  getPermissionsAsync: jest.fn(async () => ({ granted: mockGranted })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: mockGranted })),
  setNotificationHandler: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyEconAlerts } = require('@/services/econNotifications') as typeof import('@/services/econNotifications');

const AT = '2026-11-01T12:00:00.000Z';
const NOW = new Date('2026-11-12T12:00:00Z');
const ev = (title: string, dateET: string, timeET: string | null, extra: Partial<EconomicEvent> = {}) => ({
  ...makeEvent({ source: 'bls', title, dateET, timeET, timeStatus: timeET ? 'published' : 'unknown', sourceUrl: 'https://www.bls.gov/', retrievedAt: AT }),
  ...extra,
});
const on = { ...DEFAULT_ALERT_SETTINGS, enabled: true };
const cpi = ev('Consumer Price Index', '2026-11-13', '08:30');
const nfp = ev('The Employment Situation', '2026-12-04', '08:30');
const ppi = ev('Producer Price Index', '2026-11-16', '08:30'); // medium
const noTime = ev('Gross Domestic Product', '2026-11-25', null);

describe('alert planning', () => {
  it('one alert per relevant timed release, at the chosen lead, inside the 14-day horizon', () => {
    const plan = planEconAlerts([cpi, nfp, ppi, noTime], on, NOW);
    expect(plan.map((p) => [p.eventId, p.fireAt])).toEqual([[cpi.id, '2026-11-13T13:15:00.000Z']]); // NFP is 22 days out; PPI medium; GDP no time
    expect(plan[0]).toMatchObject({ identifier: `econ:${cpi.id}:15`, title: 'CPI — Consumer Price Index in 15 min' });
    expect(plan[0].body).toMatch(/8:30 AM EST/); // Nov 13 = standard time
    expect(planEconAlerts([cpi, ppi], { ...on, minImpact: 'medium' }, NOW)).toHaveLength(2);
    expect(planEconAlerts([cpi], { ...on, enabled: false }, NOW)).toEqual([]);
  });

  it('never alerts for a release already past its alert time or withdrawn', () => {
    expect(planEconAlerts([cpi], on, new Date('2026-11-13T13:20:00Z'))).toEqual([]);
    expect(planEconAlerts([{ ...cpi, active: false }], on, NOW)).toEqual([]);
  });

  it('diff: unchanged → nothing to do; moved → reschedule; dropped → cancel', () => {
    const plan = planEconAlerts([cpi], on, NOW);
    expect(diffEconAlerts(plan, [{ identifier: plan[0].identifier, fireAt: plan[0].fireAt }])).toEqual({ cancel: [], schedule: [] });
    const moved = { ...plan[0], fireAt: '2026-11-13T13:45:00.000Z' };
    expect(diffEconAlerts([moved], [{ identifier: plan[0].identifier, fireAt: plan[0].fireAt }])).toEqual({ cancel: [plan[0].identifier], schedule: [moved] });
    expect(diffEconAlerts([], [{ identifier: plan[0].identifier, fireAt: plan[0].fireAt }, { identifier: 'pre-session', fireAt: null }])).toEqual({ cancel: [plan[0].identifier], schedule: [] }); // other app notifications untouched
  });
});

describe('advance warnings and timing — TEST DATA (invented releases, not the real calendar)', () => {
  const testCpi = ev('TEST Consumer Price Index', '2026-11-13', '08:30'); // TEST: 13:30 UTC
  it('every chosen lead gets its own alert at the exact UTC instant', () => {
    const plan = planEconAlerts([testCpi], { ...on, leads: [60, 5, 15] }, NOW);
    expect(plan.map((p) => [p.identifier.split(':').pop(), p.fireAt])).toEqual([
      ['60', '2026-11-13T12:30:00.000Z'],
      ['15', '2026-11-13T13:15:00.000Z'],
      ['5', '2026-11-13T13:25:00.000Z'],
    ]);
  });
  it('a lead whose time has passed is skipped; later leads still fire', () => {
    const plan = planEconAlerts([testCpi], { ...on, leads: [60, 5] }, new Date('2026-11-13T12:45:00Z'));
    expect(plan.map((p) => p.fireAt)).toEqual(['2026-11-13T13:25:00.000Z']);
  });
  it('the text uses the trader’s zone (DST-aware) with the official Eastern time alongside', () => {
    const [a] = planEconAlerts([testCpi], on, NOW, { ...DEFAULT_NEWS_RULES, displayZone: 'America/Los_Angeles' });
    expect(a.body).toMatch(/^Scheduled for 5:30 AM PST \(8:30 AM EST\)/);
  });
  it('settings from the older single-lead version keep working', () => {
    expect(alertLeads({ leadMinutes: 30 } as never)).toEqual([30]);
    expect(alertLeads({ leads: [] })).toEqual([15]);
    expect(alertLeads({ leads: [5, 5, -1, 60] })).toEqual([60, 5]);
  });
});

describe('applying alerts on the phone (expo-notifications)', () => {
  beforeEach(() => {
    mockScheduled.length = 0;
    mockGranted = true;
  });

  it('schedules once with a deterministic identifier and a date trigger; re-applying never duplicates', async () => {
    const plan = planEconAlerts([cpi], on, NOW);
    expect(await applyEconAlerts(plan)).toMatchObject({ scheduled: 1, cancelled: 0, permission: true });
    expect(mockScheduled).toHaveLength(1);
    expect(mockScheduled[0]).toMatchObject({ identifier: `econ:${cpi.id}:15`, content: { data: { fireAt: '2026-11-13T13:15:00.000Z', url: '/intelligence' } }, trigger: { type: 'date' } });
    expect(await applyEconAlerts(plan)).toMatchObject({ scheduled: 0, cancelled: 0 });
    expect(await applyEconAlerts(planEconAlerts([cpi], on, NOW))).toMatchObject({ scheduled: 0 });
    expect(mockScheduled).toHaveLength(1);
  });

  it('a rescheduled release moves its alert; a withdrawn one loses it', async () => {
    await applyEconAlerts(planEconAlerts([cpi], on, NOW));
    const later = ev('Consumer Price Index', '2026-11-13', '10:00');
    await applyEconAlerts(planEconAlerts([later], on, NOW));
    expect(mockScheduled.map((r) => r.content.data.fireAt)).toEqual(['2026-11-13T14:45:00.000Z']);
    await applyEconAlerts([]);
    expect(mockScheduled).toHaveLength(0);
  });

  it('TEST DATA: a release moved to another day cancels the old alert and schedules the new one', async () => {
    const first = ev('TEST The Employment Situation', '2026-11-13', '08:30');
    await applyEconAlerts(planEconAlerts([first], on, NOW));
    const moved = ev('TEST The Employment Situation', '2026-11-20', '08:30');
    // After the refresh the old date is inactive and the new one active.
    await applyEconAlerts(planEconAlerts([{ ...first, active: false }, moved], on, NOW));
    expect(mockScheduled.map((r) => [r.identifier, r.content.data.fireAt])).toEqual([[`econ:${moved.id}:15`, '2026-11-20T13:15:00.000Z']]);
  });

  it('without notification permission nothing is scheduled, but stale alerts are still removed', async () => {
    await applyEconAlerts(planEconAlerts([cpi], on, NOW));
    mockGranted = false;
    expect(await applyEconAlerts(planEconAlerts([cpi, ev('The Employment Situation', '2026-11-20', '08:30')], on, NOW))).toMatchObject({ scheduled: 0, cancelled: 1, permission: false });
    expect(mockScheduled).toHaveLength(0);
  });
});

describe('reading the calendar from the backend', () => {
  type Res = { data: unknown; error: unknown };
  const fake = (events: Res, status: Res) =>
    ({
      from: (t: string) => {
        const res = t === 'economic_events' ? events : status;
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'gte', 'lte', 'order', 'limit']) q[m] = () => q;
        q.then = (ok: (v: Res) => unknown) => Promise.resolve(res).then(ok);
        return q;
      },
    }) as never;

  it('no backend → not configured (never an empty "all clear")', async () => {
    expect(await readEconomicCalendar(null)).toEqual({ status: 'not_configured' });
  });

  it('maps rows and statuses; a failed query is an error, not "no events"', async () => {
    const row = { id: 'bls:cpi:2026-11-13', source: 'bls', source_event_id: null, title: 'Consumer Price Index', name: 'CPI — Consumer Price Index', code: 'CPI', date_et: '2026-11-13', time_et: '08:30', time_status: 'published', starts_at: '2026-11-13T13:30:00+00:00', source_url: 'https://www.bls.gov/', retrieved_at: '2026-11-01T12:00:00+00:00', kind: 'scheduled_release', active: true };
    const st = { source: 'bls', checked_at: '2026-11-10T06:23:00+00:00', last_success_at: '2026-11-10T06:23:00+00:00', status: 'ok', error: null, event_count: 40, coverage_until: '2026-12-31' };
    const ok = await readEconomicCalendar(fake({ data: [row], error: null }, { data: [st], error: null }), NOW);
    expect(ok).toMatchObject({ status: 'ok', events: [{ id: row.id, startsAt: '2026-11-13T13:30:00.000Z', kind: 'scheduled_release' }], statuses: [{ source: 'bls', lastSuccessAt: '2026-11-10T06:23:00.000Z', coverageUntil: '2026-12-31' }] });
    expect(await readEconomicCalendar(fake({ data: null, error: { message: 'x' } }, { data: [], error: null }), NOW)).toMatchObject({ status: 'error' });
  });
});
