import {
  calculateTradeRisk,
  isStopWidened,
  maxContractsForRisk,
  realizedPnl,
  realizedR,
  stopChangeRiskDelta,
} from '../riskEngine';

describe('calculateTradeRisk', () => {
  it('computes the mockup ES long example', () => {
    const r = calculateTradeRisk({
      instrument: 'ES',
      direction: 'long',
      entry: 6042.25,
      stop: 6037.25,
      target: 6052.25,
      contracts: 1,
      accountBalance: 25000,
    });
    expect(r.valid).toBe(true);
    expect(r.pointsRisk).toBe(5);
    expect(r.pointsReward).toBe(10);
    expect(r.riskDollars).toBe(250);
    expect(r.rewardDollars).toBe(500);
    expect(r.rr).toBe(2);
    expect(r.ticksRisk).toBe(20);
    expect(r.accountRiskPct).toBe(1);
  });

  it('computes a short correctly', () => {
    const r = calculateTradeRisk({ instrument: 'NQ', direction: 'short', entry: 21000, stop: 21010, target: 20970, contracts: 2 });
    expect(r.valid).toBe(true);
    expect(r.riskDollars).toBe(400);
    expect(r.rewardDollars).toBe(1200);
    expect(r.rr).toBe(3);
  });

  it('works without a target', () => {
    const r = calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 6000, stop: 5994, target: null, contracts: 5 });
    expect(r.valid).toBe(true);
    expect(r.riskDollars).toBe(150);
    expect(r.rr).toBeNull();
  });

  it('rejects a stop on the wrong side', () => {
    const long = calculateTradeRisk({ instrument: 'ES', direction: 'long', entry: 6000, stop: 6005, target: 6010, contracts: 1 });
    expect(long.valid).toBe(false);
    expect(long.errors[0]).toMatch(/below entry/);
    const short = calculateTradeRisk({ instrument: 'ES', direction: 'short', entry: 6000, stop: 5995, target: 5990, contracts: 1 });
    expect(short.valid).toBe(false);
  });

  it('rejects a target on the wrong side', () => {
    const r = calculateTradeRisk({ instrument: 'ES', direction: 'long', entry: 6000, stop: 5995, target: 5990, contracts: 1 });
    expect(r.valid).toBe(false);
  });

  it('rejects missing stop, zero and fractional contracts', () => {
    expect(calculateTradeRisk({ instrument: 'ES', direction: 'long', entry: 6000, stop: null, target: null, contracts: 1 }).valid).toBe(false);
    expect(calculateTradeRisk({ instrument: 'ES', direction: 'long', entry: 6000, stop: 5990, target: null, contracts: 0 }).valid).toBe(false);
    expect(calculateTradeRisk({ instrument: 'ES', direction: 'long', entry: 6000, stop: 5990, target: null, contracts: 1.5 }).valid).toBe(false);
    expect(calculateTradeRisk({ instrument: 'ES', direction: 'long', entry: NaN, stop: 5990, target: null, contracts: 1 }).valid).toBe(false);
  });

  it('rejects entry equal to stop', () => {
    expect(calculateTradeRisk({ instrument: 'ES', direction: 'long', entry: 6000, stop: 6000, target: 6010, contracts: 1 }).valid).toBe(false);
  });
});

describe('P/L and R', () => {
  it('computes realized P/L for long and short', () => {
    expect(realizedPnl('MES', 'long', 6000, 6008.5, 5)).toBe(212.5);
    expect(realizedPnl('ES', 'short', 6000, 6005, 1)).toBe(-250);
  });

  it('computes realized R from original risk', () => {
    expect(realizedR(500, 250)).toBe(2);
    expect(realizedR(-250, 250)).toBe(-1);
    expect(realizedR(100, 0)).toBeNull();
  });
});

describe('position sizing', () => {
  it('sizes to risk budget', () => {
    expect(maxContractsForRisk('MES', 6000, 5995, 150)).toBe(6);
    expect(maxContractsForRisk('ES', 6000, 5995, 249)).toBe(0);
    expect(maxContractsForRisk('ES', 6000, 5995, 500)).toBe(2);
  });

  it('respects max contracts', () => {
    expect(maxContractsForRisk('MES', 6000, 5995, 1000, 3)).toBe(3);
  });

  it('handles zero distance', () => {
    expect(maxContractsForRisk('ES', 6000, 6000, 500)).toBe(0);
  });
});

describe('stop changes', () => {
  it('detects widened stops', () => {
    expect(isStopWidened('long', 6037.25, 6034.25)).toBe(true);
    expect(isStopWidened('long', 6037.25, 6040)).toBe(false);
    expect(isStopWidened('short', 6000, 6003)).toBe(true);
  });

  it('computes added risk when widening', () => {
    // Mockup example: 3 points wider on 1 ES = $150 more risk
    expect(stopChangeRiskDelta('ES', 'long', 6042.25, 6037.25, 6034.25, 1)).toBe(150);
    expect(stopChangeRiskDelta('ES', 'long', 6042.25, 6037.25, 6040.25, 1)).toBe(-150);
  });
});
