import { useMemo } from 'react';

import { useActiveAccount } from '@/hooks/useAppData';
import { useNow } from '@/hooks/useNow';
import { copiedTodayCount, copyAnalytics, type CopyAnalytics, type CopyRiskContext } from '@/lib/engines/copyTradeEngine';
import { computeDailyGuard } from '@/lib/engines/dailyGuardEngine';
import { useAppStore } from '@/store/useAppStore';
import type { CopySettings, SourceTrader } from '@/types/copyTrade';

/** Source traders the user can copy (archived ones are hidden unless asked). */
export function useSourceTraders(includeArchived = false): SourceTrader[] {
  const list = useAppStore((s) => s.sourceTraders);
  return useMemo(() => (includeArchived ? list : list.filter((t) => !t.archived)).slice().sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)), [list, includeArchived]);
}

export function useSourceTrader(id: string | null | undefined): SourceTrader | null {
  const list = useAppStore((s) => s.sourceTraders);
  return useMemo(() => list.find((t) => t.id === id) ?? null, [list, id]);
}

export function useCopyAnalytics(): CopyAnalytics {
  const traders = useAppStore((s) => s.sourceTraders);
  const copies = useAppStore((s) => s.copyTrades);
  const trades = useAppStore((s) => s.trades);
  const now = useNow(60_000);
  return useMemo(() => copyAnalytics(traders, copies, trades, now), [traders, copies, trades, now]);
}

/**
 * The risk context a copy is checked against: the account the trader's copy
 * settings name (else the active one), that account's live Daily Guard, the
 * trader's own rules, and today's copy count for this source trader.
 */
export function useCopyRiskContext(trader: SourceTrader | null, settings: CopySettings | null): CopyRiskContext | null {
  const active = useActiveAccount();
  const accounts = useAppStore((s) => s.accounts);
  const rules = useAppStore((s) => s.tradingRules);
  const trades = useAppStore((s) => s.trades);
  const copies = useAppStore((s) => s.copyTrades);
  const timeZone = useAppStore((s) => s.preferences.timezone);
  const now = useNow(15_000);
  return useMemo(() => {
    if (!settings) return null;
    const account = (settings.accountId ? accounts.find((a) => a.id === settings.accountId) : null) ?? active ?? null;
    return {
      account,
      rules,
      guard: account ? computeDailyGuard({ account, rules, trades, now }) : null,
      settings,
      copiedToday: trader ? copiedTodayCount(copies, trader.id, now) : 0,
      now,
      timeZone: timeZone || 'America/New_York',
    };
  }, [settings, accounts, active, rules, trades, copies, trader, now, timeZone]);
}
