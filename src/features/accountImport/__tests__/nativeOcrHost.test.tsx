/**
 * iOS / Android: the import screen's hidden WebView that runs the on-device reader.
 * react-native-webview is replaced by a recorder; the bridge is real.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { __resetBridge, hostAttached, request } from '@/services/accountImport/webview/bridge';
import { OCR_WEBVIEW_JS } from '@/services/accountImport/webview/bundle.generated';

import { NativeOcrHost } from '../NativeOcrHost';

type Props = { source: { html: string; baseUrl: string }; onMessage: (e: { nativeEvent: { data: string } }) => void; onShouldStartLoadWithRequest: (r: { url: string }) => boolean; onContentProcessDidTerminate: () => void };
const mockInstances: { props: Props; posted: string[] }[] = [];
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const WebView = React.forwardRef(function MockWebView(props: Props, ref: React.Ref<unknown>) {
    const [inst] = React.useState(() => ({ props, posted: [] as string[] }));
    inst.props = props;
    React.useEffect(() => {
      mockInstances.push(inst);
    }, [inst]);
    React.useImperativeHandle(ref, () => ({ postMessage: (m: string) => inst.posted.push(m) }));
    return null;
  });
  return { WebView };
});

describe('NativeOcrHost (hidden reader WebView)', () => {
  beforeEach(() => {
    __resetBridge();
    mockInstances.length = 0;
  });

  it('loads the bundled reader page on an https origin and attaches the bridge while mounted', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NativeOcrHost />);
    });
    expect(hostAttached()).toBe(true);
    const { props } = mockInstances[0];
    expect(props.source.baseUrl).toBe('https://propguard.local/');
    expect(props.source.html).toContain(OCR_WEBVIEW_JS.slice(0, 200));
    expect(props.source.html).not.toMatch(/<\/script[^>]*>[\s\S]*<\/script[^>]*>[\s\S]*<\/script/); // the bundle cannot close its own tag early
    // Never navigates away from its own page.
    expect(props.onShouldStartLoadWithRequest({ url: 'https://propguard.local/' })).toBe(true);
    expect(props.onShouldStartLoadWithRequest({ url: 'https://evil.example/' })).toBe(false);
    act(() => r.unmount());
    expect(hostAttached()).toBe(false);
  });

  it('round-trips a request through the WebView and recovers from a crashed page', async () => {
    act(() => {
      create(<NativeOcrHost />);
    });
    const web = () => mockInstances[mockInstances.length - 1];
    act(() => web().props.onMessage({ nativeEvent: { data: JSON.stringify({ ready: true }) } }));
    const p = request<{ ok: number }>('recognize', { image: { id: 'x', uri: 'data:image/jpeg;base64,AA' } }, { timeoutMs: 5000 });
    await new Promise((res) => setTimeout(res, 0));
    const sent = JSON.parse(web().posted[0]);
    expect(sent).toMatchObject({ op: 'recognize', image: { id: 'x' } });
    act(() => web().props.onMessage({ nativeEvent: { data: JSON.stringify({ id: sent.id, ok: true, result: { ok: 1 } }) } }));
    await expect(p).resolves.toEqual({ ok: 1 });

    // The OS killed the WebView process: reads in flight fail (retryable) and a fresh page is mounted.
    const q = request('recognize', {}, { timeoutMs: 5000 });
    await new Promise((res) => setTimeout(res, 0));
    const before = mockInstances.length;
    act(() => web().props.onContentProcessDidTerminate());
    await expect(q).rejects.toMatchObject({ code: 'load_failed' });
    expect(mockInstances.length).toBe(before + 1);
    expect(hostAttached()).toBe(true);
  });
});
