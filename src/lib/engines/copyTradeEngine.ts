import type { CopyConviction, CopySettings, CopyTrade, CopyTranslationSnapshot, CopyVerdict, SourceTrader } from '@/types/copyTrade';
import type { Account, Trade, TradingRules } from '@/types/domain';
import { dayKey } from '@/utils/dates';

import type { DailyGuard } from './dailyGuardEngine';
import { cleanNumber, findInstrument, pointsBetween } from './instrumentEngine';

/**
 * Copy Trade engine (pure).
 *
 * translateCopyTrade — turns a source trader's idea into the trader's OWN size
 * and risk, and checks it against the selected account (Daily Guard: daily
 * room, drawdown buffer, trade cap) and the trader's rules. It never invents
 * account values: missing entry/stop, a missing account or an unknown
 * drawdown floor make the verdict "Requires manual review" with no size.
 * All contract math goes through instrumentEngine.
 *
 * sourceTraderStats / copyAnalytics — who is worth following, from the copy
 * log (live copies use the journal trade's real result; simulated and missed
 * copies are hypothetical and reported separately).
 */

export const VERDICT_LABEL: Record<CopyVerdict, string> = {
  safe: 'Safe to copy',
  reduce: 'Reduce size',
  exceeds: 'Exceeds risk limit',
  blocked: 'Not allowed under account rules',
  review: 'Requires manual review',
};

export const COMPLETE_SETUP = 'Complete your account setup to validate copy-trade risk.';

export const DEFAULT_COPY_SETTINGS: CopySettings = {
  accountId: null,
  sizingMode: 'fixed_risk',
  fixedRisk: null,
  percentRisk: null,
  scale: null,
  maxContracts: null,
  maxTradesPerDay: null,
  allowedInstruments: [],
  session: null,
  aPlusOnly: false,
  requireManualConfirm: true,
  blockNearLimit: true,
};

export interface CopyIdea {
  instrument: string;
  direction: 'long' | 'short';
  entry: number | null;
  stop: number | null;
  target: number | null;
  sourceContracts: number | null;
  sourceInstrument: string | null;
  conviction: CopyConviction | null;
}

export interface CopyRiskContext {
  account: Account | null;
  rules: TradingRules;
  /** Daily Guard for `account` (null when there is no account). */
  guard: DailyGuard | null;
  settings: CopySettings;
  /** Copies already logged today from this source trader. */
  copiedToday: number;
  now: Date;
  /** IANA time zone for the session window (the trader's preference). */
  timeZone: string;
}

export interface CopyTranslation extends CopyTranslationSnapshot {
  label: string;
  /** Contracts the sizing rule asks for before limits (null when it cannot be worked out). */
  desiredContracts: number | null;
  riskPerContract: number | null;
  rewardDollars: number | null;
  rr: number | null;
  /** The tightest dollar limit that applies (per-trade, daily room, drawdown). */
  maxRiskAllowed: number | null;
  /** Daily risk room left if the copy is taken at the recommended size. */
  remainingAfter: number | null;
  /** Plain-language next step ("Reduce from 4 MNQ to 2 MNQ…"). */
  suggestion: string | null;
  /** A smaller contract of the same market that fits (NQ → MNQ). */
  alternative: { instrument: string; contracts: number; riskDollars: number } | null;
  /** The trader must confirm before logging (settings or a warning). */
  needsConfirm: boolean;
}

const fin = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n: number, sym: string) => `${n} ${sym}`;

/** Local HH:MM (minutes of day) in a time zone, without a date library. */
export function minutesInZone(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
    if (Number.isFinite(h) && Number.isFinite(m)) return (h % 24) * 60 + m;
  } catch {
    /* unknown zone → device time */
  }
  return now.getHours() * 60 + now.getMinutes();
}

const hhmm = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
};

/** Inside the copy window? (Windows may cross midnight.) Null window or unreadable times = always. */
export function inSession(window: CopySettings['session'], minutes: number): boolean {
  if (!window) return true;
  const a = hhmm(window.start);
  const b = hhmm(window.end);
  if (a == null || b == null) return true;
  return a <= b ? minutes >= a && minutes <= b : minutes >= a || minutes <= b;
}

export function translateCopyTrade(idea: CopyIdea, ctx: CopyRiskContext): CopyTranslation {
  const { account, rules, guard, settings } = ctx;
  const reasons: string[] = [];
  const blocks: string[] = [];
  const reviews: string[] = [];
  const spec = findInstrument(idea.instrument);

  const out = (verdict: CopyVerdict, extra: Partial<CopyTranslation> = {}): CopyTranslation => ({
    verdict,
    label: VERDICT_LABEL[verdict],
    instrument: idea.instrument,
    contracts: null,
    riskDollars: null,
    dailyRiskRemaining: guard && !guard.drawdownUnknown ? cleanNumber(guard.riskRemaining, 2) : null,
    reasons,
    desiredContracts: null,
    riskPerContract: null,
    rewardDollars: null,
    rr: null,
    maxRiskAllowed: null,
    remainingAfter: null,
    suggestion: null,
    alternative: null,
    needsConfirm: true,
    ...extra,
  });

  // ── Inputs: never fake precision.
  if (!spec) {
    reasons.push(`${idea.instrument || 'This instrument'} is not in your contract list — add it under Instruments to size it.`);
    return out('review');
  }
  if (!fin(idea.entry) || !fin(idea.stop)) {
    reasons.push('Add the entry and stop to size this copy.');
    return out('review');
  }
  const points = pointsBetween(idea.entry, idea.stop);
  if (points <= 0) {
    reasons.push('Entry and stop are the same price — the risk cannot be measured.');
    return out('review');
  }
  if ((idea.direction === 'long' && idea.stop >= idea.entry) || (idea.direction === 'short' && idea.stop <= idea.entry)) {
    reasons.push(`The stop is on the wrong side of the entry for a ${idea.direction}. Check the direction or prices.`);
    return out('review');
  }
  const riskPerContract = cleanNumber(points * spec.pointValue, 2);
  const rewardPerContract = fin(idea.target) ? cleanNumber(pointsBetween(idea.entry, idea.target) * spec.pointValue, 2) : null;
  const rr = rewardPerContract != null ? cleanNumber(rewardPerContract / riskPerContract, 2) : null;

  if (!account || !guard) {
    reasons.push(COMPLETE_SETUP);
    return out('review', { riskPerContract, rr });
  }

  // ── Copy-settings filters (the trader's own rules for this source).
  if (settings.allowedInstruments.length && !settings.allowedInstruments.includes(idea.instrument))
    blocks.push(`${idea.instrument} is not on your copy list for this trader (${settings.allowedInstruments.join(', ')}).`);
  if (settings.session && !inSession(settings.session, minutesInZone(ctx.now, ctx.timeZone)))
    blocks.push(`Outside your copy hours for this trader (${settings.session.start}–${settings.session.end}).`);
  if (settings.aPlusOnly && idea.conviction !== 'A+') blocks.push('You only copy A+ setups from this trader.');
  if (fin(settings.maxTradesPerDay) && settings.maxTradesPerDay > 0 && ctx.copiedToday >= settings.maxTradesPerDay)
    blocks.push(`You already copied ${ctx.copiedToday} of ${settings.maxTradesPerDay} trades from this trader today.`);

  // ── Account rules (Daily Guard): a STOP never lets a copy through.
  if (guard.status === 'STOP') blocks.push(...guard.reasons.map((r) => `Account: ${r}`));
  if (guard.drawdownUnknown) reviews.push('Drawdown floor unknown — add the liquidation threshold to your account before copying.');

  // ── Dollar limits.
  const limits: { value: number; why: string }[] = [];
  if (fin(rules.maxRiskPerTrade) && rules.maxRiskPerTrade > 0) limits.push({ value: rules.maxRiskPerTrade, why: `your max risk per trade (${usd(rules.maxRiskPerTrade)})` });
  const dailyKnown = guard.dailyLimit > 0 || guard.drawdownBuffer != null;
  if (dailyKnown && !guard.drawdownUnknown) limits.push({ value: Math.max(0, guard.riskRemaining), why: `today’s remaining risk (${usd(Math.max(0, guard.riskRemaining))})` });
  if (!dailyKnown) reviews.push('No daily loss limit or drawdown on this account — set them so Prop Guard can check daily risk.');
  const tightest = limits.length ? limits.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  const maxRiskAllowed = tightest?.value ?? null;

  // ── Sizing rule → desired contracts.
  let desired: number | null = null;
  let sizingBudget: number | null = null;
  let sizingNote = '';
  switch (settings.sizingMode) {
    case 'fixed_risk':
      if (fin(settings.fixedRisk) && settings.fixedRisk > 0) {
        sizingBudget = settings.fixedRisk;
        desired = Math.floor(cleanNumber(settings.fixedRisk / riskPerContract, 6));
        sizingNote = `${usd(settings.fixedRisk)} fixed risk`;
      }
      break;
    case 'percent_risk':
      if (fin(settings.percentRisk) && settings.percentRisk > 0 && fin(account.balance) && account.balance > 0) {
        const budget = (account.balance * settings.percentRisk) / 100;
        sizingBudget = budget;
        desired = Math.floor(cleanNumber(budget / riskPerContract, 6));
        sizingNote = `${settings.percentRisk}% of ${usd(account.balance)} = ${usd(budget)}`;
      }
      break;
    case 'scale':
      if (fin(idea.sourceContracts) && idea.sourceContracts > 0 && settings.scale && settings.scale.source > 0 && settings.scale.mine >= 0) {
        desired = Math.floor(cleanNumber((idea.sourceContracts * settings.scale.mine) / settings.scale.source, 6));
        sizingNote = `source ${idea.sourceContracts} × ${settings.scale.mine}/${settings.scale.source}`;
      }
      break;
    case 'mirror':
      if (fin(idea.sourceContracts) && idea.sourceContracts > 0) {
        desired = Math.floor(idea.sourceContracts);
        sizingNote = `mirror ${idea.sourceContracts}`;
      }
      break;
  }
  // Source in minis, copy in micros (or the reverse): scale / mirror counts are converted by the catalog ratio.
  if (desired != null && (settings.sizingMode === 'scale' || settings.sizingMode === 'mirror') && idea.sourceInstrument && idea.sourceInstrument !== idea.instrument) {
    const src = findInstrument(idea.sourceInstrument);
    if (src && (src.micro === spec.symbol || spec.mini === src.symbol)) desired = desired * spec.miniEquivalentRatio;
    else if (src && (src.mini === spec.symbol || spec.micro === src.symbol)) desired = Math.floor(desired / src.miniEquivalentRatio);
  }
  if (desired == null) reviews.push('Set how you size copies from this trader (fixed risk, % of account, or a scaling rule).');

  // ── Caps: contract limits and the tightest dollar limit.
  const caps = [settings.maxContracts, account.rules.maxContracts].filter((x): x is number => fin(x) && x > 0);
  const contractCap = caps.length ? Math.min(...caps) : null;
  const byRisk = maxRiskAllowed != null ? Math.floor(cleanNumber(maxRiskAllowed / riskPerContract, 6)) : null;
  const allowedMax = [contractCap, byRisk].filter((x): x is number => x != null);
  const allowed = allowedMax.length ? Math.min(...allowedMax) : null;

  // A smaller contract of the same market, when the full-size one does not fit.
  const microSym = spec.micro;
  const micro = microSym ? findInstrument(microSym) : undefined;
  const altFor = (budget: number | null) => {
    if (!micro || budget == null) return null;
    const per = cleanNumber(points * micro.pointValue, 2);
    let n = Math.floor(cleanNumber(budget / per, 6));
    if (contractCap != null) n = Math.min(n, contractCap);
    return n >= 1 ? { instrument: micro.symbol, contracts: n, riskDollars: cleanNumber(n * per, 2) } : null;
  };

  const sym = spec.symbol;
  if (blocks.length) {
    reasons.push(...blocks, ...reviews);
    return out('blocked', { riskPerContract, rr, maxRiskAllowed, desiredContracts: desired, suggestion: 'Trade blocked — skip this copy or log it as missed.' });
  }
  if (reviews.length && (desired == null || guard.drawdownUnknown)) {
    reasons.push(...reviews);
    return out('review', { riskPerContract, rr, maxRiskAllowed, desiredContracts: desired });
  }

  if (allowed != null && allowed < 1) {
    const alt = altFor(maxRiskAllowed);
    reasons.push(`One ${sym} risks ${usd(riskPerContract)} — more than ${tightest?.why ?? 'your limit'}.`);
    const dailyBound = tightest?.why.startsWith('today');
    return out('exceeds', {
      riskPerContract,
      rr,
      maxRiskAllowed,
      desiredContracts: desired,
      alternative: alt,
      suggestion: alt ? `Use ${plural(alt.contracts, alt.instrument)} instead (${usd(alt.riskDollars)} risk) to stay within limits.` : dailyBound ? 'Trade blocked: exceeds remaining daily risk.' : 'The stop is too wide for your limits — skip this copy.',
    });
  }

  const want = desired ?? 0;
  const contracts = allowed != null ? Math.min(want, allowed) : want;
  if (contracts < 1) {
    reasons.push(`Your sizing rule (${sizingNote}) gives less than one ${sym} at ${usd(riskPerContract)} risk per contract.`);
    const budgets = [maxRiskAllowed, sizingBudget].filter((x): x is number => x != null);
    const alt = altFor(budgets.length ? Math.min(...budgets) : null);
    return out('exceeds', { riskPerContract, rr, maxRiskAllowed, desiredContracts: desired, alternative: alt, suggestion: alt ? `Use ${plural(alt.contracts, alt.instrument)} instead (${usd(alt.riskDollars)} risk).` : 'The stop is too wide for your sizing rule — skip this copy.' });
  }
  const riskDollars = cleanNumber(contracts * riskPerContract, 2);
  const remainingAfter = dailyKnown && !guard.drawdownUnknown ? cleanNumber(Math.max(0, guard.riskRemaining - riskDollars), 2) : null;
  const rewardDollars = rewardPerContract != null ? cleanNumber(rewardPerContract * contracts, 2) : null;
  reasons.push(`${plural(contracts, sym)} × ${usd(riskPerContract)} = ${usd(riskDollars)} risk${sizingNote ? ` (${sizingNote})` : ''}.`);
  if (fin(idea.sourceContracts) && idea.sourceInstrument) reasons.push(`Source: ${plural(idea.sourceContracts, idea.sourceInstrument)}.`);
  if (remainingAfter != null) reasons.push(`${usd(remainingAfter)} of today’s risk would remain.`);
  reasons.push(...reviews);

  // Near the daily / drawdown limit: warn (and, when the trader asked, block).
  const nearLimit = remainingAfter != null && guard.dailyLimit > 0 && remainingAfter < guard.dailyLimit * 0.25;
  if (nearLimit) {
    const msg = `This copy leaves only ${usd(remainingAfter!)} of today’s risk.`;
    if (settings.blockNearLimit) {
      reasons.unshift(msg + ' You block copies this close to your daily limit.');
      return out('blocked', { contracts, riskDollars, riskPerContract, rr, rewardDollars, maxRiskAllowed, remainingAfter, desiredContracts: desired, suggestion: 'Trade blocked: too close to your daily loss limit.' });
    }
    reasons.unshift(msg);
  }

  const needsConfirm = settings.requireManualConfirm || guard.status === 'CAUTION' || nearLimit;
  const base = { contracts, riskDollars, riskPerContract, rr, rewardDollars, maxRiskAllowed, remainingAfter, desiredContracts: desired, needsConfirm };
  if (desired != null && contracts < desired) {
    const why = contractCap != null && contracts === contractCap && (byRisk == null || contractCap <= byRisk) ? 'your contract cap' : (tightest?.why ?? 'your limits');
    return out('reduce', { ...base, suggestion: `Reduce from ${plural(desired, sym)} to ${plural(contracts, sym)} to stay within ${why}.` });
  }
  if (reviews.length) return out('review', base);
  return out('safe', { ...base, suggestion: null });
}

// ───────────────────────────── Copy log helpers ─────────────────────────────

/** Copies logged today (any mode) from one source trader. */
export function copiedTodayCount(copies: CopyTrade[], sourceTraderId: string, now: Date): number {
  const today = dayKey(now.toISOString());
  return copies.filter((c) => c.sourceTraderId === sourceTraderId && dayKey(c.at) === today).length;
}

/** Hypothetical result of a simulated / missed copy at the trader's size. */
export function copyOutcomeFor(c: Pick<CopyTrade, 'instrument' | 'direction' | 'entry' | 'stop' | 'contracts'>, exitPrice: number): { pnl: number | null; r: number | null } {
  const spec = findInstrument(c.instrument);
  const risk = pointsBetween(c.entry, c.stop);
  if (!spec || risk <= 0) return { pnl: null, r: null };
  const pts = c.direction === 'long' ? exitPrice - c.entry : c.entry - exitPrice;
  // No allowed size (the copy did not fit): R still measures the idea, but there is no dollar result.
  return { pnl: c.contracts > 0 ? cleanNumber(pts * spec.pointValue * c.contracts, 2) : null, r: cleanNumber(pts / risk, 2) };
}

export interface CopyResult {
  closed: boolean;
  pnl: number | null;
  r: number | null;
  /** Real money (live, journaled) vs a hypothetical result. */
  real: boolean;
}

/** The result of a copy: the journal trade for live copies, else the recorded outcome. */
export function copyResult(c: CopyTrade, tradesById: Map<string, Trade>): CopyResult {
  if (c.mode === 'live' && c.tradeId) {
    const t = tradesById.get(c.tradeId);
    if (!t || t.status !== 'closed') return { closed: false, pnl: null, r: null, real: true };
    return { closed: true, pnl: t.pnl, r: t.realizedR, real: true };
  }
  const o = c.outcome;
  if (!o || o.exitPrice == null) return { closed: false, pnl: null, r: null, real: false };
  return { closed: true, pnl: o.pnl, r: o.r, real: false };
}

/** Minimum closed copies before Prop Guard says keep / reduce / stop. */
export const FOLLOW_MIN_SAMPLE = 10;

export type FollowVerdict = 'too_few' | 'keep' | 'reduce' | 'stop';
export const FOLLOW_LABEL: Record<FollowVerdict, string> = {
  too_few: 'Not enough copies yet',
  keep: 'Keep following',
  reduce: 'Reduce size',
  stop: 'Consider stopping',
};

export interface SourceTraderStats {
  sourceTraderId: string;
  name: string;
  logged: number;
  live: number;
  closed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  /** Live copies only — real journaled money. */
  netPnl: number;
  /** Simulated / missed copies at your size — hypothetical. */
  hypotheticalPnl: number;
  /** Sum of losing live copies (a positive number). */
  lossesTotal: number;
  todayCount: number;
  todayPnl: number;
  verdict: FollowVerdict;
  verdictReason: string;
}

export function sourceTraderStats(trader: Pick<SourceTrader, 'id' | 'name'>, copies: CopyTrade[], trades: Trade[], now: Date): SourceTraderStats {
  const byId = new Map(trades.map((t) => [t.id, t]));
  const mine = copies.filter((c) => c.sourceTraderId === trader.id);
  const today = dayKey(now.toISOString());
  let closed = 0;
  let wins = 0;
  let losses = 0;
  let rSum = 0;
  let rN = 0;
  let netPnl = 0;
  let hypotheticalPnl = 0;
  let lossesTotal = 0;
  let todayPnl = 0;
  for (const c of mine) {
    const res = copyResult(c, byId);
    if (!res.closed) continue;
    closed++;
    if (fin(res.r)) {
      rSum += res.r;
      rN++;
      if (res.r > 0) wins++;
      else if (res.r < 0) losses++;
    } else if (fin(res.pnl)) {
      if (res.pnl > 0) wins++;
      else if (res.pnl < 0) losses++;
    }
    if (fin(res.pnl)) {
      if (res.real) {
        netPnl += res.pnl;
        if (res.pnl < 0) lossesTotal += -res.pnl;
        if (dayKey(c.at) === today) todayPnl += res.pnl;
      } else hypotheticalPnl += res.pnl;
    }
  }
  const avgR = rN ? cleanNumber(rSum / rN, 2) : null;
  const winRate = closed ? cleanNumber(wins / closed, 4) : null;
  let verdict: FollowVerdict = 'too_few';
  let verdictReason = `${closed} of ${FOLLOW_MIN_SAMPLE} closed copies needed before judging this trader.`;
  if (closed >= FOLLOW_MIN_SAMPLE && avgR != null) {
    if (avgR >= 0.2) {
      verdict = 'keep';
      verdictReason = `Average ${avgR.toFixed(2)}R over ${closed} copies so far. Past results do not guarantee future ones.`;
    } else if (avgR > -0.1) {
      verdict = 'reduce';
      verdictReason = `About breakeven (${avgR.toFixed(2)}R over ${closed} copies) — copying at a smaller size limits the damage.`;
    } else {
      verdict = 'stop';
      verdictReason = `Losing ${avgR.toFixed(2)}R on average over ${closed} copies.`;
    }
  }
  return {
    sourceTraderId: trader.id,
    name: trader.name,
    logged: mine.length,
    live: mine.filter((c) => c.mode === 'live').length,
    closed,
    wins,
    losses,
    winRate,
    avgR,
    netPnl: cleanNumber(netPnl, 2),
    hypotheticalPnl: cleanNumber(hypotheticalPnl, 2),
    lossesTotal: cleanNumber(lossesTotal, 2),
    todayCount: mine.filter((c) => dayKey(c.at) === today).length,
    todayPnl: cleanNumber(todayPnl, 2),
    verdict,
    verdictReason,
  };
}

export interface CopyAnalytics {
  traders: SourceTraderStats[];
  activeTraders: number;
  copiedToday: number;
  todayPnl: number;
  mostCopied: SourceTraderStats | null;
  /** Highest average R among traders with at least 3 closed copies. */
  best: SourceTraderStats | null;
  /** Largest real losses. */
  mostLosses: SourceTraderStats | null;
  /** Average R: copied (closed live) vs the trader's own closed trades. */
  copiedVsOwn: { copiedAvgR: number | null; copiedCount: number; ownAvgR: number | null; ownCount: number };
  /** Setups with at least 3 closed copies, best average R first. */
  setups: { setup: string; count: number; avgR: number }[];
}

const avg = (xs: number[]) => (xs.length ? cleanNumber(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null);

export function copyAnalytics(traders: SourceTrader[], copies: CopyTrade[], trades: Trade[], now: Date): CopyAnalytics {
  const stats = traders.filter((t) => !t.archived || copies.some((c) => c.sourceTraderId === t.id)).map((t) => sourceTraderStats(t, copies, trades, now));
  const withCopies = stats.filter((s) => s.logged > 0);
  const mostCopied = withCopies.length ? withCopies.reduce((a, b) => (b.logged > a.logged ? b : a)) : null;
  const ranked = stats.filter((s) => s.closed >= 3 && s.avgR != null);
  const best = ranked.length ? ranked.reduce((a, b) => (b.avgR! > a.avgR! ? b : a)) : null;
  const losers = stats.filter((s) => s.lossesTotal > 0);
  const mostLosses = losers.length ? losers.reduce((a, b) => (b.lossesTotal > a.lossesTotal ? b : a)) : null;
  const closedTrades = trades.filter((t) => t.status === 'closed' && fin(t.realizedR));
  const copiedR = closedTrades.filter((t) => t.origin === 'copied').map((t) => t.realizedR!);
  const ownR = closedTrades.filter((t) => t.origin !== 'copied').map((t) => t.realizedR!);
  const byId = new Map(trades.map((t) => [t.id, t]));
  const setupMap = new Map<string, { label: string; rs: number[] }>();
  for (const c of copies) {
    const key = c.setup.trim().toLowerCase();
    if (!key) continue;
    const res = copyResult(c, byId);
    if (!res.closed || !fin(res.r)) continue;
    const e = setupMap.get(key) ?? { label: c.setup.trim(), rs: [] };
    e.rs.push(res.r);
    setupMap.set(key, e);
  }
  const setups = [...setupMap.values()].filter((e) => e.rs.length >= 3).map((e) => ({ setup: e.label, count: e.rs.length, avgR: avg(e.rs)! })).sort((a, b) => b.avgR - a.avgR);
  return {
    traders: stats,
    activeTraders: traders.filter((t) => t.isActive && !t.archived).length,
    copiedToday: stats.reduce((n, s) => n + s.todayCount, 0),
    todayPnl: cleanNumber(stats.reduce((n, s) => n + s.todayPnl, 0), 2),
    mostCopied,
    best,
    mostLosses,
    copiedVsOwn: { copiedAvgR: avg(copiedR), copiedCount: copiedR.length, ownAvgR: avg(ownR), ownCount: ownR.length },
    setups,
  };
}

// ───────────────────────────── Journal filters ─────────────────────────────

export type OriginFilter = 'all' | 'self' | 'copied';

/** Journal filter by origin and (optionally) source trader. Trades without an origin are the trader's own. */
export function filterByOrigin(trades: Trade[], origin: OriginFilter, sourceTraderId: string | null = null): Trade[] {
  return trades.filter((t) => {
    const copied = t.origin === 'copied';
    if (origin === 'self' && copied) return false;
    if (origin === 'copied' && !copied) return false;
    if (sourceTraderId && t.sourceTraderId !== sourceTraderId) return false;
    return true;
  });
}

/** Snapshot of a translation as stored on the copy log. */
export function snapshotOf(t: CopyTranslation): CopyTranslationSnapshot {
  return { verdict: t.verdict, instrument: t.instrument, contracts: t.contracts, riskDollars: t.riskDollars, dailyRiskRemaining: t.dailyRiskRemaining, reasons: t.reasons };
}

/**
 * The open journal trade for a LIVE copy (origin `copied`). It is closed
 * through the usual live monitor / journal flows; risk comes from the
 * instrument catalog at the copied size.
 */
export function buildCopiedTrade(c: CopyTrade, accountId: string, accountBalance: number | null, tradeId: string): Trade | null {
  const spec = findInstrument(c.instrument);
  if (!spec || c.contracts < 1) return null;
  const riskDollars = cleanNumber(pointsBetween(c.entry, c.stop) * spec.pointValue * c.contracts, 2);
  if (riskDollars <= 0) return null;
  const rewardDollars = c.target != null ? cleanNumber(pointsBetween(c.entry, c.target) * spec.pointValue * c.contracts, 2) : null;
  return {
    id: tradeId,
    accountId,
    strategyId: null,
    sessionId: null,
    instrument: c.instrument,
    direction: c.direction,
    entryPrice: c.entry,
    stopPrice: c.stop,
    originalStopPrice: c.stop,
    targetPrice: c.target,
    exitPrice: null,
    contracts: c.contracts,
    riskDollars,
    rewardDollars,
    rMultiple: rewardDollars != null ? cleanNumber(rewardDollars / riskDollars, 2) : null,
    realizedR: null,
    pnl: null,
    points: null,
    status: 'open',
    openedAt: c.at,
    closedAt: null,
    bias: c.direction === 'long' ? 'bullish' : 'bearish',
    checklist: [],
    rulesFollowed: [],
    rulesViolated: [],
    setupScore: null,
    setupGrade: null,
    disciplineScore: null,
    notes: [c.setup && `Copied setup: ${c.setup}`, c.notes].filter(Boolean).join('\n'),
    aiSummary: null,
    emotion: null,
    setupRating: null,
    screenshotUri: c.screenshotUri,
    source: 'manual',
    journaled: false,
    mae: null,
    mfe: null,
    accountBalance,
    strategyName: c.setup ? `Copy · ${c.sourceTraderName}` : null,
    origin: 'copied',
    copyTradeId: c.id,
    sourceTraderId: c.sourceTraderId,
    sourceTraderName: c.sourceTraderName,
  };
}
