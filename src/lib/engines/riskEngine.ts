import type { Direction, InstrumentSymbol } from '@/types/domain';

import {
  cleanNumber,
  getInstrument,
  pointsBetween,
  pointsToDollars,
  pointsToTicks,
} from './instrumentEngine';

export interface TradePlanInput {
  instrument: InstrumentSymbol;
  direction: Direction;
  entry: number | null;
  stop: number | null;
  target: number | null;
  contracts: number | null;
  accountBalance?: number | null;
}

export interface TradeRiskResult {
  valid: boolean;
  errors: string[];
  pointsRisk: number | null;
  ticksRisk: number | null;
  pointsReward: number | null;
  riskDollars: number | null;
  rewardDollars: number | null;
  /** Reward divided by risk, e.g. 2 means 1:2. */
  rr: number | null;
  accountRiskPct: number | null;
}

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Pure risk calculation for a proposed trade. Never throws — returns
 * structured validation errors so the UI can explain what is wrong.
 */
export function calculateTradeRisk(input: TradePlanInput): TradeRiskResult {
  const { instrument, direction, entry, stop, target, contracts, accountBalance } = input;
  const errors: string[] = [];

  const result: TradeRiskResult = {
    valid: false,
    errors,
    pointsRisk: null,
    ticksRisk: null,
    pointsReward: null,
    riskDollars: null,
    rewardDollars: null,
    rr: null,
    accountRiskPct: null,
  };

  if (!isNum(entry) || entry <= 0) errors.push('Enter a valid entry price.');
  if (!isNum(stop) || stop <= 0) errors.push('A stop price is required.');
  if (!isNum(contracts) || contracts <= 0 || !Number.isInteger(contracts)) {
    errors.push('Contracts must be a whole number above zero.');
  }
  if (errors.length > 0 || !isNum(entry) || !isNum(stop) || !isNum(contracts)) return result;

  if (direction === 'long' && stop >= entry) errors.push('For a long, the stop must be below entry.');
  if (direction === 'short' && stop <= entry) errors.push('For a short, the stop must be above entry.');

  if (isNum(target)) {
    if (direction === 'long' && target <= entry) errors.push('For a long, the target must be above entry.');
    if (direction === 'short' && target >= entry) errors.push('For a short, the target must be below entry.');
  }
  if (errors.length > 0) return result;

  const pointsRisk = pointsBetween(entry, stop);
  const riskDollars = pointsToDollars(instrument, pointsRisk, contracts);
  result.pointsRisk = pointsRisk;
  result.ticksRisk = pointsToTicks(instrument, pointsRisk);
  result.riskDollars = riskDollars;

  if (isNum(target)) {
    const pointsReward = pointsBetween(entry, target);
    result.pointsReward = pointsReward;
    result.rewardDollars = pointsToDollars(instrument, pointsReward, contracts);
    result.rr = pointsRisk > 0 ? cleanNumber(pointsReward / pointsRisk, 2) : null;
  }

  if (isNum(accountBalance) && accountBalance > 0) {
    result.accountRiskPct = cleanNumber((riskDollars / accountBalance) * 100, 2);
  }

  result.valid = true;
  return result;
}

/** Signed P/L in points for a closed trade (positive = profit). */
export function realizedPoints(direction: Direction, entry: number, exit: number): number {
  return cleanNumber(direction === 'long' ? exit - entry : entry - exit);
}

export function realizedPnl(
  instrument: InstrumentSymbol,
  direction: Direction,
  entry: number,
  exit: number,
  contracts: number,
): number {
  return pointsToDollars(instrument, realizedPoints(direction, entry, exit), contracts);
}

/** Realized R multiple relative to the ORIGINAL planned risk. */
export function realizedR(pnl: number, originalRiskDollars: number): number | null {
  if (originalRiskDollars <= 0) return null;
  return cleanNumber(pnl / originalRiskDollars, 2);
}

/** Unrealized P/L at a given mark price. */
export function openPnl(
  instrument: InstrumentSymbol,
  direction: Direction,
  entry: number,
  mark: number,
  contracts: number,
): number {
  return realizedPnl(instrument, direction, entry, mark, contracts);
}

/**
 * Largest whole number of contracts whose stop-out stays within the risk
 * budget, also capped by any max-contract rule. Returns 0 when not possible.
 */
export function maxContractsForRisk(
  instrument: InstrumentSymbol,
  entry: number,
  stop: number,
  riskBudget: number,
  maxContracts?: number | null,
): number {
  const pts = pointsBetween(entry, stop);
  if (pts <= 0 || riskBudget <= 0) return 0;
  const perContract = pts * getInstrument(instrument).pointValue;
  let n = Math.floor(cleanNumber(riskBudget / perContract, 6));
  if (isNum(maxContracts ?? null) && maxContracts! >= 0) n = Math.min(n, maxContracts!);
  return Math.max(0, n);
}

/**
 * Additional dollars at risk if a stop is moved. Positive means the stop
 * was widened (risk increased); zero or negative means risk was reduced.
 */
export function stopChangeRiskDelta(
  instrument: InstrumentSymbol,
  direction: Direction,
  entry: number,
  oldStop: number,
  newStop: number,
  contracts: number,
): number {
  const oldRisk = direction === 'long' ? entry - oldStop : oldStop - entry;
  const newRisk = direction === 'long' ? entry - newStop : newStop - entry;
  return pointsToDollars(instrument, cleanNumber(newRisk - oldRisk), contracts);
}

export function isStopWidened(direction: Direction, oldStop: number, newStop: number): boolean {
  return direction === 'long' ? newStop < oldStop : newStop > oldStop;
}
