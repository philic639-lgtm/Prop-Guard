import type { InstrumentSymbol } from '@/types/domain';

/**
 * Centralized contract specifications. Every dollar/point/tick conversion in
 * the app MUST go through this module — never hard-code multipliers in screens.
 */
export interface InstrumentSpec {
  symbol: InstrumentSymbol;
  name: string;
  exchange: 'CME';
  tickSize: number;
  tickValue: number;
  pointValue: number;
  /** Symbol of the micro contract for a mini, if any. */
  micro: InstrumentSymbol | null;
  /** Symbol of the mini contract for a micro, if any. */
  mini: InstrumentSymbol | null;
  /** How many of this contract equal one mini contract. */
  miniEquivalentRatio: number;
  priceDecimals: number;
}

export const INSTRUMENTS: Readonly<Record<InstrumentSymbol, InstrumentSpec>> = {
  ES: {
    symbol: 'ES',
    name: 'E-mini S&P 500',
    exchange: 'CME',
    tickSize: 0.25,
    tickValue: 12.5,
    pointValue: 50,
    micro: 'MES',
    mini: null,
    miniEquivalentRatio: 1,
    priceDecimals: 2,
  },
  MES: {
    symbol: 'MES',
    name: 'Micro E-mini S&P 500',
    exchange: 'CME',
    tickSize: 0.25,
    tickValue: 1.25,
    pointValue: 5,
    micro: null,
    mini: 'ES',
    miniEquivalentRatio: 10,
    priceDecimals: 2,
  },
  NQ: {
    symbol: 'NQ',
    name: 'E-mini Nasdaq-100',
    exchange: 'CME',
    tickSize: 0.25,
    tickValue: 5,
    pointValue: 20,
    micro: 'MNQ',
    mini: null,
    miniEquivalentRatio: 1,
    priceDecimals: 2,
  },
  MNQ: {
    symbol: 'MNQ',
    name: 'Micro E-mini Nasdaq-100',
    exchange: 'CME',
    tickSize: 0.25,
    tickValue: 0.5,
    pointValue: 2,
    micro: null,
    mini: 'NQ',
    miniEquivalentRatio: 10,
    priceDecimals: 2,
  },
};

export const INSTRUMENT_SYMBOLS = Object.keys(INSTRUMENTS) as InstrumentSymbol[];

export function isInstrumentSymbol(value: unknown): value is InstrumentSymbol {
  return typeof value === 'string' && value in INSTRUMENTS;
}

export function getInstrument(symbol: InstrumentSymbol): InstrumentSpec {
  const spec = INSTRUMENTS[symbol];
  if (!spec) throw new Error(`Unknown instrument: ${symbol}`);
  return spec;
}

/** Avoid float noise like 4.999999 when working with quarter-point prices. */
export function cleanNumber(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundToTick(symbol: InstrumentSymbol, price: number): number {
  const { tickSize } = getInstrument(symbol);
  return cleanNumber(Math.round(price / tickSize) * tickSize);
}

export function isOnTick(symbol: InstrumentSymbol, price: number): boolean {
  return Math.abs(roundToTick(symbol, price) - price) < 1e-9;
}

/** Absolute distance in points between two prices. */
export function pointsBetween(a: number, b: number): number {
  return cleanNumber(Math.abs(a - b));
}

export function pointsToTicks(symbol: InstrumentSymbol, points: number): number {
  return cleanNumber(points / getInstrument(symbol).tickSize);
}

export function pointsToDollars(symbol: InstrumentSymbol, points: number, contracts = 1): number {
  return cleanNumber(points * getInstrument(symbol).pointValue * contracts, 2);
}

export function ticksToDollars(symbol: InstrumentSymbol, ticks: number, contracts = 1): number {
  return cleanNumber(ticks * getInstrument(symbol).tickValue * contracts, 2);
}

/** Convert a contract count into mini-contract equivalents (e.g. 10 MES = 1 ES). */
export function toMiniEquivalent(symbol: InstrumentSymbol, contracts: number): number {
  return cleanNumber(contracts / getInstrument(symbol).miniEquivalentRatio);
}

export function formatPrice(symbol: InstrumentSymbol, price: number): string {
  return price.toFixed(getInstrument(symbol).priceDecimals);
}
