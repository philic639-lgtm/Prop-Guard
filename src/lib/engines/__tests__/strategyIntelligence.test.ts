import { blankStrategy } from '@/features/strategy/fromTemplate';
import { practiceTemplateFor } from '@/features/strategy/practiceLink';
import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { mergeAiStrategyAnalysis, quoteIsInText } from '@/services/ai/strategyAnalysis';
import type { StrategyAnalysisAI } from '@/services/ai/types';
import { rowsToStrategy, strategyToRows } from '@/services/supabase/mappers';

import { validateStrategy } from '../strategyEngine';
import {
  allRules,
  analyzeStrategyText,
  effectiveRules,
  improvedChecklist,
  improvedHealth,
  setSuggestionStatus,
  toStrategy,
  UNSUPPORTED_CLAIMS,
  type StructuredStrategy,
} from '../strategyIntelligence';
import { parseStrategyText, STRATEGY_EXAMPLE } from '../strategyParser';

const INPUTS = {
  orb: 'I trade a 15-minute opening range breakout on ES after 9:45. I wait for a breakout, 5-minute close, and retest.',
  sweep: "I buy NQ after a large selloff when price sweeps the previous day's low and quickly closes back above it.",
  vwapFade: 'I fade ES when price becomes stretched far away from VWAP and momentum starts weakening.',
  emaPullback: 'I follow strong trends on MNQ and enter pullbacks into the 20 EMA.',
  absorption: 'I watch footprint charts and enter when aggressive sellers get absorbed at support.',
};
type Key = keyof typeof INPUTS;
const A = Object.fromEntries(Object.entries(INPUTS).map(([k, t]) => [k, analyzeStrategyText(t)])) as Record<Key, StructuredStrategy>;
const styles = (k: Key) => A[k].detectedStyle.map((s) => s.id);

/** Every piece of text Prop Guard generated (not the trader's own words). */
function generatedText(a: StructuredStrategy): string[] {
  return [
    a.name,
    a.classification,
    ...a.aiInferredRules.map((r) => r.text),
    ...a.aiSuggestedRules.flatMap((s) => [s.title, s.issue, s.suggestedRule, s.rationale]),
    ...a.behavioralRisks.flatMap((r) => [r.title, r.explanation, r.mitigation]),
    ...a.strategyHealthScore.strengths,
    ...a.strategyHealthScore.weaknesses,
    ...a.strategyHealthScore.criticalGaps,
  ];
}

const words = (xs: string[]) => new Set(xs.join(' ').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
const jaccard = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size;

describe('strategy classification — five dramatically different strategies', () => {
  it('1: 15-minute ORB with breakout, 5-minute close and retest', () => {
    expect(styles('orb')).toEqual(expect.arrayContaining(['orb', 'retest']));
    expect(A.orb.instrument).toEqual(['ES']);
    expect(A.orb.tradingWindow).toMatchObject({ start: '09:45', end: null, provenance: 'trader' });
    expect(A.orb.timeframes).toContain('5m');
    expect(A.orb.name).toBe('ES 15M ORB Retest');
    expect(A.orb.aiInferredRules.map((r) => r.text)).toContain('Opening range = high and low of the first 15 minutes after the 9:30 ET open');
  });

  it('2: previous-day-low liquidity sweep reversal on NQ', () => {
    expect(styles('sweep')).toEqual(expect.arrayContaining(['liquidity_sweep', 'reversal', 'pdh_pdl']));
    expect(styles('sweep')[0]).toBe('liquidity_sweep');
    expect(A.sweep.direction).toBe('long');
    expect(A.sweep.instrument).toEqual(['NQ']);
    expect(A.sweep.name).toBe('NQ PDL Sweep Reversal');
  });

  it('3: VWAP mean reversion (fade) on ES', () => {
    expect(styles('vwapFade')).toEqual(expect.arrayContaining(['mean_reversion', 'vwap']));
    expect(styles('vwapFade')[0]).toBe('mean_reversion');
    expect(A.vwapFade.name).toBe('ES VWAP Mean Reversion');
  });

  it('4: trend continuation / 20 EMA pullback on MNQ', () => {
    expect(styles('emaPullback')).toEqual(expect.arrayContaining(['trend_continuation', 'pullback', 'moving_average']));
    expect(A.emaPullback.instrument).toEqual(['MNQ']);
    expect(A.emaPullback.name).toBe('MNQ 20 EMA Pullback');
  });

  it('5: order-flow absorption at support', () => {
    expect(styles('absorption')).toEqual(expect.arrayContaining(['order_flow', 'absorption']));
    expect(A.absorption.direction).toBe('long');
    expect(A.absorption.name).toBe('Absorption at Support');
  });

  it('unrecognized ideas are classified Other / Custom instead of being forced into a preset', () => {
    const a = analyzeStrategyText('I buy GC when my custom oscillator turns green on the 3 minute chart and I exit when it turns red.');
    expect(a.detectedStyle.map((s) => s.id)).toEqual(['custom']);
    expect(a.classification).toBe('Other / Custom');
    expect(a.instrument).toEqual(['GC']);
    expect(a.timeframes).toEqual(['3m']);
  });
});

describe('different descriptions produce meaningfully different strategies', () => {
  const keys = Object.keys(INPUTS) as Key[];

  it('names, classifications and primary styles are all distinct', () => {
    expect(new Set(keys.map((k) => A[k].name)).size).toBe(5);
    expect(new Set(keys.map((k) => A[k].classification)).size).toBe(5);
    expect(new Set(keys.map((k) => A[k].detectedStyle[0].id)).size).toBe(5);
  });

  it('setup / entry / confirmation rules differ substantially between every pair', () => {
    const core = (k: Key) => words([...A[k].setupRules, ...A[k].entryRules, ...A[k].confirmationRules, ...A[k].contextRules].map((r) => r.text));
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) expect(jaccard(core(keys[i]), core(keys[j]))).toBeLessThan(0.3);
  });

  it('stop, target and invalidation suggestions are specific to each strategy', () => {
    const of = (section: string) => new Set(keys.map((k) => A[k].aiSuggestedRules.find((s) => s.section === section)?.suggestedRule));
    expect(of('stop').size).toBe(5);
    expect(of('target').size).toBe(5);
    expect(of('invalidation').size).toBe(5);
  });

  it('the full structured strategies are not near-duplicates', () => {
    const all = (k: Key) => words([...allRules(A[k]).map((r) => r.text), ...A[k].aiSuggestedRules.map((s) => s.suggestedRule)]);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) expect(jaccard(all(keys[i]), all(keys[j]))).toBeLessThan(0.6);
  });
});

describe('no ORB / template leakage', () => {
  const nonOrb: Key[] = ['sweep', 'vwapFade', 'emaPullback', 'absorption'];

  it.each(nonOrb)('%s: no opening-range rules, window or name appear', (k) => {
    const a = A[k];
    expect(styles(k)).not.toContain('orb');
    const everything = [...allRules(a).map((r) => r.text), ...a.aiSuggestedRules.map((s) => s.suggestedRule), a.name].join(' ');
    expect(everything).not.toMatch(/opening range|\bORB\b/i);
    expect(a.tradingWindow.start).toBeNull();
    expect(a.tradingWindow.end).toBeNull();
    expect(allRules(a).some((r) => /1H trend/i.test(r.text))).toBe(false);
  });

  it('missing values stay missing — nothing is filled from a default strategy', () => {
    for (const k of nonOrb) {
      expect(A[k].stopPoints).toBeNull();
      expect(A[k].minRR).toBeNull();
      expect(A[k].maxTrades).toBeNull();
      expect(A[k].stopRules).toEqual([]);
      expect(A[k].targetRules).toEqual([]);
    }
    expect(A.absorption.instrument).toEqual([]);
  });

  it('ORB without a stated length does not become a 15-minute ORB', () => {
    const a = analyzeStrategyText('I trade the opening range breakout on NQ and wait for a candle close outside the range.');
    expect(a.name).toBe('NQ ORB Breakout');
    expect(a.aiInferredRules.map((r) => r.text).join(' ')).not.toMatch(/15 minutes/);
    expect(a.unresolvedQuestions.map((q) => q.variable)).toContain('openingRangeMinutes');
    const parsed = parseStrategyText('I trade the ORB on NQ after 9:40.');
    expect(parsed.name).toBe('ORB');
    expect(parsed.conditions.join(' ')).not.toMatch(/15 minute/);
    expect(parsed.entryWindowEnd).toBeNull();
  });

  it('a blank strategy carries no ORB defaults', () => {
    const b = blankStrategy();
    expect(b).toMatchObject({ markets: [], session: '', entryWindowStart: null, entryWindowEnd: null, biasRequirement: '', requiresBiasAlignment: false });
  });

  it('the example never influences the analysis of a custom strategy', () => {
    const fresh = analyzeStrategyText(INPUTS.vwapFade);
    analyzeStrategyText(STRATEGY_EXAMPLE);
    const after = analyzeStrategyText(INPUTS.vwapFade);
    const shape = (a: StructuredStrategy) => ({ name: a.name, styles: a.detectedStyle, rules: allRules(a).map((r) => [r.section, r.text, r.provenance]), sugg: a.aiSuggestedRules.map((s) => s.suggestedRule), score: a.strategyHealthScore.total });
    expect(shape(after)).toEqual(shape(fresh));
    expect(JSON.stringify(after)).not.toMatch(/9:45|retest|opening range/i);
  });

  it('the analysis store only accepts an analysis of the submitted text (no stale or cached results)', () => {
    const store = useStrategyAnalysisStore.getState();
    store.submit(INPUTS.sweep);
    store.setAnalysis(analyzeStrategyText(STRATEGY_EXAMPLE));
    expect(useStrategyAnalysisStore.getState().analysis).toBeNull();
    store.setAnalysis(A.sweep);
    expect(useStrategyAnalysisStore.getState().analysis?.name).toBe('NQ PDL Sweep Reversal');
    store.submit(INPUTS.absorption);
    expect(useStrategyAnalysisStore.getState().analysis).toBeNull();
    store.reset();
  });
});

describe('provenance: trader rules vs AI interpretation vs AI suggestion', () => {
  it('every trader rule quotes words that are actually in the description', () => {
    for (const k of Object.keys(INPUTS) as Key[]) {
      expect(A[k].traderProvidedRules.length).toBeGreaterThan(0);
      for (const r of A[k].traderProvidedRules) expect(quoteIsInText(r.quote, INPUTS[k])).toBe(true);
    }
  });

  it('suggestions are never part of the trader or inferred rules until accepted', () => {
    const a = A.sweep;
    const suggested = new Set(a.aiSuggestedRules.map((s) => s.suggestedRule));
    expect(allRules(a).some((r) => suggested.has(r.text))).toBe(false);
    expect(a.aiSuggestedRules.every((s) => s.status === 'pending')).toBe(true);
  });

  it('subjective rules are flagged and get measurable suggestions labelled as Prop Guard thresholds', () => {
    const momentum = analyzeStrategyText('I trade ES. Enter when momentum looks strong after the 10:00 candle.');
    const s = momentum.aiSuggestedRules.find((x) => x.kind === 'objectify');
    expect(s?.suggestedRule).toMatch(/body larger than 50% of its total range/);
    expect(s?.original).toMatch(/momentum looks strong/i);

    const dump = analyzeStrategyText('I buy NQ when it dumps hard and reverses.');
    const keys = dump.aiSuggestedRules.filter((x) => x.kind === 'objectify').map((x) => x.title);
    expect(keys.join(' ')).toMatch(/dumps hard/);
    expect(keys.join(' ')).toMatch(/reverses/);
    expect(dump.strategyHealthScore.weaknesses.join(' ')).toMatch(/subjective/);
  });

  it('accept / edit / reject decide what is saved; pending suggestions are never saved', () => {
    let a = A.sweep;
    const stop = a.aiSuggestedRules.find((s) => s.section === 'stop')!;
    const max = a.aiSuggestedRules.find((s) => s.section === 'maxTrades')!;
    const target = a.aiSuggestedRules.find((s) => s.section === 'target')!;
    a = setSuggestionStatus(a, stop.id, 'accepted');
    a = setSuggestionStatus(a, max.id, 'edited', 'Maximum 1 trade per day');
    a = setSuggestionStatus(a, target.id, 'rejected');
    const s = toStrategy(a, { id: 'x', now: '2026-10-04T00:00:00Z', accountMaxTrades: 3 });
    expect(s.stopMethod).toContain(stop.suggestedRule);
    expect(s.targetMethod).toBe('');
    expect(s.maxTrades).toBe(2); // structured value of the edited limit suggestion
    expect(effectiveRules(a).some((r) => r.text === 'Maximum 1 trade per day' && r.provenance === 'suggested')).toBe(true);
    // Pending entry suggestion is not saved.
    const entry = a.aiSuggestedRules.find((x) => x.section === 'entry')!;
    expect(s.entryTrigger).not.toContain(entry.suggestedRule);
    expect(s.originalText).toBe(INPUTS.sweep);
    expect(s.structured?.originalText).toBe(INPUTS.sweep);
    expect(s.markets).toEqual(['NQ']);
    expect(validateStrategy(s)).toEqual([]);
  });

  it('without an accepted limit, the trade limit comes from the account rule (labelled), never a template', () => {
    const s = toStrategy(A.vwapFade, { id: 'y', now: '2026-10-04T00:00:00Z', accountMaxTrades: 3 });
    expect(s.maxTrades).toBe(3);
    expect(s.entryWindowStart).toBeNull();
    expect(s.requiresBiasAlignment).toBe(false);
    const section = improvedChecklist(A.vwapFade, { accountMaxTrades: 3 }).find((x) => x.key === 'maxTrades')!;
    expect(section.lines.some((l) => l.provenance === 'account')).toBe(true);
  });

  it('the improved checklist has every required section, with pending suggestions previewed', () => {
    const sections = improvedChecklist(A.orb).map((s) => s.title);
    expect(sections).toEqual(['Market', 'Session', 'Time window', 'Timeframe', 'Bias', 'Setup', 'Entry', 'Confirmation', 'Stop loss', 'Take profit', 'Invalidation', 'Do not trade if', 'Maximum trades', 'Risk']);
    const stop = improvedChecklist(A.orb).find((s) => s.key === 'stop')!;
    expect(stop.lines[0]).toMatchObject({ provenance: 'suggested', status: 'pending' });
  });
});

describe('strategy health diagnosis', () => {
  const complete =
    'I trade ES between 9:45 and 11:00. Only long when the 1H trend is up. I wait for a 5-minute candle close above the prior swing high, then a retest. Stop 4 points below the retest low. Target 1:2. Max 2 trades per day. Risk $200 per trade. Invalidation: setup is void if price closes back below the level. Don\'t trade during FOMC.';

  it('a complete, measurable plan scores far higher than a vague one', () => {
    const good = analyzeStrategyText(complete);
    const vague = analyzeStrategyText('I buy when it looks like it wants to go up and sell when it feels toppy.');
    expect(good.strategyHealthScore.total).toBeGreaterThanOrEqual(75);
    expect(vague.strategyHealthScore.total).toBeLessThan(30);
    expect(good.strategyHealthScore.criticalGaps).toEqual([]);
    expect(vague.strategyHealthScore.criticalGaps).toEqual(expect.arrayContaining(['Instrument not specified', 'Stop-loss rule missing']));
    expect(good.strategyHealthScore.dimensions).toHaveLength(8);
  });

  it('lists strengths, weaknesses and critical gaps in plain language', () => {
    const h = A.orb.strategyHealthScore;
    expect(h.strengths).toEqual(expect.arrayContaining(['Clear market (ES)', 'Defined start time']));
    expect(h.weaknesses).toEqual(expect.arrayContaining(['No invalidation condition', 'No maximum trades defined']));
    expect(h.criticalGaps).toEqual(['Stop-loss rule missing']);
  });

  it('accepting suggestions improves the health score', () => {
    let a = A.vwapFade;
    for (const s of a.aiSuggestedRules) a = setSuggestionStatus(a, s.id, 'accepted');
    expect(improvedHealth(a).total).toBeGreaterThan(A.vwapFade.strategyHealthScore.total + 30);
  });
});

describe('behavioral risk analyses the plan, not the person', () => {
  it('flags plan-level behaviors', () => {
    expect(A.vwapFade.behavioralRisks.map((r) => r.behavior)).toEqual(expect.arrayContaining(['fomo', 'holding_losers', 'predicting_not_reacting']));
    expect(A.orb.behavioralRisks.map((r) => r.behavior)).not.toContain('fomo');
    const stops = analyzeStrategyText('I scalp MNQ and move my stop if it gets close. I average down when it goes against me.');
    expect(stops.behavioralRisks.map((r) => r.behavior)).toEqual(expect.arrayContaining(['moving_stops', 'oversized_risk', 'overtrading']));
  });

  it('never makes statements about the trader as a person', () => {
    for (const a of Object.values(A)) for (const r of a.behavioralRisks) expect(`${r.title} ${r.explanation}`).not.toMatch(/\byou (are|seem|feel|tend|lack)\b|your (psychology|personality|emotions|mindset)/i);
  });
});

describe('honesty / safety wording', () => {
  it('never calls a strategy proven, profitable, safe or high win rate', () => {
    for (const a of [...Object.values(A), analyzeStrategyText('I trade a proven profitable safe setup on ES with a high win rate')]) {
      for (const t of generatedText(a)) expect(t).not.toMatch(UNSUPPORTED_CLAIMS);
    }
  });

  it('asks only for critical variables that cannot be inferred', () => {
    expect(A.absorption.unresolvedQuestions.map((q) => q.variable)).toEqual(['instrument']);
    expect(A.emaPullback.unresolvedQuestions).toEqual([]);
    // A missing stop is a suggestion, never a question.
    for (const a of Object.values(A)) expect(a.unresolvedQuestions.some((q) => /stop/i.test(q.question))).toBe(false);
  });
});

describe('AI merge (server analysis is validated and scored locally)', () => {
  const ai: StrategyAnalysisAI = {
    name: 'NQ PDL Sweep',
    classification: 'Liquidity sweep reversal — a proven high win rate setup',
    styles: [{ id: 'Liquidity Sweep', label: 'Liquidity sweep', evidence: ["sweeps the previous day's low", 'invented words'] }],
    direction: 'long',
    instruments: ['NQ', 'XYZ'],
    session: 'New York',
    tradingWindow: { start: '09:45', end: '10:45' },
    timeframes: ['5m'],
    maxTrades: null,
    stopPoints: null,
    minRR: null,
    rules: [
      { section: 'setup', text: "Price sweeps the previous day's low", provenance: 'trader', quote: "price sweeps the previous day's low" },
      { section: 'stop', text: 'Stop 10 points below the low', provenance: 'trader', quote: 'stop 10 points' },
      { section: 'target', text: 'This setup is profitable and safe', provenance: 'inferred', quote: null },
    ],
    suggestions: [{ section: 'stop', kind: 'missing', title: 'Add a stop', issue: 'No stop.', original: null, suggestedRule: 'Stop 1 tick below the sweep low', rationale: 'Defines risk.' }],
    questions: [],
    behavioralRisks: [
      { behavior: 'fomo', title: 'Vague timing', explanation: '"Quickly" is undefined, so late entries can look valid.', mitigation: 'Time-box it.', severity: 'medium' },
      { behavior: 'revenge_trading', title: 'Emotional trader', explanation: 'You are an emotional trader who tends to revenge trade.', mitigation: '', severity: 'high' },
    ],
  };
  const merged = mergeAiStrategyAnalysis(ai, A.sweep);

  it('downgrades "trader" rules whose quote is not in the description', () => {
    const stop = allRules(merged).find((r) => r.text === 'Stop 10 points below the low')!;
    expect(stop.provenance).toBe('inferred');
    expect(allRules(merged).find((r) => r.text === "Price sweeps the previous day's low")?.provenance).toBe('trader');
  });

  it('drops unsupported claims and statements about the person', () => {
    expect(allRules(merged).some((r) => /profitable|safe/i.test(r.text))).toBe(false);
    expect(merged.classification).not.toMatch(UNSUPPORTED_CLAIMS);
    expect(merged.behavioralRisks.some((r) => /emotional trader/i.test(r.title))).toBe(false);
    expect(merged.behavioralRisks.some((r) => r.title === 'Vague timing')).toBe(false); // local fomo risk already covers it
  });

  it('keeps the trader-typed facts, filters invalid instruments and scores locally', () => {
    expect(merged.instrument).toEqual(['NQ']);
    expect(merged.tradingWindow).toMatchObject({ start: '09:45', end: '10:45', provenance: 'inferred' });
    expect(merged.analysisSource).toBe('ai');
    expect(merged.detectedStyle[0]).toMatchObject({ id: 'liquidity_sweep', evidence: ["sweeps the previous day's low"] });
    // Local engine scores the merged rules: unquoted rules don't earn "trader" credit, and the score is bounded.
    expect(merged.strategyHealthScore.total).toBeLessThanOrEqual(100);
    expect(merged.aiSuggestedRules.some((s) => s.section === 'maxTrades' && s.apply?.maxTrades === 2)).toBe(true);
  });
});

describe('integration', () => {
  it('maps analysed strategies to Historical Practice only when the structure matches', () => {
    expect(practiceTemplateFor(A.orb)).toEqual({ templateId: 'orb-15', exact: true });
    expect(practiceTemplateFor(A.sweep)).toBeNull();
    expect(practiceTemplateFor(A.vwapFade)).toBeNull();
    expect(practiceTemplateFor(A.absorption)).toBeNull();
  });

  it('persists the original text and structured analysis through the database mappers', () => {
    const s = toStrategy(A.emaPullback, { id: '11111111-1111-1111-1111-111111111111', now: '2026-10-04T00:00:00Z', accountMaxTrades: 2 });
    const rows = strategyToRows(s, 'user-1');
    expect(rows.strategy.original_text).toBe(INPUTS.emaPullback);
    const back = rowsToStrategy({ ...rows.strategy, updated_at: s.updatedAt }, rows.checklist);
    expect(back.originalText).toBe(INPUTS.emaPullback);
    expect(back.structured?.name).toBe('MNQ 20 EMA Pullback');
    expect(back.requiresBiasAlignment).toBe(false);
  });
});
