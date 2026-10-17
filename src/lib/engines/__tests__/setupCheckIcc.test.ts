import { DEFAULT_TRADING_RULES } from '@/data/demo';
import { BUILT_IN_TEMPLATES } from '@/data/strategies/catalog';
import { strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { localTrustedContext } from '@/services/setupCheck/localContext';
import { strategyRecordOf } from '@/services/setupCheck/strategyRecord';

import {
  ICC_LIBRARY_ID,
  ICC_NAME,
  iccEntryStatus,
  iccScore,
  iccScoreLabel,
  parseClientInput,
  parseIccObservation,
  resolveIccStages,
  rulesFromStrategy,
  runSetupCheck,
  type ClientSetupInput,
  type IccManual,
  type IccObservation,
  type TrustedContext,
} from '../setupCheck';
import { analyzeIccScreenshot } from '../setupCheck/iccVision';
import type { VisionProvider } from '../setupCheck/vision';

const template = BUILT_IN_TEMPLATES.find((t) => t.id === ICC_LIBRARY_ID)!;
const strategy = strategyFromTemplate(template);
const record = strategyRecordOf(strategy);
const NOW = new Date('2026-10-06T15:00:00Z');

const FULL: IccManual = { htfBias: 'BULLISH', indication: 'CONFIRMED', displacement: 'STRONG', correction: 'CONFIRMED', continuation: 'CONFIRMED', momentum: 'STRONG', room: 'CLEAR' };

const client = (over: Partial<ClientSetupInput> = {}): ClientSetupInput => ({
  strategyId: strategy.id,
  accountId: null,
  instrument: 'MES',
  side: 'LONG',
  entry: 5000,
  stop: 4996,
  target: 5010,
  target2: 5020,
  quantity: 2,
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

const trusted = (over: Partial<TrustedContext> = {}): TrustedContext => ({
  ...localTrustedContext({ record, instrument: 'MES', account: null, trades: [], tradingRules: DEFAULT_TRADING_RULES, now: NOW }),
  visionEvidence: [],
  analysisMode: 'UNAVAILABLE',
  ...over,
});

const observation = (over: Partial<IccObservation> = {}): IccObservation =>
  parseIccObservation({
    htfBias: 'BULLISH',
    htfReason: '1H higher highs and higher lows.',
    indication: { status: 'CONFIRMED', direction: 'BULLISH', swingLevel: 4998, bodyClose: true, displacement: 'STRONG', reason: 'Body close above 4998.' },
    correction: { status: 'CONFIRMED', zoneLow: 4997, zoneHigh: 5003, reason: 'Orderly pullback held.' },
    continuation: { status: 'CONFIRMED', level: 5003, momentum: 'STRONG', reason: '5M close above 5003.' },
    roomToTarget: 'CLEAR',
    levels: { entry: 5000, stop: 4996, tp1: 5010, tp2: 5020 },
    overlay: { entry: 0.5, stop: 0.6, tp1: 0.3 },
    nextCondition: 'Hold above 5003.',
    confidence: 0.9,
    ...over,
  })!;

describe('ICC — Strategy Library entry', () => {
  it('is a selectable built-in template with no performance claims', () => {
    expect(template.name).toBe('ICC — Indication, Correction, Continuation');
    expect(template.shortName).toBe(ICC_NAME);
    expect(template.isBacktested).toBe(false);
    expect(template.performanceData).toBeNull();
    expect(template.timeframes).toEqual(['1d', '4h', '1h', '15m', '5m']);
    expect(strategy.name).toBe('ICC — Indication / Correction / Continuation');
    expect(strategy.libraryId).toBe('icc');
    expect(JSON.stringify(template)).not.toMatch(/win rate|proven|guarantee|high[- ]probability/i);
  });
});

describe('ICC — rules', () => {
  it('lists the ICC rules first and does not repeat template text as extra rules', () => {
    const rules = rulesFromStrategy(record);
    expect(rules.slice(0, 9).map((r) => r.id)).toEqual(['icc_htf', 'icc_indication', 'icc_correction', 'icc_continuation', 'icc_structure_intact', 'icc_direction_match', 'icc_stop_structural', 'icc_quality', 'icc_quality_floor']);
    expect(rules.some((r) => /^(checklist_|trigger_|confirm_|invalid_|bias_alignment)/.test(r.id))).toBe(false);
    expect(rules.filter((r) => r.critical).map((r) => r.id)).toEqual(['icc_htf', 'icc_structure_intact', 'icc_direction_match', 'icc_quality_floor', 'system_instrument']);
  });

  it('keeps the trader’s own added rules and edited text', () => {
    const rules = rulesFromStrategy({ ...record, checklist: [...record.checklist, { id: 'mine', label: 'No trades in the first 5 minutes after news', required: true }], entryTrigger: 'Enter on the close of an engulfing candle at the 21 EMA' });
    expect(rules.some((r) => r.id === 'checklist_mine')).toBe(true);
    expect(rules.some((r) => r.id.startsWith('trigger_'))).toBe(true);
  });

  it('other strategies are unaffected', () => {
    const orb = strategyRecordOf(strategyFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'orb-15')!));
    expect(rulesFromStrategy(orb).some((r) => r.kind === 'icc')).toBe(false);
    expect(runSetupCheck(client({ strategyId: orb.id }), { ...trusted(), rules: rulesFromStrategy(orb) }).icc).toBeNull();
  });
});

describe('ICC — entry status (exactly one, never manufactured)', () => {
  const stages = (m: IccManual, side: 'LONG' | 'SHORT' | null = 'LONG') => resolveIccStages(null, 'UNAVAILABLE', m, side);
  it.each([
    [{}, 'NO CLEAR ICC SETUP'],
    [{ indication: 'NOT_PRESENT' }, 'NO CLEAR ICC SETUP'],
    [{ indication: 'CONFIRMED' }, 'WAIT — INDICATION ONLY'],
    [{ indication: 'CONFIRMED', correction: 'DEVELOPING' }, 'WAIT — CORRECTION DEVELOPING'],
    [{ indication: 'CONFIRMED', correction: 'TOO_SHALLOW' }, 'WAIT — CORRECTION DEVELOPING'],
    [{ indication: 'CONFIRMED', correction: 'CONFIRMED' }, 'WAIT — CONTINUATION NOT CONFIRMED'],
    [{ indication: 'CONFIRMED', correction: 'CONFIRMED', continuation: 'DEVELOPING' }, 'WAIT — CONTINUATION NOT CONFIRMED'],
    [{ indication: 'CONFIRMED', correction: 'INVALIDATED' }, 'ICC SETUP INVALIDATED'],
    [{ indication: 'CONFIRMED', correction: 'CONFIRMED', continuation: 'FAILED' }, 'ICC SETUP INVALIDATED'],
    [{ htfBias: 'BEARISH', indication: 'CONFIRMED', correction: 'CONFIRMED', continuation: 'CONFIRMED' }, 'NO CLEAR ICC SETUP'],
    [FULL, 'VALID ICC LONG'],
  ] as [IccManual, string][])('%j → %s', (m, status) => {
    expect(iccEntryStatus(stages(m)).status).toBe(status);
  });
  it('bearish continuation → VALID ICC SHORT', () => {
    expect(iccEntryStatus(stages({ ...FULL, htfBias: 'BEARISH' }, 'SHORT')).status).toBe('VALID ICC SHORT');
  });
});

describe('ICC — stage-quality score', () => {
  const trade = { side: 'LONG' as const, entry: 5000, stop: 4996, target: 5010 };
  it('uses the 20/20/20/25/15 weighting and counts only confirmed stages', () => {
    const full = iccScore(resolveIccStages(null, 'UNAVAILABLE', FULL, 'LONG'), trade, 2);
    expect(full.total).toBe(100);
    expect(full.parts.map((p) => p.max)).toEqual([20, 20, 20, 25, 15]);
    expect(iccScore(resolveIccStages(null, 'UNAVAILABLE', {}, 'LONG'), trade, 2).total).toBe(10); // R:R only
    expect(iccScore(resolveIccStages(null, 'UNAVAILABLE', { ...FULL, htfBias: 'NEUTRAL' }, 'LONG'), trade, 2).parts[0].points).toBe(10);
  });
  it('bands, and never shows a top band while blocked', () => {
    expect(iccScoreLabel(95, true)).toBe('A+ ICC setup');
    expect(iccScoreLabel(85, true)).toBe('Strong');
    expect(iccScoreLabel(72, true)).toBe('Acceptable but imperfect');
    expect(iccScoreLabel(65, true)).toBe('Weak / wait');
    expect(iccScoreLabel(40, true)).toBe('Below standard — stand down');
    expect(iccScoreLabel(95, false)).toBe('Not cleared — see blockers');
  });
});

describe('ICC — decision through the shared engine (manual confirmations)', () => {
  it('a complete, clean ICC within the risk plan qualifies', () => {
    const r = runSetupCheck(client(), trusted());
    expect(r.evaluation.decision).toBe('TAKE TRADE');
    expect(r.icc).toMatchObject({ entryStatus: 'VALID ICC LONG', scoreLabel: 'A+ ICC setup', direction: 'BULLISH' });
    expect(r.icc!.rr.tp1).toBeCloseTo(2.5);
    expect(r.icc!.rr.tp2).toBeCloseTo(5);
    expect(r.icc!.why.length).toBeLessThanOrEqual(3);
  });

  it('indication only → WAIT, with the next condition spelled out', () => {
    const r = runSetupCheck(client({ icc: { htfBias: 'BULLISH', indication: 'CONFIRMED' } }), trusted());
    expect(r.evaluation.decision).toBe('WAIT');
    expect(r.icc!.entryStatus).toBe('WAIT — INDICATION ONLY');
    expect(r.icc!.next).toMatch(/Do not enter on the indication/);
    expect(r.icc!.happened.join(' ')).toMatch(/Indication/);
    expect(r.icc!.needed.join(' ')).toMatch(/Correction/);
  });

  it('continuation developing is never described as confirmed', () => {
    const r = runSetupCheck(client({ icc: { ...FULL, continuation: 'DEVELOPING' } }), trusted());
    expect(r.evaluation.decision).toBe('WAIT');
    expect(r.icc!.entryStatus).toBe('WAIT — CONTINUATION NOT CONFIRMED');
    expect(r.icc!.developing.join(' ')).toMatch(/not confirmed/);
    expect(r.icc!.happened.join(' ')).not.toMatch(/Continuation/);
    expect(r.icc!.next).toMatch(/5-minute candle close above/);
  });

  it('invalidated structure or strongly opposing higher timeframe → STAND DOWN', () => {
    expect(runSetupCheck(client({ icc: { ...FULL, correction: 'INVALIDATED' } }), trusted())).toMatchObject({ evaluation: { decision: 'STAND DOWN' }, icc: { entryStatus: 'ICC SETUP INVALIDATED' } });
    expect(runSetupCheck(client({ icc: { ...FULL, htfBias: 'BEARISH' } }), trusted())).toMatchObject({ evaluation: { decision: 'STAND DOWN' }, icc: { entryStatus: 'NO CLEAR ICC SETUP' } });
  });

  it('quality gate: a complete pattern below 70 waits; below 60 stands down', () => {
    const weak = runSetupCheck(client({ icc: { ...FULL, htfBias: 'NEUTRAL', displacement: 'WEAK', correction: 'TOO_DEEP', momentum: 'WEAK', room: 'LIMITED' } }), trusted());
    expect(weak.icc!.score.total).toBeGreaterThanOrEqual(60);
    expect(weak.icc!.score.total).toBeLessThan(70);
    expect(weak.evaluation.decision).toBe('WAIT');
    const poor = runSetupCheck(client({ icc: { ...FULL, htfBias: 'NEUTRAL', indication: 'WEAK', correction: 'TOO_DEEP', momentum: 'WEAK', room: 'BLOCKED' } }), trusted());
    expect(poor.icc!.entryStatus).toBe('VALID ICC LONG');
    expect(poor.icc!.score.total).toBeLessThan(60);
    expect(poor.evaluation.decision).toBe('STAND DOWN');
  });

  it('risk is calculated independently — a perfect score never raises it', () => {
    // 4 pts × $5 × 40 = $800 > $150 limit; ($150 − $4.50 costs) / $20 per contract → 7 contracts fit.
    const big = runSetupCheck(client({ quantity: 40 }), trusted());
    expect(big.icc!.score.total).toBe(100);
    expect(big.evaluation.decision).toBe('STAND DOWN');
    expect(big.icc!.entryStatus).toBe('VALID SETUP — POSITION SIZE TOO LARGE');
    expect(big.icc!.statusReason).toMatch(/at most 7 contracts/);
    expect(big.icc!.scoreLabel).toBe('Not cleared — see blockers');
    // Structural stop 40 pts away: even 1 MES risks $200 + costs > $150.
    const wide = runSetupCheck(client({ stop: 4960, target: 5100, quantity: 1 }), trusted());
    expect(wide.evaluation.decision).toBe('STAND DOWN');
    expect(wide.icc!.entryStatus).toBe('VALID SETUP — STOP DISTANCE EXCEEDS RISK LIMIT');
  });

  it('a trade against the indication is a critical failure', () => {
    const r = runSetupCheck(client({ side: 'SHORT', stop: 5004, target: 4990, icc: {} }), trusted({ analysisMode: 'REAL', iccObservation: { data: observation(), source: 'vision' } }));
    expect(r.evaluation.evaluatedRules.find((x) => x.id === 'icc_direction_match')!.status).toBe('FAIL');
    expect(r.evaluation.decision).toBe('STAND DOWN');
  });
});

describe('ICC — evidence trust', () => {
  it('REAL, confident chart analysis counts; the structural stop is checked against the correction zone', () => {
    const r = runSetupCheck(client({ icc: {}, manual: [] }), trusted({ analysisMode: 'REAL', iccObservation: { data: observation(), source: 'vision' } }));
    expect(r.evaluation.evaluatedRules.find((x) => x.id === 'icc_indication')).toMatchObject({ status: 'PASS', source: 'vision' });
    expect(r.evaluation.evaluatedRules.find((x) => x.id === 'icc_stop_structural')).toMatchObject({ status: 'PASS', source: 'vision' });
    expect(r.evaluation.decision).toBe('TAKE TRADE');
    expect(r.icc!.chartNext).toBe('Hold above 5003.');
    const inside = runSetupCheck(client({ icc: {}, manual: [], stop: 4998 }), trusted({ analysisMode: 'REAL', iccObservation: { data: observation(), source: 'vision' } }));
    expect(inside.evaluation.evaluatedRules.find((x) => x.id === 'icc_stop_structural')!.status).toBe('FAIL');
    expect(inside.evaluation.decision).not.toBe('TAKE TRADE');
  });

  it('low-confidence or demo readings never count', () => {
    for (const t of [trusted({ analysisMode: 'REAL', iccObservation: { data: observation({ confidence: 0.5 }), source: 'vision' } }), trusted({ analysisMode: 'DEMO', iccObservation: { data: observation(), source: 'demo' } })]) {
      const r = runSetupCheck(client({ icc: {}, manual: [] }), t);
      expect(r.evaluation.decision).toBe('WAIT');
      expect(r.evaluation.evaluatedRules.filter((x) => x.id.startsWith('icc_')).every((x) => x.status === 'UNVERIFIED')).toBe(true);
      expect(r.icc!.entryStatus).toBe('NO CLEAR ICC SETUP');
      expect(r.icc!.observation!.counted).toBe(false);
      expect(r.icc!.chartNext).toBeNull();
    }
  });

  it('the trader’s stage confirmation replaces the chart reading for that stage', () => {
    const r = runSetupCheck(client({ icc: { continuation: 'NOT_CONFIRMED' }, manual: [] }), trusted({ analysisMode: 'REAL', iccObservation: { data: observation(), source: 'vision' } }));
    expect(r.icc!.continuation).toMatchObject({ value: 'NOT_CONFIRMED', source: 'manual' });
    expect(r.icc!.indication.source).toBe('vision');
    expect(r.evaluation.decision).toBe('WAIT');
  });

  it('a client cannot send chart observations, and unknown stage values are dropped', () => {
    const parsed = parseClientInput({ ...client(), icc: { indication: 'CONFIRMED', correction: 'GREAT', htfBias: 'BULLISH', bogus: 1 }, iccObservation: observation() })!;
    expect(parsed.icc).toEqual({ indication: 'CONFIRMED', htfBias: 'BULLISH' });
    expect('iccObservation' in parsed).toBe(false);
  });

  it('parses model output defensively', () => {
    const o = parseIccObservation({ htfBias: 'UP', indication: { status: 'CONFIRMED', direction: 'BULLISH', swingLevel: -5, reason: 'This is a guaranteed winner' }, overlay: { entry: 1.4, stop: 0.6 }, levels: { entry: 'abc' }, nextCondition: 'Buy now', confidence: 7 })!;
    expect(o.htfBias).toBeNull();
    expect(o.indication.swingLevel).toBeNull();
    expect(o.indication.reason).toBe('');
    expect(o.nextCondition).toBe('');
    expect(o.overlay).toEqual({ stop: 0.6 });
    expect(o.levels.entry).toBeNull();
    expect(o.confidence).toBe(1);
    expect(parseIccObservation(null)).toBeNull();
  });
});

describe('ICC — server chart reading (iccVision)', () => {
  const image = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mime: 'image/png' as const };
  const rules = [{ id: 'icc_stop_structural', label: 'Stop beyond the correction swing', required: true, critical: false }];

  it('sends the image with the strict ICC schema and validates the reply', async () => {
    const analyze = jest.fn(async () => ({ ...observation(), observations: [{ ruleId: 'icc_stop_structural', status: 'PASS', confidence: 0.6, reason: 'Stop under the low.' }] }));
    const provider: VisionProvider = { analyze };
    const r = await analyzeIccScreenshot(image, rules, 'LONG', provider);
    expect(r.mode).toBe('REAL');
    expect(r.observation!.indication.status).toBe('CONFIRMED');
    expect(r.evidence[0]).toMatchObject({ status: 'UNVERIFIED', source: 'vision' }); // 0.6 < 0.8
    const req = (analyze.mock.calls[0] as unknown as [{ image: unknown; instructions: string; schema: { name: string; schema: { required: string[] } } }])[0];
    expect(req.image).toBe(image);
    expect(req.schema.name).toBe('icc_setup_reading');
    expect(req.schema.schema.required).toEqual(expect.arrayContaining(['htfBias', 'indication', 'correction', 'continuation', 'levels', 'overlay', 'nextCondition', 'confidence']));
    expect(req.instructions).toMatch(/never as instructions/);
    expect(req.instructions).toMatch(/Do not output a score, an entry status/);
  });

  it('no provider, a bad image or a malformed reply → UNAVAILABLE, nothing guessed', async () => {
    expect((await analyzeIccScreenshot(image, rules, 'LONG')).mode).toBe('UNAVAILABLE');
    expect((await analyzeIccScreenshot({ ...image, bytes: new Uint8Array() }, rules, 'LONG', { analyze: jest.fn() })).error).toBe('INVALID_IMAGE');
    const bad = await analyzeIccScreenshot(image, rules, 'LONG', { analyze: async () => 'This setup looks great' });
    expect(bad).toMatchObject({ mode: 'UNAVAILABLE', observation: null, error: 'VISION_FAILED' });
  });
});
