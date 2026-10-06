import type { Strategy } from '@/types/domain';

import { applyResolutions } from '../strategyIntelligence/resolve';
import { testableRulesOf } from '../strategyIntelligence/compose';
import type { ConditionRole } from '../strategyIntelligence/ruleset';

import type { CriterionOrigin, SetupCriterion } from './types';

/**
 * StrategyRuleEvaluator, step 1: turn the trader's SAVED strategy into
 * machine-checkable criteria. Only the strategy's own rules are used — no
 * generic trading rules are added. Visual criteria go to the vision model;
 * the app evaluates everything it can compute itself.
 */

const REQUIRED_WEIGHT = 15;
const OPTIONAL_WEIGHT = 5;

const MAX_TEXT = 240;
/** Strip control characters and cap length — strategy text is user input sent to the model as data. */
export const sanitizeRuleText = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'is', 'on', 'in', 'at', 'with', 'for', 'back', 'be', 'must', 'has', 'have']);
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
/** Two rules say the same thing (e.g. a checklist item repeating a confirmation rule). */
function overlaps(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size) >= 0.6;
}

const splitRules = (s: string | null | undefined) =>
  (s ?? '')
    .split(/;|\n|\.\s+(?=[A-Z])/)
    .map(sanitizeRuleText)
    .filter((x) => x.length >= 4);

const shortName = (text: string) => {
  const t = text.replace(/\.$/, '');
  return t.length <= 60 ? t : `${t.slice(0, 57)}…`;
};

const ROLE_ORIGIN: Record<ConditionRole, CriterionOrigin> = {
  context: 'plan_rule',
  bias: 'bias',
  setup: 'plan_rule',
  entry: 'entry_trigger',
  confirmation: 'confirmation',
  volume: 'plan_rule',
  volatility: 'plan_rule',
  invalidation: 'invalidation',
  noTrade: 'invalidation',
};

export interface CriteriaOptions {
  /** Direction the trader is considering (bias alignment wording). */
  direction?: 'long' | 'short' | 'unsure';
}

/** Visual criteria from the strategy's own rules (checklist, trigger, confirmation, retest, invalidation, bias). */
export function strategyCriteria(strategy: Strategy, _opts: CriteriaOptions = {}): SetupCriterion[] {
  const out: SetupCriterion[] = [];
  const used = new Set<string>();
  const add = (c: Omit<SetupCriterion, 'kind' | 'weight'> & { weight?: number }) => {
    const description = sanitizeRuleText(c.description);
    if (!description) return;
    if (out.some((x) => overlaps(x.description, description) && !!x.inverted === !!c.inverted)) return;
    let id = c.id;
    while (used.has(id)) id = `${c.id}_${used.size}`;
    used.add(id);
    out.push({ ...c, id, description, name: sanitizeRuleText(c.name).slice(0, 80), kind: 'visual', weight: c.weight ?? (c.required ? REQUIRED_WEIGHT : OPTIONAL_WEIGHT) });
  };

  // 1. The checklist the trader saved (their explicit yes/no conditions).
  for (const item of strategy.checklist) {
    add({ id: `checklist_${slug(item.id || item.label)}`, name: item.label, description: item.label, required: item.required, origin: 'checklist' });
  }

  // 2. Rules from the strategy's Strategy-Intelligence analysis (with the trader's approved resolutions).
  if (strategy.structured) {
    const rules = testableRulesOf(applyResolutions(strategy.structured));
    for (const c of rules.conditions) {
      const inverted = c.role === 'invalidation' || c.role === 'noTrade';
      add({
        id: `rule_${slug(c.id || c.text)}`,
        name: inverted ? `Not present: ${shortName(c.text)}` : shortName(c.text),
        description: c.text,
        required: true,
        origin: ROLE_ORIGIN[c.role],
        inverted,
      });
    }
  }

  // 3. The strategy's written rules (library / custom strategies).
  if (strategy.requiresBiasAlignment && strategy.biasRequirement.trim()) {
    add({ id: 'bias_alignment', name: `${sanitizeRuleText(strategy.biasRequirement)} bias aligned`, description: `Trade direction aligns with the ${sanitizeRuleText(strategy.biasRequirement)} bias`, required: true, origin: 'bias' });
  }
  for (const t of splitRules(strategy.entryTrigger)) add({ id: `trigger_${slug(t)}`, name: 'Entry trigger', description: t, required: true, origin: 'entry_trigger' });
  for (const t of splitRules(strategy.confirmationRules)) add({ id: `confirm_${slug(t)}`, name: shortName(t), description: t, required: true, origin: 'confirmation' });
  for (const t of splitRules(strategy.retestRules)) add({ id: `retest_${slug(t)}`, name: 'Retest', description: t, required: true, origin: 'retest' });
  for (const t of splitRules(strategy.invalidationRules)) {
    add({ id: `invalid_${slug(t)}`, name: `Not invalidated: ${shortName(t)}`, description: t, required: true, origin: 'invalidation', inverted: true });
  }
  return out;
}

/** True when the strategy gives the engine something to check visually. */
export const hasCheckableRules = (strategy: Strategy) => strategyCriteria(strategy).length > 0;
