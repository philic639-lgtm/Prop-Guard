import type { SupabaseClient } from '@supabase/supabase-js';

import { readTradeScreenshot } from '../tradeScreenshotService';

const image = { base64: 'iVBORw0KGgo', mimeType: 'image/png' as const };
const reading = { kind: 'completed_trade', entryPrice: { value: 1 }, warnings: [], usable: true };

function fakeClient(opts: { session?: boolean; invoke?: () => Promise<{ data: unknown; error: unknown }> }) {
  const calls: unknown[] = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: opts.session === false ? null : { access_token: 't' } } }) },
    functions: {
      invoke: async (name: string, o: unknown) => {
        calls.push([name, o]);
        return opts.invoke ? opts.invoke() : { data: { reading }, error: null };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const httpError = (status: number, body: unknown) => ({ message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => body } });

describe('readTradeScreenshot (client)', () => {
  it('no server configured → unavailable, nothing sent', async () => {
    expect(await readTradeScreenshot(image, null)).toMatchObject({ status: 'unavailable' });
  });
  it('signed out → unavailable, nothing sent', async () => {
    const { client, calls } = fakeClient({ session: false });
    expect(await readTradeScreenshot(image, client)).toMatchObject({ status: 'unavailable', message: expect.stringMatching(/Sign in/) });
    expect(calls).toEqual([]);
  });
  it('sends only the image to the trade-screenshot function and returns the reading', async () => {
    const { client, calls } = fakeClient({});
    expect(await readTradeScreenshot(image, client)).toEqual({ status: 'ok', reading });
    expect(calls).toEqual([['trade-screenshot', { body: { image } }]]);
  });
  it.each([
    [429, { error: 'rate_limited' }, 'rate_limited', /Too many/],
    [503, { error: 'not_configured' }, 'not_configured', /not set up/],
    [415, { error: 'image_invalid' }, 'image_invalid', /PNG, JPG or WebP/],
    [401, { error: 'unauthorized' }, 'unauthorized', /Sign in again/],
    [502, { error: 'weird' }, 'provider_error', /unavailable/],
  ])('HTTP %i → %s', async (status, body, code, msg) => {
    const { client } = fakeClient({ invoke: async () => ({ data: null, error: httpError(status, body) }) });
    expect(await readTradeScreenshot(image, client)).toMatchObject({ status: 'error', code, message: expect.stringMatching(msg) });
  });
  it('network failure and malformed replies are errors, never a fake reading', async () => {
    const net = fakeClient({ invoke: async () => ({ data: null, error: { message: 'Failed to send a request to the Edge Function' } }) });
    expect(await readTradeScreenshot(image, net.client)).toMatchObject({ status: 'error', code: 'network' });
    const bad = fakeClient({ invoke: async () => ({ data: { reading: { kind: 'x' } }, error: null }) });
    expect(await readTradeScreenshot(image, bad.client)).toMatchObject({ status: 'error', code: 'invalid_response' });
  });
});
