import { createDemoData, DEFAULT_TRADING_RULES } from '@/data/demo';
import { BUILT_IN_TEMPLATES } from '@/data/strategies/catalog';
import type { SetupForm } from '@/features/setupCheck/controller';
import { buildJournalSave } from '@/features/setupCheck/journalSave';
import { toSetupCheck } from '@/features/setupCheck/toSetupCheck';
import { strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { runSetupCheck, type ClientSetupInput, type IccManual } from '@/lib/engines/setupCheck';
import { localTrustedContext } from '@/services/setupCheck/localContext';
import { strategyRecordOf } from '@/services/setupCheck/strategyRecord';

const NOW = new Date('2026-10-06T15:00:00Z');
const strategy = strategyFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'icc')!);
const record = strategyRecordOf(strategy);
const account = { ...createDemoData(NOW).accounts[0], kind: 'personal' as const, rules: { ...createDemoData(NOW).accounts[0].rules, maxContracts: null } };
const FULL: IccManual = { htfBias: 'BULLISH', indication: 'CONFIRMED', displacement: 'STRONG', correction: 'CONFIRMED', continuation: 'CONFIRMED', momentum: 'STRONG', room: 'CLEAR' };

const form: SetupForm = {
  strategyId: strategy.id,
  accountId: account.id,
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
  notes: 'Waited for the 5m close.',
};

function analyse(icc: IccManual, over: Partial<SetupForm> = {}) {
  const f = { ...form, ...over };
  const client: ClientSetupInput = { ...f, strategyId: strategy.id, manual: [{ ruleId: 'icc_stop_structural', status: 'PASS' }], firmConfirmations: [], icc };
  const trusted = { ...localTrustedContext({ record, instrument: 'ES', account, trades: [], tradingRules: DEFAULT_TRADING_RULES, now: NOW }), visionEvidence: [], analysisMode: 'UNAVAILABLE' as const };
  const r = runSetupCheck(client, trusted);
  const check = toSetupCheck({ id: 'chk-1', now: NOW.toISOString(), evaluation: r.evaluation, evaluatedBy: 'device', form: f, strategyName: strategy.name, strategyVersion: strategy.updatedAt, analysisId: null, analysisKey: 'k', screenshotUri: 'file://chart.png', icc: r.icc });
  return { ...r, check };
}

describe('Setup Check → Journal', () => {
  it('J. saving a QUALIFIED result keeps the full analysis and adds a pending journal trade', () => {
    const { decision, check } = analyse(FULL);
    expect(decision.status).toBe('QUALIFIED');
    const { setupCheck, pendingTrade } = buildJournalSave({ check, decision, account, pendingId: 'p-1', now: NOW });
    expect(setupCheck).toMatchObject({
      kind: 'trade_plan',
      setupType: 'ICC — Confirmed',
      createdAt: NOW.toISOString(),
      instrument: 'ES',
      direction: 'long',
      strategyName: strategy.name,
      notes: 'Waited for the 5m close.',
      screenshotUri: 'file://chart.png',
      inputs: { entry: 5000, stop: 4998, target: 5005.5, target2: 5010, quantity: 1 },
      dollarRisk: 104.5,
    });
    const d = setupCheck.setupDecision!;
    expect(d.status).toBe('QUALIFIED');
    expect(d.match.score).toBe(100);
    expect(d.match.matched.length).toBeGreaterThan(0);
    expect(d.match.failed).toEqual([]);
    expect(d.match.pending).toEqual([]);
    expect(d.risk).toMatchObject({ dollarRisk: 104.5, contracts: 1 });
    expect(d.risk.reward).toBeCloseTo(270.5);
    expect(d.risk.rr).toBeCloseTo(270.5 / 104.5);
    expect(d.levels).toMatchObject({ entry: 5000, stop: 4998, tp1: 5005.5, tp2: 5010 });
    expect(Array.isArray(d.prop.rows)).toBe(true);
    // Pending (planned) journal trade — not executed until a result is added.
    expect(pendingTrade).toMatchObject({ id: 'p-1', origin: 'setup_check', status: 'pending', tradeId: null, setupCheckId: 'chk-1', accountId: account.id, strategyId: strategy.id, instrument: 'ES', direction: 'long', entry: 5000, stop: 4998, target: 5005.5, contracts: 1, setupScore: 100, notes: 'Waited for the 5m close.', screenshotUri: 'file://chart.png' });
    expect(pendingTrade!.rulesFollowed).toEqual(d.match.matched.map((c) => c.id));
  });

  it('K. saving a WAIT analysis creates a setup review — never a trade', () => {
    const { decision, check } = analyse({ htfBias: 'BULLISH', indication: 'CONFIRMED', correction: 'CONFIRMED' });
    expect(decision.status).toBe('WAIT');
    const { setupCheck, pendingTrade } = buildJournalSave({ check, decision, account, pendingId: 'p-2', now: NOW });
    expect(pendingTrade).toBeNull();
    expect(setupCheck.kind).toBe('setup_review');
    expect(setupCheck.setupType).toBe('ICC — Awaiting confirmation');
    expect(setupCheck.tradeId).toBeNull();
    expect(setupCheck.setupDecision!.match.pending.map((c) => c.id)).toContain('icc_continuation');
  });

  it('K2. STAND DOWN and BLOCKED analyses are setup reviews too', () => {
    const cases: [IccManual, Partial<SetupForm>, string][] = [
      [{ indication: 'NOT_PRESENT' }, {}, 'STAND_DOWN'],
      [FULL, { stop: 4995, target: 5020 }, 'BLOCKED'], // $254.50 risk > $150 max
    ];
    for (const [icc, over, status] of cases) {
      const { decision, check } = analyse(icc, over);
      expect(decision.status).toBe(status);
      expect(buildJournalSave({ check, decision, account, pendingId: 'x', now: NOW })).toMatchObject({ pendingTrade: null, setupCheck: { kind: 'setup_review' } });
    }
  });

  it('a QUALIFIED analysis without an account is saved, but no pending trade is invented', () => {
    const { decision, check } = analyse(FULL);
    expect(buildJournalSave({ check, decision, account: null, pendingId: 'x', now: NOW })).toMatchObject({ pendingTrade: null, setupCheck: { kind: 'trade_plan' } });
  });
});
