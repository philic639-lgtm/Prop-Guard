import {
  ALIGNMENT_LABEL,
  FRAMEWORK_LABEL,
  getTemplate,
  CONDITION_LABEL,
  FREQUENCY_LABEL,
  HOLD_LABEL,
  SESSION_LABEL,
  STRATEGY_LIBRARY,
  STYLE_LABEL,
  CATEGORY_LABEL,
  type Complexity,
  type HoldTime,
  type MarketCondition,
  type SessionKey,
  type StrategyStyle,
  type StrategyTemplate,
  type TimeframeKey,
} from '@/data/strategyLibrary';
import type { Strategy, StrategySourceType, Trade } from '@/types/domain';

import type { DailyGuard } from './dailyGuardEngine';
import { findInstrument } from './instrumentEngine';
import { inEntryWindow } from './strategyEngine';

/**
 * Strategy library logic: search & filters, deterministic matching for
 * "Find Something Repeatable", comparison, the trader's OWN performance by
 * strategy, and the pre-trade "setup valid / wait / invalid" status.
 * Nothing here estimates profitability — matching explains FIT only, and
 * performance comes exclusively from the trader's journaled trades.
 */

// ---------------------------------------------------------------------------
// Source type
// ---------------------------------------------------------------------------

export function strategySourceType(s: Pick<Strategy, 'source' | 'sourceType'>): StrategySourceType {
  return s.sourceType ?? (s.source === 'library' ? 'BUILT_IN' : 'CUSTOM');
}

/** Honest label: built-ins use their framework label; nothing is called "proven". */
export function strategySourceLabel(s: Pick<Strategy, 'source' | 'sourceType' | 'libraryId'>): string {
  const type = strategySourceType(s);
  if (type === 'CUSTOM') return 'Custom Strategy';
  if (type === 'AI_ADAPTED') return 'Adapted Framework';
  const t = getTemplate(s.libraryId);
  return t ? FRAMEWORK_LABEL[t.framework] : 'Established Framework';
}

/** Rule fields that, when changed, make a built-in strategy "adapted". */
const RULE_FIELDS = [
  'entryWindowStart',
  'entryWindowEnd',
  'biasRequirement',
  'requiresBiasAlignment',
  'entryTrigger',
  'confirmationRules',
  'retestRules',
  'stopMethod',
  'typicalStopMin',
  'typicalStopMax',
  'targetMethod',
  'minRR',
  'maxTrades',
  'invalidationRules',
] as const;

/** Source type after an edit: a built-in whose rules or checklist changed becomes AI_ADAPTED. */
export function sourceTypeAfterEdit(before: Strategy | null, after: Strategy): StrategySourceType {
  const current = strategySourceType(before ?? after);
  if (current !== 'BUILT_IN' || !before) return current;
  const changed =
    RULE_FIELDS.some((k) => before[k] !== after[k]) ||
    before.checklist.map((c) => `${c.label}|${c.required}`).join() !== after.checklist.map((c) => `${c.label}|${c.required}`).join();
  return changed ? 'AI_ADAPTED' : 'BUILT_IN';
}

// ---------------------------------------------------------------------------
// Search & filters
// ---------------------------------------------------------------------------

export type LibraryChip = 'all' | 'orb' | 'trend' | 'vwap' | 'breakout' | 'reversal' | 'sr' | 'liquidity' | 'previous_day' | 'opening_session';

export const LIBRARY_CHIPS: { key: LibraryChip; label: string; match: (t: StrategyTemplate) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'orb', label: 'ORB', match: (t) => t.category === 'opening_range' },
  { key: 'trend', label: 'Trend', match: (t) => t.category === 'trend' },
  { key: 'vwap', label: 'VWAP', match: (t) => t.category === 'vwap' },
  { key: 'breakout', label: 'Breakout', match: (t) => t.category === 'breakout' },
  { key: 'reversal', label: 'Reversal', match: (t) => t.alignment === 'counter_trend' || t.style === 'reversal' },
  { key: 'sr', label: 'Support/Resistance', match: (t) => t.category === 'support_resistance' },
  { key: 'liquidity', label: 'Liquidity', match: (t) => t.category === 'liquidity' || t.tags.includes('liquidity') },
  { key: 'previous_day', label: 'Previous Day Levels', match: (t) => t.category === 'previous_day' },
  { key: 'opening_session', label: 'Opening Session', match: (t) => t.category === 'opening_session' },
];

export type RRPreference = 1 | 1.5 | 2 | 3;

export interface LibraryFilters {
  query?: string;
  chip?: LibraryChip;
  instrument?: string | null;
  session?: SessionKey | null;
  timeframe?: TimeframeKey | null;
  condition?: MarketCondition | null;
  experience?: Complexity | null;
  riskReward?: RRPreference | null;
}

/** Whether a template's default target structure suits a preferred reward:risk. Targets are configurable. */
export function rrFits(t: StrategyTemplate, rr: RRPreference): boolean {
  const d = t.defaultRiskReward;
  if (rr === 1) return d <= 1.5;
  if (rr === 1.5) return d >= 1.5 && d <= 2;
  if (rr === 2) return d >= 1.5 && d <= 2.5;
  // 1:3+ suits frameworks that trade with the trend and can hold for extension.
  return d >= 2 && t.alignment === 'with_trend';
}

function haystack(t: StrategyTemplate): string {
  return [t.name, t.shortName, t.description, CATEGORY_LABEL[t.category], STYLE_LABEL[t.style], ...t.tags, ...t.instruments].join(' ').toLowerCase();
}

export function activeFilterCount(f: LibraryFilters): number {
  return [f.instrument, f.session, f.timeframe, f.condition, f.experience, f.riskReward].filter((v) => v != null).length;
}

export function filterTemplates(list: readonly StrategyTemplate[], f: LibraryFilters): StrategyTemplate[] {
  const chip = LIBRARY_CHIPS.find((c) => c.key === (f.chip ?? 'all'))!;
  const tokens = (f.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((t) => {
    if (!chip.match(t)) return false;
    if (f.instrument && !t.instruments.includes(f.instrument)) return false;
    if (f.session && !t.sessions.includes(f.session)) return false;
    if (f.timeframe && !t.timeframes.includes(f.timeframe) && t.confirmationTimeframe !== f.timeframe) return false;
    if (f.condition && !t.marketConditions.includes(f.condition)) return false;
    if (f.experience && t.experienceLevel !== f.experience) return false;
    if (f.riskReward && !rrFits(t, f.riskReward)) return false;
    if (tokens.length) {
      const h = haystack(t);
      if (!tokens.every((tok) => h.includes(tok))) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Matching ("Find Something Repeatable")
// ---------------------------------------------------------------------------

export type FinderSession = SessionKey | 'flexible';
export type FinderStyle = StrategyStyle | 'unsure';
export type FinderPatience = 'frequent' | 'quality' | 'selective';
export type FinderEnvironment = 'trending' | 'range' | 'high_volatility' | 'low_volatility' | 'any';
export type FinderRR = '1' | '1.5' | '2' | '3' | 'unsure';

export interface FinderAnswers {
  /** Contracts the trader trades; 'OTHER' for anything outside the catalog. */
  instruments: string[];
  session: FinderSession;
  style: FinderStyle;
  patience: FinderPatience;
  holdTime: HoldTime;
  environment: FinderEnvironment;
  riskReward: FinderRR;
  experience: Complexity;
  /** Optional daily risk budget for a size sanity note. */
  dailyRisk?: number | null;
}

export interface TemplateMatch {
  templateId: string;
  /** 0–100 structural fit — never a probability of profit. */
  fitScore: number;
  reasons: string[];
  cautions: string[];
}

const WEIGHTS = { instrument: 15, session: 15, style: 20, frequency: 10, hold: 10, environment: 10, rr: 10, experience: 10 } as const;
const LEVEL: Record<Complexity, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };
const PATIENCE_FREQ: Record<FinderPatience, StrategyTemplate['frequency']> = { frequent: 'frequent', quality: 'moderate', selective: 'selective' };
const PATIENCE_LABEL: Record<FinderPatience, string> = { frequent: 'want frequent setups', quality: 'want 1–2 quality setups per session', selective: 'are very selective' };
const STYLE_REASON: Record<StrategyStyle, string> = {
  breakout: 'You prefer breakout/retest entries',
  pullback: 'You prefer pullback entries',
  reversal: 'You prefer reversal setups',
  trend: 'You prefer trend following',
  support_resistance: 'You trade support and resistance',
};
const HOLD_ORDER: HoldTime[] = ['1-5', '5-20', '20-60', '60+'];

function styleScore(t: StrategyTemplate, s: FinderStyle): number {
  if (s === 'unsure') return t.experienceLevel === 'Beginner' ? 0.8 : 0.6;
  if (t.style === s) return 1;
  // Closely related styles get partial credit.
  const related: Record<StrategyStyle, StrategyStyle[]> = {
    breakout: ['trend'],
    pullback: ['trend'],
    reversal: ['support_resistance'],
    trend: ['pullback', 'breakout'],
    support_resistance: ['reversal', 'breakout'],
  };
  if (related[s].includes(t.style)) return 0.55;
  if (s === 'support_resistance' && (t.category === 'support_resistance' || t.category === 'previous_day')) return 0.9;
  if (s === 'trend' && t.alignment === 'with_trend') return 0.5;
  if (s === 'reversal' && t.alignment === 'counter_trend') return 0.8;
  return 0;
}

export function scoreTemplate(t: StrategyTemplate, a: FinderAnswers): TemplateMatch {
  let score = 0;
  const reasons: string[] = [];
  const cautions: string[] = [];

  // Instruments
  const known = a.instruments.filter((i) => i !== 'OTHER');
  const supported = known.filter((i) => t.instruments.includes(i));
  if (known.length === 0) score += WEIGHTS.instrument * 0.6;
  else if (supported.length) {
    score += WEIGHTS.instrument * (supported.length === known.length ? 1 : 0.8);
    reasons.push(`You trade ${supported.slice(0, 3).join(', ')}`);
  } else {
    cautions.push(`Usually applied to ${t.instruments.slice(0, 4).join(', ')} — adapt levels for ${known[0]}.`);
  }

  // Session
  if (a.session === 'flexible') score += WEIGHTS.session * 0.8;
  else if (t.sessions.includes(a.session)) {
    score += WEIGHTS.session;
    reasons.push(`You trade the ${SESSION_LABEL[a.session]}`);
  } else if ((a.session === 'ny_open' && t.sessions.includes('ny_morning')) || (a.session === 'ny_morning' && t.sessions.includes('ny_open'))) {
    score += WEIGHTS.session * 0.5;
  }

  // Style
  const st = styleScore(t, a.style);
  score += WEIGHTS.style * st;
  if (a.style !== 'unsure' && st >= 0.9) reasons.push(STYLE_REASON[a.style]);
  if (a.style === 'unsure' && t.experienceLevel === 'Beginner') reasons.push('A clear, rule-based structure to start with');

  // Frequency / patience
  const wantFreq = PATIENCE_FREQ[a.patience];
  const order = ['selective', 'moderate', 'frequent'];
  const diff = Math.abs(order.indexOf(wantFreq) - order.indexOf(t.frequency));
  score += WEIGHTS.frequency * (diff === 0 ? 1 : diff === 1 ? 0.5 : 0);
  if (diff === 0) reasons.push(`You ${PATIENCE_LABEL[a.patience]}`);

  // Hold time
  if (t.holdTimes.includes(a.holdTime)) {
    score += WEIGHTS.hold;
    reasons.push(`Typical hold of ${HOLD_LABEL[a.holdTime]} matches yours`);
  } else {
    const near = t.holdTimes.some((h) => Math.abs(HOLD_ORDER.indexOf(h) - HOLD_ORDER.indexOf(a.holdTime)) === 1);
    if (near) score += WEIGHTS.hold * 0.5;
  }

  // Environment
  if (a.environment === 'any') score += WEIGHTS.environment * 0.7;
  else if (t.marketConditions.includes(a.environment)) {
    score += WEIGHTS.environment;
    reasons.push(`Built for ${CONDITION_LABEL[a.environment].toLowerCase()} conditions`);
  } else if (a.environment === 'range' && t.marketConditions.includes('reversal')) score += WEIGHTS.environment * 0.6;
  else if (a.environment === 'high_volatility' && t.marketConditions.includes('trending')) score += WEIGHTS.environment * 0.3;

  // Reward : risk
  if (a.riskReward === 'unsure') score += WEIGHTS.rr * 0.7;
  else {
    const rr = Number(a.riskReward) as RRPreference;
    if (rrFits(t, rr)) {
      score += WEIGHTS.rr;
      reasons.push(`You prefer approximately 1:${a.riskReward} reward/risk`);
    } else score += WEIGHTS.rr * 0.3;
  }

  // Experience
  const gap = LEVEL[t.experienceLevel] - LEVEL[a.experience];
  score += WEIGHTS.experience * (gap <= 0 ? 1 : gap === 1 ? 0.4 : 0);
  if (gap > 0) cautions.push(`${t.experienceLevel} framework — practice it before trading live.`);

  // Size sanity: a mini index contract with this framework's typical stop vs the daily budget.
  if (a.dailyRisk && a.dailyRisk > 0) {
    const mini = supported.find((i) => findInstrument(i) && !findInstrument(i)!.isMicro && ['ES', 'NQ', 'YM', 'RTY'].includes(i));
    const spec = mini ? findInstrument(mini) : undefined;
    if (spec && t.stopRange[0] * spec.pointValue > a.dailyRisk / 2) {
      cautions.push(`A ${t.stopRange[0]}-point stop on 1 ${mini} risks $${t.stopRange[0] * spec.pointValue} — consider the micro contract.`);
    }
  }

  return { templateId: t.id, fitScore: Math.round(Math.max(0, Math.min(99, score))), reasons: reasons.slice(0, 6), cautions: cautions.slice(0, 3) };
}

/** Rank the curated library for a trader. Deterministic; the top `count` (default 5). */
export function matchTemplates(a: FinderAnswers, count = 5, list: readonly StrategyTemplate[] = STRATEGY_LIBRARY): TemplateMatch[] {
  return list
    .map((t, i) => ({ m: scoreTemplate(t, a), popular: t.popular ? 1 : 0, i }))
    .sort((x, y) => y.m.fitScore - x.m.fitScore || y.popular - x.popular || x.i - y.i)
    .slice(0, count)
    .map((x) => x.m);
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export interface CompareRow {
  label: string;
  values: string[];
}

const COMPLEXITY_LABEL: Record<Complexity, string> = { Beginner: 'Low (Beginner)', Intermediate: 'Medium (Intermediate)', Advanced: 'High (Advanced)' };

/** Side-by-side structural comparison. Deliberately has no win-rate or return rows. */
export function compareTemplates(list: readonly StrategyTemplate[]): CompareRow[] {
  const rows: [string, (t: StrategyTemplate) => string][] = [
    ['Setup frequency', (t) => FREQUENCY_LABEL[t.frequency]],
    ['Complexity', (t) => COMPLEXITY_LABEL[t.experienceLevel]],
    ['Typical hold time', (t) => t.holdTimes.map((h) => HOLD_LABEL[h]).join(', ')],
    ['Preferred market condition', (t) => t.marketConditions.map((c) => CONDITION_LABEL[c]).join(', ')],
    ['Confirmation timeframe', (t) => t.confirmationTimeframe],
    ['Trend vs reversal', (t) => ALIGNMENT_LABEL[t.alignment]],
    ['Typical R:R', (t) => `1:${t.defaultRiskReward} (configurable)`],
    ['Best sessions', (t) => t.sessions.map((s) => SESSION_LABEL[s]).join(', ')],
    ['Supported instruments', (t) => t.instruments.join(' · ')],
  ];
  return rows.map(([label, fn]) => ({ label, values: list.map(fn) }));
}

// ---------------------------------------------------------------------------
// The trader's own performance by strategy
// ---------------------------------------------------------------------------

export const UNASSIGNED = 'unassigned';

export interface StrategyPerformanceRow {
  key: string;
  strategyId: string | null;
  name: string;
  libraryId: string | null;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Average realized R across trades that have a defined risk. */
  avgR: number | null;
  netR: number;
  netPnl: number;
  lastTradeAt: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Per-strategy results computed ONLY from the trader's own closed trades.
 * No template or sample data is ever mixed in.
 */
export function strategyPerformance(trades: readonly Trade[], strategies: readonly Strategy[], since?: Date): StrategyPerformanceRow[] {
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    if (t.status !== 'closed' || t.pnl == null) continue;
    if (since && Date.parse(t.closedAt ?? t.openedAt) < since.getTime()) continue;
    const key = t.strategyId ?? UNASSIGNED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const rows: StrategyPerformanceRow[] = [];
  for (const [key, list] of groups) {
    const s = key === UNASSIGNED ? undefined : byId.get(key);
    const wins = list.filter((t) => (t.pnl ?? 0) > 0).length;
    const losses = list.filter((t) => (t.pnl ?? 0) < 0).length;
    const rs = list.map((t) => t.realizedR).filter((r): r is number => r != null);
    const last = list.reduce<string | null>((m, t) => {
      const at = t.closedAt ?? t.openedAt;
      return m == null || at > m ? at : m;
    }, null);
    rows.push({
      key,
      strategyId: key === UNASSIGNED ? null : key,
      name: key === UNASSIGNED ? 'Strategy not assigned' : (s?.name ?? list.find((t) => t.strategyName)?.strategyName ?? 'Deleted strategy'),
      libraryId: s?.libraryId ?? null,
      trades: list.length,
      wins,
      losses,
      winRate: wins + losses > 0 ? wins / (wins + losses) : null,
      avgR: rs.length ? r2(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
      netR: r2(rs.reduce((a, b) => a + b, 0)),
      netPnl: r2(list.reduce((a, t) => a + (t.pnl ?? 0), 0)),
      lastTradeAt: last,
    });
  }
  // Assigned strategies first, strongest by average R; unassigned last.
  return rows.sort((a, b) => (a.key === UNASSIGNED ? 1 : 0) - (b.key === UNASSIGNED ? 1 : 0) || (b.avgR ?? -Infinity) - (a.avgR ?? -Infinity) || b.trades - a.trades);
}

/** Minimum trades before a strategy is called out as strong or weak. */
export const MIN_TRADES_FOR_INSIGHT = 5;

/** Plain-language summary of the trader's own results. Null until there is enough data. */
export function performanceInsight(rows: readonly StrategyPerformanceRow[], minTrades = MIN_TRADES_FOR_INSIGHT): string | null {
  const ranked = rows.filter((r) => r.strategyId && r.trades >= minTrades && r.avgR != null);
  if (ranked.length === 0) return null;
  const strong = ranked.filter((r) => (r.avgR ?? 0) > 0).slice(0, 2);
  const weak = ranked.filter((r) => (r.avgR ?? 0) < 0);
  const parts: string[] = [];
  if (strong.length === 2) parts.push(`Your journal shows that ${strong[0].name} and ${strong[1].name} have been your strongest setups.`);
  else if (strong.length === 1) parts.push(`Your journal shows that ${strong[0].name} has been your strongest setup.`);
  if (weak.length) parts.push(`${weak[0].name} is negative so far (${weak[0].avgR}R average over ${weak[0].trades} trades) — review whether the rules were followed.`);
  if (parts.length === 0) parts.push('No strategy stands out yet — keep journaling to build a clearer picture.');
  parts.push('Based only on your journaled trades; past results don’t predict future trades.');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Pre-trade status (Today's plan / Analyze strategy match)
// ---------------------------------------------------------------------------

export type PreTradeVerdict = 'VALID' | 'WAIT' | 'INVALID';

export interface PreTradeCheck {
  id: string;
  label: string;
  state: 'met' | 'missing' | 'unanswered';
  /** Checked automatically from limits/time rather than by the trader. */
  auto?: boolean;
}

export interface PreTradeStatus {
  verdict: PreTradeVerdict;
  checks: PreTradeCheck[];
  met: number;
  total: number;
  missing: string[];
  reasons: string[];
}

export interface PreTradeInput {
  strategy: Strategy;
  answers: Record<string, boolean | null | undefined>;
  guard: Pick<DailyGuard, 'status' | 'riskRemaining' | 'tradesRemaining' | 'cooldown'> | null;
  now: Date;
  /** The trader marked the strategy's invalidation condition as having occurred. */
  invalidated?: boolean;
}

/**
 * SETUP VALID only when every required checklist rule is met and limits allow a
 * trade; WAIT while rules are unconfirmed; SETUP INVALID when limits or the
 * strategy's invalidation say no trade. This is rule compliance, not a forecast.
 */
export function preTradeStatus(input: PreTradeInput): PreTradeStatus {
  const { strategy, answers, guard, now } = input;
  const checks: PreTradeCheck[] = strategy.checklist
    .filter((c) => c.kind === 'yesno')
    .map((c) => ({ id: c.id, label: c.label, state: answers[c.id] === true ? 'met' : answers[c.id] === false ? 'missing' : 'unanswered' }));

  const reasons: string[] = [];
  let invalid = false;

  const riskOk = guard != null && guard.status !== 'STOP' && guard.riskRemaining > 0;
  checks.push({ id: 'auto_risk', label: 'Risk within daily limit', state: riskOk ? 'met' : 'missing', auto: true });
  if (!riskOk) {
    invalid = true;
    reasons.push(guard ? 'Daily risk limit reached — no new trades today.' : 'Add an account so limits can be checked.');
  }
  if (guard && guard.tradesRemaining <= 0) {
    invalid = true;
    reasons.push('Trade limit reached for today.');
  }
  if (guard?.cooldown.active) {
    invalid = true;
    reasons.push('Cooldown is active.');
  }

  const windowState = inEntryWindow(strategy, now);
  if (windowState !== null) {
    checks.push({ id: 'auto_window', label: 'Inside entry window', state: windowState ? 'met' : 'missing', auto: true });
    if (!windowState) reasons.push('Outside your strategy’s entry window.');
  }

  if (input.invalidated) {
    invalid = true;
    reasons.push(`Invalidation occurred: ${strategy.invalidationRules || 'setup invalidated'}.`);
  }

  const required = strategy.checklist.filter((c) => c.kind === 'yesno' && c.required).map((c) => c.id);
  const requiredMet = required.every((id) => answers[id] === true);
  const missing = checks.filter((c) => c.state !== 'met').map((c) => c.label);
  const verdict: PreTradeVerdict = invalid ? 'INVALID' : requiredMet && windowState !== false ? 'VALID' : 'WAIT';
  if (verdict === 'WAIT' && !reasons.length) reasons.push(`Waiting on: ${missing.slice(0, 3).join(', ')}.`);
  if (verdict === 'VALID') reasons.push('All of your required rules are met. This confirms rule compliance — it does not predict the outcome.');

  return { verdict, checks, met: checks.filter((c) => c.state === 'met').length, total: checks.length, missing, reasons };
}
