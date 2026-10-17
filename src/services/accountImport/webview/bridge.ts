import { MESSAGES, OcrError, type OcrErrorCode, type OcrProgress } from '../ocrShared';

/**
 * React Native side of the WebView reader (pure, no React): the mounted
 * `NativeOcrHost` attaches a `send` function and forwards every WebView message here;
 * `request` sends one operation and resolves with its result. Every request has an
 * overall timeout and fails with a typed `OcrError` — nothing hangs, nothing is guessed.
 */
type Send = (message: string) => void;
type Pending = { resolve: (v: unknown) => void; reject: (e: OcrError) => void; onProgress?: (p: OcrProgress) => void; timer: ReturnType<typeof setTimeout> };

const CODES = new Set<OcrErrorCode>(Object.keys(MESSAGES) as OcrErrorCode[]);
const err = (code: OcrErrorCode, detail: string | null = null) => new OcrError(code, MESSAGES[code], detail);

let send: Send | null = null;
let ready = false;
let waiters: (() => void)[] = [];
let seq = 0;
const pending = new Map<number, Pending>();

/** The host mounted its WebView (the page is loading). */
export function attachHost(fn: Send) {
  send = fn;
  ready = false;
}

/** The WebView went away (screen closed, page crashed): fail what is in flight. */
export function detachHost(fn?: Send) {
  if (fn && send !== fn) return;
  send = null;
  ready = false;
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err('load_failed', 'reader closed'));
    pending.delete(id);
  }
}

/** True while a host WebView is mounted (the import screen is open). */
export function hostAttached(): boolean {
  return send !== null;
}

/** Every message from the WebView page. */
export function onHostMessage(raw: string) {
  let m: { ready?: boolean; id?: number; progress?: OcrProgress; ok?: boolean; result?: unknown; code?: string; detail?: string | null };
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (m.ready) {
    ready = true;
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
    return;
  }
  const p = typeof m.id === 'number' ? pending.get(m.id) : undefined;
  if (!p) return;
  if (m.progress) {
    p.onProgress?.(m.progress);
    return;
  }
  clearTimeout(p.timer);
  pending.delete(m.id!);
  if (m.ok) p.resolve(m.result ?? null);
  else p.reject(err(CODES.has(m.code as OcrErrorCode) ? (m.code as OcrErrorCode) : 'read_failed', typeof m.detail === 'string' ? m.detail.slice(0, 160) : null));
}

function waitReady(ms: number): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      waiters = waiters.filter((f) => f !== done);
      reject(err('load_failed', send ? 'reader page did not start' : 'reader not open'));
    }, ms);
    const done = () => {
      clearTimeout(t);
      resolve();
    };
    waiters.push(done);
  });
}

/** Send one operation to the page; resolves with its result or rejects with a typed OcrError. */
export async function request<T>(op: 'prepare' | 'recognize' | 'redact' | 'dispose', payload: Record<string, unknown>, opts: { timeoutMs: number; readyMs?: number; onProgress?: (p: OcrProgress) => void }): Promise<T> {
  if (!send) throw err('load_failed', 'reader not open');
  await waitReady(opts.readyMs ?? 15_000);
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(err(op === 'recognize' ? 'read_timeout' : 'load_timeout', `no answer after ${Math.round(opts.timeoutMs / 1000)} s`));
    }, opts.timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: opts.onProgress, timer });
    try {
      send!(JSON.stringify({ id, op, ...payload }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err('read_failed', (e as Error).message));
    }
  });
}

/** Test hook. */
export function __resetBridge() {
  detachHost();
  waiters = [];
  seq = 0;
}
