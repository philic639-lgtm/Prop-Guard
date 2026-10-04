import type { ChecklistItem, InstrumentSymbol, Strategy } from '@/types/domain';
import { formatClock } from '@/utils/dates';

import { diagnoseStrategy, diagnosisInput, finalizeStructured, sectionName } from './analyze';
import { interpretStrategy, makeRule } from './interpret';
import { buildRuleSet, compileRuleSet, type CompiledRuleSet, type TestableRuleSet } from './ruleset';
import type { RuleProvenance, RuleSection, StrategyHealthScore, StrategyRule, StrategySuggestion, StructuredStrategy, SuggestionStatus } from './types';

/** All rules of a structured strategy, in section order. */
export function allRules(s: StructuredStrategy): StrategyRule[] {
  return [
    ...s.biasRules,
    ...s.contextRules,
    ...s.setupRules,
    ...s.entryRules,
    ...s.confirmationRules,
    ...s.stopRules,
    ...s.targetRules,
    ...s.managementRules,
    ...s.invalidationRules,
    ...s.noTradeRules,
    ...s.riskRules,
    ...s.filterRules,
    ...(s.volatilityRules ?? []),
    ...(s.volumeRules ?? []),
  ];
}

const isApplied = (st: SuggestionStatus) => st === 'accepted' || st === 'edited';

/** Accepted / edited suggestions as rules (provenance: suggested). Pending and rejected never become rules. */
export function acceptedSuggestionRules(s: StructuredStrategy): StrategyRule[] {
  return s.aiSuggestedRules
    .filter((g) => isApplied(g.status) && g.section !== 'window')
    .map((g) => ({ ...makeRule(g.section, (g.status === 'edited' && g.editedText) || g.suggestedRule, 'suggested', undefined, s.originalText, true), suggestionId: g.id }));
}

/** Rules after the trader's decisions: trader + inferred + accepted suggestions; objectified originals are replaced. */
export function effectiveRules(s: StructuredStrategy): StrategyRule[] {
  const accepted = s.aiSuggestedRules.filter((g) => isApplied(g.status));
  const replaced = new Set(accepted.filter((g) => g.kind === 'objectify' && g.original).map((g) => g.original));
  const base = allRules(s).map((r) => (r.provenance === 'trader' && replaced.has(r.text) ? { ...r, vagueTerms: [], measurable: true } : r));
  return [...base, ...acceptedSuggestionRules(s)];
}

/** Window / limits after accepted suggestions and answered questions. */
export function effectiveFields(s: StructuredStrategy) {
  let { start, end } = s.tradingWindow;
  let maxTrades = s.maxTrades;
  let minRR = s.minRR;
  for (const g of s.aiSuggestedRules.filter((x) => isApplied(x.status))) {
    if (g.apply?.windowStart && !start) start = g.apply.windowStart;
    if (g.apply?.windowEnd && !end) end = g.apply.windowEnd;
    if (g.apply?.maxTrades != null && maxTrades == null) maxTrades = g.apply.maxTrades;
    if (g.apply?.minRR != null && minRR == null) minRR = g.apply.minRR;
  }
  const answered = (v: string) => s.unresolvedQuestions.find((q) => q.variable === v)?.answer?.trim() || null;
  const instrument = s.instrument.length ? s.instrument : answered('instrument') ? [answered('instrument')!.toUpperCase()] : [];
  const tf = answered('timeframe');
  return { start, end, maxTrades, minRR, instrument, timeframes: s.timeframes.length ? s.timeframes : tf ? [tf] : [] };
}

/** Health score once accepted suggestions are applied (shown next to the original score). */
export function improvedHealth(s: StructuredStrategy): StrategyHealthScore {
  const f = effectiveFields(s);
  const rules = effectiveRules(s);
  return diagnoseStrategy({
    ...diagnosisInput(s, rules),
    instruments: f.instrument,
    windowStart: f.start,
    windowEnd: f.end,
    maxTrades: f.maxTrades,
    minRR: f.minRR,
    timeframes: f.timeframes,
  });
}

export function setSuggestionStatus(s: StructuredStrategy, id: string, status: SuggestionStatus, editedText?: string): StructuredStrategy {
  return { ...s, aiSuggestedRules: s.aiSuggestedRules.map((g) => (g.id === id ? { ...g, status, editedText: status === 'edited' ? editedText?.trim() || g.suggestedRule : undefined } : g)) };
}

export function answerQuestion(s: StructuredStrategy, id: string, answer: string): StructuredStrategy {
  return { ...s, unresolvedQuestions: s.unresolvedQuestions.map((q) => (q.id === id ? { ...q, answer } : q)) };
}

// ───────────────────────────── Improved strategy checklist ─────────────────────────────

export interface ChecklistLine {
  text: string;
  provenance: RuleProvenance | 'account';
  /** Suggestion lines: pending ones are previewed but NOT saved. */
  status?: SuggestionStatus;
  suggestionId?: string;
  measurable?: boolean;
}

export interface ChecklistSection {
  key: string;
  title: string;
  lines: ChecklistLine[];
  missing: boolean;
}

const SECTION_ORDER: { key: string; title: string; sections: RuleSection[] }[] = [
  { key: 'bias', title: 'Bias', sections: ['bias'] },
  { key: 'setup', title: 'Setup', sections: ['context', 'setup', 'filter', 'volatility', 'volume'] },
  { key: 'entry', title: 'Entry', sections: ['entry'] },
  { key: 'confirmation', title: 'Confirmation', sections: ['confirmation'] },
  { key: 'stop', title: 'Stop loss', sections: ['stop'] },
  { key: 'target', title: 'Take profit', sections: ['target', 'management'] },
  { key: 'invalidation', title: 'Invalidation', sections: ['invalidation'] },
  { key: 'noTrade', title: 'Do not trade if', sections: ['noTrade'] },
];

export function improvedChecklist(s: StructuredStrategy, opts: { accountMaxTrades?: number } = {}): ChecklistSection[] {
  const f = effectiveFields(s);
  const live = s.aiSuggestedRules.filter((g) => g.status !== 'rejected');
  const replaced = new Set(live.filter((g) => isApplied(g.status) && g.kind === 'objectify').map((g) => g.original));
  const rulesIn = (secs: RuleSection[]): ChecklistLine[] => [
    ...allRules(s)
      .filter((r) => secs.includes(r.section) && !(r.provenance === 'trader' && replaced.has(r.text)))
      .map((r) => ({ text: r.text, provenance: r.provenance, measurable: r.measurable })),
    ...live
      .filter((g) => secs.includes(g.section))
      .map((g) => ({ text: (g.status === 'edited' && g.editedText) || g.suggestedRule, provenance: 'suggested' as const, status: g.status, suggestionId: g.id, measurable: true })),
  ];
  const winSuggestion = live.find((g) => g.section === 'window');
  const out: ChecklistSection[] = [];
  const push = (key: string, title: string, lines: ChecklistLine[]) => out.push({ key, title, lines, missing: lines.length === 0 });

  push('market', 'Market', f.instrument.length ? [{ text: f.instrument.join(', '), provenance: s.instrument.length ? 'trader' : 'trader' }] : []);
  push('session', 'Session', s.session ? [{ text: s.session, provenance: 'inferred' }] : []);
  const win: ChecklistLine[] = [];
  if (s.tradingWindow.start || s.tradingWindow.end) {
    win.push({
      text: s.tradingWindow.start && s.tradingWindow.end ? `${formatClock(s.tradingWindow.start)} – ${formatClock(s.tradingWindow.end)} ET` : s.tradingWindow.start ? `After ${formatClock(s.tradingWindow.start)} ET` : `Before ${formatClock(s.tradingWindow.end!)} ET`,
      provenance: s.tradingWindow.provenance ?? 'trader',
    });
  }
  if (winSuggestion) win.push({ text: winSuggestion.status === 'edited' && winSuggestion.editedText ? winSuggestion.editedText : winSuggestion.suggestedRule, provenance: 'suggested', status: winSuggestion.status, suggestionId: winSuggestion.id });
  push('window', 'Time window', win);
  push('timeframe', 'Timeframe', f.timeframes.length ? [{ text: f.timeframes.join(', '), provenance: s.timeframes.length ? 'trader' : 'trader' }] : []);
  for (const sec of SECTION_ORDER) push(sec.key, sec.title, rulesIn(sec.sections));
  const maxLines = rulesIn(['maxTrades']);
  if (s.maxTrades != null) maxLines.unshift({ text: `${s.maxTrades} per day`, provenance: 'trader' });
  // Until a limit is stated or accepted, the account's own limit applies (shown, labelled as such).
  else if (!maxLines.some((l) => l.status && isApplied(l.status)) && opts.accountMaxTrades != null) maxLines.unshift({ text: `${opts.accountMaxTrades} per day (your account rule)`, provenance: 'account' });
  push('maxTrades', 'Maximum trades', maxLines);
  push('risk', 'Risk', rulesIn(['risk']));
  return out;
}

// ───────────────────────────── Comparison: your strategy vs optimized ─────────────────────────────

/** Section-by-section view of ONLY the trader's own wording (left side of the comparison). */
export function originalChecklist(s: StructuredStrategy): ChecklistSection[] {
  const trader = allRules(s).filter((r) => r.provenance === 'trader');
  return improvedChecklist({ ...s, aiSuggestedRules: [], ...splitBySection(trader), tradingWindow: s.tradingWindow.provenance === 'trader' ? s.tradingWindow : { start: null, end: null, provenance: null } }).map((sec) => ({
    ...sec,
    lines: sec.lines.filter((l) => l.provenance === 'trader'),
    missing: !sec.lines.some((l) => l.provenance === 'trader'),
  }));
}

function splitBySection(rules: StrategyRule[]) {
  const pick = (...secs: RuleSection[]) => rules.filter((r) => secs.includes(r.section));
  return {
    biasRules: pick('bias'),
    contextRules: pick('context'),
    setupRules: pick('setup'),
    entryRules: pick('entry'),
    confirmationRules: pick('confirmation'),
    stopRules: pick('stop'),
    targetRules: pick('target'),
    managementRules: pick('management'),
    invalidationRules: pick('invalidation'),
    noTradeRules: pick('noTrade'),
    riskRules: pick('risk', 'maxTrades'),
    filterRules: pick('filter'),
    volatilityRules: pick('volatility'),
    volumeRules: pick('volume'),
  };
}

// ───────────────────────────── Testable rules (IF/THEN) ─────────────────────────────

/** Rules that define the final plan: trader + inferred + accepted suggestions, with vague originals replaced by accepted definitions. */
export function finalPlanRules(s: StructuredStrategy): StrategyRule[] {
  const accepted = s.aiSuggestedRules.filter((g) => isApplied(g.status));
  const replaced = new Set(accepted.filter((g) => g.kind === 'objectify' && g.original).map((g) => g.original));
  return [...allRules(s).filter((r) => !(r.provenance === 'trader' && replaced.has(r.text))), ...acceptedSuggestionRules(s)];
}

/** Objective IF/THEN ruleset from the trader's current decisions (pending suggestions excluded). */
export function testableRulesOf(s: StructuredStrategy): TestableRuleSet {
  const f = effectiveFields(s);
  const ctx = interpretStrategy(s.originalText).context;
  return buildRuleSet({
    name: s.name,
    originalText: s.originalText,
    direction: s.direction,
    instrument: f.instrument,
    timeframes: f.timeframes,
    window: { start: f.start, end: f.end },
    conceptIds: s.detectedStyle.map((d) => d.id),
    orbMinutes: ctx.orbMinutes ?? (Number(s.unresolvedQuestions.find((q) => q.variable === 'openingRangeMinutes')?.answer) || null),
    emaPeriod: ctx.emaPeriod,
    emaType: ctx.emaType,
    level: ctx.level,
    stopPoints: s.stopPoints,
    minRR: f.minRR,
    maxTrades: f.maxTrades,
    rules: finalPlanRules(s),
  });
}

/** The trader's plan as an evaluator Practice Mode can run on candles. */
export function compileStrategy(s: StructuredStrategy, strategyId: string): CompiledRuleSet {
  return compileRuleSet(testableRulesOf(s), strategyId);
}

// ───────────────────────────── To a saved Strategy ─────────────────────────────

export interface ToStrategyOptions {
  id: string;
  now: string;
  /** The trader's own account limit — used only when the plan has no trade limit. */
  accountMaxTrades: number;
}

const joinTexts = (rules: StrategyRule[]) => rules.map((r) => r.text).join('; ');

/**
 * Convert the analysis (with the trader's Accept/Edit/Reject decisions) into a
 * Strategy usable everywhere in Prop Guard. Pending and rejected suggestions
 * are NOT included. The original text and full structured analysis are kept.
 */
export function toStrategy(s: StructuredStrategy, o: ToStrategyOptions): Strategy {
  const finalized = finalizeStructured(s, effectiveRules(s));
  const structured: StructuredStrategy = { ...s, strategyHealthScore: finalized.strategyHealthScore, testableRules: testableRulesOf(s) };
  const f = effectiveFields(s);
  const rules = effectiveRules(s);
  const by = (...secs: RuleSection[]) => rules.filter((r) => secs.includes(r.section));
  const checklistRules = by('bias', 'context', 'setup', 'entry', 'confirmation', 'noTrade', 'filter').filter((r) => !/^Direction:/.test(r.text) || r.provenance !== 'inferred');
  const checklist: ChecklistItem[] = checklistRules.map((r, i) => ({
    id: `si_${i}_${r.id}`,
    label: (r.section === 'noTrade' ? `No-trade condition clear: ${r.text}` : r.text).slice(0, 160),
    kind: 'yesno',
    required: true,
  }));
  if (!checklist.length) checklist.push({ id: 'si_plan', label: 'Setup matches my written plan', kind: 'yesno', required: true });
  const fullWindow = f.start && f.end;
  if (f.start && !f.end) checklist.unshift({ id: 'si_after', label: `Time is after ${formatClock(f.start)} ET`, kind: 'yesno', required: true });
  const bias = by('bias').filter((r) => r.provenance !== 'inferred' || !/^Direction:/.test(r.text));
  return {
    id: o.id,
    name: s.name,
    markets: f.instrument as InstrumentSymbol[],
    session: s.session,
    timeframe: f.timeframes.join(', '),
    entryWindowStart: fullWindow ? f.start : null,
    entryWindowEnd: fullWindow ? f.end : null,
    biasRequirement: joinTexts(bias).slice(0, 120),
    requiresBiasAlignment: bias.length > 0,
    entryTrigger: joinTexts(by('entry')),
    confirmationRules: joinTexts(by('confirmation')),
    retestRules: joinTexts(by('confirmation', 'entry').filter((r) => /re-?test/i.test(r.text))),
    stopMethod: joinTexts(by('stop')),
    typicalStopMin: null,
    typicalStopMax: s.stopPoints,
    targetMethod: joinTexts(by('target', 'management')),
    // Not stated and not accepted → 1 (Prop Guard then only warns below 1:1 — no invented target).
    minRR: f.minRR ?? 1,
    maxTrades: f.maxTrades ?? o.accountMaxTrades,
    invalidationRules: joinTexts(by('invalidation')),
    notes: s.originalText.trim(),
    checklist,
    source: 'custom',
    sourceType: 'CUSTOM',
    originalText: s.originalText,
    structured,
    createdAt: o.now,
    updatedAt: o.now,
  };
}

export function provenanceLabel(p: ChecklistLine['provenance'], status?: SuggestionStatus): string {
  if (p === 'trader') return 'Your rule';
  if (p === 'inferred') return 'AI interpretation';
  if (p === 'account') return 'Account rule';
  if (status === 'accepted') return 'AI suggestion · accepted';
  if (status === 'edited') return 'AI suggestion · edited';
  return 'AI suggestion';
}

export { sectionName };
export type { StrategySuggestion };
