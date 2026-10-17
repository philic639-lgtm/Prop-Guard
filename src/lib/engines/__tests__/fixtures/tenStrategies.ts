/** Ten radically different strategy descriptions used by the uniqueness tests. */
export const TEN_STRATEGIES = {
  orbBreakout: 'I trade a 15-minute opening range breakout on ES after 9:45. I wait for a breakout, 5-minute close, and retest.',
  vwapMeanReversion: 'I fade ES when price becomes stretched far away from VWAP and momentum starts weakening.',
  emaTrendPullback: 'I follow strong trends on MNQ and enter pullbacks into the 20 EMA.',
  liquiditySweepReversal: "I buy NQ after a large selloff when price sweeps the previous day's low and quickly closes back above it.",
  srBreakout:
    'I mark resistance levels on ES from the last two days and buy when a 5-minute candle closes above resistance with volume above average. Stop below the breakout candle, target 2R.',
  rsiDivergence:
    'On NQ 5-minute I short when price makes a higher high but RSI makes a lower high (bearish divergence) near the high of day, and I wait for a red candle to confirm.',
  openingDrive:
    'I trade the opening drive on NQ: if the first 5 minutes push hard in one direction with big candles, I join on the first small pullback before 10:00. Stop under the pullback low.',
  rangeFade: 'When MES is stuck in a range after 11:00 I fade the range edges, selling the top and buying the bottom, target the middle of the range. I avoid it on news days.',
  momentumScalp: 'I scalp MNQ on the 1-minute chart when there is good momentum, taking 8 points profit with a 4 point stop. Max 6 trades a day.',
  multiTimeframeTrend:
    'I use the daily trend for bias on ES, then the 1-hour chart for structure, and enter on a 15-minute close above the previous swing high in the direction of the daily trend.',
} as const;
export type TenKey = keyof typeof TEN_STRATEGIES;
