import type {
  Account,
  PendingTrade,
  PracticeRun,
  TradePlan,
  ChecklistItem,
  DisciplineEvent,
  Strategy,
  Trade,
  TradingRules,
  TradingSession,
  UserPreferences,
} from '@/types/domain';

/**
 * Pure row <-> domain mappers. Postgres numerics arrive as strings or
 * numbers depending on precision, so every numeric goes through `num`.
 */
type Row = Record<string, unknown>;

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown, fallback = ''): string => (v == null ? fallback : String(v));

export function accountToRows(a: Account, userId: string) {
  return {
    account: {
      id: a.id,
      user_id: userId,
      name: a.name,
      firm: a.firm,
      kind: a.kind,
      size: a.size,
      starting_balance: a.startingBalance,
      balance: a.balance,
      cycle_start_balance: a.cycleStartBalance,
      high_water_mark: a.highWaterMark,
      status: a.status,
      created_at: a.createdAt,
    },
    rules: {
      account_id: a.id,
      user_id: userId,
      daily_loss_limit: a.rules.dailyLossLimit,
      max_drawdown: a.rules.maxDrawdown,
      drawdown_type: a.rules.drawdownType,
      trailing_locks_at_start: a.rules.trailingLocksAtStart,
      profit_target: a.rules.profitTarget,
      max_contracts: a.rules.maxContracts,
      consistency_pct: a.rules.consistencyPct,
      min_trading_days: a.rules.minTradingDays,
      max_trading_days: a.rules.maxTradingDays,
      payout_threshold: a.rules.payoutThreshold,
      custom_rules: a.rules.custom,
    },
  };
}

export function rowsToAccount(r: Row, rules: Row | undefined): Account {
  return {
    id: str(r.id),
    name: str(r.name),
    firm: str(r.firm),
    kind: r.kind === 'personal' ? 'personal' : 'prop',
    size: num(r.size),
    startingBalance: num(r.starting_balance),
    balance: num(r.balance),
    cycleStartBalance: num(r.cycle_start_balance),
    highWaterMark: num(r.high_water_mark),
    status: (r.status as Account['status']) ?? 'active',
    createdAt: str(r.created_at),
    rules: {
      dailyLossLimit: numOrNull(rules?.daily_loss_limit),
      maxDrawdown: numOrNull(rules?.max_drawdown),
      drawdownType: (rules?.drawdown_type as Account['rules']['drawdownType']) ?? 'trailing',
      trailingLocksAtStart: rules?.trailing_locks_at_start !== false,
      profitTarget: numOrNull(rules?.profit_target),
      maxContracts: numOrNull(rules?.max_contracts),
      consistencyPct: numOrNull(rules?.consistency_pct),
      minTradingDays: numOrNull(rules?.min_trading_days),
      maxTradingDays: numOrNull(rules?.max_trading_days),
      payoutThreshold: numOrNull(rules?.payout_threshold),
      custom: Array.isArray(rules?.custom_rules) ? (rules!.custom_rules as Account['rules']['custom']) : [],
    },
  };
}

export function strategyToRows(s: Strategy, userId: string) {
  return {
    strategy: {
      id: s.id,
      user_id: userId,
      name: s.name,
      markets: s.markets,
      session: s.session,
      timeframe: s.timeframe,
      entry_window_start: s.entryWindowStart,
      entry_window_end: s.entryWindowEnd,
      bias_requirement: s.biasRequirement,
      requires_bias_alignment: s.requiresBiasAlignment,
      entry_trigger: s.entryTrigger,
      confirmation_rules: s.confirmationRules,
      retest_rules: s.retestRules,
      stop_method: s.stopMethod,
      typical_stop_min: s.typicalStopMin,
      typical_stop_max: s.typicalStopMax,
      target_method: s.targetMethod,
      min_rr: s.minRR,
      max_trades: s.maxTrades,
      invalidation_rules: s.invalidationRules,
      notes: s.notes,
      source: s.source,
      library_id: s.libraryId ?? null,
      created_at: s.createdAt,
    },
    checklist: s.checklist.map((c, i) => ({
      strategy_id: s.id,
      item_key: c.id,
      user_id: userId,
      label: c.label,
      kind: c.kind,
      required: c.required,
      position: i,
    })),
  };
}

export function rowsToStrategy(r: Row, items: Row[]): Strategy {
  const checklist: ChecklistItem[] = [...items]
    .sort((a, b) => num(a.position) - num(b.position))
    .map((i) => ({ id: str(i.item_key), label: str(i.label), kind: i.kind === 'bias' ? 'bias' : 'yesno', required: i.required !== false }));
  return {
    id: str(r.id),
    name: str(r.name),
    markets: (r.markets as Strategy['markets']) ?? [],
    session: str(r.session),
    timeframe: str(r.timeframe),
    entryWindowStart: (r.entry_window_start as string | null) ?? null,
    entryWindowEnd: (r.entry_window_end as string | null) ?? null,
    biasRequirement: str(r.bias_requirement),
    requiresBiasAlignment: r.requires_bias_alignment !== false,
    entryTrigger: str(r.entry_trigger),
    confirmationRules: str(r.confirmation_rules),
    retestRules: str(r.retest_rules),
    stopMethod: str(r.stop_method),
    typicalStopMin: numOrNull(r.typical_stop_min),
    typicalStopMax: numOrNull(r.typical_stop_max),
    targetMethod: str(r.target_method),
    minRR: num(r.min_rr),
    maxTrades: num(r.max_trades),
    invalidationRules: str(r.invalidation_rules),
    notes: str(r.notes),
    checklist,
    source: r.source === 'library' ? 'library' : 'custom',
    libraryId: (r.library_id as string | null) ?? undefined,
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function tradeToRows(t: Trade, userId: string) {
  return {
    trade: {
      id: t.id,
      user_id: userId,
      account_id: t.accountId,
      strategy_id: t.strategyId,
      session_id: t.sessionId,
      instrument: t.instrument,
      direction: t.direction,
      entry_price: t.entryPrice,
      stop_price: t.stopPrice,
      original_stop_price: t.originalStopPrice,
      target_price: t.targetPrice,
      exit_price: t.exitPrice,
      contracts: t.contracts,
      risk_dollars: t.riskDollars,
      reward_dollars: t.rewardDollars,
      r_multiple: t.rMultiple,
      realized_r: t.realizedR,
      pnl: t.pnl,
      points: t.points,
      status: t.status,
      opened_at: t.openedAt,
      closed_at: t.closedAt,
      bias: t.bias,
      rules_followed: t.rulesFollowed,
      rules_violated: t.rulesViolated,
      setup_score: t.setupScore,
      setup_grade: t.setupGrade,
      discipline_score: t.disciplineScore,
      notes: t.notes,
      screenshot_url: t.screenshotUri,
      source: t.source,
      mae: t.mae,
      mfe: t.mfe,
      followed_plan: t.followedPlan ?? null,
      account_balance: t.accountBalance ?? null,
      pending_id: t.pendingId ?? null,
      external_id: t.externalId ?? null,
    },
    checklist: t.checklist.map((c) => ({ trade_id: t.id, item_key: c.itemId, user_id: userId, label: c.label, value: c.value })),
    journal: {
      trade_id: t.id,
      user_id: userId,
      emotion: t.emotion,
      setup_rating: t.setupRating,
      ai_summary: t.aiSummary,
      completed_at: t.journaled ? new Date().toISOString() : null,
    },
  };
}

export function rowsToTrade(r: Row, checklist: Row[], journal: Row | undefined): Trade {
  return {
    id: str(r.id),
    accountId: str(r.account_id),
    strategyId: (r.strategy_id as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    instrument: r.instrument as Trade['instrument'],
    direction: r.direction === 'short' ? 'short' : 'long',
    entryPrice: num(r.entry_price),
    stopPrice: num(r.stop_price),
    originalStopPrice: num(r.original_stop_price),
    targetPrice: numOrNull(r.target_price),
    exitPrice: numOrNull(r.exit_price),
    contracts: num(r.contracts),
    riskDollars: num(r.risk_dollars),
    rewardDollars: numOrNull(r.reward_dollars),
    rMultiple: numOrNull(r.r_multiple),
    realizedR: numOrNull(r.realized_r),
    pnl: numOrNull(r.pnl),
    points: numOrNull(r.points),
    status: (r.status as Trade['status']) ?? 'open',
    openedAt: str(r.opened_at),
    closedAt: (r.closed_at as string | null) ?? null,
    bias: (r.bias as Trade['bias']) ?? null,
    checklist: checklist.map((c) => ({ itemId: str(c.item_key), label: str(c.label), value: c.value === true })),
    rulesFollowed: (r.rules_followed as string[]) ?? [],
    rulesViolated: (r.rules_violated as string[]) ?? [],
    setupScore: numOrNull(r.setup_score),
    setupGrade: (r.setup_grade as Trade['setupGrade']) ?? null,
    disciplineScore: numOrNull(r.discipline_score),
    notes: str(r.notes),
    aiSummary: (journal?.ai_summary as string | null) ?? null,
    emotion: (journal?.emotion as Trade['emotion']) ?? null,
    setupRating: numOrNull(journal?.setup_rating),
    screenshotUri: (r.screenshot_url as string | null) ?? null,
    source: TRADE_SOURCES.includes(r.source as Trade['source']) ? (r.source as Trade['source']) : 'manual',
    journaled: journal?.completed_at != null,
    mae: numOrNull(r.mae),
    mfe: numOrNull(r.mfe),
    followedPlan: r.followed_plan == null ? null : r.followed_plan === true,
    // Optional columns: only present on trades that carry them.
    ...(r.account_balance != null ? { accountBalance: num(r.account_balance) } : {}),
    ...(r.pending_id != null ? { pendingId: str(r.pending_id) } : {}),
    ...(r.external_id != null ? { externalId: str(r.external_id) } : {}),
  };
}

const TRADE_SOURCES: Trade['source'][] = ['manual', 'screenshot', 'auto', 'broker'];

export function pendingToRow(p: PendingTrade, userId: string) {
  return {
    id: p.id,
    user_id: userId,
    account_id: p.accountId,
    strategy_id: p.strategyId,
    instrument: p.instrument,
    direction: p.direction,
    entry: p.entry,
    stop: p.stop,
    target: p.target,
    contracts: p.contracts,
    account_balance: p.accountBalance,
    risk_dollars: p.riskDollars,
    reward_dollars: p.rewardDollars,
    rr: p.rr,
    bias: p.bias,
    checklist: p.checklist,
    rules_followed: p.rulesFollowed,
    rules_violated: p.rulesViolated,
    setup_score: p.setupScore,
    setup_grade: p.setupGrade,
    rule_events: p.ruleEvents,
    notes: p.notes,
    // Local file URIs are device-specific; only storage paths are synced.
    screenshot_url: p.screenshotUri && !p.screenshotUri.startsWith('file:') ? p.screenshotUri : null,
    origin: p.origin,
    status: p.status,
    trade_id: p.tradeId,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export function rowToPending(r: Row): PendingTrade {
  return {
    id: str(r.id),
    accountId: str(r.account_id),
    strategyId: (r.strategy_id as string | null) ?? null,
    instrument: str(r.instrument),
    direction: r.direction === 'short' ? 'short' : 'long',
    entry: num(r.entry),
    stop: num(r.stop),
    target: numOrNull(r.target),
    contracts: num(r.contracts),
    accountBalance: numOrNull(r.account_balance),
    riskDollars: num(r.risk_dollars),
    rewardDollars: numOrNull(r.reward_dollars),
    rr: numOrNull(r.rr),
    bias: (r.bias as PendingTrade['bias']) ?? null,
    checklist: Array.isArray(r.checklist) ? (r.checklist as PendingTrade['checklist']) : [],
    rulesFollowed: (r.rules_followed as string[]) ?? [],
    rulesViolated: (r.rules_violated as string[]) ?? [],
    setupScore: numOrNull(r.setup_score),
    setupGrade: (r.setup_grade as PendingTrade['setupGrade']) ?? null,
    ruleEvents: Array.isArray(r.rule_events) ? (r.rule_events as PendingTrade['ruleEvents']) : [],
    notes: str(r.notes),
    screenshotUri: (r.screenshot_url as string | null) ?? null,
    origin: r.origin === 'calculator' ? 'calculator' : 'analyze',
    status: (r.status as PendingTrade['status']) ?? 'pending',
    tradeId: (r.trade_id as string | null) ?? null,
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function sessionToRow(s: TradingSession, userId: string) {
  return {
    id: s.id,
    user_id: userId,
    account_id: s.accountId,
    strategy_id: s.strategyId,
    date: s.date,
    started_at: s.startedAt,
    ended_at: s.endedAt,
    status: s.status,
    review: s.review,
  };
}

export function rowToSession(r: Row): TradingSession {
  return {
    id: str(r.id),
    accountId: str(r.account_id),
    strategyId: (r.strategy_id as string | null) ?? null,
    date: str(r.date),
    startedAt: str(r.started_at),
    endedAt: (r.ended_at as string | null) ?? null,
    status: r.status === 'ended' ? 'ended' : 'active',
    review: (r.review as TradingSession['review']) ?? null,
  };
}

export function eventToRow(e: DisciplineEvent, userId: string) {
  return {
    id: e.id,
    user_id: userId,
    account_id: e.accountId,
    trade_id: e.tradeId,
    session_id: e.sessionId,
    type: e.type,
    category: e.category,
    detail: e.detail,
    occurred_at: e.at,
  };
}

export function rowToEvent(r: Row): DisciplineEvent {
  return {
    id: str(r.id),
    type: r.type as DisciplineEvent['type'],
    category: r.category as DisciplineEvent['category'],
    accountId: (r.account_id as string | null) ?? null,
    tradeId: (r.trade_id as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    detail: str(r.detail),
    at: str(r.occurred_at),
  };
}

export function preferencesToRow(
  p: UserPreferences,
  rules: TradingRules,
  activeAccountId: string | null,
  activeStrategyId: string | null,
  userId: string,
) {
  return {
    user_id: userId,
    timezone: p.timezone,
    default_instrument: p.defaultInstrument,
    markets: p.markets,
    trading_type: p.tradingType,
    prop_firm: p.propFirm,
    notifications: p.notifications,
    trading_rules: rules,
    trading_profile: p.tradingProfile,
    custom_instruments: p.customInstruments,
    onboarded: p.onboarded,
    active_account_id: activeAccountId,
    active_strategy_id: activeStrategyId,
  };
}

export function planToRow(p: TradePlan, userId: string) {
  return {
    id: p.id,
    user_id: userId,
    account_id: p.accountId,
    strategy_id: p.strategyId,
    instrument: p.instrument,
    direction: p.direction,
    entry: p.entry,
    stop: p.stop,
    target: p.target,
    contracts: p.contracts,
    risk_dollars: p.riskDollars,
    reward_dollars: p.rewardDollars,
    rr: p.rr,
    match_pct: p.matchPct,
    grade: p.grade,
    conditions_met: p.conditionsMet,
    conditions_total: p.conditionsTotal,
    notes: p.notes,
    status: p.status,
    created_at: p.createdAt,
  };
}

export function rowToPlan(r: Row): TradePlan {
  return {
    id: str(r.id),
    accountId: str(r.account_id),
    strategyId: (r.strategy_id as string | null) ?? null,
    instrument: r.instrument as TradePlan['instrument'],
    direction: r.direction === 'short' ? 'short' : 'long',
    entry: num(r.entry),
    stop: num(r.stop),
    target: numOrNull(r.target),
    contracts: num(r.contracts),
    riskDollars: num(r.risk_dollars),
    rewardDollars: numOrNull(r.reward_dollars),
    rr: numOrNull(r.rr),
    matchPct: num(r.match_pct),
    grade: r.grade as TradePlan['grade'],
    conditionsMet: num(r.conditions_met),
    conditionsTotal: num(r.conditions_total),
    notes: str(r.notes),
    status: (r.status as TradePlan['status']) ?? 'saved',
    createdAt: str(r.created_at),
  };
}

export function practiceToRow(p: PracticeRun, userId: string) {
  return {
    id: p.id,
    user_id: userId,
    strategy_id: p.strategyId,
    // Local file URIs are device-specific; only storage paths are synced.
    screenshot_path: p.screenshotUri && !p.screenshotUri.startsWith('file:') ? p.screenshotUri : null,
    answers: p.answers,
    match_pct: p.matchPct,
    conditions_met: p.conditionsMet,
    conditions_total: p.conditionsTotal,
    verdict: p.verdict,
    feedback: p.feedback,
    created_at: p.createdAt,
  };
}

export function rowToPractice(r: Row): PracticeRun {
  return {
    id: str(r.id),
    strategyId: str(r.strategy_id),
    screenshotUri: (r.screenshot_path as string | null) ?? null,
    answers: (r.answers as Record<string, boolean>) ?? {},
    matchPct: num(r.match_pct),
    conditionsMet: num(r.conditions_met),
    conditionsTotal: num(r.conditions_total),
    verdict: (r.verdict as PracticeRun['verdict']) ?? 'wait',
    feedback: str(r.feedback),
    createdAt: str(r.created_at),
  };
}
