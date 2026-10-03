import { useMemo } from 'react';

import { useActiveAccount, useDailyGuard, useStrategy } from '@/hooks/useAppData';
import { calculateTradeRisk, type TradeRiskResult } from '@/lib/engines/riskEngine';
import { evaluateSetup, type SetupEvaluation } from '@/lib/engines/strategyEngine';
import { useAppStore } from '@/store/useAppStore';
import type { PreTradeDraft } from '@/store/types';
import type { Strategy } from '@/types/domain';
import { dayKey } from '@/utils/dates';
import { parseNum } from '@/utils/format';

export interface DraftNumbers {
  entry: number | null;
  stop: number | null;
  target: number | null;
  contracts: number | null;
}

export function draftNumbers(d: PreTradeDraft): DraftNumbers {
  return { entry: parseNum(d.entry), stop: parseNum(d.stop), target: parseNum(d.target), contracts: parseNum(d.contracts) };
}

/** Live risk + strategy evaluation for the current pre-trade draft. */
export function useSetupEvaluation(draft: PreTradeDraft | null): {
  risk: TradeRiskResult | null;
  evaluation: SetupEvaluation | null;
  strategy: Strategy | null;
  guard: ReturnType<typeof useDailyGuard>;
} {
  const account = useActiveAccount();
  const rules = useAppStore((s) => s.tradingRules);
  const trades = useAppStore((s) => s.trades);
  const guard = useDailyGuard();
  const strategy = useStrategy(draft?.strategyId);

  return useMemo(() => {
    if (!draft || !account) return { risk: null, evaluation: null, strategy, guard };
    const n = draftNumbers(draft);
    const risk = calculateTradeRisk({
      instrument: draft.instrument,
      direction: draft.direction,
      entry: n.entry,
      stop: n.stop,
      target: n.target,
      contracts: n.contracts,
      accountBalance: account.balance,
    });
    if (!strategy || !guard) return { risk, evaluation: null, strategy, guard };

    const today = dayKey(new Date());
    const strategyTrades = trades.filter((t) => t.strategyId === strategy.id && t.status !== 'cancelled');
    const recentStopPoints = strategyTrades
      .filter((t) => t.status === 'closed')
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
      .slice(0, 20)
      .map((t) => Math.abs(t.entryPrice - t.originalStopPrice));
    const strategyTradesToday = strategyTrades.filter((t) => t.accountId === account.id && dayKey(t.openedAt) === today).length;

    const evaluation = evaluateSetup({
      strategy,
      direction: draft.direction,
      bias: draft.bias,
      answers: draft.answers,
      risk,
      contracts: n.contracts ?? 0,
      rules,
      guard,
      recentStopPoints,
      strategyTradesToday,
    });
    return { risk, evaluation, strategy, guard };
  }, [draft, account, rules, trades, guard, strategy]);
}
