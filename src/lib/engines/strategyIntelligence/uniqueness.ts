import { STRATEGY_LIBRARY } from '@/data/strategyLibrary';

import { conceptIdsIn } from './concepts';
import type { StrategyRule, StrategySuggestion, StructuredStrategy, UniquenessReport } from './types';

/**
 * STAGE 8 — uniqueness test.
 *
 * Before an analysis is returned, its improved strategy is compared with
 * Prop Guard's common templates and with strategies analysed before. If it
 * drifted toward a template the trader never described, or most of it is
 * Prop Guard's wording rather than the trader's, the caller regenerates the
 * recommendations in "preserve" mode (trader vocabulary only).
 */

const STOP = new Set(
  'the a an and or of to in on at for with by from is are be it its this that then than when if into after before your you my i not no only each per one two first last price candle candles bar bars close closes closed minute minutes trade trades trading entry enter stop target level levels setup rule plan time day session points point tick ticks least most more than prop guard suggested requires testing direction long short both above below beyond back'.split(' '),
);
/** Concepts too generic to define a strategy's identity. */
const GENERIC_CONCEPTS = new Set(['momentum', 'volume', 'scalping', 'news']);

export function tokens(texts: string[]): Set<string> {
  return new Set(
    texts
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9% ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** The improved STRATEGY as text: kept rules plus every live strategy-scope suggestion (account-wide protections are not strategy identity). */
export function improvedTexts(rules: StrategyRule[], suggestions: StrategySuggestion[]): string[] {
  return [...rules.map((r) => r.text), ...suggestions.filter((s) => s.status !== 'rejected' && s.scope !== 'account').map((s) => (s.status === 'edited' && s.editedText) || s.suggestedRule)];
}

export interface UniquenessReference {
  name: string;
  originalText: string;
  improved: string[];
}

const TEMPLATES = STRATEGY_LIBRARY.map((t) => {
  const text = [t.name, t.description, ...t.checklist, t.entryTrigger].join(' ');
  return { id: t.id, name: t.name, concepts: conceptIdsIn(text).filter((c) => !GENERIC_CONCEPTS.has(c)), tokens: tokens([t.name, ...t.checklist, t.entryTrigger]) };
});

export const UNIQUENESS_LIMITS = { foreignTemplate: 0.3, previous: 0.55, identityRetention: 0.3 } as const;

/**
 * `ownVocabulary` = words from the trader's text plus the vocabulary of the concepts THEY used
 * (e.g. "sweep", "reclaim" for a sweep strategy). Identity retention is the share of the
 * improved plan expressed in that vocabulary rather than in borrowed template language.
 */
export function assessUniqueness(s: Pick<StructuredStrategy, 'originalText' | 'detectedStyle'>, rules: StrategyRule[], suggestions: StrategySuggestion[], references: UniquenessReference[] = [], attempts = 1, ownVocabulary: Set<string> = new Set()): UniquenessReport {
  const improved = tokens(improvedTexts(rules, suggestions));
  const own = new Set([...tokens([s.originalText, ...rules.filter((r) => r.provenance !== 'suggested').map((r) => r.text)]), ...ownVocabulary]);
  const userConcepts = new Set(s.detectedStyle.map((d) => d.id));
  const notes: string[] = [];

  let closestForeignTemplate: UniquenessReport['closestForeignTemplate'] = null;
  for (const t of TEMPLATES) {
    if (!t.concepts.length || t.concepts.some((c) => userConcepts.has(c))) continue; // the trader's own kind of strategy is not drift
    const sim = jaccard(improved, t.tokens);
    if (!closestForeignTemplate || sim > closestForeignTemplate.similarity) closestForeignTemplate = { id: t.id, name: t.name, similarity: Math.round(sim * 1000) / 1000 };
  }
  let closestPrevious: UniquenessReport['closestPrevious'] = null;
  for (const ref of references) {
    if (ref.originalText.trim() === s.originalText.trim()) continue;
    const sim = jaccard(improved, tokens(ref.improved));
    if (!closestPrevious || sim > closestPrevious.similarity) closestPrevious = { name: ref.name, similarity: Math.round(sim * 1000) / 1000 };
  }
  let kept = 0;
  for (const w of improved) if (own.has(w)) kept++;
  const identityRetention = improved.size ? Math.round((kept / improved.size) * 1000) / 1000 : 1;

  if (closestForeignTemplate && closestForeignTemplate.similarity >= UNIQUENESS_LIMITS.foreignTemplate) notes.push(`Recommendations drifted toward "${closestForeignTemplate.name}", a strategy you did not describe.`);
  if (closestPrevious && closestPrevious.similarity >= UNIQUENESS_LIMITS.previous) notes.push(`The improved plan is very close to "${closestPrevious.name}", which started from a different description.`);
  if (identityRetention < UNIQUENESS_LIMITS.identityRetention) notes.push('Most of the improved plan would be Prop Guard’s wording rather than yours.');
  const suggestionsWithTools = suggestions.filter((x) => x.status !== 'rejected' && x.introducesTools.length);
  if (suggestionsWithTools.length) notes.push(`${suggestionsWithTools.length} suggestion${suggestionsWithTools.length === 1 ? '' : 's'} would add a tool you do not use (${[...new Set(suggestionsWithTools.flatMap((x) => x.introducesTools))].join(', ')}).`);
  const passes =
    !(closestForeignTemplate && closestForeignTemplate.similarity >= UNIQUENESS_LIMITS.foreignTemplate) &&
    !(closestPrevious && closestPrevious.similarity >= UNIQUENESS_LIMITS.previous) &&
    identityRetention >= UNIQUENESS_LIMITS.identityRetention &&
    suggestionsWithTools.length === 0;
  if (passes) notes.push(attempts > 1 ? 'Recommendations were regenerated to keep your original logic.' : 'The improved plan stays recognisably yours.');
  return { closestForeignTemplate, closestPrevious, identityRetention, passes, attempts, notes };
}
