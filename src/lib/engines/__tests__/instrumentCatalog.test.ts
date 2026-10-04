import { INSTRUMENT_CATALOG, makeCustomInstrument, POPULAR_INSTRUMENTS } from '@/data/instruments';

import {
  findInstrument,
  getInstrument,
  groupByCategory,
  instrumentOptions,
  pointsToDollars,
  roundToTick,
  searchInstruments,
  setCustomInstruments,
  toMiniEquivalent,
} from '../instrumentEngine';
import { calculateTradeRisk, maxContractsForRisk } from '../riskEngine';
import { parseStrategyText } from '../strategyParser';

const REQUIRED = ['ES', 'MES', 'NQ', 'MNQ', 'YM', 'MYM', 'RTY', 'M2K', 'GC', 'MGC', 'SI', 'HG', 'CL', 'MCL', 'NG', 'ZB', 'ZN', '6E', '6B', '6J', 'BTC', 'MBT', 'ETH', 'MET'];

describe('instrument catalog', () => {
  afterEach(() => {
    setCustomInstruments([]);
    setCustomInstruments([], 'draft');
  });

  it('contains every required contract', () => {
    for (const s of REQUIRED) expect(findInstrument(s)).toBeDefined();
    for (const s of POPULAR_INSTRUMENTS) expect(findInstrument(s)).toBeDefined();
  });

  it('keeps tick value = tick size × point value for every contract', () => {
    for (const s of INSTRUMENT_CATALOG) expect(s.tickValue).toBeCloseTo(s.tickSize * s.pointValue, 8);
  });

  it('has correct CME point values', () => {
    const pv = (s: string) => getInstrument(s).pointValue;
    expect([pv('YM'), pv('MYM'), pv('RTY'), pv('M2K')]).toEqual([5, 0.5, 50, 5]);
    expect([pv('GC'), pv('MGC'), pv('SI'), pv('HG')]).toEqual([100, 10, 5000, 25000]);
    expect([pv('CL'), pv('MCL'), pv('NG')]).toEqual([1000, 100, 10000]);
    expect([pv('ZB'), pv('ZN')]).toEqual([1000, 1000]);
    expect([pv('6E'), pv('6B'), pv('6J')]).toEqual([125000, 62500, 12500000]);
    expect([pv('BTC'), pv('MBT'), pv('ETH'), pv('MET')]).toEqual([5, 0.1, 50, 0.1]);
  });

  it('links micros to their standard contracts', () => {
    for (const [micro, mini] of [['MES', 'ES'], ['MNQ', 'NQ'], ['MYM', 'YM'], ['M2K', 'RTY'], ['MGC', 'GC'], ['MCL', 'CL'], ['MBT', 'BTC'], ['MET', 'ETH']]) {
      expect(getInstrument(micro).isMicro).toBe(true);
      expect(getInstrument(micro).mini).toBe(mini);
      expect(getInstrument(mini).micro).toBe(micro);
      expect(getInstrument(mini).isMicro).toBe(false);
    }
    expect(toMiniEquivalent('MBT', 50)).toBe(1);
    expect(toMiniEquivalent('MCL', 10)).toBe(1);
  });

  it('prices risk correctly across asset classes', () => {
    // CL: 20 ticks ($0.20) × $1000/pt = $200
    expect(calculateTradeRisk({ instrument: 'CL', direction: 'long', entry: 78.5, stop: 78.3, target: 78.9, contracts: 1 }).riskDollars).toBe(200);
    // 6E: 20 ticks × $6.25 = $125
    expect(calculateTradeRisk({ instrument: '6E', direction: 'short', entry: 1.0850, stop: 1.0860, target: 1.0830, contracts: 1 }).riskDollars).toBe(125);
    // ZN: 8 ticks (1/64) × $15.625 = $125
    expect(calculateTradeRisk({ instrument: 'ZN', direction: 'long', entry: 110.5, stop: 110.375, target: 110.75, contracts: 1 }).riskDollars).toBe(125);
    // 6J tiny tick: 10 ticks × $6.25 = $62.50
    expect(calculateTradeRisk({ instrument: '6J', direction: 'long', entry: 0.0067, stop: 0.006695, target: 0.00671, contracts: 1 }).riskDollars).toBe(62.5);
    // GC: $5 move × $100 × 2 = $1000
    expect(pointsToDollars('GC', 5, 2)).toBe(1000);
    expect(maxContractsForRisk('MGC', 2000, 1995, 200)).toBe(4);
  });

  it('rounds to each contract tick', () => {
    expect(roundToTick('YM', 42010.4)).toBe(42010);
    expect(roundToTick('ZB', 118.04)).toBe(118.03125);
    expect(roundToTick('6J', 0.00670033)).toBe(0.0067005);
    expect(roundToTick('BTC', 64003)).toBe(64005);
  });

  it('searches by ticker or name, tickers first', () => {
    expect(searchInstruments('gold').map((s) => s.symbol)).toEqual(['GC', 'MGC']);
    expect(searchInstruments('mnq')[0].symbol).toBe('MNQ');
    expect(searchInstruments('crude').map((s) => s.symbol)).toEqual(['CL', 'MCL']);
    expect(searchInstruments('yen')[0].symbol).toBe('6J');
    expect(searchInstruments('zzzz')).toEqual([]);
  });

  it('groups by category in a stable order', () => {
    expect(groupByCategory(INSTRUMENT_CATALOG as never).map((g) => g.category)).toEqual(['indices', 'metals', 'energy', 'treasuries', 'currencies', 'crypto']);
  });

  it('registers custom instruments for all engines', () => {
    const custom = makeCustomInstrument({ symbol: 'ali', name: 'Aluminum', tickSize: 0.0005, tickValue: 12.5, isMicro: false });
    expect(custom.symbol).toBe('ALI');
    expect(custom.pointValue).toBe(25000);
    setCustomInstruments([custom]);
    expect(getInstrument('ALI').category).toBe('custom');
    expect(calculateTradeRisk({ instrument: 'ALI', direction: 'long', entry: 4.5, stop: 4.49, target: 4.52, contracts: 1 }).riskDollars).toBe(250);
    expect(instrumentOptions(['ALI'])[0].value).toBe('ALI');
    expect(parseStrategyText('I trade ALI breakouts').instrument).toBe('ALI');
  });

  it('merges custom instruments from separate sources', () => {
    setCustomInstruments([makeCustomInstrument({ symbol: 'ALI', name: 'Aluminum', tickSize: 0.0005, tickValue: 12.5, isMicro: false })]);
    setCustomInstruments([makeCustomInstrument({ symbol: 'ZC', name: 'Corn', tickSize: 0.25, tickValue: 12.5, isMicro: false })], 'draft');
    expect(findInstrument('ALI')).toBeDefined();
    expect(findInstrument('ZC')?.pointValue).toBe(50);
  });

  it('never lets a custom instrument override a built-in contract', () => {
    setCustomInstruments([makeCustomInstrument({ symbol: 'ES', name: 'Fake', tickSize: 1, tickValue: 1, isMicro: false })]);
    expect(getInstrument('ES').pointValue).toBe(50);
  });

  it('parses non-equity tickers from strategy text', () => {
    expect(parseStrategyText('I trade CL after 9:30').instrument).toBe('CL');
    expect(parseStrategyText('Micro gold MGC only').instrument).toBe('MGC');
    expect(parseStrategyText('6E London breakout').instrument).toBe('6E');
  });
});
