import { ALL_LESSONS, CURRICULUM, findLesson } from '@/data/learning/curriculum';
import { DEFAULT_PREFERENCES } from '@/data/demo';
import { getTemplate, STRATEGY_LIBRARY } from '@/data/strategyLibrary';
import { NOW, makeAccount, makeRules, makeStrategy, makeTrade } from '@/test/fixtures';
import type { PersonalityAnswers } from '@/types/domain';
import type { PracticeAttempt } from '@/types/practice';

import {
  accountLimits,
  assessPersonality,
  buildTradingPlan,
  continueLesson,
  emptyLearning,
  experienceMode,
  gradeQuiz,
  lessonAfter,
  lessonStatus,
  markLesson,
  moduleProgress,
  nextLesson,
  overallProgress,
  quickStartChecklist,
  recommendStrategies,
  rulesFromPersonality,
} from '../learningEngine';
import { calculateTradeRisk } from '../riskEngine';

const answers = (over: Partial<PersonalityAnswers> = {}): PersonalityAnswers => ({
  hours: '1to2',
  session: 'ny_open',
  afterLoss: 'calm',
  openLoss: 'okay',
  frequency: 'quality',
  hold: '5-20',
  riskPerTrade: 150,
  dailyLoss: 400,
  experience: 'Beginner',
  ...over,
});

const UNSUPPORTED = /guarantee|can't lose|can’t lose|winner|proven|profitable strategy|high win rate|buy now|take this trade/i;

describe('curriculum', () => {
  it('covers the eight beginner topics in order with unique lesson ids', () => {
    expect(CURRICULUM.map((m) => m.id)).toEqual(['prop-firms', 'account-protection', 'personality', 'strategy-discovery', 'charts', 'practice', 'plan', 'improve']);
    const ids = ALL_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every quiz answer is a valid choice; visuals point at real library templates', () => {
    for (const l of ALL_LESSONS) {
      for (const b of l.blocks) {
        if (b.kind === 'quiz') for (const q of b.questions) expect(q.answer).toBeLessThan(q.choices.length);
        if (b.kind === 'visual') expect(getTemplate(b.templateId)?.visual).toBeTruthy();
      }
    }
  });

  it('lesson copy never makes profit or certainty claims (wrong quiz choices excepted)', () => {
    for (const l of ALL_LESSONS) {
      const blocks = l.blocks.map((b) => (b.kind === 'quiz' ? { ...b, questions: b.questions.map((q) => ({ ...q, choices: [q.choices[q.answer]] })) } : b));
      expect(JSON.stringify({ ...l, blocks })).not.toMatch(UNSUPPORTED);
    }
  });
});

describe('progress', () => {
  it('starts empty, continues where the trader left off and moves forward', () => {
    let p = emptyLearning();
    expect(continueLesson(p)?.id).toBe(ALL_LESSONS[0].id);
    p = markLesson(p, 'prop-firms-basics', 'started', NOW);
    expect(continueLesson(p)?.id).toBe('prop-firms-basics');
    p = markLesson(p, 'prop-firms-basics', 'completed', NOW, 100);
    expect(nextLesson(p)?.id).toBe('prop-firms-stages');
    expect(moduleProgress(p, CURRICULUM[0])).toMatchObject({ completed: 1, total: 2, pct: 50 });
  });

  it('skipping moves on but is not counted as learned; a completed lesson is never downgraded', () => {
    let p = markLesson(undefined, 'prop-firms-basics', 'skipped', NOW);
    expect(nextLesson(p)?.id).toBe('prop-firms-stages');
    expect(overallProgress(p).completed).toBe(0);
    expect(overallProgress(p).skipped).toBe(1);
    // revisiting a skipped lesson keeps it skipped until finished
    p = markLesson(p, 'prop-firms-basics', 'started', NOW);
    expect(lessonStatus(p, 'prop-firms-basics')).toBe('skipped');
    p = markLesson(p, 'prop-firms-basics', 'completed', NOW, 50);
    p = markLesson(p, 'prop-firms-basics', 'skipped', NOW);
    p = markLesson(p, 'prop-firms-basics', 'completed', NOW, 100);
    p = markLesson(p, 'prop-firms-basics', 'started', NOW, 0);
    expect(p.lessons['prop-firms-basics']).toMatchObject({ status: 'completed', quizScore: 100 });
  });

  it('lessonAfter walks the curriculum and ends with null', () => {
    expect(lessonAfter('prop-firms-stages')?.id).toBe(CURRICULUM[1].lessons[0].id);
    expect(lessonAfter(ALL_LESSONS[ALL_LESSONS.length - 1].id)).toBeNull();
    expect(findLesson('nope')).toBeFalsy();
  });

  it('all lessons done → nothing next', () => {
    let p = emptyLearning();
    for (const l of ALL_LESSONS) p = markLesson(p, l.id, 'completed', NOW);
    expect(nextLesson(p)).toBeNull();
    expect(overallProgress(p).pct).toBe(100);
  });
});

describe('gradeQuiz', () => {
  const qs = CURRICULUM[1].lessons[0].blocks.flatMap((b) => (b.kind === 'quiz' ? b.questions : []));
  it('scores against the answer key with a 70% pass mark', () => {
    expect(qs.length).toBeGreaterThanOrEqual(2);
    const all = Object.fromEntries(qs.map((q) => [q.id, q.answer]));
    expect(gradeQuiz(qs, all)).toMatchObject({ correct: qs.length, score: 100, passed: true });
    const oneWrong = { ...all, [qs[0].id]: (qs[0].answer + 1) % qs[0].choices.length };
    const g = gradeQuiz(qs, oneWrong);
    expect(g.correct).toBe(qs.length - 1);
    expect(g.passed).toBe(g.score >= 70);
    expect(gradeQuiz(qs, {})).toMatchObject({ answered: 0, correct: 0, passed: false });
  });
});

describe('personality assessment', () => {
  it('is deterministic and uses the trader’s own limits', () => {
    const a = assessPersonality(answers(), NOW);
    expect(assessPersonality(answers(), NOW)).toEqual(a);
    expect(a.suggestedRules).toEqual({ maxRiskPerTrade: 150, dailyStop: 400, maxTradesPerDay: 2, cooldownMinutes: 10, maxConsecutiveLosses: 2 });
    expect(a.archetype).toBe('Balanced Intraday Trader');
  });

  it('archetypes follow time, frequency and hold', () => {
    expect(assessPersonality(answers({ hours: 'lt1' }), NOW).archetype).toBe('Focused Session Specialist');
    expect(assessPersonality(answers({ hold: '20-60', frequency: 'selective', session: 'flexible' }), NOW).archetype).toBe('Patient Planner');
    expect(assessPersonality(answers({ frequency: 'frequent', hold: '1-5' }), NOW).archetype).toBe('Active Intraday Trader');
  });

  it('revenge tendency → longer cooldown, fewer trades, stop after one loss', () => {
    const r = assessPersonality(answers({ afterLoss: 'revenge', frequency: 'frequent' }), NOW);
    expect(r.suggestedRules).toMatchObject({ cooldownMinutes: 30, maxTradesPerDay: 2, maxConsecutiveLosses: 1 });
    expect(r.cautions.join(' ')).toMatch(/cooldown/);
    expect(rulesFromPersonality(makeRules(), r)).toMatchObject({ allowCooldownOverride: false, allowStopWidening: false, noRevengeTrades: true });
  });

  it('caps rules to the account and per-trade risk to half the daily stop — never raises them', () => {
    const acct = makeAccount(); // DLL 500, MDD 1,500
    const r = assessPersonality(answers({ dailyLoss: 2000, riskPerTrade: 900 }), NOW, accountLimits(acct));
    expect(r.suggestedRules.dailyStop).toBe(500);
    expect(r.suggestedRules.maxRiskPerTrade).toBe(250);
    expect(r.cautions.length).toBeGreaterThanOrEqual(2);
    // tighter than the account: kept as is
    const tight = assessPersonality(answers({ dailyLoss: 300, riskPerTrade: 100 }), NOW, accountLimits(acct));
    expect(tight.suggestedRules).toMatchObject({ dailyStop: 300, maxRiskPerTrade: 100 });
    // half the max drawdown
    const mdd = assessPersonality(answers({ dailyLoss: 2000 }), NOW, { dailyLossLimit: null, maxDrawdown: 2000 });
    expect(mdd.suggestedRules.dailyStop).toBe(1000);
  });

  it('a verified "no daily loss limit" account caps on drawdown only', () => {
    const acct = makeAccount({ rules: { dailyLossLimit: null, maxDrawdown: 2000, calc: { dailyLossMode: 'none' } } as never });
    expect(accountLimits(acct)).toEqual({ dailyLossLimit: null, maxDrawdown: 2000 });
  });
});

describe('strategy discovery', () => {
  it('recommends library templates via the Strategy Finder matcher, with reasons', () => {
    const recs = recommendStrategies(answers(), ['MES']);
    expect(recs).toHaveLength(3);
    for (const r of recs) {
      expect(STRATEGY_LIBRARY.some((t) => t.id === r.templateId)).toBe(true);
      expect(r.fitScore).toBeLessThan(100);
    }
    expect(recs[0].reasons.length).toBeGreaterThan(0);
    // different answers → different top picks
    const other = recommendStrategies(answers({ session: 'ny_afternoon', frequency: 'selective', hold: '60+', experience: 'Advanced' }), ['CL']);
    expect(other.map((r) => r.templateId)).not.toEqual(recs.map((r) => r.templateId));
  });
});

describe('trading plan', () => {
  const orb = getTemplate('orb-15')!;
  const personality = assessPersonality(answers({ riskPerTrade: 150, dailyLoss: 400 }), NOW);

  it('sizes from the template stop with the risk engine and the account cap', () => {
    const plan = buildTradingPlan({ personality, template: orb, instrument: 'MES', account: makeAccount(), rules: makeRules() });
    expect(plan.rules.maxRiskPerTrade).toBe(150);
    expect(plan.sizing.stopPoints).toEqual(orb.stopRange);
    // MES $5/pt, widest stop 8 pts → $40 per contract → 3 contracts within $150
    const widest = orb.stopRange[1];
    const n = plan.sizing.contracts!;
    const r = calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 5000, stop: 5000 - widest, target: null, contracts: n });
    expect(r.riskDollars!).toBeLessThanOrEqual(150);
    const over = calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 5000, stop: 5000 - widest, target: null, contracts: n + 1 });
    expect(over.riskDollars!).toBeGreaterThan(150);
    expect(plan.account).toMatchObject({ dailyLossLimit: 500, maxDrawdown: 1500, maxContracts: 10, verified: false });
    expect(plan.checklist).toEqual(orb.checklist);
  });

  it('respects the account contract cap and says when one contract is too big', () => {
    const capped = buildTradingPlan({ personality, template: orb, instrument: 'MES', account: makeAccount({ rules: { maxContracts: 1 } as never }), rules: makeRules() });
    expect(capped.sizing.contracts).toBe(1);
    const tiny = assessPersonality(answers({ riskPerTrade: 50, dailyLoss: 200 }), NOW);
    const es = buildTradingPlan({ personality: tiny, template: orb, instrument: 'ES', account: null, rules: makeRules() });
    expect(es.sizing.contracts).toBe(0);
    expect(es.cautions.join(' ')).toMatch(/micro/);
    expect(es.cautions.join(' ')).toMatch(/No account added/);
  });

  it('never applies index stop ranges to other markets', () => {
    const plan = buildTradingPlan({ personality, template: orb, instrument: 'CL', account: null, rules: makeRules() });
    expect(plan.sizing).toMatchObject({ stopPoints: null, contracts: null });
  });

  it('plan text makes no profit claims and carries the disclaimer', () => {
    const plan = buildTradingPlan({ personality, template: orb, instrument: 'MES', account: makeAccount(), rules: makeRules() });
    const { disclaimer, ...rest } = plan;
    expect(JSON.stringify(rest)).not.toMatch(UNSUPPORTED);
    expect(disclaimer).toMatch(/not a prediction/);
  });
});

describe('experienced quick start', () => {
  it('nothing is done for a new user', () => {
    const items = quickStartChecklist({ accounts: [], activeAccount: null, strategies: [], practiceAttempts: [], trades: [], rules: makeRules({ dailyStop: 0 }) });
    expect(items.map((i) => i.id)).toEqual(['account', 'rules', 'strategy', 'test', 'journal', 'improve']);
    expect(items.every((i) => !i.done)).toBe(true);
  });

  it('reflects real data only', () => {
    const acct = makeAccount({ firmLink: { status: 'verified' } as never });
    const trades = Array.from({ length: 5 }, (_, i) => makeTrade({ id: `t${i}`, status: 'closed' }));
    const items = quickStartChecklist({
      accounts: [acct],
      activeAccount: acct,
      strategies: [makeStrategy()],
      practiceAttempts: [{ id: 'p1' } as PracticeAttempt],
      trades,
      rules: makeRules(),
    });
    expect(items.every((i) => i.done)).toBe(true);
    expect(items[0].detail).toMatch(/verified/);
  });

  it('a daily stop above the account limit is flagged', () => {
    const acct = makeAccount();
    const rules = quickStartChecklist({ accounts: [acct], activeAccount: acct, strategies: [], practiceAttempts: [], trades: [], rules: makeRules({ dailyStop: 900 }) }).find((i) => i.id === 'rules')!;
    expect(rules.done).toBe(false);
    expect(rules.detail).toMatch(/above the account limit/);
  });
});

describe('experience mode', () => {
  it('older profiles default to experienced; switching keeps learning progress', () => {
    expect(experienceMode(DEFAULT_PREFERENCES)).toBe('experienced');
    const learning = markLesson(undefined, 'prop-firms-basics', 'completed', NOW);
    const beginner = { ...DEFAULT_PREFERENCES, tradingProfile: { ...DEFAULT_PREFERENCES.tradingProfile, mode: 'beginner' as const }, learning };
    expect(experienceMode(beginner)).toBe('beginner');
    const switched = { ...beginner, tradingProfile: { ...beginner.tradingProfile, mode: 'experienced' as const } };
    expect(experienceMode(switched)).toBe('experienced');
    expect(switched.learning).toBe(learning);
  });
});
