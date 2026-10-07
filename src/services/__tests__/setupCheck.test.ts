import { readFileSync } from 'node:fs';

import { createDemoData } from '@/data/demo';
import { BUILT_IN_TEMPLATES } from '@/data/strategies/catalog';
import { strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { SetupCheckController, type ControllerDeps, type ProviderMode, type SetupForm } from '@/features/setupCheck/controller';
import { toSetupCheck } from '@/features/setupCheck/toSetupCheck';
import { evaluateSetup, type SetupEvaluation } from '@/lib/engines/setupCheck';
import { demoIccObservation, demoObservations } from '@/services/setupCheck/demoVision';
import { SetupCheckError } from '@/services/setupCheck/errors';
import { validateImage } from '@/services/setupCheck/imageValidation';
import { localTrustedContext } from '@/services/setupCheck/localContext';
import { remoteSetupClient, type RemoteSetupClient, type RemoteSetupResult } from '@/services/setupCheck/remoteSetupCheck';
import { strategyRecordOf } from '@/services/setupCheck/strategyRecord';

// 1×1 images (real file signatures).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const demo = createDemoData(new Date('2026-10-06T14:00:00Z'));
const ORB = demo.strategies[0];
const VWAP = demo.strategies[1];
const NOW = new Date('2026-10-06T14:15:00Z'); // 10:15 ET — inside the ORB entry window

const FORM: SetupForm = {
  strategyId: ORB.id,
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
  liveAccountConfirmed: false,
  timeframe: '5m',
  notes: '',
};
const shot = (hash: string) => ({ base64: PNG, mimeType: 'image/png', uri: `file://${hash}.png`, hash });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ICC = strategyFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'icc')!);

function deps(mode: ProviderMode, remote: RemoteSetupClient | null = null): ControllerDeps {
  const records = new Map([...demo.strategies, ICC].map((s) => [s.id, strategyRecordOf(s)]));
  return {
    mode,
    strategy: (id) => (id ? (records.get(id) ?? null) : null),
    trusted: (form, record, now) => localTrustedContext({ record, instrument: form.instrument, account: demo.accounts.find((a) => a.id === form.accountId) ?? null, trades: [], tradingRules: demo.tradingRules, now }),
    demoVision: demoObservations,
    demoIcc: demoIccObservation,
    remote,
    now: () => NOW,
  };
}

const confirmAll = (c: SetupCheckController) => {
  for (const r of c.view().rules.filter((x) => x.kind === 'visual')) c.setManual(r.id, 'PASS');
};

/** A server response; the evaluation is a real engine result so its shape is exact. */
function serverResult({ verdict, ...over }: Partial<RemoteSetupResult> & { verdict?: SetupEvaluation['decision'] } = {}): RemoteSetupResult {
  const evaluation = evaluateSetup({ rules: [], evidence: [], trade: { entry: 1, stop: 0, target: 2, quantity: 1, pointValue: 1, minimumRR: 1, maxRisk: 100 }, prop: { mode: 'none' }, analysisMode: 'REAL' } as never);
  return {
    analysisId: 7,
    analysisMode: 'REAL',
    visionError: null,
    key: 'k',
    strategyVersion: ORB.updatedAt,
    evaluatedAt: NOW.toISOString(),
    rules: [{ id: 'checklist_a', label: 'A', description: 'A', kind: 'visual', required: true, critical: false }],
    ...over,
    evaluation: { ...evaluation, decision: verdict ?? evaluation.decision },
  };
}

describe('Setup Check — image validation (screenshot upload)', () => {
  it('accepts real PNG / JPEG and rejects wrong types, mismatched signatures and oversize files', () => {
    expect(validateImage({ base64: PNG, mimeType: 'image/png' })).toMatchObject({ ok: true, mimeType: 'image/png' });
    expect(validateImage({ base64: JPEG, mimeType: 'image/jpeg' }).ok).toBe(true);
    expect(validateImage({ base64: PNG, mimeType: 'image/jpeg' })).toEqual({ ok: false, reason: 'corrupt' });
    expect(validateImage({ base64: PNG, mimeType: 'application/pdf' })).toEqual({ ok: false, reason: 'type' });
    expect(validateImage({ base64: btoa('<script>alert(1)</script>'), mimeType: 'image/png' }).ok).toBe(false);
    expect(validateImage({ base64: PNG.replace(/=+$/, '') + 'A'.repeat(14_000_000), mimeType: 'image/png' })).toEqual({ ok: false, reason: 'size' });
    expect(validateImage(null)).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('Setup Check controller — MANUAL (no chart provider configured)', () => {
  it('starts with nothing confirmed and waits; explicit confirmations of every rule can clear', () => {
    const c = new SetupCheckController(deps('MANUAL'), FORM);
    const v0 = c.view();
    expect(v0.analysisMode).toBe('UNAVAILABLE');
    expect(v0.evaluatedBy).toBe('device');
    expect(c.getState().manual).toEqual({}); // no default PASS
    expect(v0.evaluation!.decision).toBe('WAIT');
    expect(v0.evaluation!.evaluatedRules.filter((r) => r.source === 'manual' || r.status === 'UNVERIFIED').length).toBeGreaterThan(0);
    confirmAll(c);
    expect(c.view().evaluation!.decision).toBe('TAKE TRADE');
    // Saved record carries the engine numbers, not a grade.
    const saved = toSetupCheck({ id: 'x', now: NOW.toISOString(), evaluation: c.view().evaluation!, evaluatedBy: 'device', form: c.getState().form, strategyName: ORB.name, strategyVersion: ORB.updatedAt, analysisId: null, analysisKey: c.currentKey(), screenshotUri: null });
    expect(saved).toMatchObject({ decision: 'TAKE TRADE', ruleAlignmentScore: 100, analysisMode: 'UNAVAILABLE', evaluatedBy: 'device' });
  });

  it('analyze() does nothing without a provider and reports missing inputs', async () => {
    const c = new SetupCheckController(deps('MANUAL'), { ...FORM, strategyId: null });
    await c.analyze();
    expect(c.getState().analysisError?.code).toBe('no_strategy');
    c.setForm({ strategyId: ORB.id });
    await c.analyze();
    expect(c.getState().analysisError?.code).toBe('no_screenshot');
    c.setScreenshot(shot('a'));
    await c.analyze();
    expect(c.getState().analysis).toBeNull();
  });

  it('form edits: changing strategy / account / instrument resets confirmations; prices change the verdict immediately', () => {
    const c = new SetupCheckController(deps('MANUAL'), FORM);
    confirmAll(c);
    expect(c.view().evaluation!.decision).toBe('TAKE TRADE');
    c.setForm({ stop: 4990 }); // R:R drops below the strategy minimum
    expect(c.view().evaluation!.decision).not.toBe('TAKE TRADE');
    c.setForm({ stop: 4996 });
    expect(c.view().evaluation!.decision).toBe('TAKE TRADE');
    c.setForm({ instrument: 'ES' });
    expect(c.getState().manual).toEqual({});
    expect(c.view().evaluation!.decision).not.toBe('TAKE TRADE');
    confirmAll(c);
    c.setForm({ strategyId: VWAP.id });
    expect(c.getState().manual).toEqual({});
  });

  it('non-integer contract sizes never clear', () => {
    const c = new SetupCheckController(deps('MANUAL'), { ...FORM, quantity: 1.5 });
    confirmAll(c);
    expect(c.view().evaluation!.decision).not.toBe('TAKE TRADE');
  });
});

describe('Setup Check controller — React snapshot', () => {
  it('getSnapshot is stable between changes and carries a fresh view after each edit', () => {
    const c = new SetupCheckController(deps('MANUAL'), FORM);
    const s1 = c.getSnapshot();
    expect(c.getSnapshot()).toBe(s1); // no re-render loop
    const rule = s1.view.rules.find((r) => r.kind === 'visual')!;
    c.setManual(rule.id, 'PASS');
    const s2 = c.getSnapshot();
    expect(s2).not.toBe(s1);
    expect(s2.view.evaluation!.passedRequired).toBe(s1.view.evaluation!.passedRequired + 1);
  });
});

describe('Setup Check controller — DEMO', () => {
  it('demo observations are labelled, count for nothing, and can never clear', async () => {
    const c = new SetupCheckController(deps('DEMO'), FORM);
    c.setScreenshot(shot('demo-1'));
    await c.analyze();
    const v = c.view();
    expect(v.analysisMode).toBe('DEMO');
    expect(Object.values(v.chartEvidence).every((e) => e.source === 'demo' && /DEMO/.test(e.reason))).toBe(true);
    // Only the system rules (instrument, entry window) count — demo chart evidence adds zero.
    const baseline = new SetupCheckController(deps('MANUAL'), FORM).view().evaluation!;
    expect(v.evaluation!.ruleAlignmentScore).toBe(baseline.ruleAlignmentScore);
    expect(v.evaluation!.passedRequired).toBe(baseline.passedRequired);
    confirmAll(c);
    expect(c.view().evaluation!.decision).not.toBe('TAKE TRADE');
    expect(JSON.stringify(c.view().evaluation!.blockers)).toMatch(/demo/i);
  });

  it('screenshot upload: a different image invalidates the analysis and chart confirmations; the same image keeps them', async () => {
    const c = new SetupCheckController(deps('DEMO'), FORM);
    c.setScreenshot(shot('one'));
    await c.analyze();
    const key1 = c.currentKey();
    expect(c.getState().analysis?.key).toBe(key1);
    confirmAll(c);
    c.setScreenshot(shot('one'));
    expect(c.getState().analysis).not.toBeNull();
    expect(Object.keys(c.getState().manual).length).toBeGreaterThan(0);
    c.setScreenshot(shot('two'));
    expect(c.currentKey()).not.toBe(key1);
    expect(c.getState().analysis).toBeNull();
    expect(c.getState().manual).toEqual({});
  });

  it('entry / stop / target / size edits invalidate the old analysis', async () => {
    for (const patch of [{ entry: 5001 }, { stop: 4995 }, { target: 5012 }, { quantity: 3 }, { accountId: demo.accounts[0].id }, { side: 'SHORT' as const }]) {
      const c = new SetupCheckController(deps('DEMO'), FORM);
      c.setScreenshot(shot('p'));
      await c.analyze();
      expect(c.getState().analysis).not.toBeNull();
      c.setForm(patch);
      expect(c.getState().analysis).toBeNull();
    }
    // Notes / costs are not evidence inputs.
    const c = new SetupCheckController(deps('DEMO'), FORM);
    c.setScreenshot(shot('p'));
    await c.analyze();
    c.setForm({ notes: 'hi', costs: 3 });
    expect(c.getState().analysis).not.toBeNull();
  });
});

describe('Setup Check controller — REMOTE (configured provider)', () => {
  it('shows the server decision only; the device never computes one', async () => {
    const remote: RemoteSetupClient = { analyze: jest.fn(async () => serverResult({ verdict: 'WAIT' })), evaluate: jest.fn(async () => serverResult({ verdict: 'TAKE TRADE' })) };
    const c = new SetupCheckController(deps('REMOTE', remote), FORM);
    expect(c.view().evaluation).toBeNull();
    expect(c.view().evaluatedBy).toBeNull();
    c.setScreenshot(shot('r1'));
    await c.analyze();
    expect(remote.analyze).toHaveBeenCalledTimes(1);
    const sent = (remote.analyze as jest.Mock).mock.calls[0][0];
    // The client sends inputs + image only — never sources, verified prop rules or computed results.
    expect(sent.image).toEqual({ base64: PNG, mimeType: 'image/png' });
    expect(JSON.stringify(sent.input)).not.toMatch(/"source"|"verified"|"decision"|"pointValue"|"maxRisk"/);
    expect(c.view()).toMatchObject({ analysisMode: 'REAL', evaluatedBy: 'server', pending: false });
    expect(c.view().evaluation!.decision).toBe('WAIT');
    // Confirming a rule makes the shown result pending until the server re-evaluates.
    c.setManual('checklist_a', 'PASS');
    expect(c.view().pending).toBe(true);
    await c.refresh();
    expect(c.view().pending).toBe(false);
    expect(c.view().evaluation!.decision).toBe('TAKE TRADE');
    // Same inputs → no duplicate request.
    await c.refresh();
    expect(remote.evaluate).toHaveBeenCalledTimes(1);
  });

  it('a late analyze response for an older screenshot never overwrites the newer one', async () => {
    const first = deferred<RemoteSetupResult>();
    const second = deferred<RemoteSetupResult>();
    const analyze = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const c = new SetupCheckController(deps('REMOTE', { analyze, evaluate: jest.fn() }), FORM);
    c.setScreenshot(shot('old'));
    const p1 = c.analyze();
    c.setScreenshot(shot('new'));
    const p2 = c.analyze();
    second.resolve(serverResult({ analysisId: 2 }));
    await p2;
    first.resolve(serverResult({ analysisId: 1 }));
    await p1;
    expect(c.getState().analysis?.analysisId).toBe(2);
    expect(c.getState().server?.result.analysisId).toBe(2);
  });

  it('an analyze response arriving after a form edit is discarded', async () => {
    const d = deferred<RemoteSetupResult>();
    const c = new SetupCheckController(deps('REMOTE', { analyze: jest.fn(() => d.promise), evaluate: jest.fn() }), FORM);
    c.setScreenshot(shot('x'));
    const p = c.analyze();
    c.setForm({ entry: 5001 });
    d.resolve(serverResult());
    await p;
    expect(c.getState().analysis).toBeNull();
    expect(c.getState().server).toBeNull();
  });

  it('out-of-order evaluate responses: only the latest inputs win', async () => {
    const a = deferred<RemoteSetupResult>();
    const b = deferred<RemoteSetupResult>();
    const evaluate = jest.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const c = new SetupCheckController(deps('REMOTE', { analyze: jest.fn(), evaluate }), FORM);
    const p1 = c.refresh();
    c.setForm({ target: 5020 });
    const p2 = c.refresh();
    b.resolve(serverResult({ verdict: 'STAND DOWN' }));
    await p2;
    a.resolve(serverResult({ verdict: 'TAKE TRADE' }));
    await p1;
    expect(c.view().evaluation!.decision).toBe('STAND DOWN');
    expect(c.view().pending).toBe(false);
  });

  it('provider errors surface as friendly, retryable states', async () => {
    const c = new SetupCheckController(deps('REMOTE', { analyze: jest.fn(async () => Promise.reject(new SetupCheckError('rate_limited'))), evaluate: jest.fn() }), FORM);
    c.setScreenshot(shot('e'));
    await c.analyze();
    expect(c.getState().analysisError?.code).toBe('rate_limited');
    expect(c.getState().analyzing).toBe(false);
    expect(c.view().analysisMode).toBe('UNAVAILABLE');
  });
});

describe('Setup Check — remote client (server trust boundary)', () => {
  const fake = (result: { data?: unknown; error?: unknown }) => ({ functions: { invoke: jest.fn(async () => result) } });
  const input = new SetupCheckController(deps('REMOTE'), FORM).clientInput();

  it('calls the authenticated Edge Function with inputs and image bytes only', async () => {
    const sb = fake({ data: serverResult() });
    const r = await remoteSetupClient(sb as never).analyze({ input, image: { base64: PNG, mimeType: 'image/png' }, imageHash: 'h' });
    expect(r.analysisMode).toBe('REAL');
    expect(sb.functions.invoke).toHaveBeenCalledWith('setup-validation', { body: { action: 'analyze', input, image: { base64: PNG, mimeType: 'image/png' }, imageHash: 'h' } });
  });

  it('rejects malformed responses and maps server error codes', async () => {
    await expect(remoteSetupClient(fake({ data: { decision: 'GREAT SETUP' } }) as never).evaluate({ input, imageHash: null, analysisId: null })).rejects.toMatchObject({ code: 'malformed' });
    await expect(remoteSetupClient(fake({ data: serverResult({ analysisMode: 'DEMO' }) }) as never).evaluate({ input, imageHash: null, analysisId: null })).rejects.toMatchObject({ code: 'malformed' });
    const ctx = (code: string) => ({ message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ code }) } });
    for (const code of ['rate_limited', 'unauthorized', 'strategy_not_found', 'timeout', 'image_invalid'] as const) {
      await expect(remoteSetupClient(fake({ error: ctx(code) }) as never).evaluate({ input, imageHash: null, analysisId: null })).rejects.toMatchObject({ code });
    }
    await expect(remoteSetupClient(fake({ error: ctx('<script>') }) as never).evaluate({ input, imageHash: null, analysisId: null })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(remoteSetupClient(fake({ error: { message: 'Failed to fetch' } }) as never).evaluate({ input, imageHash: null, analysisId: null })).rejects.toMatchObject({ code: 'network' });
  });

  it('the server derives rules, sources, prop data and the decision itself', () => {
    const src = readFileSync('supabase/functions/setup-validation/index.ts', 'utf8');
    // Client input only ever passes through the shared parser; strategy/account are loaded for auth.uid().
    expect(src).toMatch(/parseClientInput\(/);
    expect(src).toMatch(/auth\.getUser/);
    expect(src).toMatch(/from\('strategies'\)/);
    expect(src).toMatch(/runSetupCheck\(/);
    // Keys come from function secrets and are never logged; no chart contents in logs.
    expect(src).toMatch(/Deno\.env\.get\('OPENAI_API_KEY'\)/);
    expect(src).not.toMatch(/console\.(log|info|debug)\([^)]*(image|base64|OPENAI_API_KEY|key)/i);
    // Nothing under src/ may reference the OpenAI key or the server-only vision module.
    expect(readFileSync('src/features/setupCheck/useSetupCheck.ts', 'utf8')).not.toMatch(/OPENAI|setupCheck\/vision/);
  });
});

describe('Setup Check controller — ICC strategy', () => {
  const ICC_FORM: SetupForm = { ...FORM, strategyId: ICC.id, timeframe: '5m', target2: 5020 };
  const FULL = { htfBias: 'BULLISH', indication: 'CONFIRMED', displacement: 'STRONG', correction: 'CONFIRMED', continuation: 'CONFIRMED', momentum: 'STRONG', room: 'CLEAR' } as const;
  const confirmIcc = (c: SetupCheckController) => {
    for (const [k, v] of Object.entries(FULL)) c.setIcc(k as keyof typeof FULL, v);
    c.setManual('icc_stop_structural', 'PASS');
  };

  it('MANUAL: explicit stage confirmations produce the ICC card and can qualify; nothing is pre-selected', () => {
    const c = new SetupCheckController(deps('MANUAL'), ICC_FORM);
    expect(c.getState().icc).toEqual({});
    expect(c.view().icc!.entryStatus).toBe('NO CLEAR ICC SETUP');
    expect(c.view().evaluation!.decision).toBe('WAIT');
    confirmIcc(c);
    expect(c.view().icc).toMatchObject({ entryStatus: 'VALID ICC LONG', scoreLabel: 'A+ ICC setup' });
    expect(c.view().evaluation!.decision).toBe('TAKE TRADE');
    expect(c.clientInput().icc).toEqual(FULL);
  });

  it('a new screenshot or strategy clears the stage confirmations', () => {
    const c = new SetupCheckController(deps('MANUAL'), ICC_FORM);
    c.setScreenshot(shot('a'));
    confirmIcc(c);
    c.setScreenshot(shot('b'));
    expect(c.getState().icc).toEqual({});
    confirmIcc(c);
    c.setForm({ strategyId: ORB.id });
    expect(c.getState().icc).toEqual({});
  });

  it('DEMO: the simulated ICC reading is shown (with overlay) but never counted', async () => {
    const c = new SetupCheckController(deps('DEMO'), ICC_FORM);
    c.setScreenshot(shot('demo-icc'));
    await c.analyze();
    const v = c.view();
    expect(v.icc!.observation).toMatchObject({ source: 'demo', counted: false });
    expect(Object.keys(v.icc!.observation!.data.overlay).length).toBeGreaterThan(0);
    expect(v.icc!.entryStatus).toBe('NO CLEAR ICC SETUP');
    confirmIcc(c);
    expect(c.view().evaluation!.decision).not.toBe('TAKE TRADE'); // demo mode can never clear
  });

  it('REMOTE: shows the server’s ICC card', async () => {
    const icc = { entryStatus: 'WAIT — CORRECTION DEVELOPING' } as never;
    const c = new SetupCheckController(deps('REMOTE', { analyze: jest.fn(async () => ({ ...serverResult(), icc })), evaluate: jest.fn() }), ICC_FORM);
    c.setScreenshot(shot('r'));
    await c.analyze();
    expect(c.view().icc).toBe(icc);
  });
});
