import type { Decision } from './setupCheck';
import type { SetupCheck, Trade } from '@/types/domain';

export interface SetupCheckBucket {
  decision: Decision;
  checks: number;
  taken: number;
  closed: number;
  wins: number;
  netPnl: number;
}

/**
 * Process analytics: setups that were cleared vs WAIT / STAND DOWN setups
 * taken anyway, with their actual results. Not a forecast.
 */
export function setupCheckOutcomes(checks: SetupCheck[], trades: Trade[]): SetupCheckBucket[] {
  const byId = new Map(trades.map((t) => [t.id, t]));
  return (['TAKE TRADE', 'WAIT', 'STAND DOWN'] as const).map((decision) => {
    const list = checks.filter((c) => c.decision === decision);
    const linked = list.map((c) => (c.tradeId ? byId.get(c.tradeId) : undefined)).filter((t): t is Trade => !!t);
    const closed = linked.filter((t) => t.status === 'closed' && t.pnl != null);
    return { decision, checks: list.length, taken: linked.length, closed: closed.length, wins: closed.filter((t) => (t.pnl ?? 0) > 0).length, netPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0) };
  });
}
