import {
  CATEGORY_ORDER,
  INSTRUMENT_CATALOG,
  type InstrumentCategory,
  type InstrumentSpec,
} from '@/data/instruments';
import type { InstrumentSymbol } from '@/types/domain';

export type { InstrumentCategory, InstrumentSpec } from '@/data/instruments';

/**
 * Centralized contract math. Every dollar/point/tick conversion in the app
 * MUST go through this module — never hard-code multipliers in screens.
 * Specs come from the catalog in `src/data/instruments.ts` plus any custom
 * instruments the trader defined (registered from preferences at runtime).
 */

/** Built-in catalog keyed by symbol. */
export const INSTRUMENTS: Readonly<Record<string, InstrumentSpec>> = Object.freeze(
  Object.fromEntries(INSTRUMENT_CATALOG.map((s) => [s.symbol, s])),
);

/** Built-in symbols, catalog order. */
export const INSTRUMENT_SYMBOLS: InstrumentSymbol[] = INSTRUMENT_CATALOG.map((s) => s.symbol);

let customs: ReadonlyMap<string, InstrumentSpec> = new Map();
const sources = new Map<string, readonly InstrumentSpec[]>();

/**
 * Register custom instruments from a source ("preferences" for saved ones,
 * "draft" for ones added during onboarding before they are saved).
 * Built-in symbols can never be overridden.
 */
export function setCustomInstruments(list: readonly InstrumentSpec[] | undefined | null, source = 'preferences'): void {
  const next = list ?? [];
  if (sources.get(source) === next) return;
  sources.set(source, next);
  const merged = new Map<string, InstrumentSpec>();
  for (const l of sources.values()) {
    for (const s of l) if (!INSTRUMENTS[s.symbol]) merged.set(s.symbol, { ...s, custom: true, category: 'custom' });
  }
  customs = merged;
}

export function findInstrument(symbol: string | null | undefined): InstrumentSpec | undefined {
  if (!symbol) return undefined;
  return INSTRUMENTS[symbol] ?? customs.get(symbol);
}

export function isInstrumentSymbol(value: unknown): value is InstrumentSymbol {
  return typeof value === 'string' && findInstrument(value) !== undefined;
}

export function getInstrument(symbol: InstrumentSymbol): InstrumentSpec {
  const spec = findInstrument(symbol);
  if (!spec) throw new Error(`Unknown instrument: ${symbol}`);
  return spec;
}

/** Built-in catalog followed by custom instruments. */
export function allInstruments(): InstrumentSpec[] {
  return [...INSTRUMENT_CATALOG, ...customs.values()];
}

/** Case-insensitive search by ticker or name. Ticker matches rank first. */
export function searchInstruments(query: string, list: InstrumentSpec[] = allInstruments()): InstrumentSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const rank = (s: InstrumentSpec) => {
    const sym = s.symbol.toLowerCase();
    if (sym === q) return 0;
    if (sym.startsWith(q)) return 1;
    if (s.name.toLowerCase().split(/[\s-]+/).some((w) => w.startsWith(q))) return 2;
    if (s.name.toLowerCase().includes(q) || s.category.includes(q)) return 3;
    return -1;
  };
  return list
    .map((s) => ({ s, r: rank(s) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.s);
}

export function groupByCategory(list: InstrumentSpec[]): { category: InstrumentCategory; items: InstrumentSpec[] }[] {
  return CATEGORY_ORDER.map((category) => ({ category, items: list.filter((s) => s.category === category) })).filter((g) => g.items.length > 0);
}

/**
 * Picker options with the trader's own instruments first, then everything else.
 * `sub` shows the contract name so tickers like 6J are understandable.
 */
export function instrumentOptions(preferred: readonly string[] = []): { value: InstrumentSymbol; label: string; sub: string }[] {
  const all = allInstruments();
  const mine = preferred.map((p) => all.find((s) => s.symbol === p)).filter((s): s is InstrumentSpec => !!s);
  const rest = all.filter((s) => !preferred.includes(s.symbol));
  return [...mine, ...rest].map((s) => ({ value: s.symbol, label: s.symbol, sub: `${s.name}${s.isMicro ? ' · micro' : ''}` }));
}

/** Avoid float noise. 10 decimals covers the finest tick in the catalog (6J = 0.0000005). */
export function cleanNumber(value: number, decimals = 10): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundToTick(symbol: InstrumentSymbol, price: number): number {
  const { tickSize } = getInstrument(symbol);
  return cleanNumber(Math.round(cleanNumber(price / tickSize, 6)) * tickSize);
}

export function isOnTick(symbol: InstrumentSymbol, price: number): boolean {
  return Math.abs(roundToTick(symbol, price) - price) < 1e-9;
}

/** Absolute distance in points between two prices. */
export function pointsBetween(a: number, b: number): number {
  return cleanNumber(Math.abs(a - b));
}

export function pointsToTicks(symbol: InstrumentSymbol, points: number): number {
  return cleanNumber(points / getInstrument(symbol).tickSize, 4);
}

export function pointsToDollars(symbol: InstrumentSymbol, points: number, contracts = 1): number {
  return cleanNumber(points * getInstrument(symbol).pointValue * contracts, 2);
}

export function ticksToDollars(symbol: InstrumentSymbol, ticks: number, contracts = 1): number {
  return cleanNumber(ticks * getInstrument(symbol).tickValue * contracts, 2);
}

/** Convert a contract count into standard-contract equivalents (e.g. 10 MES = 1 ES). */
export function toMiniEquivalent(symbol: InstrumentSymbol, contracts: number): number {
  return cleanNumber(contracts / getInstrument(symbol).miniEquivalentRatio, 6);
}

export function formatPrice(symbol: InstrumentSymbol, price: number): string {
  const spec = findInstrument(symbol);
  return price.toFixed(spec ? spec.priceDecimals : 2);
}

/** Short spec line for UI, e.g. "$50/pt · tick 0.25 = $12.50". */
export function specSummary(symbol: InstrumentSymbol): string {
  const s = getInstrument(symbol);
  const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  return `${money(s.pointValue)}/pt · tick ${s.tickSize} = ${money(s.tickValue)}`;
}
