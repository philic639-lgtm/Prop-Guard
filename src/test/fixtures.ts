import { EMPTY_PROP_RULES } from '@/lib/engines/propRuleEngine';
import type { Account, Strategy, Trade, TradingRules } from '@/types/domain';

export const NOW = new Date('2026-10-02T14:30:00Z');

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc1',
    name: 'Test 25K',
    firm: 'Test Firm',
    kind: 'prop',
    size: 25000,
    startingBalance: 25000,
    balance: 25000,
    cycleStartBalance: 25000,
    highWaterMark: 25000,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
    rules: {
      ...EMPTY_PROP_RULES,
      dailyLossLimit: 500,
      maxDrawdown: 1500,
      drawdownType: 'trailing',
      maxContracts: 10,
      ...overrides.rules,
    },
  };
}

export function makeRules(overrides: Partial<TradingRules> = {}): TradingRules {
  return {
    maxRiskPerTrade: 250,
    maxTradesPerDay: 3,
    dailyStop: 400,
    noRevengeTrades: true,
    requireStop: true,
    requireTarget: true,
    cooldownMinutes: 15,
    allowCooldownOverride: true,
    maxConsecutiveLosses: 2,
    allowStopWidening: false,
    ...overrides,
  };
}

let seq = 0;
export function makeTrade(overrides: Partial<Trade> = {}): Trade {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'acc1',
    strategyId: 'orb',
    sessionId: null,
    instrument: 'MES',
    direction: 'long',
    entryPrice: 6000,
    stopPrice: 5995,
    originalStopPrice: 5995,
    targetPrice: 6010,
    exitPrice: null,
    contracts: 5,
    riskDollars: 125,
    rewardDollars: 250,
    rMultiple: 2,
    realizedR: null,
    pnl: null,
    points: null,
    status: 'closed',
    openedAt: NOW.toISOString(),
    closedAt: NOW.toISOString(),
    bias: 'bullish',
    checklist: [],
    rulesFollowed: [],
    rulesViolated: [],
    setupScore: null,
    setupGrade: null,
    disciplineScore: null,
    notes: '',
    aiSummary: null,
    emotion: null,
    setupRating: null,
    screenshotUri: null,
    source: 'manual',
    journaled: false,
    mae: null,
    mfe: null,
    ...overrides,
  };
}

export function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: 'orb',
    name: '15M ORB',
    markets: ['ES', 'MES'],
    session: 'NY Open',
    timeframe: '15m / 5m',
    entryWindowStart: '09:45',
    entryWindowEnd: '10:45',
    biasRequirement: '1H bias',
    requiresBiasAlignment: true,
    entryTrigger: '5m close outside ORB',
    confirmationRules: '',
    retestRules: '',
    stopMethod: 'Below retest',
    typicalStopMin: 4,
    typicalStopMax: 8,
    targetMethod: '2R',
    minRR: 2,
    maxTrades: 2,
    invalidationRules: '',
    notes: '',
    checklist: [
      { id: 'orb', label: 'ORB established', kind: 'yesno', required: true },
      { id: 'breakout', label: 'Breakout confirmed', kind: 'yesno', required: true },
      { id: 'retest', label: 'Retest occurred', kind: 'yesno', required: true },
    ],
    source: 'custom',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}
