import { router } from 'expo-router';
import { useMemo, useState } from 'react';

import { practiceTemplateFor } from '@/features/strategy/practiceLink';
import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import {
  applyResolutions,
  buildRuleItems,
  finalPlanRules,
  improvedHealth,
  resolveProgress,
  strategyOwnership,
  testableRulesOf,
  testReadiness,
  toStrategy,
  validateStrategy,
} from '@/lib/engines';
import { generateCustomStrategyScenarios } from '@/services/marketHistory/historical';
import { useAppStore } from '@/store/useAppStore';
import { uuid } from '@/utils/id';

/**
 * The analysed strategy with the trader's explicit resolutions applied, plus
 * save / practice actions shared by the analysis and final-strategy screens.
 * `analysis` stays the trader's original analysis; everything downstream uses
 * the resolved view so approved rules flow into DNA, rules, score and Practice.
 */
export function useResolvedStrategy() {
  const analysis = useStrategyAnalysisStore((s) => s.analysis);
  const savedId = useStrategyAnalysisStore((s) => s.savedId);
  const accountMaxTrades = useAppStore((s) => s.tradingRules.maxTradesPerDay);
  const [error, setError] = useState<string | null>(null);
  const [practicing, setPracticing] = useState(false);

  const resolved = useMemo(() => (analysis ? applyResolutions(analysis) : null), [analysis]);
  const items = useMemo(() => (analysis ? buildRuleItems(analysis) : []), [analysis]);
  const progress = useMemo(() => resolveProgress(items), [items]);
  const finalRules = useMemo(() => (resolved ? finalPlanRules(resolved) : []), [resolved]);
  const readiness = useMemo(() => (resolved ? testReadiness(resolved, items) : null), [resolved, items]);
  const ownership = useMemo(() => (resolved ? strategyOwnership(resolved, finalRules) : null), [resolved, finalRules]);
  const score = useMemo(() => (resolved ? improvedHealth(resolved) : null), [resolved]);
  const rules = useMemo(() => (resolved ? testableRulesOf(resolved) : null), [resolved]);

  /** Save (or update) the strategy — later resolutions update the same saved strategy. */
  const save = (): string | null => {
    if (!analysis) return null;
    const id = savedId ?? uuid();
    const existing = useAppStore.getState().strategies.find((x) => x.id === id);
    const s = toStrategy(analysis, { id, now: new Date().toISOString(), accountMaxTrades });
    const merged = existing ? { ...s, createdAt: existing.createdAt } : s;
    const problems = validateStrategy(merged);
    if (problems.length) {
      setError(problems.join(' '));
      return null;
    }
    setError(null);
    const st = useAppStore.getState();
    st.upsertStrategy(merged);
    if (!st.activeStrategyId) st.setActiveStrategy(merged.id);
    useStrategyAnalysisStore.getState().setSavedId(merged.id);
    return merged.id;
  };

  /** Practice on scenarios found by the trader's OWN compiled (resolved) rules — simulated candles. */
  const practiceOwnRules = () => {
    const id = save();
    if (!id || !resolved || !rules?.coverage.testable) return;
    setPracticing(true);
    // Let the spinner render before the scan runs.
    setTimeout(() => {
      generateCustomStrategyScenarios(id, resolved.name, testableRulesOf(resolved));
      setPracticing(false);
      router.push({ pathname: '/practice', params: { strategyId: id, source: 'historical', fromAnalysis: 'own' } });
    }, 30);
  };

  const testInPractice = () => {
    if (rules?.coverage.testable) return practiceOwnRules();
    const id = save();
    if (!id || !resolved) return;
    const link = practiceTemplateFor(resolved);
    router.push({ pathname: '/practice', params: { strategyId: link?.templateId ?? id, source: 'historical', fromAnalysis: link ? (link.exact ? 'exact' : 'closest') : 'none' } });
  };

  return { analysis, resolved, items, progress, finalRules, readiness, ownership, score, rules, savedId, error, setError, practicing, save, practiceOwnRules, testInPractice, accountMaxTrades };
}
