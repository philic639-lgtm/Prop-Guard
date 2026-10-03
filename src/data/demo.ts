import { getInstrument } from '@/lib/engines/instrumentEngine';
import { realizedPnl } from '@/lib/engines/riskEngine';
import type {
  Account,
  DisciplineEvent,
  Emotion,
  InstrumentSymbol,
  Strategy,
  Trade,
  TradingRules,
  TradingSession,
  UserPreferences,
} from '@/types/domain';
import { addDays, addMinutes, dayKey, startOfDay } from '@/utils/dates';

import { STRATEGY_LIBRARY, checklistFromLabels } from './strategyLibrary';

/**
 * Realistic, deterministic demo data so the app looks complete on first run.
 * Everything is generated relative to "now" so the Daily Guard and journal
 * always feel current.
 */
export interface AppData {
  accounts: Account[];
  strategies: Strategy[];
  trades: Trade[];
  sessions: TradingSession[];
  events: DisciplineEvent[];
  tradingRules: TradingRules;
  preferences: UserPreferences;
  activeAccountId: string | null;
  activeStrategyId: string | null;
}

export const DEFAULT_TRADING_RULES: TradingRules = {
  maxRiskPerTrade: 150,
  maxTradesPerDay: 3,
  dailyStop: 400,
  noRevengeTrades: true,
  requireStop: true,
  requireTarget: true,
  cooldownMinutes: 15,
  allowCooldownOverride: true,
  maxConsecutiveLosses: 2,
  allowStopWidening: false,
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  displayName: '',
  email: '',
  timezone: 'America/New_York',
  defaultInstrument: 'MES',
  markets: ['ES', 'MES'],
  tradingType: 'prop',
  propFirm: '',
  notifications: { preSession: true, lossLimit: true, tradeLimit: true, cooldown: true, journal: true },
  onboarded: false,
};

export const EMPTY_DATA: AppData = {
  accounts: [],
  strategies: [],
  trades: [],
  sessions: [],
  events: [],
  tradingRules: DEFAULT_TRADING_RULES,
  preferences: DEFAULT_PREFERENCES,
  activeAccountId: null,
  activeStrategyId: null,
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_IDS = {
  account25k: '00000000-0000-4000-8000-000000000a25',
  account50k: '00000000-0000-4000-8000-000000000a50',
  orb: '00000000-0000-4000-8000-0000000000b1',
  vwap: '00000000-0000-4000-8000-0000000000b2',
} as const;

function strategyFromTemplate(templateId: string, id: string, nowIso: string): Strategy {
  const t = STRATEGY_LIBRARY.find((x) => x.id === templateId)!;
  return {
    id,
    name: t.name,
    markets: ['ES', 'MES'],
    session: t.session,
    ...t.defaults,
    stopMethod: t.stopMethod,
    typicalStopMin: t.stopRange[0],
    typicalStopMax: t.stopRange[1],
    notes: '',
    checklist: checklistFromLabels(t.checklist, templateId),
    source: 'library',
    libraryId: t.id,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

const EMOTIONS: Emotion[] = ['calm', 'confident', 'calm', 'anxious', 'calm', 'frustrated'];

const NOTES_WIN = [
  'Waited for the 5m close. Retest was clean — textbook.',
  'Bias was clear on the 1H. Took the first retest and let it run to target.',
  'Patient entry. Did not chase the initial break.',
  'Good read on the open. Followed the plan exactly.',
];
const NOTES_LOSS = [
  'Valid setup, just did not work. Stop respected.',
  'Breakout failed back into the range. Took the planned loss.',
  'Entered on the retest but momentum faded. Accepting the loss.',
  'Felt rushed on this one — should have waited for the candle close.',
];

export function createDemoData(now = new Date()): AppData {
  const rand = mulberry32(25_000);
  const nowIso = now.toISOString();

  const orb = { ...strategyFromTemplate('orb-15', DEMO_IDS.orb, nowIso), notes: 'Primary strategy. One trade per day max. Skip FOMC and CPI mornings.' };
  const vwap = { ...strategyFromTemplate('vwap-reclaim', DEMO_IDS.vwap, nowIso), maxTrades: 1 };

  const trades: Trade[] = [];
  const sessions: TradingSession[] = [];
  const events: DisciplineEvent[] = [];
  let seq = 0;
  const id = (prefix: string) => {
    seq += 1;
    const hex = seq.toString(16).padStart(12, '0');
    return `00000000-0000-4000-9${prefix}-${hex}`.slice(0, 36);
  };

  // Walk back over the last ~30 calendar days, trading weekdays only.
  const today = startOfDay(now);
  const days: Date[] = [];
  for (let i = 30; i >= 1; i--) {
    const d = addDays(today, -i);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) days.push(d);
  }

  let price = 5940;
  days.forEach((day, dayIndex) => {
    price += (rand() - 0.42) * 22;
    const sessionId = id('5e5');
    const tradeCount = rand() < 0.3 ? 2 : 1;
    const sessionStart = addMinutes(day, 9 * 60 + 40);
    const sessionTrades: Trade[] = [];

    for (let k = 0; k < tradeCount; k++) {
      const useVwap = k === 1 || rand() < 0.15;
      const strategy = useVwap ? vwap : orb;
      const instrument: InstrumentSymbol = rand() < 0.2 ? 'ES' : 'MES';
      const contracts = instrument === 'ES' ? 1 : rand() < 0.5 ? 5 : 4;
      const direction = rand() < 0.6 ? 'long' : 'short';
      const stopPts = [4, 5, 5, 5.5, 6, 6, 7][Math.floor(rand() * 7)];
      const rr = rand() < 0.7 ? 2 : 2.5;
      const entry = Math.round((price + (rand() - 0.5) * 6) * 4) / 4;
      const sign = direction === 'long' ? 1 : -1;
      const stop = entry - sign * stopPts;
      const target = entry + sign * stopPts * rr;
      const roll = rand();
      const outcome = roll < 0.52 ? 'win' : roll < 0.9 ? 'loss' : 'scratch';
      const exit =
        outcome === 'win' ? target : outcome === 'loss' ? stop : Math.round((entry + sign * stopPts * 0.4) * 4) / 4;

      const opened = addMinutes(sessionStart, 8 + k * (outcome === 'loss' ? 25 : 40) + Math.floor(rand() * 12));
      const closed = addMinutes(opened, 6 + Math.floor(rand() * 30));
      const pv = getInstrument(instrument).pointValue;
      const riskDollars = stopPts * pv * contracts;
      const pnl = realizedPnl(instrument, direction, entry, exit, contracts);
      const tradeId = id('7ad');
      const journaled = rand() < 0.85;
      const isLoss = pnl < 0;

      const checklist = strategy.checklist.map((c) => ({ itemId: c.id, label: c.label, value: true }));
      const trade: Trade = {
        id: tradeId,
        accountId: DEMO_IDS.account25k,
        strategyId: strategy.id,
        sessionId,
        instrument,
        direction,
        entryPrice: entry,
        stopPrice: stop,
        originalStopPrice: stop,
        targetPrice: target,
        exitPrice: exit,
        contracts,
        riskDollars,
        rewardDollars: stopPts * rr * pv * contracts,
        rMultiple: rr,
        realizedR: Math.round((pnl / riskDollars) * 100) / 100,
        pnl,
        points: Math.round(sign * (exit - entry) * 100) / 100,
        status: 'closed',
        openedAt: opened.toISOString(),
        closedAt: closed.toISOString(),
        bias: direction === 'long' ? 'bullish' : 'bearish',
        checklist,
        rulesFollowed: ['risk_per_trade', 'risk_daily', 'min_rr', 'target_set', ...checklist.map((c) => `check_${c.itemId}`)],
        rulesViolated: [],
        setupScore: 80 + Math.floor(rand() * 20),
        setupGrade: rand() < 0.4 ? 'A_PLUS' : 'VALID',
        disciplineScore: 100,
        notes: journaled ? (isLoss ? NOTES_LOSS : NOTES_WIN)[Math.floor(rand() * 4)] : '',
        aiSummary: null,
        emotion: journaled ? EMOTIONS[Math.floor(rand() * EMOTIONS.length)] : null,
        setupRating: journaled ? 3 + Math.floor(rand() * 3) : null,
        screenshotUri: null,
        source: 'manual',
        journaled,
        mae: Math.round(rand() * stopPts * 4) / 4,
        mfe: Math.round((outcome === 'win' ? stopPts * rr : rand() * stopPts) * 4) / 4,
      };
      sessionTrades.push(trade);
      if (journaled) {
        events.push({ id: id('e0e'), type: 'JOURNAL_COMPLETED', category: 'journal', accountId: trade.accountId, tradeId, sessionId, detail: 'Journal completed', at: closed.toISOString() });
      }
    }

    // A few realistic slips so the Discipline Score has something to say.
    const first = sessionTrades[0];
    if (dayIndex === days.length - 4 && sessionTrades.length > 1) {
      const second = sessionTrades[1];
      events.push({ id: id('e0e'), type: 'COOLDOWN_BROKEN', category: 'cooldown', accountId: second.accountId, tradeId: second.id, sessionId, detail: 'Entered 6 minutes after a loss (15 minute cooldown).', at: second.openedAt });
      second.rulesViolated = ['cooldown'];
      second.disciplineScore = 75;
    }
    if (dayIndex === days.length - 9) {
      const widened = first.direction === 'long' ? first.stopPrice - 2 : first.stopPrice + 2;
      first.stopPrice = widened;
      first.rulesViolated = ['stop_widened'];
      first.disciplineScore = 75;
      events.push({ id: id('e0e'), type: 'STOP_WIDENED', category: 'stop', accountId: first.accountId, tradeId: first.id, sessionId, detail: 'Stop moved 2 points further from entry.', at: first.openedAt });
    }
    if (dayIndex === days.length - 14) {
      first.rulesViolated = ['bias_aligned'];
      first.disciplineScore = 75;
      events.push({ id: id('e0e'), type: 'STRATEGY_VIOLATION', category: 'entry', accountId: first.accountId, tradeId: first.id, sessionId, detail: 'Entered against 1H bias.', at: first.openedAt });
    }

    trades.push(...sessionTrades);
    const last = sessionTrades[sessionTrades.length - 1];
    sessions.push({
      id: sessionId,
      accountId: DEMO_IDS.account25k,
      strategyId: orb.id,
      date: dayKey(day),
      startedAt: sessionStart.toISOString(),
      endedAt: addMinutes(new Date(last.closedAt!), 5).toISOString(),
      status: 'ended',
      review: null,
    });
  });

  // Today: one planned loss early in the session, cooldown already complete.
  const todayLossClose = new Date(Math.max(addMinutes(today, 1).getTime(), now.getTime() - 75 * 60_000));
  const todayOpen = new Date(Math.max(today.getTime(), todayLossClose.getTime() - 9 * 60_000));
  const todaySession = id('5e5');
  const tEntry = Math.round(price * 4) / 4;
  trades.push({
    id: id('7ad'),
    accountId: DEMO_IDS.account25k,
    strategyId: orb.id,
    sessionId: todaySession,
    instrument: 'MES',
    direction: 'long',
    entryPrice: tEntry,
    stopPrice: tEntry - 6,
    originalStopPrice: tEntry - 6,
    targetPrice: tEntry + 12,
    exitPrice: tEntry - 6,
    contracts: 5,
    riskDollars: 150,
    rewardDollars: 300,
    rMultiple: 2,
    realizedR: -1,
    pnl: -150,
    points: -6,
    status: 'closed',
    openedAt: todayOpen.toISOString(),
    closedAt: todayLossClose.toISOString(),
    bias: 'bullish',
    checklist: orb.checklist.map((c) => ({ itemId: c.id, label: c.label, value: true })),
    rulesFollowed: ['risk_per_trade', 'risk_daily', 'min_rr', 'target_set'],
    rulesViolated: [],
    setupScore: 88,
    setupGrade: 'VALID',
    disciplineScore: 100,
    notes: '',
    aiSummary: null,
    emotion: null,
    setupRating: null,
    screenshotUri: null,
    source: 'manual',
    journaled: false,
    mae: 6,
    mfe: 2.5,
  });
  sessions.push({
    id: todaySession,
    accountId: DEMO_IDS.account25k,
    strategyId: orb.id,
    date: dayKey(now),
    startedAt: todayOpen.toISOString(),
    endedAt: null,
    status: 'active',
    review: null,
  });

  const accountTrades = trades.filter((t) => t.accountId === DEMO_IDS.account25k);
  const sorted = [...accountTrades].sort((a, b) => Date.parse(a.closedAt!) - Date.parse(b.closedAt!));
  let balance = 25_000;
  let hwm = 25_000;
  for (const t of sorted) {
    balance += t.pnl ?? 0;
    hwm = Math.max(hwm, balance);
  }

  const account25k: Account = {
    id: DEMO_IDS.account25k,
    name: 'Lucid 25K Flex',
    firm: 'Lucid Trading',
    kind: 'prop',
    size: 25_000,
    startingBalance: 25_000,
    balance: Math.round(balance * 100) / 100,
    cycleStartBalance: 25_000,
    highWaterMark: Math.round(hwm * 100) / 100,
    status: 'active',
    createdAt: addDays(today, -32).toISOString(),
    rules: {
      dailyLossLimit: 500,
      maxDrawdown: 1_500,
      drawdownType: 'eod_trailing',
      trailingLocksAtStart: true,
      profitTarget: 1_500,
      maxContracts: 20,
      consistencyPct: 40,
      minTradingDays: 5,
      maxTradingDays: null,
      payoutThreshold: null,
      custom: [{ id: 'news', label: 'No trading during major news', description: 'Flat 2 minutes before and after tier-1 releases.' }],
    },
  };

  const account50k: Account = {
    id: DEMO_IDS.account50k,
    name: 'Lucid 50K Pro',
    firm: 'Lucid Trading',
    kind: 'prop',
    size: 50_000,
    startingBalance: 50_000,
    balance: 52_100,
    cycleStartBalance: 50_000,
    highWaterMark: 52_400,
    status: 'active',
    createdAt: addDays(today, -60).toISOString(),
    rules: {
      dailyLossLimit: 1_000,
      maxDrawdown: 2_500,
      drawdownType: 'eod_trailing',
      trailingLocksAtStart: true,
      profitTarget: 3_000,
      maxContracts: 4,
      consistencyPct: null,
      minTradingDays: null,
      maxTradingDays: null,
      payoutThreshold: 2_500,
      custom: [],
    },
  };

  return {
    accounts: [account25k, account50k],
    strategies: [orb, vwap],
    trades,
    sessions,
    events,
    tradingRules: DEFAULT_TRADING_RULES,
    preferences: {
      ...DEFAULT_PREFERENCES,
      displayName: 'Demo Trader',
      email: 'demo@propguard.app',
      propFirm: 'Lucid Trading',
      onboarded: true,
    },
    activeAccountId: account25k.id,
    activeStrategyId: orb.id,
  };
}
