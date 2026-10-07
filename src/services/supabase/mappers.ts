import type {
  Account,
  PendingTrade,
  PracticeRun,
  SetupCheck,
  TradePlan,
  ChecklistItem,
  DisciplineEvent,
  Strategy,
  Trade,
  TradingRules,
  TradingSession,
  UserPreferences,
} from '@/types/domain';
import type { PracticeAttempt, PracticeLesson } from '@/types/practice';

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
      firm_link: a.firmLink ?? null,
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
      firm_terms: a.rules.terms ?? null,
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
      ...(rules?.firm_terms && typeof rules.firm_terms === 'object' ? { terms: rules.firm_terms as NonNullable<Account['rules']['terms']> } : {}),
    },
    ...(r.firm_link && typeof r.firm_link === 'object' ? { firmLink: r.firm_link as NonNullable<Account['firmLink']> } : {}),
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
      source_type: s.sourceType ?? null,
      original_text: s.originalText ?? null,
      structured: s.structured ?? null,
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
    requiresBiasAlignment: r.requires_bias_alignment === true,
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
    ...(r.source_type === 'BUILT_IN' || r.source_type === 'CUSTOM' || r.source_type === 'AI_ADAPTED' ? { sourceType: r.source_type } : {}),
    ...(typeof r.original_text === 'string' ? { originalText: r.original_text } : {}),
    ...(r.structured && typeof r.structured === 'object' && (r.structured as { version?: number }).version === 1 ? { structured: r.structured as unknown as Strategy['structured'] } : {}),
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
      strategy_name: t.strategyName ?? null,
      setup_check_id: t.setupCheckId ?? null,
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
    ...(r.strategy_name != null ? { strategyName: str(r.strategy_name) } : {}),
    ...(r.setup_check_id != null ? { setupCheckId: str(r.setup_check_id) } : {}),
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
    setup_check_id: p.setupCheckId ?? null,
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
    origin: r.origin === 'calculator' ? 'calculator' : r.origin === 'setup_check' ? 'setup_check' : 'analyze',
    status: (r.status as PendingTrade['status']) ?? 'pending',
    tradeId: (r.trade_id as string | null) ?? null,
    ...(r.setup_check_id != null ? { setupCheckId: str(r.setup_check_id) } : {}),
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

export function practiceAttemptToRow(a: PracticeAttempt, userId: string) {
  return {
    id: a.id,
    user_id: userId,
    scenario_id: a.scenarioId,
    instrument: a.instrument,
    strategy_id: a.strategyId,
    strategy_name: a.strategyName,
    attempted_at: a.timestamp,
    mode: a.mode,
    session: a.session,
    direction: a.direction,
    decision: a.decision,
    ideal_decision: a.idealDecision,
    correct: a.correct,
    entry: a.entry ?? null,
    stop: a.stop ?? null,
    target: a.target ?? null,
    risk_reward: a.riskReward ?? null,
    score: a.score,
    grade: a.grade,
    result: a.result,
    mistakes: a.mistakes,
    setup_characteristics: a.setupCharacteristics,
    scenario_source: a.scenarioSource ?? null,
    scenario_verified: a.scenarioVerified ?? null,
  };
}

export function rowToPracticeAttempt(r: Row): PracticeAttempt {
  const opt = (v: unknown) => (v == null ? undefined : Number(v));
  return {
    id: str(r.id),
    userId: (r.user_id as string | null) ?? undefined,
    scenarioId: str(r.scenario_id),
    instrument: str(r.instrument),
    strategyId: str(r.strategy_id),
    strategyName: str(r.strategy_name),
    timestamp: str(r.attempted_at),
    mode: (r.mode as PracticeAttempt['mode']) ?? 'standard',
    session: r.session === 'afternoon' ? 'afternoon' : 'morning',
    direction: r.direction === 'short' ? 'short' : 'long',
    decision: (r.decision as PracticeAttempt['decision']) ?? 'wait',
    idealDecision: (r.ideal_decision as PracticeAttempt['idealDecision']) ?? 'wait',
    correct: r.correct === true,
    entry: opt(r.entry),
    stop: opt(r.stop),
    target: opt(r.target),
    riskReward: opt(r.risk_reward),
    score: num(r.score),
    grade: (r.grade as PracticeAttempt['grade']) ?? 'D',
    result: (r.result as PracticeAttempt['result']) ?? 'expired',
    mistakes: Array.isArray(r.mistakes) ? (r.mistakes as string[]) : [],
    setupCharacteristics: (r.setup_characteristics as PracticeAttempt['setupCharacteristics']) ?? {},
    ...(r.scenario_source ? { scenarioSource: r.scenario_source as PracticeAttempt['scenarioSource'] } : {}),
    ...(r.scenario_verified != null ? { scenarioVerified: r.scenario_verified === true } : {}),
  };
}

export function practiceLessonToRow(l: PracticeLesson, userId: string) {
  return {
    id: l.id,
    user_id: userId,
    attempt_id: l.attemptId,
    scenario_id: l.scenarioId,
    strategy_id: l.strategyId,
    strategy_name: l.strategyName,
    instrument: l.instrument,
    score: l.score,
    grade: l.grade,
    lesson: l.lesson,
    created_at: l.createdAt,
  };
}

export function rowToPracticeLesson(r: Row): PracticeLesson {
  return {
    id: str(r.id),
    attemptId: str(r.attempt_id),
    scenarioId: str(r.scenario_id),
    strategyId: str(r.strategy_id),
    strategyName: str(r.strategy_name),
    instrument: str(r.instrument),
    score: num(r.score),
    grade: (r.grade as PracticeLesson['grade']) ?? 'D',
    lesson: str(r.lesson),
    createdAt: str(r.created_at),
  };
}

// ───────────────────────────── Setup checks ─────────────────────────────

export function setupCheckToRow(c: SetupCheck, userId: string) {
  return {
    id: c.id,
    user_id: userId,
    created_at: c.createdAt,
    version: c.version,
    account_id: c.accountId,
    strategy_id: c.strategyId,
    strategy_name: c.strategyName,
    strategy_version: c.strategyVersion,
    instrument: c.instrument,
    timeframe: c.timeframe,
    direction: c.direction,
    decision: c.decision,
    score: c.ruleAlignmentScore,
    grade: null,
    grade_label: c.decision === 'TAKE TRADE' ? 'Required rules confirmed' : 'Setup incomplete or blocked',
    why: '',
    next_steps: [],
    required_total: c.totalRequired,
    required_passed: c.passedRequired,
    criteria: c.evaluatedRules,
    risk_checks: c.riskChecks,
    prop_checks: c.propChecks,
    blockers: c.blockers,
    risk_check: c.riskCheck,
    prop_compliance: c.propFirmCompliance,
    risk: { dollarRisk: c.dollarRisk, reward: c.reward, rr: c.rr },
    inputs: c.inputs,
    evidence_confidence: c.evidenceConfidence,
    analysis_mode: c.analysisMode,
    evaluated_by: c.evaluatedBy,
    analysis_id: c.analysisId,
    analysis_key: c.analysisKey,
    icc: c.icc ?? null,
    setup_decision: c.setupDecision ?? null,
    kind: c.kind ?? null,
    setup_type: c.setupType ?? null,
    provider: c.analysisMode === 'REAL' ? 'ai' : c.analysisMode === 'DEMO' ? 'mock' : 'none',
    notes: c.notes,
    screenshot_path: c.screenshotPath,
    trade_id: c.tradeId,
  };
}

export function rowToSetupCheck(r: Row): SetupCheck {
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const risk = (r.risk ?? {}) as Row;
  const inputs = (r.inputs ?? {}) as Row;
  const decision = r.decision === 'TAKE TRADE' || r.decision === 'STAND DOWN' ? r.decision : 'WAIT';
  const status = (v: unknown) => (v === 'PASS' || v === 'FAIL' ? v : 'UNVERIFIED');
  return {
    id: str(r.id),
    version: 2,
    createdAt: str(r.created_at),
    accountId: (r.account_id as string | null) ?? null,
    strategyId: str(r.strategy_id),
    strategyName: str(r.strategy_name),
    strategyVersion: str(r.strategy_version),
    instrument: str(r.instrument),
    timeframe: (r.timeframe as string | null) ?? null,
    direction: r.direction === 'long' || r.direction === 'short' ? r.direction : 'unsure',
    decision,
    ruleAlignmentScore: num(r.score),
    evidenceConfidence: num(r.evidence_confidence),
    riskCheck: status(r.risk_check),
    propFirmCompliance: r.prop_compliance === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : status(r.prop_compliance),
    passedRequired: num(r.required_passed),
    totalRequired: num(r.required_total),
    evaluatedRules: arr(r.criteria),
    riskChecks: arr(r.risk_checks),
    propChecks: arr(r.prop_checks),
    blockers: arr(r.blockers),
    dollarRisk: numOrNull(risk.dollarRisk),
    reward: numOrNull(risk.reward),
    rr: numOrNull(risk.rr),
    analysisMode: r.analysis_mode === 'REAL' || r.analysis_mode === 'DEMO' ? r.analysis_mode : 'UNAVAILABLE',
    evaluatedBy: r.evaluated_by === 'server' ? 'server' : 'device',
    analysisId: numOrNull(r.analysis_id),
    analysisKey: (r.analysis_key as string | null) ?? null,
    icc: (r.icc as SetupCheck['icc']) ?? null,
    setupDecision: (r.setup_decision as SetupCheck['setupDecision']) ?? null,
    kind: r.kind === 'trade_plan' || r.kind === 'setup_review' ? r.kind : undefined,
    setupType: (r.setup_type as string | null) ?? null,
    inputs: {
      entry: numOrNull(inputs.entry),
      stop: numOrNull(inputs.stop),
      target: numOrNull(inputs.target),
      target2: numOrNull(inputs.target2),
      quantity: numOrNull(inputs.quantity),
      costs: numOrNull(inputs.costs),
      slippage: numOrNull(inputs.slippage),
      reserve: numOrNull(inputs.reserve),
    },
    notes: str(r.notes),
    screenshotUri: null,
    screenshotPath: (r.screenshot_path as string | null) ?? null,
    tradeId: (r.trade_id as string | null) ?? null,
    saved: true,
  };
}
