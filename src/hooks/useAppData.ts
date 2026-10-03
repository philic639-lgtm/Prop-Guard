import { useMemo } from 'react';

import { computeDailyGuard, type DailyGuard } from '@/lib/engines/dailyGuardEngine';
import { computeDisciplineScore } from '@/lib/engines/disciplineEngine';
import { useAppStore } from '@/store/useAppStore';
import type { Account, Strategy, Trade } from '@/types/domain';
import { dayKey } from '@/utils/dates';

import { useNow } from './useNow';

export function useActiveAccount(): Account | null {
  const accounts = useAppStore((s) => s.accounts);
  const activeId = useAppStore((s) => s.activeAccountId);
  return useMemo(() => accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null, [accounts, activeId]);
}

export function useActiveStrategy(): Strategy | null {
  const strategies = useAppStore((s) => s.strategies);
  const activeId = useAppStore((s) => s.activeStrategyId);
  return useMemo(() => strategies.find((s) => s.id === activeId) ?? strategies[0] ?? null, [strategies, activeId]);
}

export function useStrategy(id: string | null | undefined): Strategy | null {
  const strategies = useAppStore((s) => s.strategies);
  return useMemo(() => strategies.find((s) => s.id === id) ?? null, [strategies, id]);
}

export function useTrade(id: string | null | undefined): Trade | null {
  const trades = useAppStore((s) => s.trades);
  return useMemo(() => trades.find((t) => t.id === id) ?? null, [trades, id]);
}

/** Trades for the active account, newest first. */
export function useAccountTrades(): Trade[] {
  const trades = useAppStore((s) => s.trades);
  const account = useActiveAccount();
  return useMemo(
    () =>
      trades
        .filter((t) => t.accountId === account?.id && t.status !== 'cancelled')
        .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)),
    [trades, account?.id],
  );
}

export function useOpenTrade(): Trade | null {
  const trades = useAccountTrades();
  return useMemo(() => trades.find((t) => t.status === 'open') ?? null, [trades]);
}

/** Live Daily Guard for the active account. Ticks every second while a cooldown runs. */
export function useDailyGuard(fastTick = false): DailyGuard | null {
  const account = useActiveAccount();
  const rules = useAppStore((s) => s.tradingRules);
  const trades = useAppStore((s) => s.trades);
  const now = useNow(fastTick ? 1000 : 15_000);
  return useMemo(
    () => (account ? computeDailyGuard({ account, rules, trades, now }) : null),
    [account, rules, trades, now],
  );
}

export function useTodayTrades(): Trade[] {
  const trades = useAccountTrades();
  const today = dayKey(new Date());
  return useMemo(() => trades.filter((t) => dayKey(t.openedAt) === today), [trades, today]);
}

export function useDiscipline(days = 30) {
  const trades = useAccountTrades();
  const events = useAppStore((s) => s.events);
  const now = useNow(60_000);
  return useMemo(() => {
    const cutoff = now.getTime() - days * 86_400_000;
    const recent = trades.filter((t) => Date.parse(t.openedAt) >= cutoff);
    const ids = new Set(recent.map((t) => t.id));
    const recentEvents = events.filter((e) => Date.parse(e.at) >= cutoff && (e.tradeId == null || ids.has(e.tradeId)));
    return { score: computeDisciplineScore(recent, recentEvents), trades: recent, events: recentEvents };
  }, [trades, events, days, now]);
}
