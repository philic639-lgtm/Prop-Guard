import { router } from 'expo-router';

import type { StrategyTemplate } from '@/data/strategyLibrary';
import { newDraft } from '@/features/session/draft';
import { useAppStore } from '@/store/useAppStore';
import type { Strategy } from '@/types/domain';

import { strategyFromTemplate } from './fromTemplate';
import { useStrategyDraftStore } from './useStrategyDraftStore';

/** The trader's saved copy of a built-in template, if any. */
export function savedStrategyFor(templateId: string, strategies: readonly Strategy[]): Strategy | undefined {
  return strategies.find((s) => s.libraryId === templateId);
}

/** Save a built-in template to the trader's strategies (once). Returns the saved strategy. */
export function saveTemplate(t: StrategyTemplate): Strategy {
  const st = useAppStore.getState();
  st.markTemplateUsed(t.id);
  const existing = savedStrategyFor(t.id, st.strategies);
  if (existing) return existing;
  const strategy = strategyFromTemplate(t, st.preferences.markets);
  st.upsertStrategy(strategy);
  return strategy;
}

/** Open the rule editor on a copy of the template (saved edits become an adapted strategy). */
export function customizeTemplate(t: StrategyTemplate) {
  const st = useAppStore.getState();
  st.markTemplateUsed(t.id);
  const existing = savedStrategyFor(t.id, st.strategies);
  if (existing) {
    router.push({ pathname: '/strategy/review', params: { id: existing.id } });
    return;
  }
  useStrategyDraftStore.getState().setDraft(strategyFromTemplate(t, st.preferences.markets), 'template', 'local');
  router.push('/strategy/review');
}

export function practiceTemplate(t: StrategyTemplate) {
  const strategy = saveTemplate(t);
  router.push({ pathname: '/practice', params: { strategyId: strategy.id } });
}

/** Make the template the active strategy and open Analyze with its checklist. */
export function openTemplateInAnalyze(t: StrategyTemplate) {
  const strategy = saveTemplate(t);
  const st = useAppStore.getState();
  st.setActiveStrategy(strategy.id);
  const instrument = st.draft?.instrument ?? st.preferences.defaultInstrument;
  st.setDraft(newDraft(strategy, instrument));
  router.push('/analyze');
}
