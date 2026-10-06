import { createDemoData } from '@/data/demo';
import type { RiskContext } from '@/lib/engines/setupValidation';
import { MockVisionProvider } from '@/services/setupCheck/MockVisionProvider';
import { RemoteVisionProvider } from '@/services/setupCheck/RemoteVisionProvider';
import { analyzeSetup, SetupCheckError, validateImage } from '@/services/setupCheck/SetupAnalysisService';
import type { VisionAnalysisProvider } from '@/services/setupCheck/VisionAnalysisProvider';

// 1×1 images (real file signatures).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const demo = createDemoData(new Date('2026-10-06T14:00:00Z'));
const ORB = demo.strategies[0];
const RISK: RiskContext = { maxRiskPerTrade: 300, requireStop: true, requireTarget: false, guard: { status: 'GO', headline: '', reasons: [], riskRemaining: 1000, tradesRemaining: 3, cooldownActive: false, drawdownBuffer: 2000 }, account: null };
const input = { instrument: 'ES', timeframe: '5m', direction: 'long' as const, entry: 5000, stop: 4996, target: 5008, contracts: 1, notes: '' };
const NOW = new Date('2026-10-06T14:15:00Z');

describe('Setup Check — image validation', () => {
  it('accepts real PNG / JPEG and rejects wrong types, mismatched signatures and oversize files', () => {
    expect(validateImage({ base64: PNG, mimeType: 'image/png' })).toMatchObject({ ok: true, mimeType: 'image/png' });
    expect(validateImage({ base64: JPEG, mimeType: 'image/jpeg' }).ok).toBe(true);
    expect(validateImage({ base64: PNG, mimeType: 'image/jpeg' })).toEqual({ ok: false, reason: 'corrupt' });
    expect(validateImage({ base64: PNG, mimeType: 'application/pdf' })).toEqual({ ok: false, reason: 'type' });
    expect(validateImage({ base64: btoa('<script>alert(1)</script>'), mimeType: 'image/png' }).ok).toBe(false);
    expect(validateImage({ base64: PNG.replace(/=+$/, '') + 'A'.repeat(6_000_000), mimeType: 'image/png' })).toEqual({ ok: false, reason: 'size' });
    expect(validateImage(null)).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('Setup Check — service', () => {
  it('error states: no strategy, no screenshot, invalid image, no checkable rules, not configured', async () => {
    const base = { input, risk: RISK, accountId: null, now: NOW, provider: new MockVisionProvider() };
    await expect(analyzeSetup({ ...base, strategy: null, image: { base64: PNG, mimeType: 'image/png', uri: null } })).rejects.toMatchObject({ code: 'no_strategy' });
    await expect(analyzeSetup({ ...base, strategy: ORB, image: null })).rejects.toMatchObject({ code: 'no_screenshot' });
    await expect(analyzeSetup({ ...base, strategy: ORB, image: { base64: PNG, mimeType: 'image/gif', uri: null } })).rejects.toMatchObject({ code: 'image_invalid' });
    const empty = { ...ORB, checklist: [], entryTrigger: '', confirmationRules: '', retestRules: '', invalidationRules: '', requiresBiasAlignment: false };
    await expect(analyzeSetup({ ...base, strategy: empty, image: { base64: PNG, mimeType: 'image/png', uri: null } })).rejects.toMatchObject({ code: 'no_rules' });
    await expect(analyzeSetup({ ...base, provider: null, strategy: ORB, image: { base64: PNG, mimeType: 'image/png', uri: null } })).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('mock analysis is clearly labelled and still decided by the app', async () => {
    const check = await analyzeSetup({ strategy: ORB, image: { base64: PNG, mimeType: 'image/png', uri: 'file://x.png' }, input, risk: RISK, accountId: null, now: NOW, provider: new MockVisionProvider() });
    expect(check.provider).toBe('mock');
    expect(check.summary).toMatch(/DEMO/);
    expect(check.criteria.filter((c) => c.kind === 'visual').every((c) => c.evidence.startsWith('[DEMO]'))).toBe(true);
    expect(['QUALIFIED', 'WAIT', 'STAND_DOWN']).toContain(check.decision);
    expect(check.saved).toBe(false);
    expect(check.screenshotUri).toBe('file://x.png');
  });

  it('malformed AI response → safe error (nothing guessed)', async () => {
    const bad: VisionAnalysisProvider = { id: 'remote', analyze: async () => ({ raw: 'I think this is a great setup!', model: 'm', provider: 'ai' }) };
    await expect(analyzeSetup({ strategy: ORB, image: { base64: PNG, mimeType: 'image/png', uri: null }, input, risk: RISK, accountId: null, now: NOW, provider: bad })).rejects.toBeInstanceOf(SetupCheckError);
    await expect(analyzeSetup({ strategy: ORB, image: { base64: PNG, mimeType: 'image/png', uri: null }, input, risk: RISK, accountId: null, now: new Date(NOW.getTime() + 60_000), provider: bad })).rejects.toMatchObject({ code: 'malformed', retry: true });
  });

  it('remote provider maps server errors to friendly codes and never needs a client-side key', async () => {
    const fake = (result: { data?: unknown; error?: unknown }) => ({ functions: { invoke: jest.fn(async () => result) } }) as never;
    const img = { base64: PNG, mimeType: 'image/png' };
    const req = { strategyName: 'x', strategyTimeframe: '', instrument: 'ES', timeframe: null, direction: 'long' as const, prices: { entry: null, stop: null, target: null }, notes: '', criteria: [] };
    const rate = new RemoteVisionProvider(fake({ error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ code: 'rate_limited' }) } } }));
    await expect(rate.analyze(img, req)).rejects.toMatchObject({ code: 'rate_limited' });
    const down = new RemoteVisionProvider(fake({ error: { message: 'Failed to fetch' } }));
    await expect(down.analyze(img, req)).rejects.toMatchObject({ code: 'network' });
    const ok = new RemoteVisionProvider(fake({ data: { result: { criteria: [] }, model: 'gpt-6-sol' } }));
    await expect(ok.analyze(img, req)).resolves.toMatchObject({ provider: 'ai', model: 'gpt-6-sol' });
    const junk = new RemoteVisionProvider(fake({ data: 'oops' }));
    await expect(junk.analyze(img, req)).rejects.toMatchObject({ code: 'malformed' });
  });
});
