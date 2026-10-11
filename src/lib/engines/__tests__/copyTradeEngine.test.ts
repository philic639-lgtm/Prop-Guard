/**
 * Copy Trade: risk translation against the selected account, verdicts,
 * reduced-size and micro suggestions, analytics by source trader, journal
 * origin filters. Every number comes from the instrument catalog
 * (MNQ $2/pt, NQ $20/pt, MES $5/pt, ES $50/pt).
 */
import { makeAccount, makeRules, makeTrade } from '@/test/fixtures';
import type { CopySettings, CopyTrade, SourceTrader } from '@/types/copyTrade';

import {
  buildCopiedTrade,
  COMPLETE_SETUP,
  copiedTodayCount,
  copyAnalytics,
  copyOutcomeFor,
  DEFAULT_COPY_SETTINGS,
  filterByOrigin,
  FOLLOW_MIN_SAMPLE,
  inSession,
  sourceTraderStats,
  translateCopyTrade,
  type CopyIdea,
  type CopyRiskContext,
} from '../copyTradeEngine';
import { computeDailyGuard } from '../dailyGuardEngine';

const NOW = new Date('2026-10-12T14:30:00Z'); // 10:30 New York
const settings = (o: Partial<CopySettings> = {}): CopySettings => ({ ...DEFAULT_COPY_SETTINGS, requireManualConfirm: false, blockNearLimit: false, ...o });
// A $50k prop account: $1,000 daily loss limit, $2,000 trailing drawdown, 10 contract cap.
const account = makeAccount({ id: 'acc1', size: 50_000, startingBalance: 50_000, balance: 50_000, highWaterMark: 50_000, rules: { dailyLossLimit: 1_000, maxDrawdown: 2_000, drawdownType: 'trailing', maxContracts: 10 } as never });
const rules = makeRules({ maxRiskPerTrade: 300, dailyStop: 600, maxTradesPerDay: 5 });
function ctx(o: Partial<CopyRiskContext> = {}, trades = [] as ReturnType<typeof makeTrade>[]): CopyRiskContext {
  const acc = o.account === undefined ? account : o.account;
  return {
    account: acc,
    rules: o.rules ?? rules,
    guard: acc ? computeDailyGuard({ account: acc, rules: o.rules ?? rules, trades, now: NOW }) : null,
    settings: settings(),
    copiedToday: 0,
    now: NOW,
    timeZone: 'America/New_York',
    ...o,
  };
}
const idea = (o: Partial<CopyIdea> = {}): CopyIdea => ({ instrument: 'MNQ', direction: 'long', entry: 20_000, stop: 19_980, target: 20_040, sourceContracts: null, sourceInstrument: null, conviction: 'A', ...o });

describe('risk translation uses the selected account rules (7)', () => {
  it('fixed $160 risk on MNQ with a 20-pt stop ($40/contract) → 4 MNQ, safe, daily room after the trade', () => {
    const t = translateCopyTrade(idea(), ctx({ settings: settings({ fixedRisk: 160 }) }));
    expect(t).toMatchObject({ verdict: 'safe', label: 'Safe to copy', contracts: 4, riskPerContract: 40, riskDollars: 160, rr: 2, rewardDollars: 320 });
    // Daily room = the tighter of the $600 personal stop and the $1,000 firm DLL.
    expect(t.dailyRiskRemaining).toBe(600);
    expect(t.remainingAfter).toBe(440);
  });

  it('percent sizing uses the account balance (0.5% of $50,000 = $250 → 6 MNQ)', () => {
    const t = translateCopyTrade(idea(), ctx({ settings: settings({ sizingMode: 'percent_risk', percentRisk: 0.5 }) }));
    expect(t.contracts).toBe(6);
  });

  it('a different selected account changes the answer (smaller daily room)', () => {
    const small = makeAccount({ id: 'acc2', rules: { dailyLossLimit: 100, maxDrawdown: 1_000, drawdownType: 'trailing', maxContracts: 10 } as never });
    const t = translateCopyTrade(idea(), ctx({ account: small, settings: settings({ fixedRisk: 160 }) }));
    expect(t).toMatchObject({ verdict: 'reduce', contracts: 2, riskDollars: 80 });
  });
});

describe('oversizing is flagged (8) and a reduced size is suggested (9)', () => {
  it('mirror: source 10 MNQ ($400) > max $300 per trade → reduce to 7 MNQ', () => {
    const t = translateCopyTrade(idea({ sourceContracts: 10, sourceInstrument: 'MNQ' }), ctx({ settings: settings({ sizingMode: 'mirror' }) }));
    expect(t.verdict).toBe('reduce');
    expect(t.contracts).toBe(7);
    expect(t.suggestion).toBe('Reduce from 10 MNQ to 7 MNQ to stay within your max risk per trade ($300).');
  });

  it('scaling rule: source 5 → mine 2', () => {
    const t = translateCopyTrade(idea({ sourceContracts: 5, sourceInstrument: 'MNQ' }), ctx({ settings: settings({ sizingMode: 'scale', scale: { source: 5, mine: 2 } }) }));
    expect(t).toMatchObject({ verdict: 'safe', contracts: 2 });
  });

  it('source trades minis, I trade micros: 2 NQ mirrored = 20 MNQ, capped by my contract limit', () => {
    const t = translateCopyTrade(idea({ sourceContracts: 2, sourceInstrument: 'NQ', stop: 19_995 }), ctx({ settings: settings({ sizingMode: 'mirror', maxContracts: 4 }) }));
    expect(t.desiredContracts).toBe(20);
    expect(t).toMatchObject({ verdict: 'reduce', contracts: 4 });
    expect(t.suggestion).toMatch(/to 4 MNQ to stay within your contract cap/);
  });

  it('one NQ does not fit ($400 > $300) → exceeds, with a micro alternative', () => {
    const t = translateCopyTrade(idea({ instrument: 'NQ' }), ctx({ settings: settings({ fixedRisk: 300 }) }));
    expect(t).toMatchObject({ verdict: 'exceeds', label: 'Exceeds risk limit', contracts: null });
    expect(t.alternative).toEqual({ instrument: 'MNQ', contracts: 7, riskDollars: 280 });
    expect(t.suggestion).toBe('Use 7 MNQ instead ($280 risk) to stay within limits.');
  });

  it('a stop too wide for today’s remaining risk → "Trade blocked: exceeds remaining daily risk."', () => {
    const lost = [makeTrade({ accountId: 'acc1', status: 'closed', pnl: -560, closedAt: NOW.toISOString(), openedAt: NOW.toISOString(), instrument: 'MES', contracts: 1, riskDollars: 100 })];
    const tight = makeRules({ maxRiskPerTrade: 1_000, dailyStop: 600, maxTradesPerDay: 5, maxConsecutiveLosses: 5 });
    const t = translateCopyTrade(idea({ instrument: 'ES', stop: 19_990 }), ctx({ rules: tight, settings: settings({ fixedRisk: 1_000 }) }, lost));
    expect(t.verdict).toBe('exceeds');
    expect(t.reasons[0]).toMatch(/more than today’s remaining risk \(\$40\)/);
    expect(t.suggestion).toBe('Trade blocked: exceeds remaining daily risk.');
  });

  it('near the daily limit: blocked when the trader asked for it, otherwise a warning that needs confirmation', () => {
    const c = { settings: settings({ fixedRisk: 200, blockNearLimit: true }), rules: makeRules({ maxRiskPerTrade: 500, dailyStop: 600, maxTradesPerDay: 5 }) };
    const t = translateCopyTrade(idea(), ctx(c));
    expect(t.verdict).toBe('safe'); // $200 leaves $400 of $600
    // 40-pt stop = $80 per MNQ: $480 → 6 MNQ, leaving $120 of the $600 daily room (< 25%).
    const bigger = translateCopyTrade(idea({ stop: 19_960 }), ctx({ ...c, settings: settings({ fixedRisk: 480, blockNearLimit: true }) }));
    expect(bigger).toMatchObject({ verdict: 'blocked', label: 'Not allowed under account rules' });
    const warned = translateCopyTrade(idea({ stop: 19_960 }), ctx({ ...c, settings: settings({ fixedRisk: 480, blockNearLimit: false }) }));
    expect(warned).toMatchObject({ verdict: 'safe', needsConfirm: true });
    expect(warned.reasons[0]).toMatch(/leaves only \$120/);
  });
});

describe('copy-settings filters and account rules block a copy', () => {
  it('instrument list, A+ only, trades per day, copy hours', () => {
    expect(translateCopyTrade(idea(), ctx({ settings: settings({ fixedRisk: 100, allowedInstruments: ['MES'] }) })).verdict).toBe('blocked');
    expect(translateCopyTrade(idea({ conviction: 'A' }), ctx({ settings: settings({ fixedRisk: 100, aPlusOnly: true }) })).reasons[0]).toMatch(/A\+ setups/);
    expect(translateCopyTrade(idea(), ctx({ copiedToday: 2, settings: settings({ fixedRisk: 100, maxTradesPerDay: 2 }) })).verdict).toBe('blocked');
    expect(translateCopyTrade(idea(), ctx({ settings: settings({ fixedRisk: 100, session: { start: '09:30', end: '10:00' } }) })).verdict).toBe('blocked');
    expect(translateCopyTrade(idea(), ctx({ settings: settings({ fixedRisk: 100, session: { start: '09:30', end: '11:00' } }) })).verdict).toBe('safe');
    expect(inSession({ start: '22:00', end: '02:00' }, 30)).toBe(true);
  });

  it('a Daily Guard STOP (daily loss reached) is never bypassed', () => {
    const lost = [makeTrade({ accountId: 'acc1', status: 'closed', pnl: -650, closedAt: NOW.toISOString(), openedAt: NOW.toISOString() })];
    const t = translateCopyTrade(idea(), ctx({ settings: settings({ fixedRisk: 100 }) }, lost));
    expect(t.verdict).toBe('blocked');
    expect(t.reasons.join(' ')).toMatch(/Account: You've reached your daily loss limit/);
  });
});

describe('missing account setup shows guidance — nothing invented (12)', () => {
  it('no account → review with "Complete your account setup…", no size', () => {
    const t = translateCopyTrade(idea(), ctx({ account: null, settings: settings({ fixedRisk: 160 }) }));
    expect(t).toMatchObject({ verdict: 'review', contracts: null, riskDollars: null });
    expect(t.reasons).toContain(COMPLETE_SETUP);
  });

  it('missing stop / wrong-side stop / unknown instrument → review', () => {
    expect(translateCopyTrade(idea({ stop: null }), ctx()).reasons[0]).toMatch(/entry and stop/);
    expect(translateCopyTrade(idea({ stop: 20_010 }), ctx()).reasons[0]).toMatch(/wrong side/);
    expect(translateCopyTrade(idea({ instrument: 'XYZ' }), ctx()).verdict).toBe('review');
  });

  it('a prop account with an unknown drawdown floor → review, no size', () => {
    const unknown = makeAccount({ id: 'acc3', rules: { maxDrawdown: null, drawdownType: null } as never });
    const t = translateCopyTrade(idea(), ctx({ account: unknown, settings: settings({ fixedRisk: 160 }) }));
    expect(t).toMatchObject({ verdict: 'review', contracts: null });
    expect(t.reasons.join(' ')).toMatch(/Drawdown floor unknown/);
  });

  it('no sizing rule set → review', () => {
    expect(translateCopyTrade(idea(), ctx({ settings: settings() })).verdict).toBe('review');
  });
});

// ───────────────────────────── Analytics (10) ─────────────────────────────

const trader = (id: string, name: string, o: Partial<SourceTrader> = {}): SourceTrader => ({ id, name, platform: 'discord', assetClass: 'futures', instruments: ['MNQ'], style: 'scalp', notes: '', trustRating: 3, isActive: true, archived: false, settings: settings(), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...o });
const copy = (o: Partial<CopyTrade>): CopyTrade => ({
  id: Math.random().toString(36).slice(2),
  sourceTraderId: 'a',
  sourceTraderName: 'Alpha',
  accountId: 'acc1',
  instrument: 'MNQ',
  direction: 'long',
  entry: 20_000,
  stop: 19_980,
  target: 20_040,
  sourceContracts: null,
  sourceInstrument: null,
  at: NOW.toISOString(),
  setup: 'ORB',
  notes: '',
  conviction: 'A',
  mode: 'simulated',
  screenshotUri: null,
  contracts: 2,
  translation: { verdict: 'safe', instrument: 'MNQ', contracts: 2, riskDollars: 80, dailyRiskRemaining: 600, reasons: [] },
  tradeId: null,
  outcome: null,
  lesson: '',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...o,
});

describe('analytics by source trader', () => {
  it('hypothetical outcome of a simulated copy: +40 pts on 2 MNQ = +$160, +2R', () => {
    expect(copyOutcomeFor(copy({}), 20_040)).toEqual({ pnl: 160, r: 2 });
    expect(copyOutcomeFor(copy({ direction: 'short', entry: 20_000, stop: 20_020 }), 20_030)).toEqual({ pnl: -120, r: -1.5 });
    // A copy that did not fit at any size: R only, no invented dollars.
    expect(copyOutcomeFor(copy({ contracts: 0 }), 20_040)).toEqual({ pnl: null, r: 2 });
  });

  it('win rate, average R, real vs hypothetical P&L, most copied, best, most losses, copied vs own', () => {
    const liveWin = makeTrade({ id: 'L1', accountId: 'acc1', status: 'closed', pnl: 200, realizedR: 2, origin: 'copied', sourceTraderId: 'a' });
    const liveLoss = makeTrade({ id: 'L2', accountId: 'acc1', status: 'closed', pnl: -100, realizedR: -1, origin: 'copied', sourceTraderId: 'b' });
    const own = makeTrade({ id: 'O1', accountId: 'acc1', status: 'closed', pnl: 50, realizedR: 0.5 });
    const copies = [
      copy({ mode: 'live', tradeId: 'L1', setup: 'ORB' }),
      copy({ outcome: { exitPrice: 19_980, pnl: -80, r: -1, closedAt: NOW.toISOString() }, setup: 'orb' }),
      copy({ outcome: { exitPrice: 20_040, pnl: 160, r: 2, closedAt: NOW.toISOString() }, setup: 'ORB ' }),
      copy({ mode: 'missed' }), // no outcome yet → not closed
      copy({ sourceTraderId: 'b', sourceTraderName: 'Bravo', mode: 'live', tradeId: 'L2', setup: 'Fade' }),
    ];
    const a = sourceTraderStats(trader('a', 'Alpha'), copies, [liveWin, liveLoss, own], NOW);
    expect(a).toMatchObject({ logged: 4, live: 1, closed: 3, wins: 2, losses: 1, avgR: 1, netPnl: 200, hypotheticalPnl: 80, todayCount: 4, todayPnl: 200, verdict: 'too_few' });
    expect(a.winRate).toBeCloseTo(2 / 3, 4);
    const all = copyAnalytics([trader('a', 'Alpha'), trader('b', 'Bravo')], copies, [liveWin, liveLoss, own], NOW);
    expect(all.mostCopied?.name).toBe('Alpha');
    expect(all.best?.name).toBe('Alpha');
    expect(all.mostLosses).toMatchObject({ name: 'Bravo', lossesTotal: 100 });
    expect(all.copiedVsOwn).toEqual({ copiedAvgR: 0.5, copiedCount: 2, ownAvgR: 0.5, ownCount: 1 });
    expect(all.setups).toEqual([{ setup: 'ORB', count: 3, avgR: 1 }]);
    expect(all).toMatchObject({ activeTraders: 2, copiedToday: 5, todayPnl: 100 });
  });

  it('keep / reduce / stop only after enough closed copies', () => {
    const closedWith = (r: number) => Array.from({ length: FOLLOW_MIN_SAMPLE }, () => copy({ outcome: { exitPrice: 1, pnl: r * 80, r, closedAt: NOW.toISOString() } }));
    expect(sourceTraderStats(trader('a', 'Alpha'), closedWith(0.5), [], NOW).verdict).toBe('keep');
    expect(sourceTraderStats(trader('a', 'Alpha'), closedWith(0), [], NOW).verdict).toBe('reduce');
    expect(sourceTraderStats(trader('a', 'Alpha'), closedWith(-0.5), [], NOW).verdict).toBe('stop');
    expect(sourceTraderStats(trader('a', 'Alpha'), closedWith(0.5).slice(1), [], NOW).verdict).toBe('too_few');
    expect(sourceTraderStats(trader('a', 'Alpha'), closedWith(0.5), [], NOW).verdictReason).toMatch(/do not guarantee/);
  });

  it('copies today per source trader (trades-per-day setting)', () => {
    expect(copiedTodayCount([copy({}), copy({}), copy({ sourceTraderId: 'b' }), copy({ at: '2026-10-01T14:00:00Z' })], 'a', NOW)).toBe(2);
  });
});

describe('journal origin (5, 6, 11)', () => {
  it('a live copy becomes an open journal trade marked copied, with catalog risk', () => {
    const t = buildCopiedTrade(copy({ mode: 'live', contracts: 3 }), 'acc1', 50_000, 'T1')!;
    expect(t).toMatchObject({ id: 'T1', status: 'open', origin: 'copied', sourceTraderId: 'a', sourceTraderName: 'Alpha', riskDollars: 120, rewardDollars: 240, rMultiple: 2, contracts: 3 });
    expect(buildCopiedTrade(copy({ contracts: 0 }), 'acc1', null, 'T2')).toBeNull();
  });

  it('filters: all / my trades / copied / by source trader — older trades without an origin are mine', () => {
    const mine = makeTrade({ id: 'm' });
    const a = makeTrade({ id: 'ca', origin: 'copied', sourceTraderId: 'a' });
    const b = makeTrade({ id: 'cb', origin: 'copied', sourceTraderId: 'b' });
    const self = makeTrade({ id: 's', origin: 'self' });
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(filterByOrigin([mine, a, b, self], 'all'))).toEqual(['m', 'ca', 'cb', 's']);
    expect(ids(filterByOrigin([mine, a, b, self], 'self'))).toEqual(['m', 's']);
    expect(ids(filterByOrigin([mine, a, b, self], 'copied'))).toEqual(['ca', 'cb']);
    expect(ids(filterByOrigin([mine, a, b, self], 'copied', 'b'))).toEqual(['cb']);
  });
});
