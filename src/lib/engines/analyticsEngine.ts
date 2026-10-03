import type { DisciplineEvent, InstrumentSymbol, Strategy, Trade } from '@/types/domain';
import { dayKey } from '@/utils/dates';

import { VIOLATION_TYPES } from './disciplineEngine';

export interface PerformanceStats {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  winRate: number | null;
  profitFactor: number | null;
  avgR: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null;
  largestWin: number | null;
  largestLoss: number | null;
}

export interface GroupStat {
  key: string;
  label: string;
  pnl: number;
  count: number;
  winRate: number | null;
}

export interface EquityPoint {
  x: number;
  y: number;
  date: string;
}

const closedOnly = (trades: Trade[]) => trades.filter((t) => t.status === 'closed' && t.pnl != null);

export function computeStats(trades: Trade[]): PerformanceStats {
  const closed = closedOnly(trades);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
  const grossProfit = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const netPnl = grossProfit - grossLoss;
  const rs = closed.map((t) => t.realizedR).filter((r): r is number => r != null);
  const decided = wins.length + losses.length;

  return {
    count: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: closed.length - decided,
    netPnl: round2(netPnl),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    winRate: decided > 0 ? wins.length / decided : null,
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : null,
    avgR: rs.length > 0 ? round2(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
    avgWin: wins.length > 0 ? round2(grossProfit / wins.length) : null,
    avgLoss: losses.length > 0 ? round2(-grossLoss / losses.length) : null,
    expectancy: closed.length > 0 ? round2(netPnl / closed.length) : null,
    largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl ?? 0)) : null,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.pnl ?? 0)) : null,
  };
}

export function equityCurve(trades: Trade[], startingBalance: number): EquityPoint[] {
  const closed = closedOnly(trades).sort((a, b) => Date.parse(a.closedAt!) - Date.parse(b.closedAt!));
  const points: EquityPoint[] = [{ x: 0, y: startingBalance, date: closed[0]?.openedAt ?? new Date().toISOString() }];
  let bal = startingBalance;
  closed.forEach((t, i) => {
    bal += t.pnl ?? 0;
    points.push({ x: i + 1, y: round2(bal), date: t.closedAt! });
  });
  return points;
}

function groupBy(trades: Trade[], keyFn: (t: Trade) => string, labelFn: (k: string) => string = (k) => k): GroupStat[] {
  const groups = new Map<string, Trade[]>();
  for (const t of closedOnly(trades)) {
    const k = keyFn(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  return [...groups.entries()].map(([key, list]) => {
    const s = computeStats(list);
    return { key, label: labelFn(key), pnl: s.netPnl, count: s.count, winRate: s.winRate };
  });
}

export function pnlByDay(trades: Trade[]): GroupStat[] {
  return groupBy(trades, (t) => dayKey(t.closedAt!)).sort((a, b) => a.key.localeCompare(b.key));
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function pnlByWeekday(trades: Trade[]): GroupStat[] {
  return groupBy(trades, (t) => String(new Date(t.openedAt).getDay()), (k) => WEEKDAYS[Number(k)]).sort(
    (a, b) => Number(a.key) - Number(b.key),
  );
}

export function pnlByHour(trades: Trade[]): GroupStat[] {
  return groupBy(
    trades,
    (t) => String(new Date(t.openedAt).getHours()),
    (k) => {
      const h = Number(k);
      return `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'p' : 'a'}`;
    },
  ).sort((a, b) => Number(a.key) - Number(b.key));
}

export function pnlByInstrument(trades: Trade[]): GroupStat[] {
  return groupBy(trades, (t) => t.instrument).sort((a, b) => b.count - a.count);
}

export function pnlByStrategy(trades: Trade[], strategies: Strategy[]): GroupStat[] {
  const names = new Map(strategies.map((s) => [s.id, s.name]));
  return groupBy(
    trades,
    (t) => t.strategyId ?? 'none',
    (k) => (k === 'none' ? 'No strategy' : (names.get(k) ?? 'Deleted strategy')),
  ).sort((a, b) => b.pnl - a.pnl);
}

export function bestStrategy(trades: Trade[], strategies: Strategy[]): GroupStat | null {
  const groups = pnlByStrategy(trades, strategies).filter((g) => g.key !== 'none' && g.count >= 1);
  return groups.length > 0 ? groups[0] : null;
}

export function mostTradedInstrument(trades: Trade[]): InstrumentSymbol | null {
  const g = pnlByInstrument(trades);
  return g.length > 0 ? (g[0].key as InstrumentSymbol) : null;
}

/** Split performance by whether each trade had any recorded violation. */
export function performanceByCompliance(trades: Trade[], events: DisciplineEvent[]) {
  const violated = new Set(events.filter((e) => VIOLATION_TYPES.has(e.type) && e.tradeId).map((e) => e.tradeId!));
  const isViolated = (t: Trade) => violated.has(t.id) || t.rulesViolated.length > 0;
  return {
    followed: computeStats(trades.filter((t) => !isViolated(t))),
    violated: computeStats(trades.filter(isViolated)),
  };
}

export function violationCounts(events: DisciplineEvent[]): { type: string; count: number }[] {
  const map = new Map<string, number>();
  for (const e of events) {
    if (!VIOLATION_TYPES.has(e.type)) continue;
    map.set(e.type, (map.get(e.type) ?? 0) + 1);
  }
  return [...map.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

export function averageExcursions(trades: Trade[]): { mae: number | null; mfe: number | null } {
  const maes = trades.map((t) => t.mae).filter((v): v is number => v != null);
  const mfes = trades.map((t) => t.mfe).filter((v): v is number => v != null);
  const avg = (v: number[]) => (v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null);
  return { mae: avg(maes), mfe: avg(mfes) };
}

export function filterByRange(trades: Trade[], range: 'week' | 'month' | 'all', now = new Date()): Trade[] {
  if (range === 'all') return trades;
  const days = range === 'week' ? 7 : 30;
  const cutoff = now.getTime() - days * 86_400_000;
  return trades.filter((t) => Date.parse(t.openedAt) >= cutoff);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
