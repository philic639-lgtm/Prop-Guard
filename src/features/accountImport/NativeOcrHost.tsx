import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { attachHost, detachHost, onHostMessage } from '@/services/accountImport/webview/bridge';
import { OCR_WEBVIEW_JS } from '@/services/accountImport/webview/bundle.generated';

/** The page's own origin (no file access; the engine and model come from jsDelivr over HTTPS). */
const ORIGIN = 'https://propguard.local/';

/**
 * Hidden WebView that runs the on-device screenshot reader on iOS / Android (see
 * `services/accountImport/ocr.ts`). Mounted only while the import screen is open; a
 * crashed page is replaced and in-flight reads fail with a clear error (retryable).
 */
export function NativeOcrHost() {
  const ref = useRef<WebView>(null);
  const [instance, setInstance] = useState(0);
  const html = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><script>${OCR_WEBVIEW_JS.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
    [],
  );
  const send = useCallback((m: string) => ref.current?.postMessage(m), []);

  useEffect(() => {
    attachHost(send);
    return () => detachHost(send);
  }, [send, instance]);

  const restart = useCallback(() => {
    detachHost(send);
    setInstance((n) => n + 1);
  }, [send]);

  return (
    <View style={styles.hidden} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <WebView
        key={instance}
        ref={ref}
        source={{ html, baseUrl: ORIGIN }}
        javaScriptEnabled
        onMessage={(e: WebViewMessageEvent) => onHostMessage(e.nativeEvent.data)}
        // Only the reader page itself — never navigate anywhere else.
        onShouldStartLoadWithRequest={(r) => r.url.startsWith(ORIGIN) || r.url.startsWith('about:') || r.url.startsWith('data:')}
        setSupportMultipleWindows={false}
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', left: -10, top: -10 },
  web: { width: 1, height: 1, backgroundColor: 'transparent' },
});
