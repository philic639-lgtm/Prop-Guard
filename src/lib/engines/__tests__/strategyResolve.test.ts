import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { generateCustomStrategyScenarios } from '@/services/marketHistory/historical';
import { rowsToStrategy, strategyToRows } from '@/services/supabase/mappers';

import { validateStrategy } from '../strategyEngine';
import {
  analyzeStrategyText,
  applyResolutions,
  buildRuleItems,
  finalPlanRules,
  finalRuleSheet,
  improvedHealth,
  makeResolution,
  resolveProgress,
  setResolution,
  strategyOwnership,
  testableRulesOf,
  testReadiness,
  toStrategy,
  UNSUPPORTED_CLAIMS,
  type StrategyRuleItem,
  type StructuredStrategy,
} from '../strategyIntelligence';

const TEXT = {
  A: "I buy ES when it looks strong after 9:45 and breaks the morning high but I don't want to chase.",
  B: 'I short NQ when it rejects VWAP.',
  C: 'I trade opening range breakouts with a 5 point stop and 10 point target.',
  D: 'I buy pullbacks in an uptrend.',
  E: 'I scalp momentum when volume is good.',
} as const;
type K = keyof typeof TEXT;
const KEYS = Object.keys(TEXT) as K[];

const analysed = Object.fromEntries(KEYS.map((k) => [k, analyzeStrategyText(TEXT[k])])) as Record<K, StructuredStrategy>;
const itemsOf = (k: K) => buildRuleItems(analysed[k]);
const item = (items: StrategyRuleItem[], id: string) => {
  const i = items.find((x) => x.id === id);
  if (!i) throw new Error(`missing item ${id}`);
  return i;
};

/** Accept Prop Guard's recommendation (or the first option) for every item — each one an explicit decision. */
function resolveAll(a: StructuredStrategy): StructuredStrategy {
  let s = a;
  for (const i of buildRuleItems(a)) s = setResolution(s, makeResolution(i, { optionIds: i.aiRecommendation?.optionIds ?? [i.options[0].id] }));
  return s;
}

const everyText = (s: StructuredStrategy) => [...finalPlanRules(s).map((r) => r.text), ...buildRuleItems(s).flatMap((i) => [i.why, i.question, i.aiRecommendation?.reasoning ?? '', ...i.options.flatMap((o) => [o.label, o.detail, o.tradeoff ?? '', o.ruleText])])];

describe('Resolve Missing Rules — detection', () => {
  it('never resolves anything on its own: a fresh analysis has no resolutions and no resolved items', () => {
    for (const k of KEYS) {
      expect(analysed[k].resolutions ?? []).toHaveLength(0);
      expect(itemsOf(k).filter((i) => i.resolved)).toHaveLength(0);
      // Nothing an item proposes is in the plan until the trader approves it.
      expect(finalPlanRules(applyResolutions(analysed[k])).some((r) => r.origin)).toBe(false);
    }
  });

  it('A: flags "looks strong" as subjective and asks for breakout, chase and morning-high definitions', () => {
    const items = itemsOf('A');
    const strong = items.find((i) => i.subjective && i.category === 'subjective');
    expect(strong?.originalText?.toLowerCase()).toContain('strong');
    expect(strong?.multiSelect).toBe(true);
    const chase = item(items, 'chaseProtection');
    expect(chase.options.length).toBeGreaterThanOrEqual(3);
    expect(chase.options.length).toBeLessThanOrEqual(6);
    expect(chase.options.map((o) => o.label).join(' ')).toMatch(/retest/i);
    // Example distances are presented as choices, never as the correct value.
    expect(chase.options.some((o) => o.input)).toBe(true);
    const breakout = item(items, 'breakoutDefinition');
    expect(breakout.options.every((o) => (o.tradeoff ?? '').length > 0)).toBe(true);
    expect(breakout.aiRecommendation?.reasoning).toMatch(/chase/i);
    expect(item(items, 'levelDefinition').question).toMatch(/morning high/i);
    // Stated parts are not asked again.
    expect(items.some((i) => i.category === 'instrument')).toBe(false);
    expect(items.some((i) => i.category === 'direction')).toBe(false);
  });

  it('B: asks what a VWAP rejection is, not about breakouts or chasing', () => {
    const items = itemsOf('B');
    expect(item(items, 'entryTrigger').options.map((o) => o.label).join(' ')).toMatch(/reject|wick|close/i);
    expect(items.some((i) => i.category === 'breakoutDefinition' || i.category === 'chaseProtection')).toBe(false);
    expect(item(items, 'stop').critical).toBe(true);
  });

  it('C: stated stop and target are not re-asked; the opening range length and the market are', () => {
    const items = itemsOf('C');
    expect(items.some((i) => i.category === 'stop' || i.category === 'target')).toBe(false);
    expect(item(items, 'levelDefinition').options.some((o) => o.values?.rangeMinutes)).toBe(true);
    expect(item(items, 'instrument').required).toBe(true);
  });

  it('D and E: undefined trend / momentum / volume become subjective items with measurable criteria', () => {
    const d = itemsOf('D');
    expect(d.find((i) => i.subjective && /trend/i.test(i.originalText ?? ''))?.multiSelect).toBe(true);
    const e = itemsOf('E');
    const subj = e.filter((i) => i.category === 'subjective').map((i) => i.originalText?.toLowerCase() ?? '');
    expect(subj.some((t) => t.includes('volume'))).toBe(true);
    expect(subj.some((t) => t.includes('momentum'))).toBe(true);
  });

  it('the five strategies get meaningfully different questions and options', () => {
    const sig = (k: K) => itemsOf(k).filter((i) => i.required).map((i) => `${i.id}:${i.options.map((o) => o.id).join(',')}`).join('|');
    const sigs = KEYS.map(sig);
    expect(new Set(sigs).size).toBe(KEYS.length);
    // Same category, different options: the stop examples follow the instrument (ES vs NQ).
    const stopText = (k: K) => item(itemsOf(k), 'stop').options.map((o) => `${o.label} ${o.detail}`).join(' ');
    expect(stopText('A')).not.toBe(stopText('B'));
    // Different time-window presets for a scalp vs a pullback plan.
    const win = (k: K) => item(itemsOf(k), 'timeWindow').options.map((o) => o.ruleText).join('|');
    expect(win('D')).not.toBe(win('E'));
  });

  it('orders items by the required priority: entry ambiguity → stop → invalidation → target → … → optional', () => {
    for (const k of KEYS) {
      const req = itemsOf(k).filter((i) => i.required).map((i) => i.priority);
      expect([...req].sort((x, y) => x - y)).toEqual(req);
      const firstOptional = itemsOf(k).findIndex((i) => !i.required);
      expect(itemsOf(k).slice(firstOptional).every((i) => !i.required)).toBe(true);
    }
  });

  it('no item, option or recommendation makes a performance claim', () => {
    for (const k of KEYS) for (const t of everyText(resolveAll(analysed[k]))) expect(t).not.toMatch(UNSUPPORTED_CLAIMS);
  });
});

describe('Resolve Missing Rules — resolution', () => {
  it('A: an approved recommendation becomes an AI-approved rule, labelled as such, and updates DNA', () => {
    const items = itemsOf('A');
    const chase = item(items, 'chaseProtection');
    const s = setResolution(analysed.A, makeResolution(chase, { optionIds: chase.aiRecommendation!.optionIds }));
    const r = applyResolutions(s);
    const rule = finalPlanRules(r).find((x) => x.ruleItemId === 'chaseProtection');
    expect(rule?.origin).toBe('ai_approved');
    expect(rule?.provenance).toBe('suggested');
    const entry = r.dna.find((d) => d.key === 'entry')!;
    expect(entry.values.some((v) => v.origin === 'ai_approved')).toBe(true);
    expect(item(buildRuleItems(s), 'chaseProtection').resolved).toBe(true);
  });

  it('A: a chase distance is the trader’s own value, not a hard-coded default', () => {
    const chase = item(itemsOf('A'), 'chaseProtection');
    const opt = chase.options.find((o) => o.input)!;
    const r = applyResolutions(setResolution(analysed.A, makeResolution(chase, { optionIds: [opt.id], inputValue: 3 })));
    expect(finalPlanRules(r).find((x) => x.ruleItemId === 'chaseProtection')?.text).toContain('3');
  });

  it('A: resolving a subjective phrase keeps the trader’s words and marks them as defined', () => {
    const strong = itemsOf('A').find((i) => i.subjective && i.category === 'subjective')!;
    const picks = strong.options.slice(0, 2).map((o) => o.id);
    const r = applyResolutions(setResolution(analysed.A, makeResolution(strong, { optionIds: picks })));
    const traderRule = finalPlanRules(r).find((x) => x.provenance === 'trader' && x.definedBy);
    expect(traderRule).toBeDefined();
    expect(traderRule!.vagueTerms).toHaveLength(0);
    expect(finalPlanRules(r).find((x) => x.ruleItemId === strong.id)?.text).toMatch(/AND/);
  });

  it('a custom rule is recorded in the trader’s own words with source "custom"', () => {
    const stop = item(itemsOf('B'), 'stop');
    const res = makeResolution(stop, { optionIds: [], customText: 'Stop 6 points above the rejection wick' });
    expect(res.source).toBe('custom');
    const r = applyResolutions(setResolution(analysed.B, res));
    const rule = finalPlanRules(r).find((x) => x.ruleItemId === 'stop')!;
    expect(rule.text).toBe('Stop 6 points above the rejection wick');
    expect(rule.provenance).toBe('trader');
    expect(finalRuleSheet(r, finalPlanRules(r)).find((x) => x.key === 'stop')?.lines.some((l) => l.origin === 'CUSTOM RULE')).toBe(true);
  });

  it('the definition score recalculates as rules are resolved, with per-dimension deltas', () => {
    for (const k of KEYS) {
      const base = analysed[k].strategyHealthScore.total;
      const items = itemsOf(k);
      const first = items[0];
      const one = applyResolutions(setResolution(analysed[k], makeResolution(first, { optionIds: first.aiRecommendation?.optionIds ?? [first.options[0].id] })));
      const all = applyResolutions(resolveAll(analysed[k]));
      expect(improvedHealth(one).total).toBeGreaterThanOrEqual(base);
      expect(improvedHealth(all).total).toBeGreaterThan(base);
      expect(improvedHealth(all).total).toBeGreaterThanOrEqual(improvedHealth(one).total);
    }
  });

  it('progress counts resolved items, and every strategy becomes test ready once its rules are resolved', () => {
    for (const k of KEYS) {
      const before = resolveProgress(itemsOf(k));
      expect(before.resolved).toBe(0);
      expect(before.next).not.toBeNull();
      const done = resolveAll(analysed[k]);
      const items = buildRuleItems(done);
      const after = resolveProgress(items);
      expect(after.resolved).toBe(after.total);
      const r = applyResolutions(done);
      const ready = testReadiness(r, items);
      expect(ready.ready).toBe(true);
      expect(ready.core.map((c) => c.label)).toEqual(expect.arrayContaining(['Instrument', 'Setup', 'Entry', 'Stop', 'Target', 'Invalidation', 'Time window', 'Trade limit']));
      expect(testableRulesOf(r).coverage.testable).toBe(true);
    }
  });

  it('clearing a resolution removes the rule again', () => {
    const stop = item(itemsOf('D'), 'stop');
    const s = setResolution(analysed.D, makeResolution(stop, { optionIds: [stop.options[0].id] }));
    const store = useStrategyAnalysisStore.getState();
    store.load(s, 'saved-1');
    useStrategyAnalysisStore.getState().unresolve('stop');
    const back = useStrategyAnalysisStore.getState().analysis!;
    expect(finalPlanRules(applyResolutions(back)).some((x) => x.ruleItemId === 'stop')).toBe(false);
    expect(useStrategyAnalysisStore.getState().savedId).toBe('saved-1');
    useStrategyAnalysisStore.getState().reset();
  });

  it('ownership separates the trader’s rules from approved AI options and Prop Guard wording', () => {
    const r = applyResolutions(resolveAll(analysed.C));
    const own = strategyOwnership(r, finalPlanRules(r));
    expect(own.traderPct + own.aiApprovedPct + own.propGuardPct).toBe(100);
    expect(own.traderPct).toBeGreaterThan(0);
    expect(own.aiApprovedPct).toBeGreaterThan(0);
  });

  it('the final rule sheet labels every line with its origin', () => {
    const r = applyResolutions(resolveAll(analysed.A));
    const sheet = finalRuleSheet(r, finalPlanRules(r));
    for (const key of ['market', 'direction', 'window', 'setup', 'entry', 'chase', 'stop', 'target', 'invalidation', 'limit', 'cutoff']) expect(sheet.find((x) => x.key === key)?.lines.length).toBeGreaterThan(0);
    expect(sheet.find((x) => x.key === 'market')?.lines[0].origin).toBe('YOUR RULE');
    expect(sheet.find((x) => x.key === 'stop')?.lines.every((l) => l.origin === 'AI SUGGESTION — APPROVED')).toBe(true);
  });
});

describe('Resolve Missing Rules — saving and Historical Practice', () => {
  it('the saved strategy persists resolutions, rule items and the practice spec (also through the database mappers)', () => {
    const done = resolveAll(analysed.A);
    const s = toStrategy(done, { id: '22222222-2222-2222-2222-222222222222', now: '2026-10-05T00:00:00Z', accountMaxTrades: 3 });
    expect(validateStrategy(s)).toEqual([]);
    expect(s.structured?.resolutions?.length).toBe(buildRuleItems(analysed.A).length);
    expect(s.structured?.ruleItems?.every((i) => i.resolved)).toBe(true);
    expect(s.structured?.practiceSpec?.chase.length).toBeGreaterThan(0);
    // Approved rules are in the saved checklist, labelled.
    expect(s.checklist.some((c) => /chase|beyond the breakout|retest/i.test(c.label))).toBe(true);
    const rows = strategyToRows(s, 'user-1');
    const back = rowsToStrategy({ ...rows.strategy, updated_at: s.updatedAt }, rows.checklist);
    expect(back.structured?.resolutions).toEqual(s.structured?.resolutions);
    expect(back.structured?.practiceSpec?.instrument).toBe('ES');
  });

  it('Historical Practice receives the completed strategy as structured fields', () => {
    for (const k of KEYS) {
      const r = applyResolutions(resolveAll(analysed[k]));
      const s = toStrategy(resolveAll(analysed[k]), { id: `id-${k}`, now: '2026-10-05T00:00:00Z', accountMaxTrades: 3 });
      const spec = s.structured!.practiceSpec!;
      expect(spec.instrument).toBeTruthy();
      expect(spec.stop.kind).toBeDefined();
      expect(spec.target.kind).toBeDefined();
      expect(spec.timeStart ?? spec.timeEnd).toBeTruthy();
      expect(spec.tradeLimit).toBeGreaterThan(0);
      expect(spec.entry.length + spec.setup.length).toBeGreaterThan(0);
      expect(spec.name).toBe(r.name);
    }
  });

  it('practice scenarios are generated from the resolved rules and stay SIMULATED', () => {
    const r = applyResolutions(resolveAll(analysed.C));
    const out = generateCustomStrategyScenarios('resolve-c', r.name, testableRulesOf(r));
    expect(out.scenarios.length).toBeGreaterThan(0);
    for (const sc of out.scenarios) {
      expect(sc.source.kind).toBe('simulated');
      expect(sc.source.verified).toBe(false);
    }
  });
});
