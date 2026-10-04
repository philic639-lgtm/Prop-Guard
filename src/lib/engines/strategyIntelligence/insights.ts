import { conceptById, REGIME_LABELS, type Concept, type ConceptContext } from './concepts';
import type {
  BehavioralRisk,
  ConfidenceLabel,
  DnaComponent,
  DnaKey,
  Insight,
  MarketRegime,
  RegimeAssessment,
  RiskLevel,
  RuleProvenance,
  RuleSection,
  StrategyHealthScore,
  StrategyReasoning,
  StrategyRule,
  StructuredStrategy,
  WeaknessReport,
} from './types';

/**
 * Stages 1, 2, 4 and 7 of the analysis: decomposition (DNA), reasoning
 * behind the idea, weakness report and market-regime fit. Everything here is
 * derived from the trader's rules and the concepts THEY used; generic trading
 * knowledge is labelled C, Prop Guard hypotheses D. Nothing is ever labelled E
 * without verified historical data.
 */

type Base = Pick<StructuredStrategy, 'originalText' | 'instrument' | 'timeframes' | 'session' | 'tradingWindow' | 'direction' | 'directionSource' | 'stopPoints' | 'minRR' | 'maxTrades' | 'detectedStyle'>;

const ins = (text: string, confidence: ConfidenceLabel, basis?: string): Insight => ({ text, confidence, ...(basis ? { basis } : {}) });
const uniqBy = (xs: Insight[]) => xs.filter((x, i) => xs.findIndex((y) => y.text === x.text) === i);

function conceptsOf(b: Base): Concept[] {
  return b.detectedStyle.map((s) => conceptById(s.id)).filter((c): c is Concept => !!c);
}

// ───────────────────────────── DNA (decomposition) ─────────────────────────────

const DNA_LABELS: Record<DnaKey, string> = {
  market: 'Market / instrument',
  timeframe: 'Timeframe',
  setup: 'Setup',
  context: 'Market context',
  bias: 'Directional bias',
  entry: 'Entry trigger',
  confirmation: 'Confirmation',
  invalidation: 'Invalidation',
  stop: 'Stop-loss logic',
  target: 'Profit target logic',
  management: 'Trade management',
  session: 'Session / time',
  volatility: 'Volatility requirements',
  volume: 'Volume / order-flow requirements',
  noTrade: 'Do NOT trade when',
};

const ORDER_FLOW_WORDS = /volume|delta|footprint|absorb|imbalance|order ?flow|tape|\bDOM\b|aggressive (buyers|sellers)/i;

export function buildDna(b: Base, rules: StrategyRule[]): DnaComponent[] {
  const of = (...secs: RuleSection[]) => rules.filter((r) => secs.includes(r.section)).map((r) => ({ text: r.text, provenance: r.provenance }));
  const inText = (s: string) => new RegExp(`\\b${s}\\b`, 'i').test(b.originalText);
  const comp = (key: DnaKey, values: { text: string; provenance: RuleProvenance }[]): DnaComponent => ({ key, label: DNA_LABELS[key], values: values.filter((v, i) => values.findIndex((w) => w.text === v.text) === i) });
  const session: { text: string; provenance: RuleProvenance }[] = [];
  if (b.session) session.push({ text: b.session, provenance: /new york|london|asia|overnight|\bNY\b|RTH/i.test(b.originalText) ? 'trader' : 'inferred' });
  if (b.tradingWindow.start || b.tradingWindow.end) {
    session.push({ text: `${b.tradingWindow.start ? `from ${b.tradingWindow.start}` : ''}${b.tradingWindow.end ? ` until ${b.tradingWindow.end}` : ''} ET`.trim(), provenance: b.tradingWindow.provenance ?? 'trader' });
  }
  const bias = of('bias');
  if (b.direction && !bias.some((x) => /^Direction:/.test(x.text))) bias.unshift({ text: b.direction === 'both' ? 'Both directions' : `${b.direction === 'long' ? 'Long' : 'Short'} only`, provenance: b.directionSource ?? 'inferred' });
  const volume = [...of('volume'), ...rules.filter((r) => r.section !== 'volume' && ORDER_FLOW_WORDS.test(r.text)).map((r) => ({ text: r.text, provenance: r.provenance }))];
  return [
    comp('market', b.instrument.map((i) => ({ text: i, provenance: inText(i) ? 'trader' : 'inferred' }))),
    comp('timeframe', b.timeframes.map((t) => ({ text: t, provenance: 'trader' as const }))),
    comp('setup', of('setup')),
    comp('context', of('context', 'filter')),
    comp('bias', bias),
    comp('entry', of('entry')),
    comp('confirmation', of('confirmation')),
    comp('invalidation', of('invalidation')),
    comp('stop', [...of('stop'), ...(b.stopPoints != null && !of('stop').length ? [{ text: `${b.stopPoints} points`, provenance: 'trader' as const }] : [])]),
    comp('target', of('target')),
    comp('management', of('management')),
    comp('session', session),
    comp('volatility', of('volatility')),
    comp('volume', volume),
    comp('noTrade', of('noTrade')),
  ];
}

// ───────────────────────────── Reasoning ("why should this work?") ─────────────────────────────

export function buildReasoning(b: Base, rules: StrategyRule[], ctx: ConceptContext): StrategyReasoning {
  const concepts = conceptsOf(b);
  const by = (s: RuleSection) => rules.filter((r) => r.section === s);
  const traderVague = rules.filter((r) => r.provenance === 'trader' && r.vagueTerms.length);
  const evidence = (id: string) => b.detectedStyle.find((s) => s.id === id)?.evidence[0];

  const exploits = concepts.filter((c) => c.thesis).slice(0, 2).map((c) => ins(c.thesis!(ctx), 'B', evidence(c.id)));
  if (!exploits.length) {
    const what = [...by('setup'), ...by('entry')].filter((r) => r.provenance === 'trader').map((r) => r.text);
    exploits.push(ins(what.length ? `Your plan reacts to: ${what.join('; ')}. Prop Guard could not map this to a known market behavior, so write down why you expect it to work — that is the assumption to test.` : 'The plan does not yet say what market behavior it reacts to.', 'A'));
  }
  const assumptions = concepts.filter((c) => c.assumption).slice(0, 2).map((c) => ins(c.assumption!(ctx), 'B', evidence(c.id)));
  if (by('bias').some((r) => r.provenance === 'trader')) assumptions.push(ins('The direction you take from your bias rule keeps going for the length of the trade.', 'A', by('bias').find((r) => r.provenance === 'trader')?.quote));

  const falseSignals = uniqBy([
    ...concepts.flatMap((c) => (c.falseSignals ?? []).map((t) => ins(t, 'C', evidence(c.id)))).slice(0, 4),
    ...traderVague.map((r) => ins(`"${r.vagueTerms[0]}" can be read into almost any candle after the fact, so it will fire on noise as well as real setups.`, 'A', r.quote)),
  ]);

  const earlyEntry: Insight[] = concepts.filter((c) => c.early).slice(0, 2).map((c) => ins(c.early!, 'C', evidence(c.id)));
  if (!by('confirmation').length && by('entry').length) earlyEntry.unshift(ins('There is no confirmation step: the first touch of the setup is enough to enter.', 'A'));
  const lateEntry: Insight[] = concepts.filter((c) => c.late).slice(0, 2).map((c) => ins(c.late!, 'C', evidence(c.id)));
  if (by('confirmation').length >= 3) lateEntry.unshift(ins(`The plan stacks ${by('confirmation').length} confirmations; each one moves the entry later and the stop further away.`, 'A'));

  const subjectiveDiscretion = traderVague.map((r) => ins(`"${r.vagueTerms.join('", "')}" in "${r.text}" depends on judgment in the moment.`, 'A', r.quote));

  const overtrading: Insight[] = [];
  if (b.maxTrades == null) overtrading.push(ins('Nothing in the plan limits the number of attempts per day.', 'A'));
  if (!b.tradingWindow.start && !b.tradingWindow.end) overtrading.push(ins('With no time window the setup can be looked for all session long.', 'A'));
  if (b.detectedStyle.some((s) => s.id === 'scalping')) overtrading.push(ins('Scalping plans produce many small decisions; without a loss limit the count grows after losses.', 'C'));
  if (b.detectedStyle.some((s) => s.id === 'support_resistance' || s.id === 'range') && !/max|limit|only one|first touch/i.test(b.originalText)) overtrading.push(ins('Every touch of every level qualifies — the same level can be traded repeatedly in one session.', 'B'));

  const riskReward: Insight[] = [];
  if (!by('stop').length && b.stopPoints == null) riskReward.push(ins('No stop is defined, so risk per trade — and therefore reward:risk — cannot be measured.', 'A'));
  if (!by('target').length && b.minRR == null) riskReward.push(ins('No target is defined, so the reward side of each trade is decided in the moment.', 'A'));
  if (b.minRR != null && b.minRR < 1.5) riskReward.push(ins(`A 1:${b.minRR} reward:risk needs a high hit rate to stay positive after costs.`, 'C', `1:${b.minRR}`));
  if (b.detectedStyle.some((s) => s.id === 'mean_reversion')) riskReward.push(ins('Fades target a return to the mean — the later the entry, the less distance is left to the target while the stop stays beyond the extreme.', 'C'));
  if (b.detectedStyle.some((s) => s.id === 'scalping') && b.minRR != null && b.minRR >= 3) riskReward.push(ins(`Scalping with a 1:${b.minRR} target asks small moves to travel far.`, 'B'));

  const regimeThreats = uniqBy(concepts.flatMap((c) => (c.regimes?.avoid ?? []).map(([r, why]) => ins(`${REGIME_LABELS[r]}: ${why}`, 'C'))).slice(0, 4));

  return { exploits, assumptions, falseSignals, earlyEntry, lateEntry, subjectiveDiscretion, overtrading, riskReward, regimeThreats };
}

// ───────────────────────────── Market regimes ─────────────────────────────

const ALL_REGIMES: MarketRegime[] = ['trending', 'ranging', 'high_volatility', 'low_volatility', 'breakout', 'mean_reversion', 'news_driven', 'opening_session', 'late_session'];

export function assessRegimes(b: Base, rules: StrategyRule[]): RegimeAssessment[] {
  const score = new Map<MarketRegime, number>(ALL_REGIMES.map((r) => [r, 0]));
  const reasons = new Map<MarketRegime, string[]>(ALL_REGIMES.map((r) => [r, []]));
  const fromTrader = new Set<MarketRegime>();
  const add = (r: MarketRegime, n: number, why: string, trader = false) => {
    score.set(r, score.get(r)! + n);
    if (!reasons.get(r)!.includes(why)) reasons.get(r)!.push(why);
    if (trader) fromTrader.add(r);
  };
  // Concepts are weighted by how central they are (detection order).
  conceptsOf(b).forEach((c, i) => {
    const w = i === 0 ? 3 : i === 1 ? 2 : 1;
    for (const [r, why] of c.regimes?.good ?? []) add(r, w, why);
    for (const [r, why] of c.regimes?.avoid ?? []) add(r, -w, why);
  });
  // The trader's own words outrank concept knowledge.
  const start = b.tradingWindow.start;
  if (start && start < '10:30') add('opening_session', 3, `Your window starts at ${start} ET.`, true);
  if (start && start >= '13:30') add('late_session', 3, `Your window starts at ${start} ET.`, true);
  if (b.tradingWindow.end && b.tradingWindow.end <= '11:30') add('late_session', -2, `Your window ends at ${b.tradingWindow.end} ET.`, true);
  for (const r of rules.filter((x) => x.section === 'noTrade' && x.provenance === 'trader')) {
    if (/news|fomc|cpi|nfp|report/i.test(r.text)) add('news_driven', -4, `You avoid news: "${r.text}".`, true);
    if (/chop|range|sideways/i.test(r.text)) add('ranging', -4, `You avoid chop: "${r.text}".`, true);
    if (/slow|quiet|low volume|dead/i.test(r.text)) add('low_volatility', -4, `You avoid slow markets: "${r.text}".`, true);
    if (/trend/i.test(r.text)) add('trending', -4, `You avoid trends: "${r.text}".`, true);
  }
  for (const r of rules.filter((x) => x.provenance === 'trader' && (x.section === 'context' || x.section === 'bias' || x.section === 'volatility'))) {
    if (/trend/i.test(r.text)) add('trending', 2, `Your plan requires a trend: "${r.text}".`, true);
    if (/range|chop|balance/i.test(r.text)) add('ranging', 2, `Your plan requires a range: "${r.text}".`, true);
    if (/high volatil|wide range|big range|atr (above|>)/i.test(r.text)) add('high_volatility', 2, `Your plan asks for volatility: "${r.text}".`, true);
  }
  return ALL_REGIMES.map((r) => {
    const s = score.get(r)!;
    return { regime: r, label: REGIME_LABELS[r], fit: s > 0 ? 'designed_for' : s < 0 ? 'avoid' : 'neutral', reasons: reasons.get(r)!, confidence: fromTrader.has(r) ? 'A' : 'C' } as RegimeAssessment;
  });
}

// ───────────────────────────── Weakness report ─────────────────────────────

export function findContradictions(b: Base, rules: StrategyRule[]): Insight[] {
  const t = b.originalText;
  const out: Insight[] = [];
  if (/only (long|buy)/i.test(t) && /\b(short|sell)\b(?!\s*-?\s*off)/i.test(t.replace(/only (long|buy)[^.]*/i, ''))) out.push(ins('The plan says long only but also describes short / sell entries.', 'A', /only (long|buy)/i.exec(t)?.[0]));
  if (/only (short|sell)/i.test(t) && /\b(long|buy)\b/i.test(t.replace(/only (short|sell)[^.]*/i, ''))) out.push(ins('The plan says short only but also describes long / buy entries.', 'A', /only (short|sell)/i.exec(t)?.[0]));
  const ids = new Set(b.detectedStyle.map((s) => s.id));
  if ((ids.has('trend_continuation') || ids.has('breakout')) && (ids.has('mean_reversion') || /counter[- ]trend|fade/i.test(t))) out.push(ins('The plan both follows moves (trend / breakout) and fades them — it does not say which applies when.', 'A'));
  if (b.tradingWindow.start && b.tradingWindow.end && b.tradingWindow.start >= b.tradingWindow.end) out.push(ins(`The trading window ends (${b.tradingWindow.end}) before it starts (${b.tradingWindow.start}).`, 'A'));
  if (b.maxTrades != null && /re-?enter|keep trying|try again|another (one|trade)|until (it|i) (works|win)/i.test(t)) out.push(ins(`A limit of ${b.maxTrades} trade${b.maxTrades === 1 ? '' : 's'} conflicts with re-entering after a failed attempt.`, 'A', /re-?enter|keep trying|try again|another (one|trade)|until (it|i) (works|win)/i.exec(t)?.[0]));
  if (/tight stop/i.test(t) && /(give it|plenty of) room|wide stop/i.test(t)) out.push(ins('The plan asks for a tight stop and also for giving the trade room.', 'A'));
  if (ids.has('scalping') && b.minRR != null && b.minRR >= 3) out.push(ins(`A scalp with a 1:${b.minRR} target is a contradiction in holding time — scalps rarely travel that far.`, 'B'));
  const notBefore = /no trades? before (\d{1,2}):(\d{2})/i.exec(t);
  if (notBefore && b.tradingWindow.start) {
    const nb = `${notBefore[1].padStart(2, '0')}:${notBefore[2]}`;
    if (b.tradingWindow.start < nb) out.push(ins(`The window starts at ${b.tradingWindow.start} but the plan also says no trades before ${nb}.`, 'A', notBefore[0]));
  }
  if (rules.some((r) => r.section === 'stop' && /no stop|mental stop|don'?t use a stop/i.test(r.text)) && /risk \$?\d+/i.test(t)) out.push(ins('A fixed dollar risk cannot be enforced without a hard stop.', 'B'));
  return out;
}

function ambiguityOf(b: Base, rules: StrategyRule[], ctx: ConceptContext): Insight[] {
  const out: Insight[] = [];
  for (const r of rules.filter((x) => x.provenance === 'trader' && x.vagueTerms.length)) out.push(ins(`"${r.vagueTerms[0]}" is not defined.`, 'A', r.quote));
  if (!ctx.level && rules.some((r) => r.provenance === 'trader' && /\b(it|the level|that level|this level)\b/i.test(r.text) && /(above|below|back|through|at|to)\s+(it|the level|that level|this level)\b/i.test(r.text))) {
    out.push(ins('"It" / "the level" is used without saying which level.', 'A'));
  }
  if (b.timeframes.length > 1 && !/(enter|entry|trigger)[^.]*\d+\s*-?\s*(min|m\b)/i.test(b.originalText)) out.push(ins(`Several timeframes are mentioned (${b.timeframes.join(', ')}) but not which one triggers the entry.`, 'A'));
  if (b.direction === 'both' && b.directionSource !== 'trader') out.push(ins('The plan does not say whether it trades long, short or both.', 'A'));
  return out;
}

function overfittingOf(b: Base, rules: StrategyRule[]): RiskLevel {
  const stripped = b.originalText.replace(/\b\d{1,2}:\d{2}\b/g, '').replace(/\b(?:ES|MES|NQ|MNQ|YM|MYM|RTY|M2K|CL|MCL|GC|MGC)\b/g, '');
  const numbers = (stripped.match(/\d+(?:\.\d+)?/g) ?? []).length;
  const indicators = (b.originalText.match(/\b(RSI|MACD|stochastic|bollinger|ema|sma|vwap|atr|adx|cci|ichimoku|fib)\b/gi) ?? []).map((x) => x.toLowerCase());
  const conditions = rules.filter((r) => r.provenance === 'trader' && ['setup', 'entry', 'confirmation', 'context', 'filter', 'volume', 'volatility'].includes(r.section)).length;
  const reasons: string[] = [];
  if (numbers > 8) reasons.push(`${numbers} specific numeric parameters — many knobs that can be tuned to past data.`);
  else if (numbers > 5) reasons.push(`${numbers} numeric parameters — check each one has a reason beyond fitting past charts.`);
  if (new Set(indicators).size >= 3) reasons.push(`${new Set(indicators).size} different indicators must line up — more filters means fewer, more curve-fit signals.`);
  if (conditions >= 7) reasons.push(`${conditions} entry conditions — very specific setups occur rarely and may describe the past better than the future.`);
  const level = reasons.length >= 2 || numbers > 8 ? 'high' : reasons.length ? 'medium' : 'low';
  return { level, reasons: reasons.length ? reasons : ['Few parameters — low risk of fitting the rules to past charts.'] };
}

function executionOf(b: Base): RiskLevel {
  const ids = new Set(b.detectedStyle.map((s) => s.id));
  const t = b.originalText;
  const reasons: string[] = [];
  let level: RiskLevel['level'] = 'low';
  const raise = (l: RiskLevel['level'], why: string) => {
    reasons.push(why);
    if (l === 'high' || (l === 'medium' && level === 'low')) level = l;
  };
  if (ids.has('order_flow')) raise('high', 'Order-flow entries depend on reading the footprint in real time — slow execution erases the edge.');
  if (ids.has('scalping')) raise('medium', 'Small targets make spread, commission and slippage a large share of each trade.');
  if (b.timeframes.some((x) => x === '1m' || x === 'tick')) raise('medium', 'Very short timeframes leave seconds to act on a signal.');
  if (/market order/i.test(t) && (ids.has('breakout') || ids.has('orb'))) raise('medium', 'Market orders on breakouts are filled at the worst prices of the move.');
  if (ids.has('news') || /\b(trade|during) (the )?(news|cpi|fomc|nfp)/i.test(t)) raise('high', 'Trading releases means gaps through stops and wide spreads.');
  if (ids.has('opening_drive') || (b.tradingWindow.start != null && b.tradingWindow.start <= '09:31')) raise('medium', 'The first minutes of the session have the widest spreads and fastest moves.');
  return { level, reasons: reasons.length ? reasons : ['Entries are on candle closes at defined levels — execution is straightforward.'] };
}

export function buildWeaknessReport(b: Base, rules: StrategyRule[], health: StrategyHealthScore, risks: BehavioralRisk[], missing: string[], ctx: ConceptContext): WeaknessReport {
  const concepts = conceptsOf(b);
  const highs = risks.filter((r) => r.severity === 'high');
  const failureScenarios = uniqBy([
    ...concepts.flatMap((c) => (c.falseSignals ?? []).map((f) => ins(`Fails when: ${f.charAt(0).toLowerCase()}${f.slice(1)}.`, 'C'))).slice(0, 3),
    ...concepts.flatMap((c) => (c.regimes?.avoid ?? []).map(([r, why]) => ins(`Fails on ${REGIME_LABELS[r].toLowerCase()} days — ${why.charAt(0).toLowerCase()}${why.slice(1)}`, 'C'))).slice(0, 2),
    ...(!rules.some((r) => r.section === 'stop') && b.stopPoints == null ? [ins('One losing trade can grow past the daily loss limit, because nothing defines where it is cut.', 'A')] : []),
  ]);
  return {
    strengths: health.strengths,
    weaknesses: health.weaknesses,
    missingRules: missing,
    contradictions: findContradictions(b, rules),
    ambiguity: ambiguityOf(b, rules, ctx),
    overfittingRisk: overfittingOf(b, rules),
    executionRisk: executionOf(b),
    psychologicalRisk: {
      level: highs.length ? 'high' : risks.length ? 'medium' : 'low',
      reasons: risks.length ? risks.map((r) => r.title) : ['No behavioral weaknesses found in how the plan is written.'],
    },
    failureScenarios,
  };
}
