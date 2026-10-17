import { isInstrumentSymbol } from '@/lib/engines/instrumentEngine';
import { finalizeStructured, makeStrategyRule, UNSUPPORTED_CLAIMS, type BehavioralRisk, type ClarifyingQuestion, type StrategySuggestion, type StructuredStrategy } from '@/lib/engines/strategyIntelligence';
import { allRules } from '@/lib/engines/strategyIntelligence/compose';
import { introducedTools } from '@/lib/engines/strategyIntelligence/vagueness';
import type { UniquenessReference } from '@/lib/engines/strategyIntelligence/uniqueness';

import type { StrategyAnalysisAI } from './types';

/** Statements about the trader as a person (the plan is analysed, never the person). */
const ABOUT_THE_PERSON = /\byou(?:'re| are| seem| feel| tend| lack| struggle| have (?:a|an) (?:problem|issue|tendency))\b|your (?:psychology|personality|emotions|mindset|ego|fear|greed)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9:.%$ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** A "trader" rule must quote words that are actually in the description. */
export function quoteIsInText(quote: string | null | undefined, text: string): boolean {
  if (!quote) return false;
  const q = norm(quote);
  return q.length >= 3 && norm(text).includes(q);
}

const clean = (s: string) => !UNSUPPORTED_CLAIMS.test(s);
let n = 0;
const id = (p: string) => `ai_${p}_${(n++).toString(36)}`;

/**
 * Merge a model's analysis with the deterministic local analysis.
 *  - provenance is verified: unquoted "trader" rules become "inferred";
 *  - measurability and vagueness are re-derived locally, and the health score
 *    is ALWAYS computed by the local engine (the model cannot inflate it);
 *  - unsupported performance claims and statements about the person are dropped;
 *  - numbers the trader typed (window, limits, stop) come from the local parser first.
 */
export function mergeAiStrategyAnalysis(ai: StrategyAnalysisAI, local: StructuredStrategy, references: UniquenessReference[] = []): StructuredStrategy {
  const text = local.originalText;
  const rules = ai.rules
    .filter((r) => clean(r.text))
    .map((r) => {
      const trusted = r.provenance === 'trader' && quoteIsInText(r.quote, text);
      return makeStrategyRule(r.section, r.text, trusted ? 'trader' : 'inferred', trusted ? r.quote ?? undefined : undefined, text);
    });
  // Keep local trader rules the model missed (by quote), so nothing the trader said is lost.
  const covered = new Set(rules.map((r) => norm(r.quote ?? '')));
  for (const r of allRules(local)) {
    if (r.provenance === 'trader' && r.quote && ![...covered].some((c) => c && (c.includes(norm(r.quote!)) || norm(r.quote!).includes(c)))) rules.push(r);
  }
  const finalRules = rules.length ? rules : allRules(local);

  const aiSuggestions: StrategySuggestion[] = ai.suggestions
    .filter((s) => clean(s.suggestedRule) && clean(s.title) && s.section !== 'maxTrades')
    .map((s) => ({
      id: id('sg'),
      section: s.section,
      kind: s.kind,
      title: s.title,
      issue: s.issue,
      original: s.original ?? undefined,
      suggestedRule: s.suggestedRule,
      rationale: s.confidence === 'D' && !/requires testing/i.test(s.rationale) ? `${s.rationale} Suggested by Prop Guard — requires testing.` : s.rationale,
      status: 'pending' as const,
      confidence: s.confidence,
      introducesTools: introducedTools(s.suggestedRule, text),
      scope: s.section === 'risk' || /\b(news|cpi|fomc|nfp)\b/i.test(s.suggestedRule) ? ('account' as const) : ('strategy' as const),
    }))
    // Keep the trader's toolset: a model suggestion that swaps in a new indicator is dropped (local wording covers the gap).
    .filter((s) => s.introducesTools.length === 0);
  // Local suggestions carry structured `apply` values (limits, windows) and fill sections the model skipped.
  const localKeep = local.aiSuggestedRules.filter((l) => l.section === 'maxTrades' || l.section === 'window' || !aiSuggestions.some((a) => a.section === l.section && a.kind === l.kind));
  const suggestions = [...aiSuggestions, ...localKeep];

  const questions: ClarifyingQuestion[] = [...local.unresolvedQuestions];
  for (const q of ai.questions) if (!questions.some((x) => x.variable === q.variable)) questions.push({ id: id('q'), variable: q.variable, question: q.question, why: q.why, options: q.options });

  const risks: BehavioralRisk[] = ai.behavioralRisks
    .filter((r) => clean(r.explanation) && !ABOUT_THE_PERSON.test(r.explanation) && !ABOUT_THE_PERSON.test(r.title))
    .map((r) => ({ id: id('br'), ...r }));

  const instruments = [...new Set([...local.instrument, ...ai.instruments.map((s) => s.toUpperCase()).filter(isInstrumentSymbol)])];
  const styles = ai.styles.length
    ? ai.styles.map((s) => ({ id: s.id.toLowerCase().replace(/[^a-z0-9_]+/g, '_'), label: s.label, confidence: 0.8, evidence: s.evidence.filter((e) => quoteIsInText(e, text)) }))
    : local.detectedStyle;

  return finalizeStructured(
    {
      version: 1,
      originalText: text,
      name: clean(ai.name) ? ai.name : local.name,
      detectedStyle: styles,
      classification: ai.classification && clean(ai.classification) ? ai.classification : local.classification,
      direction: local.directionSource === 'trader' ? local.direction : (ai.direction ?? local.direction),
      directionSource: local.directionSource === 'trader' ? 'trader' : ai.direction ? 'inferred' : local.directionSource,
      instrument: instruments,
      session: local.session || ai.session,
      tradingWindow: local.tradingWindow.start || local.tradingWindow.end ? local.tradingWindow : { start: ai.tradingWindow.start, end: ai.tradingWindow.end, provenance: ai.tradingWindow.start || ai.tradingWindow.end ? 'inferred' : null },
      timeframes: local.timeframes.length ? local.timeframes : ai.timeframes,
      maxTrades: local.maxTrades ?? ai.maxTrades,
      stopPoints: local.stopPoints ?? ai.stopPoints,
      minRR: local.minRR ?? ai.minRR,
      aiSuggestedRules: suggestions,
      unresolvedQuestions: questions.slice(0, 3),
      analysisSource: 'ai',
      analyzedAt: local.analyzedAt,
    },
    finalRules,
    risks,
    { references },
  );
}
