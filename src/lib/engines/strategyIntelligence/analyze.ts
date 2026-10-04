import { formatClock } from '@/utils/dates';

import { abbreviateLevel, CONCEPTS, conceptById, type Concept, type ConceptContext } from './concepts';
import { interpretStrategy, makeRule, type Interpretation } from './interpret';
import type {
  BehavioralRisk,
  ClarifyingQuestion,
  DetectedStyle,
  HealthDimension,
  RuleSection,
  StrategyHealthScore,
  StrategyRule,
  StrategySuggestion,
  StructuredStrategy,
} from './types';
import { findVagueTerms } from './vagueness';

/**
 * Strategy Intelligence pipeline (deterministic, on-device):
 *   1 interpret → 2 diagnose → 3 behavioral risk → 4 objectify → 5 improve.
 * The AI provider may replace stage-1 interpretation and add suggestions, but
 * scoring, provenance rules and safety wording always run here.
 */

/** Never used about a strategy without historical evidence. */
export const UNSUPPORTED_CLAIMS = /\b(proven|profitable|profitability|high[- ]win[- ]rate|win rate|guarantee[ds]?|guaranteed|safe|risk[- ]free|can'?t lose|sure thing|always works)\b/i;

const SECTIONS_WITH_RULES: RuleSection[] = ['bias', 'context', 'setup', 'entry', 'confirmation', 'stop', 'target', 'management', 'invalidation', 'noTrade', 'risk', 'maxTrades', 'filter'];

let sid = 0;
const sugId = (p: string) => `sg_${p}_${(sid++).toString(36)}`;

// ───────────────────────────── Concept ordering ─────────────────────────────

/** Concepts in the description, most specific first (they word the suggestions). */
function activeConcepts(styles: DetectedStyle[]): Concept[] {
  return styles
    .map((s) => conceptById(s.id))
    .filter((c): c is Concept => !!c)
    .sort((a, b) => b.specificity - a.specificity);
}

function firstFrom<K extends keyof Concept>(concepts: Concept[], key: K): Concept | undefined {
  return concepts.find((c) => typeof c[key] === 'function');
}

// ───────────────────────────── Inferred rules ─────────────────────────────

function inferredRules(i: Interpretation, concepts: Concept[]): StrategyRule[] {
  const out: StrategyRule[] = [];
  const add = (section: RuleSection, text: string, measurable = true) => out.push(makeRule(section, text, 'inferred', undefined, i.originalText, measurable));
  for (const c of concepts) for (const t of c.inferred?.(i.context) ?? []) add('setup', t);
  if (i.directionProvenance === 'inferred' && i.direction) {
    const why = i.styles.some((s) => s.id === 'mean_reversion') ? 'counter to the stretch (fade)' : i.direction === 'both' ? 'in either direction' : i.direction === 'long' ? 'long only' : 'short only';
    add('bias', `Direction: ${why}`, true);
  }
  // Ordered trader steps imply the entry when no explicit entry rule exists.
  const hasEntry = i.rules.some((r) => r.section === 'entry' && r.provenance === 'trader');
  const confirmations = i.rules.filter((r) => r.section === 'confirmation');
  if (!hasEntry && confirmations.length) add('entry', `Enter after: ${confirmations.map((r) => r.text.toLowerCase()).join(' → ')}`, confirmations.every((r) => r.measurable));
  return out;
}

// ───────────────────────────── Suggestions (objectify + missing) ─────────────────────────────

function suggestionsFor(i: Interpretation, concepts: Concept[], rules: StrategyRule[]): StrategySuggestion[] {
  const out: StrategySuggestion[] = [];
  const has = (s: RuleSection) => rules.some((r) => r.section === s);
  const c = i.context;

  // STAGE 4 — make subjective rules objective.
  const seen = new Set<string>();
  for (const r of rules.filter((x) => x.provenance === 'trader')) {
    for (const hit of findVagueTerms(r.quote ?? r.text, i.originalText)) {
      if (seen.has(hit.term.key)) continue;
      seen.add(hit.term.key);
      out.push({
        id: sugId('obj'),
        section: hit.term.section ?? r.section,
        kind: 'objectify',
        title: `Define "${hit.match}"`,
        issue: hit.term.issue(hit.match),
        original: r.text,
        suggestedRule: hit.term.suggest(c, r.quote ?? r.text),
        rationale: 'A measurable definition means the same chart always gets the same decision — and the rule can be tested in Historical Practice.',
        status: 'pending',
      });
    }
  }

  // STAGE 5 — fill missing structure, worded for THIS strategy's concepts.
  const missing = (section: RuleSection, key: 'stop' | 'target' | 'invalidation' | 'entry' | 'noTrade', title: string, issue: string, generic: string, rationale: string) => {
    const concept = firstFrom(concepts, key);
    const fn = concept?.[key] as ((x: ConceptContext) => string) | undefined;
    let rule = fn ? fn(c) : generic;
    if (key === 'stop' && !/^stop/i.test(rule)) rule = `Stop ${rule.charAt(0).toLowerCase()}${rule.slice(1)}`;
    out.push({ id: sugId(key), section, kind: 'missing', title, issue, suggestedRule: rule, rationale, status: 'pending' });
  };

  // An entry "idea" (e.g. "enter pullbacks into the 20 EMA") still needs the exact trigger event.
  const traderEntries = rules.filter((r) => r.section === 'entry' && r.provenance === 'trader');
  const TRIGGER = /close|candle|break|cross|engulf|limit order|market order|stop order|tick (?:above|below)|reclaim/i;
  const entryImprecise = !traderEntries.length || traderEntries.every((r) => !r.measurable || !TRIGGER.test(r.text));
  if (!has('entry') || (entryImprecise && firstFrom(concepts, 'entry'))) {
    missing('entry', 'entry', 'Define the exact entry trigger', has('entry') ? 'The entry describes the idea but not the exact moment to enter.' : 'No entry trigger is stated.', `Enter on the first ${c.timeframe ?? '5-minute'} candle that closes in the trade direction after the setup is complete`, 'An exact trigger prevents entering early on anticipation or late on a chase.');
  }
  if (!has('stop') && i.stopPoints == null) {
    missing('stop', 'stop', 'Add a stop-loss rule', 'The plan has no stop-loss — risk on every trade is undefined.', 'Stop 1 tick beyond the structure that invalidates the idea (the setup high/low)', 'A pre-defined stop caps the loss before entry and makes position sizing possible.');
  }
  if (!has('target') && i.minRR == null) {
    missing('target', 'target', 'Add a take-profit rule', 'No exit for winning trades is defined.', 'First target at 2R; move the stop to break-even after 1R', 'A defined exit stops winners being cut early or given back.');
  }
  if (!has('invalidation')) {
    missing('invalidation', 'invalidation', 'Add an invalidation condition', 'Nothing says when the setup is no longer valid.', 'Setup is void if price closes beyond the setup extreme before the entry triggers', 'Invalidation tells you when to stand aside instead of forcing a late entry.');
  }
  if (i.maxTrades == null && !has('maxTrades')) {
    const scalp = i.styles.some((s) => s.id === 'scalping');
    out.push({
      id: sugId('max'),
      section: 'maxTrades',
      kind: 'protection',
      title: 'Set a maximum number of trades',
      issue: 'No daily trade limit — the plan allows unlimited attempts.',
      suggestedRule: scalp ? 'Maximum 4 trades per day; stop after 2 consecutive losses' : 'Maximum 2 trades per day',
      rationale: 'A hard limit removes the option to trade repeatedly after a loss.',
      status: 'pending',
      apply: { maxTrades: scalp ? 4 : 2 },
    });
  }
  if (!i.window.start && !i.window.end) {
    out.push({
      id: sugId('win'),
      section: 'window',
      kind: 'protection',
      title: 'Add a trading window',
      issue: 'No time window — the plan can be traded at any hour, including low-liquidity chop.',
      suggestedRule: i.styles.some((s) => s.id === 'orb' || s.id === 'opening_drive') ? 'Only take entries between 9:45 AM and 11:00 AM ET' : 'Only take entries between 9:30 AM and 11:30 AM ET (the highest-liquidity part of the session)',
      rationale: 'A fixed window keeps the strategy to the market conditions it was designed for.',
      status: 'pending',
      apply: i.styles.some((s) => s.id === 'orb' || s.id === 'opening_drive') ? { windowStart: '09:45', windowEnd: '11:00' } : { windowStart: '09:30', windowEnd: '11:30' },
    });
  } else if (i.window.start && !i.window.end) {
    const [h, m] = i.window.start.split(':').map(Number);
    const end = `${String(Math.min(15, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    out.push({
      id: sugId('win'),
      section: 'window',
      kind: 'protection',
      title: 'Add an end to the trading window',
      issue: `The plan says when to start (${formatClock(i.window.start)}) but not when to stop looking for trades.`,
      suggestedRule: `No new entries after ${formatClock(end)} ET`,
      rationale: 'Setups that trigger late in the session behave differently from the ones the plan describes.',
      status: 'pending',
      apply: { windowStart: i.window.start, windowEnd: end },
    });
  }
  if (!has('noTrade')) {
    const concept = firstFrom(concepts, 'noTrade');
    out.push({
      id: sugId('nt'),
      section: 'noTrade',
      kind: 'protection',
      title: 'Add do-not-trade conditions',
      issue: 'The plan never says when to sit out.',
      suggestedRule: concept?.noTrade ? `${concept.noTrade(c)}; no entries 5 minutes before/after scheduled high-impact news (CPI, FOMC, NFP)` : 'No entries 5 minutes before/after scheduled high-impact news (CPI, FOMC, NFP)',
      rationale: 'Knowing when NOT to trade is part of the edge definition.',
      status: 'pending',
    });
  }
  if (!has('risk')) {
    out.push({
      id: sugId('risk'),
      section: 'risk',
      kind: 'protection',
      title: 'Define risk per trade',
      issue: 'Position size / risk per trade is not stated.',
      suggestedRule: 'Risk a fixed dollar amount per trade (your account max risk per trade); size = risk ÷ (stop distance × point value)',
      rationale: 'Fixed risk keeps one trade from outweighing the rest of the plan.',
      status: 'pending',
    });
  }
  if (i.minRR == null && has('target') === false && !out.some((s) => s.section === 'target')) {
    out.push({ id: sugId('rr'), section: 'target', kind: 'missing', title: 'Set a minimum reward:risk', issue: 'No minimum reward:risk.', suggestedRule: 'Only take trades with at least 1:2 reward:risk to the first target', rationale: 'Filters out trades where the stop is too wide for the available room.', status: 'pending', apply: { minRR: 2 } });
  }
  // Attach R:R to the target suggestion so accepting it sets the strategy's minimum.
  const target = out.find((s) => s.section === 'target' && s.kind === 'missing');
  if (target && i.minRR == null && /\b2R\b/.test(target.suggestedRule)) target.apply = { ...target.apply, minRR: 2 };
  return out;
}

// ───────────────────────────── Questions ─────────────────────────────

function questionsFor(i: Interpretation, rules: StrategyRule[]): ClarifyingQuestion[] {
  const q: ClarifyingQuestion[] = [];
  if (!i.instruments.length) {
    q.push({ id: 'q_instrument', variable: 'instrument', question: 'Which market do you trade this on?', why: 'Stops, targets and risk depend on the contract — this cannot be inferred.', options: ['ES', 'MES', 'NQ', 'MNQ', 'CL', 'GC'] });
  }
  if (!rules.some((r) => ['entry', 'confirmation', 'setup'].includes(r.section))) {
    q.push({ id: 'q_entry', variable: 'entryTrigger', question: 'What exactly has to happen on the chart for you to enter?', why: 'Without an entry condition there is no strategy to check.' });
  }
  if (i.styles.some((s) => s.id === 'orb') && i.context.orbMinutes == null) {
    q.push({ id: 'q_orb', variable: 'openingRangeMinutes', question: 'How many minutes define your opening range?', why: 'The opening range length changes every level the strategy uses.', options: ['5', '15', '30', '60'] });
  }
  if (!i.timeframes.length && /candle|close/i.test(i.originalText)) {
    q.push({ id: 'q_tf', variable: 'timeframe', question: 'Which chart timeframe do your candle closes use?', why: 'A 1-minute close and a 15-minute close are different rules.', options: ['1m', '2m', '5m', '15m'] });
  }
  return q.slice(0, 3);
}

// ───────────────────────────── Diagnosis (STAGE 2) ─────────────────────────────

export interface DiagnosisInput {
  rules: StrategyRule[];
  instruments: string[];
  windowStart: string | null;
  windowEnd: string | null;
  timeframes: string[];
  direction: StructuredStrategy['direction'];
  maxTrades: number | null;
  stopPoints: number | null;
  minRR: number | null;
  session: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function diagnoseStrategy(d: DiagnosisInput): StrategyHealthScore {
  const by = (s: RuleSection) => d.rules.filter((r) => r.section === s);
  const anyM = (s: RuleSection) => by(s).some((r) => r.measurable);
  const traderRules = d.rules.filter((r) => r.section !== 'window');
  const vague = d.rules.filter((r) => r.vagueTerms.length);
  const entry = [...by('entry'), ...by('setup')];
  const hasStop = by('stop').length > 0 || d.stopPoints != null;
  const stopM = anyM('stop') || d.stopPoints != null;
  const hasTarget = by('target').length > 0 || d.minRR != null;
  const targetM = anyM('target') || d.minRR != null;
  const hasWindow = !!(d.windowStart || d.windowEnd);
  const fullWindow = !!(d.windowStart && d.windowEnd);
  const measurableShare = traderRules.length ? traderRules.filter((r) => r.measurable).length / traderRules.length : 0;

  const dims: HealthDimension[] = [
    {
      key: 'ruleClarity',
      label: 'Rule clarity',
      score: clamp(traderRules.length ? measurableShare * 100 - Math.max(0, vague.length - 1) * 8 : 0),
      notes: vague.length ? [`${vague.length} rule${vague.length === 1 ? '' : 's'} use subjective wording`] : [],
    },
    { key: 'entryPrecision', label: 'Entry precision', score: clamp((entry.length ? 35 : 0) + (entry.some((r) => r.measurable) ? 30 : 0) + (by('confirmation').length ? 15 : 0) + (anyM('confirmation') ? 20 : 0)), notes: [] },
    { key: 'riskDefinition', label: 'Risk definition', score: clamp((hasStop ? 50 : 0) + (stopM ? 25 : 0) + (by('risk').length ? 25 : 0)), notes: [] },
    { key: 'exitDefinition', label: 'Exit definition', score: clamp((hasTarget ? 50 : 0) + (targetM ? 30 : 0) + (by('management').length ? 20 : 0)), notes: [] },
    {
      key: 'marketContext',
      label: 'Market context',
      score: clamp((d.instruments.length ? 25 : 0) + (hasWindow || d.session ? 25 : 0) + (by('bias').length || by('context').length ? 25 : 0) + (by('noTrade').length || by('filter').length ? 25 : 0)),
      notes: [],
    },
    { key: 'repeatability', label: 'Repeatability', score: clamp((fullWindow ? 25 : hasWindow ? 15 : 0) + (d.timeframes.length ? 25 : 0) + (entry.some((r) => r.measurable) ? 25 : 0) + (by('invalidation').length ? 25 : 0)), notes: [] },
    { key: 'testability', label: 'Testability', score: clamp(measurableShare * 50 + (stopM ? 20 : 0) + (targetM ? 20 : 0) + (d.timeframes.length ? 10 : 0)), notes: [] },
    { key: 'overtradingProtection', label: 'Overtrading protection', score: clamp((d.maxTrades != null ? 60 : 0) + (hasWindow ? 20 : 0) + (by('noTrade').length ? 20 : 0)), notes: [] },
  ];
  const total = clamp(dims.reduce((a, x) => a + x.score, 0) / dims.length);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const criticalGaps: string[] = [];
  if (d.instruments.length) strengths.push(`Clear market (${d.instruments.join(', ')})`);
  if (fullWindow) strengths.push('Defined trading window');
  else if (hasWindow) strengths.push('Defined start time');
  if (d.direction) strengths.push('Defined directional concept');
  if (entry.some((r) => r.measurable && r.provenance === 'trader')) strengths.push('Measurable setup / entry condition');
  if (anyM('confirmation')) strengths.push('Uses a confirmation step before entry');
  if (stopM) strengths.push('Stop-loss is defined');
  if (targetM) strengths.push('Profit target / reward:risk is defined');
  if (d.maxTrades != null) strengths.push(`Daily trade limit (${d.maxTrades})`);
  if (by('noTrade').length) strengths.push('Has do-not-trade conditions');
  if (by('invalidation').length) strengths.push('Has an invalidation condition');

  for (const r of vague) weaknesses.push(`${sectionName(r.section)} is subjective ("${r.vagueTerms[0]}")`);
  if (!by('invalidation').length) weaknesses.push('No invalidation condition');
  if (d.maxTrades == null) weaknesses.push('No maximum trades defined');
  if (!hasWindow) weaknesses.push('No trading window');
  else if (!fullWindow) weaknesses.push('Trading window has no end time');
  if (!d.timeframes.length) weaknesses.push('Chart timeframe not specified');
  if (hasTarget && !targetM) weaknesses.push('Profit target is not measurable');
  if (!hasTarget) weaknesses.push('No take-profit rule');
  if (!by('risk').length) weaknesses.push('Risk per trade not defined');

  if (!d.instruments.length) criticalGaps.push('Instrument not specified');
  if (!entry.length && !by('confirmation').length) criticalGaps.push('Entry trigger missing');
  if (!hasStop) criticalGaps.push('Stop-loss rule missing');

  return { total, dimensions: dims, strengths, weaknesses: [...new Set(weaknesses)], criticalGaps };
}

export function sectionName(s: RuleSection): string {
  return (
    {
      bias: 'Bias',
      context: 'Market context',
      setup: 'Setup',
      entry: 'Entry trigger',
      confirmation: 'Confirmation',
      stop: 'Stop-loss',
      target: 'Take-profit',
      management: 'Trade management',
      invalidation: 'Invalidation',
      noTrade: 'Do-not-trade rule',
      risk: 'Risk',
      maxTrades: 'Trade limit',
      window: 'Trading window',
      timeframe: 'Timeframe',
      filter: 'Filter',
    } as const
  )[s];
}

// ───────────────────────────── Behavioral risk (STAGE 3) ─────────────────────────────

/** Weaknesses built into the PLAN. Never a statement about the trader as a person. */
export function behavioralRisksFor(d: DiagnosisInput, styles: string[], text: string): BehavioralRisk[] {
  const out: BehavioralRisk[] = [];
  const by = (s: RuleSection) => d.rules.filter((r) => r.section === s);
  const vagueEntry = [...by('entry'), ...by('confirmation'), ...by('setup')].find((r) => r.vagueTerms.length);
  const add = (r: Omit<BehavioralRisk, 'id'>) => out.push({ id: `br_${r.behavior}`, ...r });

  if (vagueEntry) {
    add({
      behavior: 'fomo',
      title: 'Subjective trigger can invite FOMO entries',
      explanation: `The plan allows an entry when "${vagueEntry.vagueTerms[0]}". Because that is not defined, a fast move can be read as a valid signal after the fact.`,
      mitigation: 'Replace it with a measurable confirmation (see Prop Guard suggestions).',
      severity: 'high',
    });
  }
  if (!by('stop').length && d.stopPoints == null) {
    add({
      behavior: 'holding_losers',
      title: 'No stop means losers have no exit',
      explanation: 'Without a stop rule, the plan gives no instruction for when a trade is wrong, which makes holding and hoping the default.',
      mitigation: 'Define the stop location before entry.',
      severity: 'high',
    });
  }
  if (d.maxTrades == null) {
    add({
      behavior: /scalp/i.test(text) ? 'overtrading' : 'revenge_trading',
      title: 'Unlimited attempts per day',
      explanation: 'Nothing in the plan ends the trading day, so a loss can be followed by another attempt, and another.',
      mitigation: 'Set a maximum number of trades and a stop-after-losses rule.',
      severity: 'medium',
    });
  }
  if (!d.windowStart && !d.windowEnd) {
    add({
      behavior: 'trading_chop',
      title: 'Plan can be traded in any market hour',
      explanation: 'With no time window, the setup can be taken in slow midday or overnight conditions it was not designed for.',
      mitigation: 'Restrict entries to a fixed window.',
      severity: 'medium',
    });
  }
  if (!by('target').length && d.minRR == null) {
    add({
      behavior: 'cutting_winners_early',
      title: 'No exit plan for winners',
      explanation: 'Without a target, exits are decided in the moment — winners are easy to close early and hard to hold to plan.',
      mitigation: 'Pre-define the first target and what happens to the rest.',
      severity: 'medium',
    });
  }
  const counterTrend = styles.some((s) => s === 'mean_reversion' || s === 'reversal');
  if (counterTrend && !by('invalidation').length) {
    add({
      behavior: 'predicting_not_reacting',
      title: 'Counter-move setup without a "wrong" signal',
      explanation: 'Fading or catching a reversal without an invalidation level encourages anticipating the turn instead of reacting to it.',
      mitigation: 'Require the confirmation candle first and define the extreme that cancels the idea.',
      severity: 'high',
    });
  }
  const breakoutNoConfirm = styles.some((s) => s === 'breakout' || s === 'orb') && !by('confirmation').length;
  if (breakoutNoConfirm) {
    add({
      behavior: 'entering_too_early',
      title: 'Breakout without a confirmation step',
      explanation: 'Entering on the first push through a level exposes the plan to wicks and failed breakouts.',
      mitigation: 'Require a candle close beyond the level (and optionally a retest).',
      severity: 'medium',
    });
  }
  if (by('confirmation').length >= 4) {
    add({
      behavior: 'over_confirmation',
      title: 'Many confirmations can delay entries',
      explanation: `The plan stacks ${by('confirmation').length} confirmations; by the time all are met, much of the move and the reward:risk may be gone.`,
      mitigation: 'Keep the confirmations that change the decision; drop the rest.',
      severity: 'low',
    });
  }
  if (/move (my |the )?stop|widen|give it room/i.test(text)) {
    add({ behavior: 'moving_stops', title: 'Plan allows stop adjustments', explanation: 'Moving or widening the stop after entry changes the risk the trade was sized for.', mitigation: 'Only move stops toward profit, by a rule (e.g. break-even at 1R).', severity: 'high' });
  }
  if (/add (to|on) (losers|losing)|average down|double down|martingale/i.test(text)) {
    add({ behavior: 'oversized_risk', title: 'Adding to losing positions', explanation: 'Adding size against the position multiplies risk beyond the planned amount.', mitigation: 'Remove adds to losers; only add to winners with a new stop.', severity: 'high' });
  } else if (!by('risk').length) {
    add({ behavior: 'oversized_risk', title: 'Size is not tied to risk', explanation: 'Without a risk-per-trade rule, position size can drift up after wins or losses.', mitigation: 'Fix dollar risk per trade and size from the stop distance.', severity: 'low' });
  }
  if (/\bchase|catch the move|don'?t miss|before it (runs|goes)/i.test(text)) {
    add({ behavior: 'chasing', title: 'Plan language encourages chasing', explanation: 'Rules framed around not missing the move push entries far from the planned level.', mitigation: 'Enter only at the defined level; a missed trade is not a loss.', severity: 'medium' });
  }
  return out;
}

// ───────────────────────────── Naming & classification ─────────────────────────────

function nameFor(i: Interpretation, concepts: Concept[]): string {
  const parts: string[] = [];
  const ids = concepts.map((c) => c.id);
  const c = i.context;
  if (ids.includes('orb')) parts.push(`${c.orbMinutes ? `${c.orbMinutes}M ` : ''}ORB${ids.includes('retest') ? ' Retest' : ' Breakout'}`);
  else if (ids.includes('liquidity_sweep')) parts.push(`${c.level ? `${abbreviateLevel(c.level)} ` : ''}Sweep${ids.includes('reversal') ? ' Reversal' : ''}`);
  else if (ids.includes('order_flow') || ids.includes('absorption')) parts.push(ids.includes('absorption') ? `Absorption${/support/i.test(i.originalText) ? ' at Support' : /resistance/i.test(i.originalText) ? ' at Resistance' : ''}` : 'Order Flow');
  else if (ids.includes('mean_reversion')) parts.push(`${ids.includes('vwap') ? 'VWAP ' : ''}Mean Reversion`);
  else if (ids.includes('moving_average') && (ids.includes('pullback') || ids.includes('trend_continuation'))) parts.push(`${c.emaPeriod ? `${c.emaPeriod} ${c.emaType ?? 'EMA'}` : 'MA'} ${ids.includes('pullback') ? 'Pullback' : 'Trend'}`);
  else {
    const named = concepts.filter((x) => x.name).slice(0, 2);
    for (const n of named) parts.push(n.name!(c));
  }
  const base = parts.join(' ').trim() || 'Custom Strategy';
  return `${i.instruments[0] ? `${i.instruments[0]} ` : ''}${base}`.slice(0, 60);
}

function classificationFor(styles: DetectedStyle[]): string {
  const top = styles.filter((s) => s.id !== 'momentum' || styles.length === 1).slice(0, 3).map((s) => s.label);
  return top.join(' · ');
}

// ───────────────────────────── Assemble ─────────────────────────────

export interface AnalyzeOptions {
  now?: string;
}

export function diagnosisInput(s: Pick<StructuredStrategy, 'instrument' | 'tradingWindow' | 'timeframes' | 'direction' | 'maxTrades' | 'stopPoints' | 'minRR' | 'session'>, rules: StrategyRule[]): DiagnosisInput {
  return {
    rules,
    instruments: s.instrument,
    windowStart: s.tradingWindow.start,
    windowEnd: s.tradingWindow.end,
    timeframes: s.timeframes,
    direction: s.direction,
    maxTrades: s.maxTrades,
    stopPoints: s.stopPoints,
    minRR: s.minRR,
    session: s.session,
  };
}

/** Group a flat rule list into the per-section arrays of the structured strategy. */
export function sectionArrays(rules: StrategyRule[]) {
  const pick = (s: RuleSection) => rules.filter((r) => r.section === s);
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
    riskRules: [...pick('risk'), ...pick('maxTrades')],
    filterRules: pick('filter'),
  };
}

export function missingVariablesOf(s: Pick<StructuredStrategy, 'instrument' | 'tradingWindow' | 'timeframes' | 'direction' | 'maxTrades' | 'stopPoints' | 'minRR' | 'session'>, rules: StrategyRule[]): string[] {
  const has = (sec: RuleSection) => rules.some((r) => r.section === sec);
  const m: string[] = [];
  if (!s.instrument.length) m.push('instrument');
  if (!s.session) m.push('session');
  if (!s.tradingWindow.start || !s.tradingWindow.end) m.push('trading window');
  if (!s.timeframes.length) m.push('timeframe');
  if (!s.direction) m.push('directional bias');
  if (!has('entry')) m.push('entry trigger');
  if (!has('confirmation')) m.push('confirmation');
  if (!has('stop') && s.stopPoints == null) m.push('stop-loss');
  if (!has('target') && s.minRR == null) m.push('take-profit');
  if (s.minRR == null) m.push('risk/reward');
  if (!has('risk')) m.push('position sizing');
  if (s.maxTrades == null) m.push('trade limit');
  if (!has('invalidation')) m.push('invalidation');
  if (!has('noTrade')) m.push('no-trade conditions');
  if (!has('management')) m.push('management rules');
  return m;
}

/** Re-derive score, risks and missing variables after rules change (AI merge, edits). */
export function finalizeStructured(base: Omit<StructuredStrategy, 'strategyHealthScore' | 'behavioralRisks' | 'missingVariables' | 'traderProvidedRules' | 'aiInferredRules' | keyof ReturnType<typeof sectionArrays>>, rules: StrategyRule[], extraRisks: BehavioralRisk[] = []): StructuredStrategy {
  const d = diagnosisInput(base, rules);
  const local = behavioralRisksFor(d, base.detectedStyle.map((s) => s.id), base.originalText);
  const risks = [...local, ...extraRisks.filter((r) => !local.some((l) => l.behavior === r.behavior))];
  return {
    ...base,
    ...sectionArrays(rules),
    traderProvidedRules: rules.filter((r) => r.provenance === 'trader'),
    aiInferredRules: rules.filter((r) => r.provenance === 'inferred'),
    strategyHealthScore: diagnoseStrategy(d),
    behavioralRisks: risks,
    missingVariables: missingVariablesOf(base, rules),
  };
}

/** Full deterministic analysis of a free-text strategy. */
export function analyzeStrategyText(text: string, opts: AnalyzeOptions = {}): StructuredStrategy {
  const i = interpretStrategy(text);
  const concepts = activeConcepts(i.styles);
  const rules = [...i.rules, ...inferredRules(i, concepts)];
  // Structured numbers the trader stated become explicit rules too.
  if (i.stopPoints != null && !rules.some((r) => r.section === 'stop')) rules.push(makeRule('stop', `Stop ${i.stopPoints} points`, 'trader', undefined, text, true));
  if (i.minRR != null && !rules.some((r) => r.section === 'target')) rules.push(makeRule('target', `Minimum 1:${i.minRR} reward:risk`, 'trader', undefined, text, true));
  const suggestions = suggestionsFor(i, concepts, rules);
  return finalizeStructured(
    {
      version: 1,
      originalText: text,
      name: nameFor(i, concepts),
      detectedStyle: i.styles,
      classification: classificationFor(i.styles),
      direction: i.direction,
      directionSource: i.directionProvenance,
      instrument: i.instruments,
      session: i.session,
      tradingWindow: i.window,
      timeframes: i.timeframes,
      maxTrades: i.maxTrades,
      stopPoints: i.stopPoints,
      minRR: i.minRR,
      aiSuggestedRules: suggestions,
      unresolvedQuestions: questionsFor(i, rules),
      analysisSource: 'local',
      analyzedAt: opts.now ?? new Date().toISOString(),
    },
    rules,
  );
}

export const ALL_RULE_SECTIONS = SECTIONS_WITH_RULES;
export { CONCEPTS };
