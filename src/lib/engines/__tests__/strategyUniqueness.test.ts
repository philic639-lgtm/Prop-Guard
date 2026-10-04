import { generateCustomStrategyScenarios } from '@/services/marketHistory/historical';
import { MockHistoricalProvider } from '@/services/market-data/MockHistoricalProvider';

import {
  allRules,
  analyzeStrategyText,
  assessUniqueness,
  compileStrategy,
  finalPlanRules,
  improvedTexts,
  jaccard,
  originalChecklist,
  setSuggestionStatus,
  testableRulesOf,
  tokens,
  UNSUPPORTED_CLAIMS,
  type StructuredStrategy,
} from '../strategyIntelligence';
import { scanForSignals } from '../strategyEvaluators';
import { TEN_STRATEGIES, type TenKey } from './fixtures/tenStrategies';

const KEYS = Object.keys(TEN_STRATEGIES) as TenKey[];
const A = Object.fromEntries(KEYS.map((k) => [k, analyzeStrategyText(TEN_STRATEGIES[k])])) as Record<TenKey, StructuredStrategy>;
const acceptAll = (a: StructuredStrategy) => a.aiSuggestedRules.reduce((x, s) => setSuggestionStatus(x, s.id, 'accepted'), a);
const ACCEPTED = Object.fromEntries(KEYS.map((k) => [k, acceptAll(A[k])])) as Record<TenKey, StructuredStrategy>;
const styles = (k: TenKey) => A[k].detectedStyle.map((s) => s.id);
const improvedTokens = (a: StructuredStrategy) => tokens(improvedTexts(allRules(a), a.aiSuggestedRules));
const everythingGenerated = (a: StructuredStrategy) => [
  ...a.aiSuggestedRules.flatMap((s) => [s.title, s.issue, s.suggestedRule, s.rationale]),
  ...Object.values(a.reasoning).flatMap((xs) => xs.map((x: { text: string }) => x.text)),
  ...a.regimes.flatMap((r) => r.reasons),
  ...a.weaknessReport.failureScenarios.map((x) => x.text),
  ...a.weaknessReport.contradictions.map((x) => x.text),
];

describe('10 radically different strategies are classified as what they are', () => {
  const expected: Record<TenKey, { has: string[]; not?: string[] }> = {
    orbBreakout: { has: ['orb', 'retest'] },
    vwapMeanReversion: { has: ['mean_reversion', 'vwap'], not: ['orb'] },
    emaTrendPullback: { has: ['moving_average', 'pullback', 'trend_continuation'], not: ['vwap'] },
    liquiditySweepReversal: { has: ['liquidity_sweep', 'pdh_pdl'], not: ['orb', 'vwap'] },
    srBreakout: { has: ['breakout', 'support_resistance'], not: ['orb'] },
    rsiDivergence: { has: ['indicator'], not: ['trend_continuation', 'orb'] },
    openingDrive: { has: ['opening_drive', 'pullback'], not: ['orb'] },
    rangeFade: { has: ['range', 'mean_reversion'], not: ['vwap', 'orb'] },
    momentumScalp: { has: ['scalping', 'momentum'], not: ['orb'] },
    multiTimeframeTrend: { has: ['multi_timeframe', 'trend_continuation'], not: ['moving_average'] },
  };
  it.each(KEYS)('%s', (k) => {
    expect(styles(k)).toEqual(expect.arrayContaining(expected[k].has));
    for (const n of expected[k].not ?? []) expect(styles(k)).not.toContain(n);
  });

  it('every strategy gets its own name and classification', () => {
    expect(new Set(KEYS.map((k) => A[k].name)).size).toBe(10);
    expect(new Set(KEYS.map((k) => A[k].classification)).size).toBe(10);
    expect(KEYS.map((k) => A[k].name)).toEqual([
      'ES 15M ORB Retest',
      'ES VWAP Mean Reversion',
      'MNQ 20 EMA Pullback',
      'NQ PDL Sweep Reversal',
      'ES Resistance Breakout',
      'NQ RSI Divergence',
      'NQ Opening Drive Pullback',
      'MES Range Fade',
      'MNQ Momentum Scalp',
      'ES Multi-Timeframe Trend',
    ]);
  });
});

describe('uniqueness: analyses do NOT converge on one template', () => {
  const pairs = KEYS.flatMap((a, i) => KEYS.slice(i + 1).map((b) => [a, b] as const));
  const sims = pairs.map(([a, b]) => ({ a, b, sim: jaccard(improvedTokens(A[a]), improvedTokens(A[b])) }));

  it('no two improved strategies are near-duplicates', () => {
    for (const s of sims) expect(s.sim).toBeLessThan(0.45);
    const mean = sims.reduce((x, s) => x + s.sim, 0) / sims.length;
    expect(mean).toBeLessThan(0.2);
  });

  it('the core trading logic (setup / entry / confirmation) differs between every pair', () => {
    const core = (k: TenKey) => tokens(finalPlanRules(ACCEPTED[k]).filter((r) => ['setup', 'entry', 'confirmation', 'context', 'bias'].includes(r.section)).map((r) => r.text));
    for (const [a, b] of pairs) expect(jaccard(core(a), core(b))).toBeLessThan(0.35);
  });

  it('stop, target, invalidation and trade-limit suggestions are specific to each strategy', () => {
    for (const section of ['stop', 'target', 'invalidation', 'maxTrades'] as const) {
      const texts = KEYS.map((k) => A[k].aiSuggestedRules.find((s) => s.section === section)?.suggestedRule).filter(Boolean);
      expect(new Set(texts).size).toBeGreaterThanOrEqual(Math.ceil(texts.length * 0.75));
    }
  });

  it('no suggestion swaps in a tool the trader never mentioned (VWAP, EMA, ATR, ORB, RSI, order flow)', () => {
    for (const k of KEYS) {
      for (const s of A[k].aiSuggestedRules) expect({ k, rule: s.suggestedRule, tools: s.introducesTools }).toEqual({ k, rule: s.suggestedRule, tools: [] });
      const text = TEN_STRATEGIES[k];
      const suggested = A[k].aiSuggestedRules.map((s) => s.suggestedRule).join(' ');
      if (!/vwap/i.test(text)) expect(suggested).not.toMatch(/\bvwap\b/i);
      if (!/ema|sma|moving average/i.test(text)) expect(suggested).not.toMatch(/\b(ema|sma)\b/i);
      if (!/opening range|\bORB\b/i.test(text)) expect(suggested).not.toMatch(/opening range|\bORB\b/i);
      if (!/\bATR\b/i.test(text)) expect(suggested).not.toMatch(/\bATR\b|average true range/i);
    }
  });

  it('every analysis passes its own uniqueness test and stays recognisably the trader’s', () => {
    for (const k of KEYS) {
      const u = A[k].uniqueness!;
      expect(u.passes).toBe(true);
      expect(u.identityRetention).toBeGreaterThanOrEqual(0.3);
      expect(u.closestForeignTemplate?.similarity ?? 0).toBeLessThan(0.3);
    }
  });

  it('regenerates in preserve mode when the result is too close to an earlier strategy', () => {
    const first = A.liquiditySweepReversal;
    const paraphrase = "I go long NQ when price sweeps the previous day's low after a big selloff and then closes back above it.";
    const again = analyzeStrategyText(paraphrase, { references: [{ name: first.name, originalText: first.originalText, improved: improvedTexts(allRules(first), first.aiSuggestedRules) }] });
    expect(again.uniqueness?.attempts).toBe(2);
    expect(again.uniqueness?.closestPrevious?.name).toBe(first.name);
    // Preserve mode drops generic protections and never adds foreign tools.
    expect(again.aiSuggestedRules.length).toBeLessThan(first.aiSuggestedRules.length);
    expect(again.aiSuggestedRules.every((s) => s.introducesTools.length === 0)).toBe(true);
  });

  it('flags drift toward a template the trader never described', () => {
    const a = A.rangeFade;
    const drifted = assessUniqueness(a, allRules(a), [
      ...a.aiSuggestedRules,
      { ...a.aiSuggestedRules[0], id: 'x1', suggestedRule: 'Identify the 15 minute opening range high and low; wait for a 5 minute candle close outside the opening range; wait for a retest of the opening range level that holds', introducesTools: ['orb'] },
    ]);
    expect(drifted.passes).toBe(false);
    expect(drifted.notes.join(' ')).toMatch(/drifted toward|add a tool/);
  });
});

describe('confidence labels', () => {
  it('every recommendation is labelled A–D and never E without historical data', () => {
    for (const k of KEYS) {
      for (const s of A[k].aiSuggestedRules) expect(['A', 'B', 'C', 'D']).toContain(s.confidence);
      for (const xs of Object.values(A[k].reasoning)) for (const x of xs as { confidence: string }[]) expect(x.confidence).not.toBe('E');
      for (const r of A[k].regimes) expect(r.confidence).not.toBe('E');
    }
  });

  it('invented thresholds are D and say they require testing', () => {
    const d = KEYS.flatMap((k) => A[k].aiSuggestedRules.filter((s) => s.confidence === 'D'));
    expect(d.length).toBeGreaterThan(5);
    for (const s of d) expect(s.rationale).toMatch(/Suggested by Prop Guard — requires testing/);
  });

  it('never claims a plan is proven, profitable, safe or high win rate', () => {
    for (const k of KEYS) for (const t of everythingGenerated(A[k])) expect(t).not.toMatch(UNSUPPORTED_CLAIMS);
  });
});

describe('decomposition, reasoning, regimes and weakness report', () => {
  it('decomposes every strategy into the 15 DNA components, in the trader’s own words', () => {
    for (const k of KEYS) {
      expect(A[k].dna.map((d) => d.key)).toEqual(['market', 'timeframe', 'setup', 'context', 'bias', 'entry', 'confirmation', 'invalidation', 'stop', 'target', 'management', 'session', 'volatility', 'volume', 'noTrade']);
    }
    const sweep = A.liquiditySweepReversal.dna;
    expect(sweep.find((d) => d.key === 'setup')?.values.map((v) => v.text)).toContain("Price sweeps the previous day's low");
    expect(A.srBreakout.dna.find((d) => d.key === 'volume')?.values[0]).toMatchObject({ provenance: 'trader' });
    expect(A.rangeFade.dna.find((d) => d.key === 'noTrade')?.values[0].text).toMatch(/news/i);
  });

  it('explains what each strategy exploits — differently for each one', () => {
    const exploits = KEYS.map((k) => A[k].reasoning.exploits[0]?.text);
    expect(exploits.every(Boolean)).toBe(true);
    expect(new Set(exploits).size).toBeGreaterThanOrEqual(9);
    expect(A.liquiditySweepReversal.reasoning.exploits[0].text).toMatch(/stops/i);
    expect(A.rangeFade.reasoning.assumptions.map((x) => x.text).join(' ')).toMatch(/range stays intact/i);
    expect(A.vwapMeanReversion.reasoning.subjectiveDiscretion.length).toBeGreaterThan(0);
    expect(A.orbBreakout.reasoning.earlyEntry[0].text).toMatch(/before a candle closes/i);
  });

  it('identifies the market regime each strategy is designed for — and when to avoid it', () => {
    const fit = (k: TenKey, fitType: 'designed_for' | 'avoid') => A[k].regimes.filter((r) => r.fit === fitType).map((r) => r.regime);
    expect(fit('orbBreakout', 'designed_for')).toEqual(expect.arrayContaining(['opening_session', 'breakout']));
    expect(fit('vwapMeanReversion', 'avoid')).toContain('trending');
    expect(fit('rangeFade', 'designed_for')).toContain('ranging');
    expect(fit('rangeFade', 'avoid')).toEqual(expect.arrayContaining(['trending', 'news_driven']));
    expect(A.rangeFade.regimes.find((r) => r.regime === 'news_driven')?.confidence).toBe('A'); // from the trader's own rule
    expect(fit('emaTrendPullback', 'designed_for')).toContain('trending');
    expect(fit('emaTrendPullback', 'avoid')).toContain('ranging');
    expect(fit('momentumScalp', 'avoid')).toContain('low_volatility');
    expect(new Set(KEYS.map((k) => fit(k, 'designed_for').sort().join(','))).size).toBeGreaterThanOrEqual(8);
  });

  it('reports contradictions, ambiguity, overfitting, execution risk and failure scenarios', () => {
    const contra = analyzeStrategyText('Only long ES. I short when the 5-minute candle closes below VWAP. Max 1 trade a day but I re-enter if stopped out.');
    expect(contra.weaknessReport.contradictions.map((x) => x.text).join(' ')).toMatch(/long only.*short/i);
    expect(contra.weaknessReport.contradictions.map((x) => x.text).join(' ')).toMatch(/re-entering/i);
    const fitted = analyzeStrategyText('I buy ES when RSI(7) is below 23, MACD 12 26 9 crosses up, the 34 EMA is above the 89 EMA, stochastic 14 3 3 is under 18 and Bollinger 21 2.1 is touched.');
    expect(fitted.weaknessReport.overfittingRisk.level).toBe('high');
    expect(A.momentumScalp.weaknessReport.executionRisk.level).not.toBe('low');
    expect(A.orbBreakout.weaknessReport.overfittingRisk.level).toBe('low');
    for (const k of KEYS) expect(A[k].weaknessReport.failureScenarios.length).toBeGreaterThan(0);
    expect(A.vwapMeanReversion.weaknessReport.ambiguity.length).toBeGreaterThan(0);
  });
});

describe('testable IF/THEN rules feed Practice Mode', () => {
  it('every strategy becomes an IF/THEN ruleset with entry and exit blocks', () => {
    for (const k of KEYS) {
      const rs = testableRulesOf(ACCEPTED[k]);
      expect(rs.blocks.some((b) => b.kind === 'exit')).toBe(true);
      expect(rs.blocks.some((b) => b.kind === 'entry')).toBe(true);
      expect(rs.coverage.total).toBeGreaterThan(0);
    }
  });

  it('after accepting suggestions, all 10 strategies can be checked automatically on candles', () => {
    for (const k of KEYS) expect({ k, testable: testableRulesOf(ACCEPTED[k]).coverage.testable }).toEqual({ k, testable: true });
  });

  it('the ORB ruleset reads like the trader’s plan', () => {
    const rs = testableRulesOf(A.orbBreakout);
    expect(rs.window).toBeNull();
    expect(rs.primaryLevel).toMatchObject({ kind: 'edge', of: 'or', minutes: 15 });
    const entry = rs.blocks.find((b) => b.kind === 'entry')!;
    expect(entry.if.map((l) => l.text)).toEqual(['5-minute close', 'Retest']);
    expect(entry.if.every((l) => l.evaluable)).toBe(true);
    expect(rs.practiceDefaults.join(' ')).toMatch(/no stop yet/);
  });

  it('compiled rules never look ahead: truncating history gives identical signals', () => {
    const bars = new MockHistoricalProvider({ instruments: ['ES', 'NQ'] }).getHistoricalBarsSync({ instrument: 'ES', timeframe: '5m', startTime: '2025-03-03T00:00:00Z', endTime: '2025-03-22T00:00:00Z' });
    for (const k of ['orbBreakout', 'rangeFade', 'srBreakout'] as TenKey[]) {
      const ev = compileStrategy(ACCEPTED[k], `t-${k}`);
      const full = scanForSignals(ev, 'ES', bars, { includeInvalid: true, lookbackSessions: 1 });
      expect(full.length).toBeGreaterThan(0);
      for (const sig of full.slice(0, 5)) {
        const cut = scanForSignals(ev, 'ES', bars.slice(0, sig.decisionIndex + 1), { includeInvalid: true, lookbackSessions: 1 });
        expect(cut.find((x) => x.decisionTimestamp === sig.decisionTimestamp)).toEqual(sig);
      }
      for (const sig of full) {
        if (sig.direction === 'long') expect(sig.stop).toBeLessThan(sig.entry);
        else expect(sig.stop).toBeGreaterThan(sig.entry);
      }
    }
  });

  it('generates SIMULATED practice scenarios from the trader’s own rules', () => {
    const r = generateCustomStrategyScenarios('t-sweep', A.liquiditySweepReversal.name, testableRulesOf(ACCEPTED.liquiditySweepReversal));
    expect(r.scenarios.length).toBeGreaterThan(0);
    for (const s of r.scenarios) {
      expect(s.source).toMatchObject({ kind: 'simulated', verified: false });
      expect(s.strategyName).toBe('NQ PDL Sweep Reversal');
      expect(s.historical?.checks.map((c) => c.label)).toEqual(expect.arrayContaining(["Price sweeps the previous day's low"]));
    }
    const scalp = generateCustomStrategyScenarios('t-scalp', A.momentumScalp.name, testableRulesOf(ACCEPTED.momentumScalp));
    expect(scalp.timeframe).toBe('1m');
    for (const s of scalp.scenarios.filter((x) => x.idealTrade)) expect(Math.abs(s.idealTrade!.target - s.idealTrade!.entry)).toBe(8); // the trader's 8-point target
  });

  it('keeps the range fade a RANGE strategy (not generic mean reversion)', () => {
    expect(A.rangeFade.reasoning.exploits[0].text).toMatch(/^Balance/);
    expect(A.rangeFade.aiSuggestedRules.find((x) => x.section === 'stop')?.suggestedRule).toMatch(/range edge/);
  });

  it('side-specific rules apply only to their side ("selling the top" is not required for longs)', () => {
    const rs = testableRulesOf(ACCEPTED.rangeFade);
    expect(rs.conditions.find((c) => /selling the top/i.test(c.text))?.appliesTo).toBe('short');
    expect(rs.conditions.find((c) => /buying the bottom/i.test(c.text))?.appliesTo).toBe('long');
    const bars = new MockHistoricalProvider({ instruments: ['MES'] }).getHistoricalBarsSync({ instrument: 'MES', timeframe: '5m', startTime: '2025-03-03T00:00:00Z', endTime: '2025-03-29T00:00:00Z' });
    const signals = scanForSignals(compileStrategy(ACCEPTED.rangeFade, 't-range'), 'MES', bars, { includeInvalid: true, lookbackSessions: 1 });
    expect(new Set(signals.map((x) => x.direction))).toEqual(new Set(['long', 'short']));
    for (const sig of signals) expect(sig.checks.some((c) => (sig.direction === 'long' ? /selling the top/i : /buying the bottom/i).test(c.label))).toBe(false);
  });

  it('the comparison view keeps the trader’s original wording on the left', () => {
    const left = originalChecklist(A.liquiditySweepReversal);
    const all = left.flatMap((s) => s.lines.map((l) => l.text));
    expect(all).toEqual(expect.arrayContaining(['Buy NQ', "Price sweeps the previous day's low", 'Quickly closes back above it', 'After a large selloff']));
    expect(left.flatMap((s) => s.lines).every((l) => l.provenance === 'trader')).toBe(true);
  });
});
