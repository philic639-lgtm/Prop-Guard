import { Platform } from 'react-native';

/**
 * Why a browser refused a request, when it says so. A page whose Content Security Policy does
 * not allow a host (e.g. a sandboxed preview frame) makes `fetch` fail with a bare
 * "Failed to fetch"; the browser reports the real reason only as a `securitypolicyviolation`
 * event. Recording those lets the app show the actual cause instead of a guess.
 */
export interface PolicyBlock {
  /** Origin the page tried to reach (no path, no query — never credentials). */
  blockedOrigin: string;
  /** The CSP directive that blocked it, e.g. "connect-src". */
  directive: string;
  at: string;
}

const blocks = new Map<string, PolicyBlock>();
let installed = false;

function originOf(uri: string): string | null {
  try {
    return new URL(uri).origin;
  } catch {
    return null;
  }
}

/** Start listening (web only; idempotent). */
export function watchPolicyBlocks(): void {
  if (installed || Platform.OS !== 'web' || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('securitypolicyviolation', (e) => {
    const origin = originOf(e.blockedURI);
    if (origin) blocks.set(origin, { blockedOrigin: origin, directive: e.effectiveDirective || e.violatedDirective, at: new Date().toISOString() });
  });
}

/** The latest recorded block for this host since `since` (ISO), if any. */
export function policyBlockFor(url: string, since?: string): PolicyBlock | null {
  const origin = originOf(url);
  const b = origin ? blocks.get(origin) : undefined;
  return b && (!since || b.at >= since) ? b : null;
}

/** Test hook. */
export function recordPolicyBlock(b: PolicyBlock): void {
  blocks.set(b.blockedOrigin, b);
}
