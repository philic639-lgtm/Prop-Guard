import { readFileSync } from 'node:fs';

import { createDemoData } from '@/data/demo';

import { SHARED_FILES, toDeno } from '../../../../scripts/sync-setup-check-shared';
import {
  analysisKey,
  buildEngineInput,
  contentHash,
  evaluateSetup,
  FIRM_RULES_MAX_AGE_DAYS,
  NONBINDING_DAILY_LIMIT,
  normalizedMaxContracts,
  parseClientInput,
  propBuffers,
  rulesAreCurrent,
  rulesFromStrategy,
  systemEvidence,
  visualRules,
  type AccountRiskState,
  type ClientSetupInput,
  type StrategyRecord,
  type TrustedContext,
} from '../setupCheck';

const demo = createDemoData(new Date('2026-10-06T14:00:00Z'));
const orb = demo.strategies[0];
const record: StrategyRecord = {
  id: orb.id,
  name: orb.name,
  updatedAt: orb.updatedAt,
  markets: orb.markets,
  timeframe: orb.timeframe,
  entryWindowStart: orb.entryWindowStart,
  entryWindowEnd: orb.entryWindowEnd,
  biasRequirement: orb.biasRequirement,
  requiresBiasAlignment: orb.requiresBiasAlignment,
  entryTrigger: orb.entryTrigger,
  confirmationRules: orb.confirmationRules,
  retestRules: orb.retestRules,
  invalidationRules: orb.invalidationRules,
  minRR: orb.minRR,
  checklist: orb.checklist.map((c) => ({ id: c.id, label: c.label, required: c.required })),
};
const NOW = new Date('2026-10-06T14:15:00Z'); // 10:15 ET, inside 09:45–10:45
const rules = rulesFromStrategy(record);

const client = (over: Partial<ClientSetupInput> = {}): ClientSetupInput => ({
  strategyId: orb.id,
  accountId: null,
  instrument: 'MES',
  side: 'LONG',
  entry: 5000,
  stop: 4996,
  target: 5010,
  target2: null,
  quantity: 2,
  costs: 2,
  slippage: 2.5,
  reserve: 0,
  noDailyLimitConfirmed: false,
  timeframe: '5m',
  notes: '',
  manual: visualRules(rules).map((r) => ({ ruleId: r.id, status: 'PASS' as const })),
  firmConfirmations: [],
  icc: {},
  ...over,
});

const trusted = (over: Partial<TrustedContext> = {}): TrustedContext => ({
  rules,
  systemEvidence: systemEvidence(record, rules, 'MES', NOW),
  visionEvidence: [],
  analysisMode: 'UNAVAILABLE',
  // MES from the instrument catalog: $5 / point, 0.25 tick, 10 MES = 1 ES.
  instrument: { pointValue: 5, tickSize: 0.25, miniEquivalentRatio: 10 },
  minimumRR: orb.minRR,
  maxRisk: 150,
  account: null,
  now: NOW,
  ...over,
});

describe('Setup Check — rules come from the saved strategy', () => {
  it('builds rules only from the strategy (checklist, trigger, confirmation, retest, invalidation, bias, window, markets)', () => {
    const labels = rules.map((r) => `${r.id}|${r.description}`).join('\n');
    expect(labels).toMatch(/checklist_orb_15_0\|ORB established/);
    expect(rules.find((r) => r.id.startsWith('invalid_'))).toMatchObject({ critical: true, required: true });
    expect(rules.find((r) => r.id === 'system_entry_window')).toMatchObject({ kind: 'system', critical: true });
    expect(rules.find((r) => r.id === 'system_instrument')).toMatchObject({ kind: 'system', critical: true });
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    expect(labels).not.toMatch(/volume/i);
    // Same record → same IDs (device and server agree).
    expect(rulesFromStrategy({ ...record }).map((r) => r.id)).toEqual(rules.map((r) => r.id));
  });

  it('system evidence is computed (instrument in plan, entry window)', () => {
    const ev = systemEvidence(record, rules, 'CL', new Date('2026-10-06T17:00:00Z'));
    expect(ev.find((e) => e.ruleId === 'system_instrument')!.status).toBe('FAIL');
    expect(ev.find((e) => e.ruleId === 'system_entry_window')!.status).toBe('FAIL');
    expect(ev.every((e) => e.source === 'system')).toBe(true);
  });
});

describe('Setup Check — trust boundary', () => {
  it('a client cannot inject vision, system or computed evidence', () => {
    const raw = {
      ...client(),
      manual: [
        { ruleId: 'system_entry_window', status: 'PASS', source: 'system' }, // cannot override a computed rule
        { ruleId: rules[0].id, status: 'PASS', source: 'vision', confidence: 1 }, // source is forced to manual
        { ruleId: 'made_up', status: 'PASS' },
      ],
      visionEvidence: [{ ruleId: rules[1].id, status: 'PASS', source: 'vision', confidence: 1, reason: 'fake' }],
      prop: { verified: true, rulesCurrent: true },
      pointValue: 9999,
    };
    const parsed = parseClientInput(raw)!;
    const late = new Date('2026-10-06T17:00:00Z');
    const input = buildEngineInput(parsed, trusted({ systemEvidence: systemEvidence(record, rules, 'MES', late), now: late }));
    expect(input.evidence.find((e) => e.ruleId === 'system_entry_window')).toMatchObject({ status: 'FAIL', source: 'system' });
    expect(input.evidence.find((e) => e.ruleId === rules[0].id)!.source).toBe('manual');
    expect(input.evidence.some((e) => e.ruleId === rules[1].id)).toBe(false); // client "vision" ignored
    expect(input.evidence.some((e) => e.ruleId === 'made_up')).toBe(false);
    expect(input.trade.pointValue).toBe(5); // catalog value, not the client's
    expect(input.prop).toEqual({ mode: 'none' }); // no account → no client-claimed prop data
  });

  it('nothing is pre-ticked: without explicit confirmations every visual rule is UNVERIFIED', () => {
    const r = evaluateSetup(buildEngineInput(client({ manual: [] }), trusted()));
    expect(r.decision).toBe('WAIT');
    expect(r.evaluatedRules.filter((x) => !x.id.startsWith('system_')).every((x) => x.status === 'UNVERIFIED')).toBe(true);
  });

  it('manual-only checking can clear a personal-account setup when everything is confirmed', () => {
    const r = evaluateSetup(buildEngineInput(client(), trusted()));
    // MES: 4 pts × $5 × 2 + $4.50 costs = $44.50 risk; reward 10 × $5 × 2 − 4.50 = $95.50.
    expect(r.dollarRisk).toBeCloseTo(44.5);
    expect(r.reward).toBeCloseTo(95.5);
    expect(r.decision).toBe('TAKE TRADE');
  });

  it('uses the instrument catalog: ES vs MES give different dollar risk; off-tick prices stay unverified', () => {
    const es = evaluateSetup(buildEngineInput(client({ instrument: 'ES' }), trusted({ instrument: { pointValue: 50, tickSize: 0.25, miniEquivalentRatio: 1 } })));
    expect(es.dollarRisk).toBeCloseTo(4 * 50 * 2 + 4.5);
    const off = evaluateSetup(buildEngineInput(client({ entry: 5000.1 }), trusted()));
    expect(off.riskChecks.find((c) => c.id === 'ticks')!.status).toBe('UNVERIFIED');
    expect(off.decision).not.toBe('TAKE TRADE');
  });

  it('fees and slippage must be explicit (zero allowed)', () => {
    expect(evaluateSetup(buildEngineInput(client({ costs: null }), trusted())).decision).toBe('WAIT');
    expect(evaluateSetup(buildEngineInput(client({ costs: 0, slippage: 0 }), trusted())).decision).toBe('TAKE TRADE');
  });

  it('demo observations never count; live vision evidence must come from the server with confidence ≥ 0.8', () => {
    const vision = visualRules(rules).map((r) => ({ ruleId: r.id, status: 'PASS' as const, source: 'demo' as const, confidence: 1, reason: 'Simulated.' }));
    const demoRun = evaluateSetup(buildEngineInput(client({ manual: [] }), trusted({ visionEvidence: vision, analysisMode: 'DEMO' })));
    expect(demoRun.decision).toBe('WAIT');
    expect(demoRun.blockers.some((b) => b.id === 'demo')).toBe(true);
    const real = evaluateSetup(buildEngineInput(client({ manual: [] }), trusted({ visionEvidence: vision.map((v) => ({ ...v, source: 'vision' as const })), analysisMode: 'REAL' })));
    expect(real.decision).toBe('TAKE TRADE');
  });
});

describe('Setup Check — prop accounts', () => {
  const account = (over: Partial<AccountRiskState> = {}): AccountRiskState => ({
    kind: 'prop',
    balance: 50_500,
    startingBalance: 50_000,
    highWaterMark: 50_800,
    maxDrawdown: 2_000,
    drawdownType: 'eod_trailing',
    trailingLocksAtStart: true,
    dailyLossLimit: 1_000,
    realizedPnlToday: -200,
    openRisk: 100,
    maxContracts: 5,
    verified: true,
    lastVerifiedAt: '2026-10-05T00:00:00.000Z',
    ...over,
  });

  it('computes current buffers after realized P&L and open exposure (trailing floor, lock at start)', () => {
    // Floor = min(50,800 − 2,000, 50,000) = 48,800; buffer = 50,500 − 48,800 − 100 = 1,600.
    expect(propBuffers(account(), false)).toEqual({ drawdownBuffer: 1_600, dailyLossRemaining: 700 });
    expect(propBuffers(account({ drawdownType: 'static' }), false).drawdownBuffer).toBe(2_400);
    expect(propBuffers(account({ dailyLossLimit: null }), false).dailyLossRemaining).toBeUndefined();
    expect(propBuffers(account({ dailyLossLimit: null }), true).dailyLossRemaining).toBe(NONBINDING_DAILY_LIMIT);
  });

  it('normalizes micro / mini contract limits upstream', () => {
    expect(normalizedMaxContracts(5, 10)).toBe(50);
    expect(normalizedMaxContracts(5, 1)).toBe(5);
    expect(normalizedMaxContracts(null, 10)).toBeUndefined();
  });

  it('stale firm rules are not current', () => {
    expect(rulesAreCurrent('2026-10-05T00:00:00Z', NOW)).toBe(true);
    expect(rulesAreCurrent(new Date(NOW.getTime() - (FIRM_RULES_MAX_AGE_DAYS + 1) * 86_400_000).toISOString(), NOW)).toBe(false);
    expect(rulesAreCurrent(null, NOW)).toBe(false);
  });

  it('a verified, current account with confirmed restrictions can clear; missing or stale firm data blocks it', () => {
    const firm = [{ ruleId: 'other_firm_rules', status: 'PASS' as const }];
    const ok = evaluateSetup(buildEngineInput(client({ firmConfirmations: firm }), trusted({ account: account() })));
    expect(ok.decision).toBe('TAKE TRADE');
    expect(evaluateSetup(buildEngineInput(client(), trusted({ account: account() }))).decision).toBe('WAIT'); // other firm rules not confirmed
    expect(evaluateSetup(buildEngineInput(client({ firmConfirmations: firm }), trusted({ account: account({ verified: false }) }))).decision).toBe('WAIT');
    expect(evaluateSetup(buildEngineInput(client({ firmConfirmations: firm }), trusted({ account: account({ lastVerifiedAt: '2026-01-01T00:00:00Z' }) }))).decision).toBe('WAIT');
    // 60 MES > 5 ES × 10 → contract limit violated → STAND DOWN.
    expect(evaluateSetup(buildEngineInput(client({ quantity: 60, firmConfirmations: firm }), trusted({ account: account(), maxRisk: 1e6 }))).propChecks.find((c) => c.id === 'contracts')!.status).toBe('FAIL');
    // Risk above the remaining daily loss → STAND DOWN.
    expect(evaluateSetup(buildEngineInput(client({ firmConfirmations: firm }), trusted({ account: account({ realizedPnlToday: -950 }) }))).decision).toBe('STAND DOWN');
  });
});

describe('Setup Check — staleness keys', () => {
  const base = { imageHash: contentHash('abc'), strategyId: 's', strategyVersion: 'v1', instrument: 'ES', accountId: 'a', side: 'LONG', entry: 1, stop: 0.5, target: 2, quantity: 1 };
  it('any change to screenshot, strategy version, instrument, account, prices or size changes the key', () => {
    const k = analysisKey(base);
    for (const patch of [{ imageHash: contentHash('abd') }, { strategyVersion: 'v2' }, { instrument: 'MES' }, { accountId: 'b' }, { entry: 1.25 }, { stop: 0.75 }, { target: 3 }, { quantity: 2 }]) {
      expect(analysisKey({ ...base, ...patch })).not.toBe(k);
    }
    expect(analysisKey({ ...base })).toBe(k);
    expect(contentHash('a'.repeat(5000))).not.toBe(contentHash(`${'a'.repeat(4999)}b`));
  });
});

describe('Setup Check — server copy', () => {
  it('the Edge Function’s shared modules are in sync with src (run `npm run shared:sync`)', () => {
    for (const [from, to] of SHARED_FILES) expect(readFileSync(to, 'utf8')).toBe(toDeno(readFileSync(from, 'utf8')));
  });
});
