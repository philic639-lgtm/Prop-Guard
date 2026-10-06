import { useMemo } from 'react';

import { useActiveAccount, useDailyGuard } from '@/hooks/useAppData';
import { accountRiskContext, type RiskContext } from '@/lib/engines/setupValidation';
import { useAppStore } from '@/store/useAppStore';

/**
 * Risk context for a Setup Check: the trader's personal risk rules, today's
 * Daily Guard and the active account's limits (each labelled verified /
 * entered by the trader / unverified). Nothing is invented.
 */
export function useSetupRiskContext(): RiskContext {
  const account = useActiveAccount();
  const rules = useAppStore((s) => s.tradingRules);
  const guard = useDailyGuard();
  return useMemo(
    () => ({
      maxRiskPerTrade: rules.maxRiskPerTrade > 0 ? rules.maxRiskPerTrade : null,
      requireStop: rules.requireStop,
      requireTarget: rules.requireTarget,
      guard: guard
        ? {
            status: guard.status,
            headline: guard.headline,
            reasons: guard.reasons,
            riskRemaining: guard.riskRemaining,
            tradesRemaining: guard.tradesRemaining,
            cooldownActive: guard.cooldown.active,
            drawdownBuffer: guard.drawdownBuffer,
          }
        : null,
      account: accountRiskContext(account),
    }),
    [rules, guard, account],
  );
}
