import type { NormalizedBar, Timeframe } from './MarketDataProvider';
import { TIMEFRAME_MINUTES, toIso } from './MarketDataProvider';

/** Loosely-typed bar as it arrives from a provider before normalization. */
export interface RawBar {
  timestamp: string | number | Date;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume?: number | string | null;
  contractSymbol?: string | null;
}

export interface NormalizeMeta {
  instrument: string;
  timeframe: Timeframe;
  source: string;
  continuousSymbol?: string | null;
  /** Keep only bars with startTime <= timestamp < endTime. */
  startTime?: string | Date;
  endTime?: string | Date;
}

export interface NormalizeReport {
  bars: NormalizedBar[];
  rejected: number;
  duplicates: number;
}

/** Timestamps: ISO strings, epoch ms, or epoch nanoseconds (Databento style). */
export function parseTimestamp(v: string | number | Date): string | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
  if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    // ns (≥1e17) → ms; s (<1e11) → ms; otherwise ms.
    const ms = n >= 1e17 ? n / 1e6 : n < 1e11 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const d = new Date(String(v).trim());
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').trim()));

/**
 * Validate, coerce, de-duplicate (last wins) and sort bars. Invalid bars
 * (non-numeric, high < low, open/close outside the range) are rejected, never patched.
 */
export function normalizeBars(raw: readonly RawBar[], meta: NormalizeMeta): NormalizeReport {
  const start = meta.startTime ? Date.parse(toIso(meta.startTime)) : -Infinity;
  const end = meta.endTime ? Date.parse(toIso(meta.endTime)) : Infinity;
  const byTs = new Map<string, NormalizedBar>();
  let rejected = 0;
  let duplicates = 0;
  for (const r of raw) {
    const ts = parseTimestamp(r.timestamp);
    const o = num(r.open);
    const h = num(r.high);
    const l = num(r.low);
    const c = num(r.close);
    const vol = r.volume == null || r.volume === '' ? 0 : num(r.volume);
    const valid =
      ts != null &&
      [o, h, l, c, vol].every(Number.isFinite) &&
      h >= l &&
      o <= h && o >= l &&
      c <= h && c >= l &&
      vol >= 0 &&
      l > 0;
    if (!valid) {
      rejected++;
      continue;
    }
    const t = Date.parse(ts!);
    if (t < start || t >= end) continue;
    if (byTs.has(ts!)) duplicates++;
    byTs.set(ts!, {
      timestamp: ts!,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: vol,
      instrument: meta.instrument,
      timeframe: meta.timeframe,
      source: meta.source,
      contractSymbol: r.contractSymbol ?? null,
      continuousSymbol: meta.continuousSymbol ?? null,
    });
  }
  const bars = [...byTs.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { bars, rejected, duplicates };
}

/** Unique identity of a stored bar — the database enforces the same key. */
export const barKey = (b: Pick<NormalizedBar, 'instrument' | 'timeframe' | 'source' | 'timestamp'>) => `${b.instrument}|${b.timeframe}|${b.source}|${b.timestamp}`;

/**
 * Aggregate finer bars into a coarser timeframe (e.g. 1m → 5m). Buckets are
 * aligned to UTC multiples of the target length; missing minutes are allowed
 * (illiquid periods simply have fewer constituent bars).
 */
export function aggregateBars(bars: readonly NormalizedBar[], target: Timeframe): NormalizedBar[] {
  if (!bars.length) return [];
  const size = TIMEFRAME_MINUTES[target] * 60_000;
  if (TIMEFRAME_MINUTES[bars[0].timeframe] > TIMEFRAME_MINUTES[target]) throw new Error(`Cannot aggregate ${bars[0].timeframe} bars into ${target}`);
  if (bars[0].timeframe === target) return [...bars];
  const out: NormalizedBar[] = [];
  let cur: NormalizedBar | null = null;
  let curBucket = -1;
  for (const b of [...bars].sort((x, y) => x.timestamp.localeCompare(y.timestamp))) {
    const bucket = Math.floor(Date.parse(b.timestamp) / size) * size;
    if (!cur || bucket !== curBucket) {
      if (cur) out.push(cur);
      curBucket = bucket;
      cur = { ...b, timestamp: new Date(bucket).toISOString(), timeframe: target };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      cur.contractSymbol = b.contractSymbol ?? cur.contractSymbol;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Minimal CSV parser (quoted fields supported) → array of header-keyed records. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length);
  if (!lines.length) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}
