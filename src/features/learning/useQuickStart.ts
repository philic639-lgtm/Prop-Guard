import { useMemo } from 'react';

import { useActiveAccount } from '@/hooks/useAppData';
import { quickStartChecklist } from '@/lib/engines/learningEngine';
import { useAppStore } from '@/store/useAppStore';

/** Experienced quick-start checklist from the trader's real data. */
export function useQuickStart() {
  const accounts = useAppStore((s) => s.accounts);
  const strategies = useAppStore((s) => s.strategies);
  const practiceAttempts = useAppStore((s) => s.practiceAttempts);
  const trades = useAppStore((s) => s.trades);
  const rules = useAppStore((s) => s.tradingRules);
  const activeAccount = useActiveAccount();
  return useMemo(
    () => quickStartChecklist({ accounts, activeAccount, strategies, practiceAttempts, trades, rules }),
    [accounts, activeAccount, strategies, practiceAttempts, trades, rules],
  );
}
