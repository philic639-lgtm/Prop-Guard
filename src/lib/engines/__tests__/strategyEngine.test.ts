import { NOW, makeAccount, makeRules, makeStrategy, makeTrade } from '@/test/fixtures';

import { computeDailyGuard } from '../dailyGuardEngine';
import { calculateTradeRisk } from '../riskEngine';
import { evaluateSetup, validateStrategy, type SetupEvaluationInput } from '../strategyEngine';

const allYes = { orb: true, breakout: true, retest: true };

function input(overrides: Partial<SetupEvaluationInput> = {}): SetupEvaluationInput {
  const rules = makeRules();
  return {
    strategy: makeStrategy(),
    direction: 'long',
    bias: 'bullish',
    answers: allYes,
    risk: calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 6042.25, stop: 6037.25, target: 6052.25, contracts: 5 }),
    contracts: 5,
    rules,
    guard: computeDailyGuard({ account: makeAccount(), rules, trades: [], now: NOW }),
    recentStopPoints: [5, 5, 5],
    strategyTradesToday: 0,
    now: NOW,
    ...overrides,
  };
}

describe('evaluateSetup', () => {
  it('grades a fully compliant setup as A+', () => {
    const r = evaluateSetup(input());
    expect(r.grade).toBe('A_PLUS');
    expect(r.matchPct).toBe(100);
    expect(r.violations).toHaveLength(0);
  });

  it('downgrades to VALID with a wider-than-average stop caution', () => {
    const r = evaluateSetup(input({ recentStopPoints: [3.5, 3.5] }));
    expect(r.grade).toBe('VALID');
    expect(r.cautions.join(' ')).toMatch(/1.5 points wider than your strategy average/);
  });

  it('flags misaligned bias', () => {
    const r = evaluateSetup(input({ bias: 'bearish' }));
    expect(r.checks.find((c) => c.id === 'bias_aligned')!.passed).toBe(false);
    expect(['CAUTION', 'NO_TRADE']).toContain(r.grade);
  });

  it('marks unanswered checklist items as failed', () => {
    const r = evaluateSetup(input({ answers: { orb: true } }));
    expect(r.checks.filter((c) => c.severity === 'checklist' && !c.passed)).toHaveLength(2);
    expect(r.grade).not.toBe('A_PLUS');
  });

  it('returns RULE_VIOLATION when risk exceeds the per-trade max', () => {
    const risk = calculateTradeRisk({ instrument: 'ES', direction: 'long', entry: 6042.25, stop: 6037.25, target: 6052.25, contracts: 2 });
    const r = evaluateSetup(input({ risk, contracts: 2 }));
    expect(r.grade).toBe('RULE_VIOLATION');
    expect(r.violations.join(' ')).toMatch(/exceeds your \$250 per-trade limit/);
  });

  it('returns RULE_VIOLATION when R:R is below the strategy minimum', () => {
    const risk = calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 6042.25, stop: 6037.25, target: 6047.25, contracts: 5 });
    expect(evaluateSetup(input({ risk })).grade).toBe('RULE_VIOLATION');
  });

  it('returns RULE_VIOLATION when a target is required but missing', () => {
    const risk = calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 6042.25, stop: 6037.25, target: null, contracts: 5 });
    const r = evaluateSetup(input({ risk }));
    expect(r.grade).toBe('RULE_VIOLATION');
  });

  it('returns RULE_VIOLATION during cooldown', () => {
    const rules = makeRules();
    const loss = makeTrade({ pnl: -100, openedAt: new Date(NOW.getTime() - 600_000).toISOString(), closedAt: new Date(NOW.getTime() - 300_000).toISOString() });
    const guard = computeDailyGuard({ account: makeAccount(), rules, trades: [loss], now: NOW });
    const r = evaluateSetup(input({ guard }));
    expect(r.grade).toBe('RULE_VIOLATION');
    expect(r.violations).toContain('You are still in a post-loss cooldown.');
  });

  it('returns NO_TRADE when the daily guard says stop', () => {
    const rules = makeRules();
    const loss = makeTrade({ pnl: -400, openedAt: '2026-10-02T13:50:00Z', closedAt: '2026-10-02T13:55:00Z' });
    const guard = computeDailyGuard({ account: makeAccount(), rules, trades: [loss], now: NOW });
    expect(evaluateSetup(input({ guard })).grade).toBe('NO_TRADE');
  });

  it('returns NO_TRADE for an invalid trade plan', () => {
    const risk = calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 6000, stop: 6010, target: 6020, contracts: 1 });
    expect(evaluateSetup(input({ risk })).grade).toBe('NO_TRADE');
  });

  it('enforces the strategy daily trade cap', () => {
    expect(evaluateSetup(input({ strategyTradesToday: 2 })).grade).toBe('RULE_VIOLATION');
  });

  it('cautions outside the entry window', () => {
    const r = evaluateSetup(input({ now: new Date('2026-10-02T18:00:00Z') }));
    expect(r.cautions).toContain('You are outside your strategy entry window.');
    expect(r.grade).toBe('VALID');
  });

  it('never grades above CAUTION when a required checklist item fails', () => {
    const r = evaluateSetup(input({ answers: { orb: true, breakout: true, retest: false } }));
    expect(r.grade).toBe('CAUTION');
  });
});

describe('validateStrategy', () => {
  it('accepts a valid strategy', () => {
    expect(validateStrategy(makeStrategy())).toEqual([]);
  });

  it('reports all problems', () => {
    const errors = validateStrategy(
      makeStrategy({ name: ' ', markets: [], minRR: 0, maxTrades: 0, typicalStopMin: 9, typicalStopMax: 4, entryWindowStart: '25:00', entryWindowEnd: null, checklist: [] }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });
});
