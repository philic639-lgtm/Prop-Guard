import { DEFAULT_TRADING_RULES } from '@/data/demo';
import { BUILT_IN_TEMPLATES } from '@/data/strategies/catalog';
import { strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { localTrustedContext } from '@/services/setupCheck/localContext';
import { strategyRecordOf } from '@/services/setupCheck/strategyRecord';

import { calculateTradeRisk } from '../riskEngine';
import {
  parseIccObservation,
  rulesFromStrategy,
  runSetupCheck,
  setupTransition,
  type AccountRiskState,
  type ClientSetupInput,
  type Evidence,
  type IccManual,
  type SetupSnapshot,
  type TrustedContext,
} from '../setupCheck';

const NOW = new Date('2026-10-06T14:15:00Z'); // 10:15 ET — inside the ORB window
const icc = strategyRecordOf(strategyFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'icc')!));
const orb = strategyRecordOf(strategyFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'orb-15')!));
const FULL: IccManual = { htfBias: 'BULLISH', indication: 'CONFIRMED', displacement: 'STRONG', correction: 'CONFIRMED', continuation: 'CONFIRMED', momentum: 'STRONG', room: 'CLEAR' };

/** ES: $50 / point. Entry 5000, stop 4998 → $100 per contract; TP1 5005.5. */
const client = (over: Partial<ClientSetupInput> = {}): ClientSetupInput => ({
  strategyId: icc.id,
  accountId: null,
  instrument: 'ES',
  side: 'LONG',
  entry: 5000,
  stop: 4998,
  target: 5005.5,
  target2: 5010,
  quantity: 1,
  costs: 2,
  slippage: 2.5,
  reserve: 0,
  noDailyLimitConfirmed: false,
  liveAccountConfirmed: false,
  timeframe: '5m',
  notes: '',
  manual: [{ ruleId: 'icc_stop_structural', status: 'PASS' }],
  firmConfirmations: [],
  icc: FULL,
  ...over,
});

const trusted = (record = icc, instrument = 'ES', over: Partial<TrustedContext> = {}): TrustedContext => ({
  ...localTrustedContext({ record, instrument, account: null, trades: [], tradingRules: DEFAULT_TRADING_RULES, now: NOW }),
  visionEvidence: [],
  analysisMode: 'UNAVAILABLE',
  ...over,
});

const prop = (over: Partial<AccountRiskState> = {}): AccountRiskState => ({
  kind: 'prop',
  balance: 50_000,
  startingBalance: 50_000,
  highWaterMark: 50_000,
  maxDrawdown: 2_000,
  drawdownType: 'trailing',
  trailingLocksAtStart: true,
  dailyLossLimit: 1_000,
  realizedPnlToday: 0,
  openRisk: 0,
  maxContracts: 2,
  verified: true,
  lastVerifiedAt: '2026-10-01T00:00:00Z',
  liveData: false,
  ...over,
});
const FIRM = [{ ruleId: 'other_firm_rules', status: 'PASS' as const }];

describe('Setup decision — ICC (A–F)', () => {
  it('A. indication only → WAIT, stage Indication only', () => {
    const { decision: d } = runSetupCheck(client({ icc: { htfBias: 'BULLISH', indication: 'CONFIRMED' } }), trusted());
    expect(d.status).toBe('WAIT');
    expect(d.stage).toEqual({ code: 'INDICATION_ONLY', label: 'Indication only' });
    expect(d.icc!.stages.map((s) => s.state)).toEqual(['done', 'pending', 'pending']);
    expect(d.alert).toBe('Your setup is forming. Get ready and manage risk, but wait for confirmation.');
    expect(d.event).toBe('SETUP_DETECTED');
  });

  it('B. indication + correction, no confirmation → WAIT, Awaiting confirmation', () => {
    const { decision: d } = runSetupCheck(client({ icc: { htfBias: 'BULLISH', indication: 'CONFIRMED', correction: 'CONFIRMED' } }), trusted());
    expect(d.status).toBe('WAIT');
    expect(d.stage.label).toBe('Awaiting confirmation');
    expect(d.why.summary).toMatch(/^WAIT because \d+ of \d+ strategy conditions are satisfied, but your saved ICC rules require confirmation after the correction before entry\.$/);
    expect(d.event).toBe('SETUP_CONFIRMATION_PENDING');
  });

  it('B2. correction still developing → WAIT, Correction in progress', () => {
    const { decision: d } = runSetupCheck(client({ icc: { indication: 'CONFIRMED', correction: 'DEVELOPING' } }), trusted());
    expect(d).toMatchObject({ status: 'WAIT', stage: { code: 'CORRECTION_IN_PROGRESS' }, event: 'SETUP_PROGRESS' });
  });

  it('C. fully confirmed + valid risk → QUALIFIED with full metrics', () => {
    const { decision: d } = runSetupCheck(client(), trusted());
    expect(d.status).toBe('QUALIFIED');
    expect(d.displayStatus).toBe('QUALIFIED');
    expect(d.stage).toEqual({ code: 'CONFIRMED', label: 'Confirmed' });
    expect(d.match.score).toBe(100);
    expect(d.entryQuality).toBe('Strong');
    expect(d.risk).toMatchObject({ pointRisk: 2, riskPerContract: 100, contracts: 1, dollarRisk: 104.5, maxRisk: 150, maxAllowedContracts: 1, riskCapExceeded: false });
    expect(d.levels).toMatchObject({ entry: 5000, stop: 4998, tp1: 5005.5, tp2: 5010 });
    expect(d.checklist.every((c) => c.state === 'matched')).toBe(true);
    expect(d.event).toBe('SETUP_CONFIRMED');
    expect(`${d.headline} ${d.action}`).not.toMatch(/safe to trade|will win|guarantee/i);
  });

  it('D. confirmed but contracts exceed the prop maximum → BLOCKED with the exact rule', () => {
    const { decision: d } = runSetupCheck(client({ accountId: 'a', quantity: 3, firmConfirmations: FIRM, liveAccountConfirmed: true }), trusted(icc, 'ES', { account: prop(), maxRisk: 1e6 }));
    expect(d.status).toBe('BLOCKED');
    expect(d.headline).toBe('Strategy setup is valid, but this trade violates your prop-firm rules');
    expect(d.blocking).toContainEqual({ label: 'Prop firm rule: Position size', detail: 'Maximum contracts allowed: 2 · Current size: 3' });
    expect(d.prop.rows.find((r) => r.id === 'position_size')!.status).toBe('FAIL');
    expect(d.entryQuality).toBe('Strong');
    expect(d.event).toBe('RISK_BLOCKED');
  });

  it('D2. personal plan contract cap also blocks', () => {
    const personal = prop({ kind: 'personal', maxContracts: 2 });
    const { decision: d } = runSetupCheck(client({ accountId: 'a', quantity: 3 }), trusted(icc, 'ES', { account: personal, maxRisk: 1e6 }));
    expect(d.status).toBe('BLOCKED');
    expect(d.blocking).toContainEqual({ label: 'Max contracts', detail: 'Maximum contracts allowed: 2 · Current size: 3' });
  });

  it('E. confirmed but dollar risk exceeds the trader’s max → BLOCKED, never qualified', () => {
    const { decision: d, evaluation } = runSetupCheck(client({ stop: 4995, target: 5020 }), trusted());
    expect(evaluation.decision).not.toBe('TAKE TRADE');
    expect(d.status).toBe('BLOCKED');
    expect(d.blocking[0]).toEqual({ label: 'Max risk per trade', detail: 'Max risk allowed: $150 · Current risk: $254.5' });
    expect(d.risk).toMatchObject({ riskCapExceeded: true, stopTooWide: true, maxAllowedContracts: 0 });
    expect(d.action).toBe('Reduce risk or stand down.');
  });

  it('F. no identifiable ICC setup → STAND_DOWN', () => {
    const { decision: d } = runSetupCheck(client({ icc: { indication: 'NOT_PRESENT' } }), trusted());
    expect(d.status).toBe('STAND_DOWN');
    expect(d.headline).toBe('No clear match to your saved setup');
    expect(d.action).toBe('Do not force the trade. Wait for a cleaner setup.');
    expect(`${d.action} ${d.why.summary}`).not.toMatch(/loosen|change your (rules|strategy)|remove the rule/i);
  });

  it('F2. invalidated ICC / opposing higher timeframe → STAND_DOWN', () => {
    expect(runSetupCheck(client({ icc: { ...FULL, correction: 'INVALIDATED' } }), trusted()).decision).toMatchObject({ status: 'STAND_DOWN', stage: { code: 'INVALIDATED' }, event: 'SETUP_INVALIDATED' });
    expect(runSetupCheck(client({ icc: { ...FULL, htfBias: 'BEARISH' } }), trusted()).decision.status).toBe('STAND_DOWN');
  });

  it('F3. generic strategy: mostly failed conditions → STAND_DOWN with failed list', () => {
    const fails = rulesFromStrategy(orb).filter((r) => r.kind === 'visual').map((r, i) => ({ ruleId: r.id, status: (i < 2 ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL' }));
    const { decision: d } = runSetupCheck(client({ strategyId: orb.id, icc: {}, manual: fails }), trusted(orb));
    expect(d.status).toBe('STAND_DOWN');
    expect(d.match.failed.length).toBeGreaterThan(0);
  });
});

describe('Setup decision — score never overrides a missing confirmation (G)', () => {
  it('G. high match score but a mandatory confirmation pending → WAIT', () => {
    const rules = rulesFromStrategy(orb).filter((r) => r.kind === 'visual');
    const confirm = rules.find((r) => r.id.startsWith('confirm_'))!;
    const manual = rules.filter((r) => r.id !== confirm.id).map((r) => ({ ruleId: r.id, status: 'PASS' as const }));
    const { decision: d, evaluation } = runSetupCheck(client({ strategyId: orb.id, icc: {}, manual, stop: 4996, target: 5010, instrument: 'MES', quantity: 2 }), trusted(orb, 'MES'));
    expect(d.match.score).toBeGreaterThanOrEqual(85);
    expect(evaluation.riskCheck).toBe('PASS');
    expect(d.status).toBe('WAIT');
    expect(d.match.pending.map((c) => c.id)).toEqual([confirm.id]);
    expect(d.match.pending[0].category).toBe('confirmation');
    expect(d.stage.code).toBe('AWAITING_CONFIRMATION');
  });

  it('every condition carries its weight and the score adds up to the matched weights', () => {
    const { decision: d } = runSetupCheck(client({ icc: { htfBias: 'BULLISH', indication: 'CONFIRMED' } }), trusted());
    const total = d.match.conditions.reduce((n, c) => n + c.weight, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
    expect(d.match.score).toBe(Math.round(d.match.matched.reduce((n, c) => n + c.weight, 0)));
    expect(d.match.conditions.some((c) => c.id === 'icc_quality')).toBe(false); // derived, not evidence
  });
});

describe('Setup decision — analysis confidence (H)', () => {
  const observation = (confidence: number) =>
    parseIccObservation({
      htfBias: 'BULLISH',
      htfReason: 'HH/HL',
      indication: { status: 'CONFIRMED', direction: 'BULLISH', swingLevel: 4999, bodyClose: true, displacement: 'STRONG', reason: 'Body close' },
      correction: { status: 'CONFIRMED', zoneLow: 4998.5, zoneHigh: 5001, reason: 'Held' },
      continuation: { status: 'CONFIRMED', level: 5001, momentum: 'STRONG', reason: 'Closed above' },
      roomToTarget: 'CLEAR',
      levels: { entry: 5000, stop: null, tp1: 5005.5, tp2: null },
      overlay: {},
      nextCondition: '',
      confidence,
    })!;

  it('H. strong-looking chart reading at low confidence → WAIT / NEEDS_INPUT, LOW, never qualified', () => {
    const { decision: d } = runSetupCheck(client({ icc: {}, manual: [] }), trusted(icc, 'ES', { analysisMode: 'REAL', iccObservation: { data: observation(0.6), source: 'vision' } }));
    expect(['WAIT', 'NEEDS_INPUT']).toContain(d.status);
    expect(d.displayStatus).toBe('WAIT');
    expect(d.confidence.level).toBe('LOW');
    expect(d.confidence.notes.join(' ')).toMatch(/low-confidence/);
  });

  it('a missing stop level on the image is requested, not invented', () => {
    const { decision: d } = runSetupCheck(client({ icc: {}, manual: [], stop: null }), trusted(icc, 'ES', { analysisMode: 'REAL', iccObservation: { data: observation(0.95), source: 'vision' } }));
    expect(d.needsInput).toContain('Could not confidently identify the exact stop level from this image — enter it manually.');
    expect(d.status).not.toBe('QUALIFIED');
  });

  it('generic strategy: one mandatory rule read at low confidence → WAIT with a manual-confirm prompt', () => {
    const rules = rulesFromStrategy(orb).filter((r) => r.kind === 'visual');
    const vision: Evidence[] = rules.map((r, i) => ({ ruleId: r.id, status: 'PASS', source: 'vision', confidence: i === 0 ? 0.55 : 0.95, reason: 'seen' }));
    const { decision: d } = runSetupCheck(client({ strategyId: orb.id, icc: {}, manual: [], instrument: 'MES', stop: 4996, target: 5010, quantity: 2 }), trusted(orb, 'MES', { analysisMode: 'REAL', visionEvidence: vision }));
    expect(d.status).toBe('WAIT');
    expect(d.confidence).toMatchObject({ level: 'LOW', basis: 'chart' });
    expect(d.confidence.notes[0]).toBe(`Could not confidently confirm “${rules[0].label}” from this image — confirm it yourself.`);
  });

  it('demo readings are LOW confidence and never qualify', () => {
    const { decision: d } = runSetupCheck(client(), trusted(icc, 'ES', { analysisMode: 'DEMO' }));
    expect(d.status).not.toBe('QUALIFIED');
    expect(d.confidence.basis).toBe('demo');
  });
});

describe('Setup decision — prop-firm checks (I)', () => {
  it('I. live metrics unavailable → UNVERIFIED, never a fabricated PASS', () => {
    const { decision: d } = runSetupCheck(client({ accountId: 'a', firmConfirmations: FIRM }), trusted(icc, 'ES', { account: prop({ dailyLossLimit: null }) }));
    const row = (id: string) => d.prop.rows.find((r) => r.id === id)!;
    expect(row('position_size').status).toBe('PASS');
    expect(row('daily_loss')).toMatchObject({ status: 'UNVERIFIED', label: 'Daily loss limit' });
    expect(row('drawdown')).toMatchObject({ status: 'UNVERIFIED', label: 'Trailing drawdown' });
    expect(row('drawdown').reason).toMatch(/live P&L is not connected/);
    expect(row('live_state').status).toBe('UNVERIFIED');
    expect(d.status).not.toBe('QUALIFIED');
    expect(d.prop.rows.filter((r) => r.status === 'PASS').map((r) => r.id)).not.toContain('daily_loss');
  });

  it('confirmed live state + all firm checks → prop rows PASS and QUALIFIED', () => {
    const { decision: d } = runSetupCheck(client({ accountId: 'a', firmConfirmations: FIRM, liveAccountConfirmed: true }), trusted(icc, 'ES', { account: prop() }));
    expect(d.prop.rows.map((r) => [r.id, r.status])).toEqual([
      ['rules_current', 'PASS'],
      ['position_size', 'PASS'],
      ['daily_loss', 'PASS'],
      ['drawdown', 'PASS'],
      ['account_restrictions', 'PASS'],
      ['live_state', 'PASS'],
    ]);
    expect(d.status).toBe('QUALIFIED');
  });

  it('daily loss limit would be exceeded → BLOCKED with the prop rule', () => {
    const { decision: d } = runSetupCheck(client({ accountId: 'a', firmConfirmations: FIRM, liveAccountConfirmed: true }), trusted(icc, 'ES', { account: prop({ realizedPnlToday: -950 }) }));
    expect(d.status).toBe('BLOCKED');
    expect(d.blocking.map((b) => b.label)).toContain('Prop firm rule: Daily loss limit');
  });

  it('consistency rule is listed and stays UNVERIFIED until confirmed', () => {
    const { decision: d } = runSetupCheck(client({ accountId: 'a', firmConfirmations: FIRM, liveAccountConfirmed: true }), trusted(icc, 'ES', { account: prop({ consistencyPct: 40 }) }));
    expect(d.prop.rows.find((r) => r.id === 'consistency')!.status).toBe('UNVERIFIED');
  });
});

describe('Setup decision — risk uses each instrument’s own specification (L)', () => {
  it.each([
    ['ES', 5000, 4998, 5005, 2],
    ['MES', 5000, 4998, 5005, 3],
    ['NQ', 18000, 17990, 18030, 1],
    ['CL', 75, 74.8, 75.5, 2],
    ['GC', 2400, 2398, 2406, 1],
  ] as const)('%s', (instrument, entry, stop, target, quantity) => {
    const { decision: d } = runSetupCheck(client({ strategyId: orb.id, instrument, entry, stop, target, quantity, costs: 3, slippage: 2, icc: {}, manual: [] }), trusted(orb, instrument, { maxRisk: 1e6 }));
    const app = calculateTradeRisk({ instrument, direction: 'long', entry, stop, target, contracts: quantity });
    expect(d.risk.riskPerContract).toBeCloseTo(app.riskDollars! / quantity, 6);
    expect(d.risk.dollarRisk).toBeCloseTo(app.riskDollars! + 5, 6);
    expect(d.risk.reward).toBeCloseTo(app.rewardDollars! - 5, 6);
    expect(d.risk.pointRisk).toBeCloseTo(app.pointsRisk!, 6);
  });
});

describe('Setup alerts — event model', () => {
  const snap = (status: SetupSnapshot['status'], stage: string, over: Partial<SetupSnapshot> = {}): SetupSnapshot => ({ strategyId: 's', status, stage, matchScore: 60, assessed: true, ...over });
  const meta = { strategyName: 'ICC — Indication / Correction / Continuation', instrument: 'ES', source: 'delayed_data' as const, at: NOW };

  it('emits one event per lifecycle change, never repeats, and works for any data source', () => {
    const a = setupTransition(null, snap('WAIT', 'CORRECTION_IN_PROGRESS'), meta)!;
    expect(a).toMatchObject({ type: 'SETUP_PROGRESS', message: 'Your ICC setup is forming — correction detected.', source: 'delayed_data' });
    expect(setupTransition(snap('WAIT', 'CORRECTION_IN_PROGRESS'), snap('WAIT', 'CORRECTION_IN_PROGRESS'), meta)).toBeNull();
    expect(setupTransition(snap('WAIT', 'CORRECTION_IN_PROGRESS'), snap('WAIT', 'AWAITING_CONFIRMATION'), meta)!.message).toBe('Your setup is close — waiting for confirmation.');
    expect(setupTransition(snap('WAIT', 'AWAITING_CONFIRMATION'), snap('QUALIFIED', 'CONFIRMED'), meta)!.message).toBe('Your saved setup is now confirmed. Review risk before entry.');
    expect(setupTransition(snap('QUALIFIED', 'CONFIRMED'), snap('BLOCKED', 'CONFIRMED'), meta)!.type).toBe('RISK_BLOCKED');
    expect(setupTransition(snap('WAIT', 'AWAITING_CONFIRMATION'), snap('STAND_DOWN', 'INVALIDATED'), meta)!.type).toBe('SETUP_INVALIDATED');
  });

  it('nothing to alert when nothing was assessed or no setup was developing', () => {
    expect(setupTransition(null, snap('NEEDS_INPUT', 'NOT_ASSESSED', { assessed: false }), meta)).toBeNull();
    expect(setupTransition(null, snap('STAND_DOWN', 'INVALIDATED'), meta)).toBeNull();
  });
});
