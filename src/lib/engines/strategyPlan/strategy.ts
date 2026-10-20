import type { ChecklistItem, Strategy } from '@/types/domain';

import { analyzeStrategyText } from '../strategyIntelligence/analyze';
import { confirmedPlan, planReadiness } from './plan';
import type { StrategyPlan } from './types';

/**
 * Saving a plan as a Strategy: every Strategy field comes from the plan's DEFINED rules only.
 * Rules the plan does not define stay empty / 0 ("not set") — never a default. An incomplete
 * plan is saved as a clearly labelled draft; the plan itself is stored with the strategy
 * (`structured.plan`), so reopening restores every answer, decision and rule source.
 */

/** The plan saved with a strategy (strategies from "Teach Prop Guard your plan"). */
export const planOf = (s: Pick<Strategy, 'structured'> | null | undefined): StrategyPlan | null => s?.structured?.plan ?? null;

/** A saved plan with rules still to define. */
export const isDraftStrategy = (s: Pick<Strategy, 'structured'> | null | undefined): boolean => {
  const p = planOf(s);
  return !!p && planReadiness(p).status === 'draft';
};

/** "2R", "1:2", "2 to 1" in the target → minimum reward:risk; 0 = not set. */
export function rrOf(target: string | null | undefined): number {
  const t = (target ?? '').toLowerCase();
  const m = /(\d+(?:\.\d+)?)\s*r\b/.exec(t) ?? /\b1\s*:\s*(\d+(?:\.\d+)?)/.exec(t) ?? /(\d+(?:\.\d+)?)\s*to\s*1\b/.exec(t);
  return m ? Number(m[1]) : 0;
}

/** Reward:risk and trade cap the plan DEFINES (0 = not set — never a default). */
export function planLimits(plan: StrategyPlan): { minRR: number; maxTrades: number } {
  const f = plan.fields;
  return { minRR: f.target.status === 'supplied' ? rrOf(f.target.display) : 0, maxTrades: f.maxTrades.status === 'supplied' ? (f.maxTrades.value ?? 0) : 0 };
}

export function planName(plan: StrategyPlan): string {
  const r = plan.fields.openingRange.value;
  const inst = plan.fields.instrument.value?.length ? `${plan.fields.instrument.value.join('/')} ` : '';
  return r ? `${inst}${r.minutes}-minute opening range plan` : `${inst}My strategy`.trim();
}

export function planToStrategy(plan: StrategyPlan, opts: { id: string; now: string; name?: string; createdAt?: string }): Strategy {
  const f = plan.fields;
  const ready = planReadiness(plan);
  const lines = confirmedPlan(plan);
  const checklist: ChecklistItem[] = lines.map((l) => ({ id: `plan-${l.key}`, label: l.text, kind: 'yesno', required: true }));
  const start = f.lookStart.value ?? f.openingRange.value?.end ?? null;
  const end = f.entryCutoff.value && f.entryCutoff.value !== 'none' ? f.entryCutoff.value : null;
  const accepted = (id: string) => plan.decisions[id]?.status === 'accepted';
  // The legacy analysis object keeps older screens working; it never adds rules to the plan.
  const legacy = analyzeStrategyText(plan.originalText);
  return {
    id: opts.id,
    name: opts.name?.trim() || planName(plan),
    markets: f.instrument.status === 'supplied' || f.instrument.status === 'accepted' ? (f.instrument.value ?? []) : [],
    session: 'New York',
    timeframe: f.executionTimeframe.value ?? '',
    entryWindowStart: start && end ? start : null,
    entryWindowEnd: start && end ? end : null,
    biasRequirement: '',
    requiresBiasAlignment: false,
    entryTrigger: f.entryTrigger.status === 'supplied' ? (f.entryTrigger.display ?? '') : '',
    confirmationRules: accepted('candle_close') ? 'Only enter after a candle closes beyond the level on your execution chart' : '',
    retestRules: accepted('retest') ? 'Enter when price returns to the range level and holds' : '',
    stopMethod: f.stop.status === 'supplied' ? (f.stop.display ?? '') : '',
    typicalStopMin: null,
    typicalStopMax: null,
    targetMethod: f.target.status === 'supplied' ? (f.target.display ?? '') : '',
    ...planLimits(plan),
    invalidationRules: '',
    notes: ready.status === 'draft' ? `DRAFT — still to define: ${ready.unresolved.join(', ')}.` : '',
    checklist,
    source: 'custom',
    sourceType: 'CUSTOM',
    originalText: plan.originalText,
    structured: { ...legacy, testableRules: undefined, resolutions: undefined, practiceSpec: undefined, plan },
    createdAt: opts.createdAt ?? opts.now,
    updatedAt: opts.now,
  };
}
