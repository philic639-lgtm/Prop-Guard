import type {
  Bias,
  ChecklistAnswer,
  Direction,
  Emotion,
  InstrumentSymbol,
  PendingOrigin,
  PendingRuleEvent,
  PendingTrade,
  SetupGrade,
  Trade,
  TradeSource,
} from '@/types/domain';

import { cleanNumber, getInstrument, pointsToDollars } from './instrumentEngine';
import { calculateTradeRisk, realizedPnl, realizedPoints, realizedR } from './riskEngine';

/**
 * Automatic journaling.
 *
 * Every trade checked in Analyze or the Risk Calculator becomes a PendingTrade:
 * a full snapshot of the plan (prices, size, risk, strategy, checklist, rules).
 * When the trade is done, only the result is needed — from the trader, a
 * confirmed screenshot, or a broker import — and this engine turns the pair
 * into a complete, closed journal Trade. Pure functions; no store access.
 */

// ---------------------------------------------------------------------------
// Pending snapshots
// ---------------------------------------------------------------------------

export interface PendingTradeInput {
  id: string;
  accountId: string;
  strategyId: string | null;
  instrument: InstrumentSymbol;
  direction: Direction;
  entry: number | null;
  stop: number | null;
  target: number | null;
  contracts: number | null;
  accountBalance: number | null;
  origin: PendingOrigin;
  bias?: Bias | null;
  checklist?: ChecklistAnswer[];
  rulesFollowed?: string[];
  rulesViolated?: string[];
  setupScore?: number | null;
  setupGrade?: SetupGrade | null;
  ruleEvents?: PendingRuleEvent[];
  notes?: string;
  screenshotUri?: string | null;
  /** Keep the original timestamp when re-checking the same draft. */
  createdAt?: string;
  now: Date;
}

/** Build a pending snapshot. Returns null when the numbers don't form a valid trade. */
export function buildPendingTrade(input: PendingTradeInput): PendingTrade | null {
  const risk = calculateTradeRisk({
    instrument: input.instrument,
    direction: input.direction,
    entry: input.entry,
    stop: input.stop,
    target: input.target,
    contracts: input.contracts,
    accountBalance: input.accountBalance,
  });
  if (!risk.valid || input.entry == null || input.stop == null || input.contracts == null || risk.riskDollars == null) return null;
  const nowIso = input.now.toISOString();
  return {
    id: input.id,
    accountId: input.accountId,
    strategyId: input.strategyId,
    instrument: input.instrument,
    direction: input.direction,
    entry: input.entry,
    stop: input.stop,
    target: input.target,
    contracts: input.contracts,
    accountBalance: input.accountBalance,
    riskDollars: risk.riskDollars,
    rewardDollars: risk.rewardDollars,
    rr: risk.rr,
    bias: input.bias ?? null,
    checklist: input.checklist ?? [],
    rulesFollowed: input.rulesFollowed ?? [],
    rulesViolated: input.rulesViolated ?? [],
    setupScore: input.setupScore ?? null,
    setupGrade: input.setupGrade ?? null,
    ruleEvents: input.ruleEvents ?? [],
    notes: input.notes?.trim() ?? '',
    screenshotUri: input.screenshotUri ?? null,
    origin: input.origin,
    status: 'pending',
    tradeId: null,
    createdAt: input.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

/** True when two snapshots describe the same trade plan (used to skip redundant writes). */
export function samePendingPlan(a: PendingTrade, b: PendingTrade): boolean {
  return (
    a.instrument === b.instrument &&
    a.direction === b.direction &&
    a.entry === b.entry &&
    a.stop === b.stop &&
    a.target === b.target &&
    a.contracts === b.contracts &&
    a.strategyId === b.strategyId &&
    a.setupGrade === b.setupGrade &&
    a.setupScore === b.setupScore &&
    a.bias === b.bias &&
    a.notes === b.notes &&
    a.screenshotUri === b.screenshotUri &&
    a.accountBalance === b.accountBalance &&
    a.rulesViolated.join() === b.rulesViolated.join() &&
    a.ruleEvents.map((e) => e.type + e.category).join() === b.ruleEvents.map((e) => e.type + e.category).join() &&
    a.checklist.map((c) => `${c.itemId}:${c.value}`).join() === b.checklist.map((c) => `${c.itemId}:${c.value}`).join()
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** How the trader (or a broker) reports the outcome. */
export type TradeResultInput =
  | { kind: 'target' }
  | { kind: 'stop' }
  | { kind: 'breakeven' }
  /** `pnl` overrides the computed P&L when a broker reports net-of-fees P&L. */
  | { kind: 'exit'; exitPrice: number; pnl?: number | null }
  | { kind: 'pnl'; pnl: number };

export type TradeOutcome = 'win' | 'loss' | 'breakeven';

export interface ResolvedResult {
  exitPrice: number;
  pnl: number;
  points: number;
}

/** Turn a reported result into exit price, P&L and points. Returns an error message when it can't. */
export function resolveResult(
  p: Pick<PendingTrade, 'instrument' | 'direction' | 'stop' | 'target'>,
  result: TradeResultInput,
  entry: number,
  contracts: number,
): ResolvedResult | { error: string } {
  if (!(entry > 0)) return { error: 'Enter a valid entry price.' };
  if (!(contracts >= 1)) return { error: 'Contracts must be at least 1.' };
  const spec = getInstrument(p.instrument);
  const priceDecimals = spec.priceDecimals + 2;
  let exitPrice: number;
  let pnl: number | null = null;
  switch (result.kind) {
    case 'target':
      if (p.target == null) return { error: 'This trade has no target. Enter the exit price instead.' };
      exitPrice = p.target;
      break;
    case 'stop':
      exitPrice = p.stop;
      break;
    case 'breakeven':
      exitPrice = entry;
      break;
    case 'exit':
      if (!(result.exitPrice > 0)) return { error: 'Enter a valid exit price.' };
      exitPrice = result.exitPrice;
      if (result.pnl != null && Number.isFinite(result.pnl)) pnl = cleanNumber(result.pnl, 2);
      break;
    case 'pnl': {
      if (!Number.isFinite(result.pnl)) return { error: 'Enter the P&L in dollars.' };
      pnl = cleanNumber(result.pnl, 2);
      const pts = pnl / (spec.pointValue * contracts);
      exitPrice = cleanNumber(p.direction === 'long' ? entry + pts : entry - pts, priceDecimals);
      if (!(exitPrice > 0)) return { error: 'That P&L implies a negative exit price.' };
      break;
    }
  }
  const points = cleanNumber(realizedPoints(p.direction, entry, exitPrice), priceDecimals);
  return {
    exitPrice,
    pnl: pnl ?? realizedPnl(p.instrument, p.direction, entry, exitPrice, contracts),
    points,
  };
}

export function tradeOutcome(pnl: number | null | undefined): TradeOutcome | null {
  if (pnl == null) return null;
  if (Math.abs(pnl) < 0.005) return 'breakeven';
  return pnl > 0 ? 'win' : 'loss';
}

export const OUTCOME_LABEL: Record<TradeOutcome, string> = { win: 'Win', loss: 'Loss', breakeven: 'Breakeven' };

// ---------------------------------------------------------------------------
// Pending → journal entry
// ---------------------------------------------------------------------------

export interface CompletionDetails {
  tradeId: string;
  result: TradeResultInput;
  /** Actual fill when it differs from the plan. Defaults to the planned entry / size. */
  entryFill?: number | null;
  contracts?: number | null;
  openedAt?: string;
  closedAt: string;
  sessionId?: string | null;
  notes?: string;
  emotion?: Emotion | null;
  followedPlan?: boolean | null;
  screenshotUri?: string | null;
  source?: TradeSource;
  externalId?: string | null;
}

/** Discipline score for a trade: −25 per rule event, capped at 75 when the trader says they broke the plan. */
export function pendingDisciplineScore(p: Pick<PendingTrade, 'ruleEvents'>, followedPlan: boolean | null | undefined): number {
  const base = Math.max(0, 100 - p.ruleEvents.length * 25);
  return followedPlan === false ? Math.min(base, 75) : base;
}

/** Create the full, closed journal entry from a pending snapshot and its result. */
export function completePendingTrade(p: PendingTrade, d: CompletionDetails): Trade | { error: string } {
  const entry = d.entryFill ?? p.entry;
  const contracts = d.contracts ?? p.contracts;
  const resolved = resolveResult(p, d.result, entry, contracts);
  if ('error' in resolved) return resolved;

  // Risk and R:R follow the actual fill; the planned stop and target stay as planned.
  const filledAsPlanned = entry === p.entry && contracts === p.contracts;
  const risk = filledAsPlanned
    ? null
    : calculateTradeRisk({ instrument: p.instrument, direction: p.direction, entry, stop: p.stop, target: p.target, contracts });
  const riskDollars = risk?.valid && risk.riskDollars != null ? risk.riskDollars : filledAsPlanned ? p.riskDollars : pointsToDollars(p.instrument, Math.abs(entry - p.stop), contracts);
  const rewardDollars = risk?.valid ? risk.rewardDollars : p.rewardDollars;
  const rr = risk?.valid ? risk.rr : p.rr;

  return {
    id: d.tradeId,
    accountId: p.accountId,
    strategyId: p.strategyId,
    sessionId: d.sessionId ?? null,
    instrument: p.instrument,
    direction: p.direction,
    entryPrice: entry,
    stopPrice: p.stop,
    originalStopPrice: p.stop,
    targetPrice: p.target,
    exitPrice: resolved.exitPrice,
    contracts,
    riskDollars,
    rewardDollars,
    rMultiple: rr,
    realizedR: riskDollars > 0 ? realizedR(resolved.pnl, riskDollars) : null,
    pnl: resolved.pnl,
    points: resolved.points,
    status: 'closed',
    openedAt: d.openedAt ?? p.createdAt,
    closedAt: d.closedAt,
    bias: p.bias,
    checklist: p.checklist,
    rulesFollowed: p.rulesFollowed,
    rulesViolated: p.rulesViolated,
    setupScore: p.setupScore,
    setupGrade: p.setupGrade,
    disciplineScore: pendingDisciplineScore(p, d.followedPlan),
    notes: (d.notes ?? p.notes).trim(),
    aiSummary: null,
    emotion: d.emotion ?? null,
    setupRating: null,
    screenshotUri: d.screenshotUri ?? p.screenshotUri,
    source: d.source ?? 'auto',
    journaled: true,
    mae: null,
    mfe: null,
    followedPlan: d.followedPlan ?? null,
    accountBalance: p.accountBalance,
    pendingId: p.id,
    externalId: d.externalId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Broker import (future connected brokers)
// ---------------------------------------------------------------------------

/** A completed round-trip trade as a broker reports it. Brokers adapt their fills to this shape. */
export interface BrokerClosedTrade {
  /** Broker's stable id for the round trip — used to never import twice. */
  externalId: string;
  instrument: InstrumentSymbol;
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  contracts: number;
  openedAt: string;
  closedAt: string;
  /** Net P&L when the broker reports it (includes fees). Otherwise computed from prices. */
  pnl?: number | null;
}

export type BrokerImportAction =
  /** Matched a pending plan → full journal entry with the plan's strategy, checklist and rules. */
  | { kind: 'complete-pending'; pendingId: string; trade: Trade }
  /** Matched a trade open in the live monitor → close it at the broker's exit. */
  | { kind: 'close-open'; pendingId: string | null; tradeId: string; exitPrice: number; closedAt: string; externalId: string; pnl: number | null }
  /** No plan in Prop Guard → import as a broker trade that still needs notes. */
  | { kind: 'import-new'; trade: Trade };

export interface BrokerMatchOptions {
  /** How long before the broker entry a check may have happened. */
  maxLeadMinutes?: number;
  /** Allow a check shortly after the fill (trader checked right after entering). */
  maxLagMinutes?: number;
}

/** Entry tolerance: 4 ticks or a quarter of the planned stop distance, whichever is larger. */
function entryTolerance(p: PendingTrade): number {
  const spec = getInstrument(p.instrument);
  return Math.max(spec.tickSize * 4, Math.abs(p.entry - p.stop) * 0.25);
}

/** Find the pending plan a broker trade most likely executed. */
export function matchPendingTrade(
  pendings: readonly PendingTrade[],
  bt: BrokerClosedTrade,
  accountId: string,
  opts: BrokerMatchOptions = {},
  exclude: ReadonlySet<string> = new Set(),
): PendingTrade | null {
  const lead = (opts.maxLeadMinutes ?? 8 * 60) * 60_000;
  const lag = (opts.maxLagMinutes ?? 5) * 60_000;
  const opened = Date.parse(bt.openedAt);
  let best: PendingTrade | null = null;
  let bestDiff = Infinity;
  for (const p of pendings) {
    if (exclude.has(p.id)) continue;
    if (p.accountId !== accountId || (p.status !== 'pending' && p.status !== 'entered')) continue;
    if (p.instrument !== bt.instrument || p.direction !== bt.direction) continue;
    const created = Date.parse(p.createdAt);
    if (created > opened + lag || opened - created > lead) continue;
    const diff = Math.abs(p.entry - bt.entryPrice);
    if (diff > entryTolerance(p) + 1e-9) continue;
    if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) <= 1e-9 && best && created > Date.parse(best.createdAt))) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

export interface BrokerImportInput {
  accountId: string;
  brokerTrades: readonly BrokerClosedTrade[];
  pendings: readonly PendingTrade[];
  trades: readonly Trade[];
  newId: () => string;
  options?: BrokerMatchOptions;
  /**
   * Strategy the trader selected in the pre-trade session when the trade was
   * opened. Used for broker trades that match no pending check.
   */
  strategyFor?: (bt: BrokerClosedTrade) => { id: string; name: string } | null;
}

/**
 * Plan how broker trades enter the journal. Pure: the caller applies the
 * actions to the store. Already-imported trades (same externalId) are skipped.
 */
export function planBrokerImport(input: BrokerImportInput): { actions: BrokerImportAction[]; skipped: string[] } {
  const known = new Set(input.trades.map((t) => t.externalId).filter((x): x is string => !!x));
  const used = new Set<string>();
  const actions: BrokerImportAction[] = [];
  const skipped: string[] = [];
  const ordered = [...input.brokerTrades].sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));

  for (const bt of ordered) {
    if (known.has(bt.externalId) || !(bt.entryPrice > 0) || !(bt.exitPrice > 0) || !(bt.contracts >= 1)) {
      skipped.push(bt.externalId);
      continue;
    }
    known.add(bt.externalId);
    const match = matchPendingTrade(input.pendings, bt, input.accountId, input.options, used);

    if (match?.status === 'entered' && match.tradeId) {
      const open = input.trades.find((t) => t.id === match.tradeId);
      used.add(match.id);
      if (open?.status === 'open') {
        actions.push({ kind: 'close-open', pendingId: match.id, tradeId: open.id, exitPrice: bt.exitPrice, closedAt: bt.closedAt, externalId: bt.externalId, pnl: bt.pnl ?? null });
      } else {
        skipped.push(bt.externalId);
      }
      continue;
    }

    if (match) {
      used.add(match.id);
      const trade = completePendingTrade(match, {
        tradeId: input.newId(),
        result: { kind: 'exit', exitPrice: bt.exitPrice, pnl: bt.pnl },
        entryFill: bt.entryPrice,
        contracts: bt.contracts,
        openedAt: bt.openedAt,
        closedAt: bt.closedAt,
        source: 'broker',
        externalId: bt.externalId,
      });
      if ('error' in trade) skipped.push(bt.externalId);
      else actions.push({ kind: 'complete-pending', pendingId: match.id, trade });
      continue;
    }

    actions.push({ kind: 'import-new', trade: brokerTradeToJournal(bt, input.accountId, input.newId(), input.strategyFor?.(bt) ?? null) });
  }
  return { actions, skipped };
}

/** A broker trade with no Prop Guard plan: prices and P&L are known; strategy, stop and notes are not. */
export function brokerTradeToJournal(bt: BrokerClosedTrade, accountId: string, id: string, strategy: { id: string; name: string } | null = null): Trade {
  const pnl = bt.pnl != null && Number.isFinite(bt.pnl) ? cleanNumber(bt.pnl, 2) : realizedPnl(bt.instrument, bt.direction, bt.entryPrice, bt.exitPrice, bt.contracts);
  return {
    id,
    accountId,
    strategyId: strategy?.id ?? null,
    strategyName: strategy?.name ?? null,
    sessionId: null,
    instrument: bt.instrument,
    direction: bt.direction,
    entryPrice: bt.entryPrice,
    stopPrice: bt.entryPrice,
    originalStopPrice: bt.entryPrice,
    targetPrice: null,
    exitPrice: bt.exitPrice,
    contracts: bt.contracts,
    riskDollars: 0,
    rewardDollars: null,
    rMultiple: null,
    realizedR: null,
    pnl,
    points: cleanNumber(realizedPoints(bt.direction, bt.entryPrice, bt.exitPrice), getInstrument(bt.instrument).priceDecimals + 2),
    status: 'closed',
    openedAt: bt.openedAt,
    closedAt: bt.closedAt,
    bias: null,
    checklist: [],
    rulesFollowed: [],
    rulesViolated: [],
    setupScore: null,
    setupGrade: null,
    disciplineScore: null,
    notes: '',
    aiSummary: null,
    emotion: null,
    setupRating: null,
    screenshotUri: null,
    source: 'broker',
    journaled: false,
    mae: null,
    mfe: null,
    followedPlan: null,
    accountBalance: null,
    pendingId: null,
    externalId: bt.externalId,
  };
}
