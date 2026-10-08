import { CURRICULUM, type LearningModule, type Lesson, type QuizQuestion } from '@/data/learning/curriculum';
import type { StrategyTemplate } from '@/data/strategies/schema';
import type { PracticeAttempt } from '@/types/practice';
import type {
  Account,
  ExperienceMode,
  InstrumentSymbol,
  LearningProgress,
  PersonalityAnswers,
  PersonalityResult,
  Strategy,
  Trade,
  TradingRules,
  UserPreferences,
} from '@/types/domain';

import { findInstrument } from './instrumentEngine';
import { dailyLossLimitFor, maxDrawdownAmount } from './propRuleEngine';
import { maxContractsForRisk } from './riskEngine';
import { matchTemplates, MIN_TRADES_FOR_INSIGHT, type FinderAnswers, type TemplateMatch } from './strategyLibraryEngine';

/**
 * Dual experience (beginner learning path / experienced quick start).
 *
 * Pure and deterministic. Both experiences read and write the same data
 * (accounts, rules, strategies, practice, journal) — the mode only changes
 * what the app shows first, so switching never loses anything.
 */

// ───────────────────────────── Mode ─────────────────────────────

/** Older profiles have no mode: they were set up as experienced traders. */
export function experienceMode(prefs: Pick<UserPreferences, 'tradingProfile'>): ExperienceMode {
  return prefs.tradingProfile.mode ?? 'experienced';
}

// ───────────────────────────── Progress ─────────────────────────────

export function emptyLearning(): LearningProgress {
  return { lessons: {}, lastLessonId: null, personality: null, plan: null };
}

export type LessonState = 'not_started' | 'started' | 'completed' | 'skipped';

export function lessonStatus(progress: LearningProgress | undefined, lessonId: string): LessonState {
  return progress?.lessons[lessonId]?.status ?? 'not_started';
}

/**
 * Record a lesson's state. A completed lesson stays completed (revisiting or
 * skipping it later never erases progress); the best quiz score is kept.
 */
export function markLesson(
  progress: LearningProgress | undefined,
  lessonId: string,
  status: 'started' | 'completed' | 'skipped',
  now: Date,
  quizScore?: number | null,
): LearningProgress {
  const base = progress ?? emptyLearning();
  const prev = base.lessons[lessonId];
  const next = prev?.status === 'completed' ? 'completed' : prev?.status === 'skipped' && status === 'started' ? 'skipped' : status;
  const best = quizScore == null ? (prev?.quizScore ?? null) : Math.max(quizScore, prev?.quizScore ?? 0);
  return {
    ...base,
    lessons: { ...base.lessons, [lessonId]: { status: next, quizScore: best, updatedAt: now.toISOString() } },
    lastLessonId: lessonId,
  };
}

export interface ProgressSummary {
  completed: number;
  skipped: number;
  total: number;
  /** Completed lessons only (skipped lessons don't count as learned). */
  pct: number;
}

function summarize(progress: LearningProgress | undefined, lessons: readonly Lesson[]): ProgressSummary {
  let completed = 0;
  let skipped = 0;
  for (const l of lessons) {
    const s = lessonStatus(progress, l.id);
    if (s === 'completed') completed++;
    else if (s === 'skipped') skipped++;
  }
  return { completed, skipped, total: lessons.length, pct: lessons.length ? Math.round((completed / lessons.length) * 100) : 0 };
}

export const moduleProgress = (progress: LearningProgress | undefined, module: LearningModule) => summarize(progress, module.lessons);

export const overallProgress = (progress: LearningProgress | undefined, modules: readonly LearningModule[] = CURRICULUM) =>
  summarize(
    progress,
    modules.flatMap((m) => m.lessons),
  );

/** First lesson that is neither completed nor skipped, in curriculum order. */
export function nextLesson(progress: LearningProgress | undefined, modules: readonly LearningModule[] = CURRICULUM): Lesson | null {
  for (const m of modules) for (const l of m.lessons) if (!['completed', 'skipped'].includes(lessonStatus(progress, l.id))) return l;
  return null;
}

/** Where "Continue" goes: the lesson in progress, else the next one. */
export function continueLesson(progress: LearningProgress | undefined, modules: readonly LearningModule[] = CURRICULUM): Lesson | null {
  const last = progress?.lastLessonId;
  if (last && lessonStatus(progress, last) === 'started') {
    const l = modules.flatMap((m) => m.lessons).find((x) => x.id === last);
    if (l) return l;
  }
  return nextLesson(progress, modules);
}

/** The lesson after `lessonId` in curriculum order (null at the end). */
export function lessonAfter(lessonId: string, modules: readonly LearningModule[] = CURRICULUM): Lesson | null {
  const all = modules.flatMap((m) => m.lessons);
  const i = all.findIndex((l) => l.id === lessonId);
  return i >= 0 && i < all.length - 1 ? all[i + 1] : null;
}

// ───────────────────────────── Quiz ─────────────────────────────

export const QUIZ_PASS_PCT = 70;

export interface QuizGrade {
  correct: number;
  total: number;
  /** 0–100. */
  score: number;
  passed: boolean;
  answered: number;
}

export function gradeQuiz(questions: readonly QuizQuestion[], answers: Record<string, number | undefined>): QuizGrade {
  const total = questions.length;
  const answered = questions.filter((q) => answers[q.id] != null).length;
  const correct = questions.filter((q) => answers[q.id] === q.answer).length;
  const score = total ? Math.round((correct / total) * 100) : 100;
  return { correct, total, score, passed: score >= QUIZ_PASS_PCT, answered };
}

// ───────────────────────────── Personality assessment ─────────────────────────────

/** Account limits the personal rules must stay inside (from the account's own rules). */
export interface AccountLimits {
  dailyLossLimit: number | null;
  maxDrawdown: number | null;
}

export function accountLimits(account: Account | null | undefined): AccountLimits | null {
  if (!account) return null;
  return { dailyLossLimit: dailyLossLimitFor(account)?.limit ?? null, maxDrawdown: maxDrawdownAmount(account) };
}

const COOLDOWN: Record<PersonalityAnswers['afterLoss'], number> = { revenge: 30, frustrated: 15, calm: 10 };
const MAX_TRADES: Record<PersonalityAnswers['frequency'], number> = { frequent: 3, quality: 2, selective: 1 };

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Deterministic profile from the trader's answers. Suggested rules come from
 * the trader's OWN dollar limits, and are only ever tightened — capped by the
 * account's daily loss limit / drawdown, never raised.
 */
export function assessPersonality(answers: PersonalityAnswers, now: Date, limits?: AccountLimits | null): PersonalityResult {
  const traits: string[] = [];
  const cautions: string[] = [];

  // Archetype
  let archetype: string;
  if (answers.hours === 'lt1' || (answers.frequency === 'selective' && answers.session === 'ny_open')) archetype = 'Focused Session Specialist';
  else if (answers.frequency !== 'frequent' && (answers.hold === '20-60' || answers.hold === '60+')) archetype = 'Patient Planner';
  else if (answers.frequency === 'frequent' && answers.hold === '1-5') archetype = 'Active Intraday Trader';
  else archetype = 'Balanced Intraday Trader';

  const summary: Record<string, string> = {
    'Focused Session Specialist': 'You have a short, defined window. A plan with one clear setup in that window, and a hard stop on the day, fits you best.',
    'Patient Planner': 'You prefer fewer, longer trades. Plans built around clear context and holding to a target suit your temperament.',
    'Active Intraday Trader': 'You like frequent, short trades. Strict per-trade risk and a trade cap matter most — activity is the main risk to your account.',
    'Balanced Intraday Trader': 'You want a moderate number of trades with normal intraday holds. A simple, repeatable setup and fixed daily limits fit well.',
  };

  // Traits
  const hoursLabel = { lt1: 'under 1 hour', '1to2': '1–2 hours', '2to4': '2–4 hours', gt4: 'more than 4 hours' }[answers.hours];
  traits.push(`Available ${hoursLabel} a day`);
  traits.push(
    { frequent: 'Prefers frequent setups', quality: 'Prefers 1–2 quality setups', selective: 'Very selective' }[answers.frequency],
  );
  traits.push(`Holds ${answers.hold} minutes`);
  traits.push({ uncomfortable: 'Prefers tight, defined risk', okay: 'Comfortable with normal pullbacks', comfortable: 'Tolerates wider swings' }[answers.openLoss]);

  // Cautions (behavioral)
  if (answers.afterLoss === 'revenge') cautions.push('You said you want to win it back after a loss — a longer cooldown and a lower trade cap are built into your rules.');
  if (answers.afterLoss === 'frustrated') cautions.push('Frustration after a loss can lead to forced trades — take the cooldown before the next one.');
  if (answers.openLoss === 'comfortable') cautions.push('Being comfortable with open losses can lead to moving stops — your plan never allows widening a stop.');
  if (answers.frequency === 'frequent') cautions.push('Frequent trading multiplies costs and mistakes — the daily trade cap is your main protection.');
  if (answers.hours === 'lt1' && answers.frequency === 'frequent') cautions.push('Frequent setups in under an hour leave little time to wait for quality — consider fewer, cleaner trades.');

  // Rules: the trader's own numbers, tightened only.
  let dailyStop = Math.max(0, answers.dailyLoss);
  if (limits?.dailyLossLimit != null && limits.dailyLossLimit > 0 && dailyStop > limits.dailyLossLimit) {
    cautions.push(`Your daily stop (${money(dailyStop)}) was above the account’s daily loss limit — capped at ${money(limits.dailyLossLimit)}.`);
    dailyStop = limits.dailyLossLimit;
  }
  if (limits?.maxDrawdown != null && limits.maxDrawdown > 0 && dailyStop > limits.maxDrawdown / 2) {
    const cap = Math.floor(limits.maxDrawdown / 2);
    cautions.push(`One day could use more than half the account’s max drawdown — daily stop capped at ${money(cap)}.`);
    dailyStop = cap;
  }
  let maxRiskPerTrade = Math.max(0, answers.riskPerTrade);
  if (dailyStop > 0 && maxRiskPerTrade > dailyStop / 2) {
    const cap = Math.floor(dailyStop / 2);
    cautions.push(`Risk per trade (${money(maxRiskPerTrade)}) would end the day in under two losses — capped at ${money(cap)}.`);
    maxRiskPerTrade = cap;
  }
  let maxTradesPerDay = MAX_TRADES[answers.frequency];
  if (answers.afterLoss === 'revenge') maxTradesPerDay = Math.min(maxTradesPerDay, 2);
  const maxConsecutiveLosses = Math.min(maxTradesPerDay, answers.afterLoss === 'calm' ? 2 : 1) || 1;

  return {
    answers,
    archetype,
    summary: summary[archetype],
    traits,
    cautions,
    suggestedRules: { maxRiskPerTrade, dailyStop, maxTradesPerDay, cooldownMinutes: COOLDOWN[answers.afterLoss], maxConsecutiveLosses },
    completedAt: now.toISOString(),
  };
}

/** Personality → Strategy Finder answers (same matcher as the Strategy Library finder). */
export function finderAnswersFromPersonality(answers: PersonalityAnswers, instruments: readonly string[]): FinderAnswers {
  return {
    instruments: instruments.length ? [...instruments] : ['MES'],
    session: answers.session,
    style: 'unsure',
    patience: answers.frequency,
    holdTime: answers.hold,
    environment: 'any',
    riskReward: answers.openLoss === 'uncomfortable' ? '1.5' : answers.openLoss === 'okay' ? '2' : 'unsure',
    experience: answers.experience,
    dailyRisk: answers.dailyLoss > 0 ? answers.dailyLoss : null,
  };
}

/** Strategy matches for a personality — structural fit only, never a profit estimate. */
export function recommendStrategies(answers: PersonalityAnswers, instruments: readonly string[], count = 3): TemplateMatch[] {
  return matchTemplates(finderAnswersFromPersonality(answers, instruments), count);
}

/** Merge a personality's suggested rules into the trader's rules (other settings kept). */
export function rulesFromPersonality(current: TradingRules, p: PersonalityResult): TradingRules {
  return {
    ...current,
    ...p.suggestedRules,
    noRevengeTrades: true,
    requireStop: true,
    allowStopWidening: false,
    allowCooldownOverride: p.answers.afterLoss === 'revenge' ? false : current.allowCooldownOverride,
  };
}

// ───────────────────────────── Trading plan ─────────────────────────────

export interface TradingPlan {
  title: string;
  archetype: string | null;
  strategy: {
    templateId: string;
    name: string;
    setup: string;
    entryTrigger: string;
    stopLoss: string;
    profitTarget: string;
    sessionLabel: string;
    entryWindow: [string, string] | null;
    avoid: string[];
  };
  rules: TradingRules;
  sizing: {
    instrument: InstrumentSymbol;
    /** Template stop range in points — only for index contracts it was written for. */
    stopPoints: [number, number] | null;
    /** Contracts that fit max risk at the WIDEST typical stop (null when the stop isn't known for this contract). */
    contracts: number | null;
    riskAtWidestStop: number | null;
    note: string;
  };
  account: {
    name: string;
    firm: string;
    dailyLossLimit: number | null;
    dailyLossMode: 'none' | 'fixed' | 'scaling' | null;
    maxDrawdown: number | null;
    maxContracts: number | null;
    /** Rules were loaded from a verified firm configuration (not hand-entered). */
    verified: boolean;
  } | null;
  checklist: string[];
  routine: { before: string[]; during: string[]; after: string[] };
  cautions: string[];
  disclaimer: string;
}

export const PLAN_DISCLAIMER =
  'This plan is a set of rules you chose, not a prediction. No strategy is guaranteed to be profitable — practice it, journal every trade and review your own results.';

export function buildTradingPlan(input: {
  personality: PersonalityResult | null;
  template: StrategyTemplate;
  instrument: InstrumentSymbol;
  account: Account | null;
  rules: TradingRules;
}): TradingPlan {
  const { personality, template: t, instrument, account } = input;
  const rules = personality ? rulesFromPersonality(input.rules, personality) : input.rules;
  const cautions: string[] = [...(personality?.cautions ?? [])];

  // Account limits (from the account's own rules; verified when imported from a verified firm configuration).
  let acct: TradingPlan['account'] = null;
  if (account) {
    const dll = dailyLossLimitFor(account);
    acct = {
      name: account.name,
      firm: account.firm,
      dailyLossLimit: dll?.limit ?? null,
      dailyLossMode: dll?.mode ?? null,
      maxDrawdown: maxDrawdownAmount(account),
      maxContracts: account.rules.maxContracts,
      verified: account.firmLink?.status === 'verified',
    };
    if (acct.dailyLossLimit != null && rules.dailyStop > acct.dailyLossLimit) {
      cautions.push(`Your daily stop is above ${account.name}’s daily loss limit (${money(acct.dailyLossLimit)}) — lower it before trading.`);
    }
    if (!acct.verified) cautions.push('This account’s rules were entered manually — double-check them against your firm’s official rules.');
  } else {
    cautions.push('No account added — add your prop account so its loss limits are part of the plan.');
  }

  // Sizing: template stop ranges are written for the index contracts it lists.
  const spec = findInstrument(instrument);
  const indexStop = t.markets.includes(instrument);
  let sizing: TradingPlan['sizing'];
  if (spec && indexStop && rules.maxRiskPerTrade > 0) {
    const widest = t.stopRange[1];
    const contracts = maxContractsForRisk(instrument, 0, widest, rules.maxRiskPerTrade, acct?.maxContracts ?? null);
    const riskAtWidestStop = Math.round(widest * spec.pointValue * Math.max(contracts, 1) * 100) / 100;
    sizing = {
      instrument,
      stopPoints: [t.stopRange[0], t.stopRange[1]],
      contracts,
      riskAtWidestStop,
      note:
        contracts > 0
          ? `${contracts} ${instrument} contract${contracts === 1 ? '' : 's'} keep a ${widest}-point stop within your ${money(rules.maxRiskPerTrade)} max risk. Size every trade from its actual stop in Check Trade.`
          : `One ${instrument} contract with a ${widest}-point stop risks ${money(widest * spec.pointValue)} — more than your ${money(rules.maxRiskPerTrade)} max. Use the micro contract or take only tighter stops.`,
    };
    if (contracts === 0) cautions.push(sizing.note);
  } else {
    sizing = {
      instrument,
      stopPoints: null,
      contracts: null,
      riskAtWidestStop: null,
      note: `This framework’s typical stop isn’t defined for ${instrument}. Size each trade from its real stop in Check Trade — max risk ${money(rules.maxRiskPerTrade)}.`,
    };
  }

  return {
    title: `${t.shortName} plan`,
    archetype: personality?.archetype ?? null,
    strategy: {
      templateId: t.id,
      name: t.name,
      setup: t.setup,
      entryTrigger: t.entryTrigger,
      stopLoss: t.stopLoss,
      profitTarget: t.profitTarget,
      sessionLabel: t.session,
      entryWindow: t.entryWindow,
      avoid: t.avoidConditions.slice(0, 4),
    },
    rules,
    sizing,
    account: acct,
    checklist: t.checklist,
    routine: {
      before: [
        'Check the news calendar and mark key levels.',
        `Confirm today’s limits: ${money(rules.dailyStop)} daily stop, ${rules.maxTradesPerDay} trade${rules.maxTradesPerDay === 1 ? '' : 's'} max.`,
        t.entryWindow ? `Trade only ${t.entryWindow[0]}–${t.entryWindow[1]} ET.` : `Trade only during: ${t.session}.`,
      ],
      during: [
        'Run every setup through Check Trade before entering.',
        'Stop goes in with the order and is never widened.',
        `After a loss, wait ${rules.cooldownMinutes} minutes. Stop for the day after ${rules.maxConsecutiveLosses} loss${rules.maxConsecutiveLosses === 1 ? '' : 'es'} in a row.`,
      ],
      after: ['Journal every trade with its result and emotion.', 'Note one thing you did well and one to improve.', 'Review your performance weekly.'],
    },
    cautions,
    disclaimer: PLAN_DISCLAIMER,
  };
}

// ───────────────────────────── Experienced quick start ─────────────────────────────

export interface QuickStartItem {
  id: 'account' | 'rules' | 'strategy' | 'test' | 'journal' | 'improve';
  title: string;
  detail: string;
  done: boolean;
  route: string;
  cta: string;
}

/** Setup status from the trader's real data — nothing is marked done that didn't happen. */
export function quickStartChecklist(data: {
  accounts: Account[];
  activeAccount: Account | null;
  strategies: Strategy[];
  practiceAttempts: PracticeAttempt[];
  trades: Trade[];
  rules: TradingRules;
}): QuickStartItem[] {
  const acct = data.activeAccount ?? data.accounts[0] ?? null;
  const verified = data.accounts.some((a) => a.firmLink?.status === 'verified');
  const limit = acct ? (dailyLossLimitFor(acct)?.limit ?? null) : null;
  const rulesOk = data.rules.maxRiskPerTrade > 0 && data.rules.dailyStop > 0 && (limit == null || data.rules.dailyStop <= limit);
  const closed = data.trades.filter((t) => t.status === 'closed').length;

  return [
    {
      id: 'account',
      title: 'Prop firm account',
      detail: !data.accounts.length
        ? 'Pick firm → program → stage → size; verified rules load automatically.'
        : verified
          ? `${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'} · verified firm rules loaded`
          : `${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'} · rules entered manually`,
      done: data.accounts.length > 0,
      route: '/accounts/new',
      cta: data.accounts.length ? 'Add another' : 'Add account',
    },
    {
      id: 'rules',
      title: 'Risk manager',
      detail: rulesOk
        ? `${money(data.rules.maxRiskPerTrade)} per trade · ${money(data.rules.dailyStop)} daily stop · ${data.rules.maxTradesPerDay} trades/day`
        : limit != null && data.rules.dailyStop > limit
          ? `Daily stop ${money(data.rules.dailyStop)} is above the account limit ${money(limit)}.`
          : 'Set max risk per trade and a daily stop.',
      done: rulesOk,
      route: '/settings/rules',
      cta: rulesOk ? 'Review' : 'Fix rules',
    },
    {
      id: 'strategy',
      title: 'Strategy',
      detail: data.strategies.length
        ? `${data.strategies.length} strateg${data.strategies.length === 1 ? 'y' : 'ies'} saved`
        : 'Import your plan in your own words, or start from the library.',
      done: data.strategies.length > 0,
      route: data.strategies.length ? '/strategy' : '/strategy/describe',
      cta: data.strategies.length ? 'Open' : 'Add strategy',
    },
    {
      id: 'test',
      title: 'Analyse & practice',
      detail: data.practiceAttempts.length
        ? `${data.practiceAttempts.length} practice attempt${data.practiceAttempts.length === 1 ? '' : 's'} recorded`
        : 'Analyse your rules and practise them on replay scenarios.',
      done: data.practiceAttempts.length > 0,
      route: '/practice',
      cta: 'Practice',
    },
    {
      id: 'journal',
      title: 'Journal',
      detail: closed ? `${closed} closed trade${closed === 1 ? '' : 's'} journaled` : 'Checked trades land here automatically for their result.',
      done: closed > 0,
      route: '/journal',
      cta: 'Open journal',
    },
    {
      id: 'improve',
      title: 'Improvement insights',
      detail:
        closed >= MIN_TRADES_FOR_INSIGHT
          ? 'Enough trades for performance insights.'
          : `Insights unlock after ${MIN_TRADES_FOR_INSIGHT} closed trades (${closed}/${MIN_TRADES_FOR_INSIGHT}).`,
      done: closed >= MIN_TRADES_FOR_INSIGHT,
      route: '/performance',
      cta: 'Performance',
    },
  ];
}
