import {
  INSTRUMENTS,
  getInstrument,
  isOnTick,
  pointsBetween,
  pointsToDollars,
  pointsToTicks,
  roundToTick,
  ticksToDollars,
  toMiniEquivalent,
} from '../instrumentEngine';

describe('instrumentEngine', () => {
  it('has correct CME contract multipliers', () => {
    expect(INSTRUMENTS.ES.pointValue).toBe(50);
    expect(INSTRUMENTS.MES.pointValue).toBe(5);
    expect(INSTRUMENTS.NQ.pointValue).toBe(20);
    expect(INSTRUMENTS.MNQ.pointValue).toBe(2);
  });

  it('keeps tick value = tick size × point value for every instrument', () => {
    for (const spec of Object.values(INSTRUMENTS)) {
      expect(spec.tickValue).toBeCloseTo(spec.tickSize * spec.pointValue, 10);
    }
  });

  it('links minis and micros both ways', () => {
    expect(getInstrument('ES').micro).toBe('MES');
    expect(getInstrument('MES').mini).toBe('ES');
    expect(getInstrument('NQ').micro).toBe('MNQ');
    expect(getInstrument('MNQ').mini).toBe('NQ');
  });

  it('converts points to dollars', () => {
    expect(pointsToDollars('ES', 5, 1)).toBe(250);
    expect(pointsToDollars('MES', 5, 5)).toBe(125);
    expect(pointsToDollars('NQ', 10, 2)).toBe(400);
    expect(pointsToDollars('MNQ', 12.5, 3)).toBe(75);
  });

  it('converts ticks', () => {
    expect(pointsToTicks('ES', 5)).toBe(20);
    expect(ticksToDollars('ES', 4, 1)).toBe(50);
    expect(ticksToDollars('MNQ', 4, 1)).toBe(2);
  });

  it('rounds to the nearest tick', () => {
    expect(roundToTick('ES', 6042.3)).toBe(6042.25);
    expect(roundToTick('ES', 6042.4)).toBe(6042.5);
    expect(isOnTick('NQ', 21000.75)).toBe(true);
    expect(isOnTick('NQ', 21000.1)).toBe(false);
  });

  it('avoids floating point noise', () => {
    expect(pointsBetween(6042.25, 6037.25)).toBe(5);
    expect(pointsBetween(0.3, 0.1)).toBe(0.2);
  });

  it('computes mini equivalents', () => {
    expect(toMiniEquivalent('MES', 10)).toBe(1);
    expect(toMiniEquivalent('ES', 2)).toBe(2);
    expect(toMiniEquivalent('MNQ', 5)).toBe(0.5);
  });

  it('throws on unknown instruments', () => {
    expect(() => getInstrument('XYZ')).toThrow();
  });
});
