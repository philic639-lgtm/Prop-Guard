import type { AlertKind, Trade } from '@/types/domain';

import { cleanNumber, pointsToDollars } from './instrumentEngine';
import { openPnl } from './riskEngine';

/**
 * Real-time trade guidance from a mark price. Pure and broker-agnostic:
 * marks can come from a demo feed today and a broker adapter later.
 */
export interface LiveTradeState {
  pnl: number;
  points: number;
  /** Open profit expressed in R of the ORIGINAL planned risk. */
  r: number;
  /** 0..1 progress from entry to target (negative when against). */
  targetProgress: number | null;
  /** Points left before the current stop is hit (>= 0). */
  pointsToStop: number;
  stopAtBreakevenOrBetter: boolean;
  targetHit: boolean;
  stopHit: boolean;
}

export interface LiveAlert {
  kind: AlertKind;
  title: string;
  body: string;
}

export function liveState(trade: Trade, mark: number): LiveTradeState {
  const sign = trade.direction === 'long' ? 1 : -1;
  const points = cleanNumber(sign * (mark - trade.entryPrice));
  const riskPts = Math.abs(trade.entryPrice - trade.originalStopPrice);
  const pnl = openPnl(trade.instrument, trade.direction, trade.entryPrice, mark, trade.contracts);
  const r = riskPts > 0 ? cleanNumber(points / riskPts, 2) : 0;
  const rewardPts = trade.targetPrice != null ? Math.abs(trade.targetPrice - trade.entryPrice) : null;
  return {
    pnl,
    points,
    r,
    targetProgress: rewardPts ? cleanNumber(points / rewardPts, 3) : null,
    pointsToStop: Math.max(0, cleanNumber(sign * (mark - trade.stopPrice))),
    stopAtBreakevenOrBetter: sign * (trade.stopPrice - trade.entryPrice) >= 0,
    targetHit: trade.targetPrice != null && sign * (mark - trade.targetPrice) >= 0,
    stopHit: sign * (mark - trade.stopPrice) <= 0,
  };
}

const pts = (n: number) => `${n > 0 ? '+' : ''}${Number.isInteger(n) ? n : n.toFixed(2)} pts`;

/**
 * Alerts to emit for this mark, excluding kinds already sent for the trade.
 * Never suggests adding size or widening a stop.
 */
export function liveAlerts(trade: Trade, mark: number, alreadySent: ReadonlySet<AlertKind> = new Set()): LiveAlert[] {
  const s = liveState(trade, mark);
  const out: LiveAlert[] = [];
  const name = `${trade.instrument} ${trade.direction === 'long' ? 'Long' : 'Short'}`;
  const riskPts = Math.abs(trade.entryPrice - trade.originalStopPrice);
  const add = (a: LiveAlert) => {
    if (!alreadySent.has(a.kind)) out.push(a);
  };

  if (s.targetHit) {
    add({ kind: 'take_profit', title: 'Take Profit Hit', body: `${name} ${pts(s.points)} | +$${Math.round(s.pnl)}` });
    return out;
  }
  if (s.r >= 0.3) add({ kind: 'good_entry', title: 'Good Entry Confirmed', body: 'Your entry is performing well. Manage it by your plan.' });
  if (s.r >= 1 && !s.stopAtBreakevenOrBetter) {
    add({
      kind: 'move_stop_breakeven',
      title: 'Move Stop to Breakeven',
      body: `${trade.instrument} is ${pts(s.points)} in profit. Consider moving your stop to breakeven to protect your profit.`,
    });
  }
  if (s.r < 0 && riskPts > 0 && s.pointsToStop <= riskPts * 0.25 && !s.stopHit) {
    add({
      kind: 'approaching_stop',
      title: 'Trade Alert',
      body: `Price is approaching your stop. ${trade.instrument} is ${pts(s.points)} from entry (${s.pointsToStop} pt${s.pointsToStop === 1 ? '' : 's'} to stop). Stay disciplined.`,
    });
  }
  return out;
}

export function closedTradeAlert(trade: Trade): LiveAlert {
  const name = `${trade.instrument} ${trade.direction === 'long' ? 'Long' : 'Short'}`;
  const pnl = trade.pnl ?? 0;
  return {
    kind: 'trade_closed',
    title: 'Trade Closed',
    body: `${name} | ${pts(trade.points ?? 0)} | ${pnl >= 0 ? '+' : '-'}$${Math.abs(Math.round(pnl))}`,
  };
}

/** Dollar value of a partial exit (used for "Partial Taken" alerts). */
export function partialAlert(trade: Trade, mark: number, contracts: number): LiveAlert {
  const s = liveState(trade, mark);
  const value = pointsToDollars(trade.instrument, s.points, contracts);
  return {
    kind: 'partial_taken',
    title: 'Partial Taken',
    body: `${trade.instrument} ${pts(s.points)} | ${value >= 0 ? '+' : '-'}$${Math.abs(Math.round(value))}`,
  };
}
