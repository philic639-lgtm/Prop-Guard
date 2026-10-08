import type { Account, PropRules, Trade } from '@/types/domain';
import { dayKey } from '@/utils/dates';

export type RuleStatus = 'ok' | 'warning' | 'breached' | 'info';

export interface RuleEvaluation {
  id: string;
  label: string;
  status: RuleStatus;
  /** Human-readable current value vs. limit. */
  current: string;
  limit: string;
  /** 0..1 — how close the account is to the limit (1 = at limit). */
  proximity: number | null;
  message: string;
}

export interface AccountEvaluation {
  /** Where the numbers come from — never live broker data unless connected. */
  dataBasis: string;
  drawdownFloor: number | null;
  drawdownBuffer: number | null;
  profitToTarget: number | null;
  targetProgress: number | null;
  tradingDays: number;
  rules: RuleEvaluation[];
  breached: boolean;
}

const WARNING_PROXIMITY = 0.75;

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * Lowest balance the account may reach before breaching max drawdown.
 * Supports static, trailing (intraday high-water) and EOD trailing styles.
 */
export function drawdownFloor(account: Account): number | null {
  const { drawdownType, trailingLocksAtStart, calc } = account.rules;
  const maxDrawdown = maxDrawdownAmount(account);
  if (maxDrawdown == null || maxDrawdown <= 0) return null;
  if (drawdownType === 'static') return account.startingBalance - maxDrawdown;
  const trailing = Math.max(account.highWaterMark, account.startingBalance) - maxDrawdown;
  // Lock point: firm-specific offset (e.g. Lucid: start + $100), else the starting balance.
  const lockOffset = calc?.trailingLockOffset ?? (trailingLocksAtStart ? 0 : null);
  return lockOffset != null ? Math.min(trailing, account.startingBalance + lockOffset) : trailing;
}

/** Max drawdown in dollars — fixed amount, or a percentage of the starting balance. */
export function maxDrawdownAmount(account: Account): number | null {
  const { maxDrawdown, calc } = account.rules;
  if (maxDrawdown != null && maxDrawdown > 0) return maxDrawdown;
  if (calc?.maxDrawdownPct != null && calc.maxDrawdownPct > 0) return Math.round(account.startingBalance * calc.maxDrawdownPct) / 100;
  return null;
}

/**
 * Today's daily loss limit in dollars: fixed, scaling (e.g. % of peak
 * end-of-day profit once above a balance) or none (verified for the plan).
 * `undefined` = no daily loss rule configured.
 */
export function dailyLossLimitFor(account: Account): { limit: number | null; mode: 'none' | 'fixed' | 'scaling'; soft: boolean } | undefined {
  const { dailyLossLimit, calc } = account.rules;
  const soft = calc?.dailyLossBreach === 'soft';
  if (calc?.dailyLossMode === 'none') return { limit: null, mode: 'none', soft: false };
  const s = calc?.dailyLossScaling;
  if (s && (s.afterBalance == null || account.highWaterMark > s.afterBalance)) {
    const basis = s.basis === 'peak_eod_profit' ? Math.max(0, account.highWaterMark - account.startingBalance) : account.highWaterMark;
    const scaled = Math.round(basis * s.pct) / 100;
    return { limit: Math.max(scaled, dailyLossLimit ?? 0), mode: 'scaling', soft };
  }
  if (dailyLossLimit != null && dailyLossLimit > 0) return { limit: dailyLossLimit, mode: 'fixed', soft };
  return undefined;
}

export function drawdownBuffer(account: Account): number | null {
  const floor = drawdownFloor(account);
  return floor == null ? null : Math.round((account.balance - floor) * 100) / 100;
}

/** Net realized P/L per trading day for closed trades. */
export function dailyPnl(trades: Trade[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of trades) {
    if (t.status !== 'closed' || t.pnl == null || !t.closedAt) continue;
    const k = dayKey(t.closedAt);
    map.set(k, (map.get(k) ?? 0) + t.pnl);
  }
  return map;
}

function proximityStatus(p: number): RuleStatus {
  if (p >= 1) return 'breached';
  if (p >= WARNING_PROXIMITY) return 'warning';
  return 'ok';
}

/**
 * Evaluate an account against its configured rules. Rules are fully data
 * driven so any firm (or a personal account) can be modelled.
 */
export function evaluateAccount(account: Account, accountTrades: Trade[], now = new Date()): AccountEvaluation {
  const rules: PropRules = account.rules;
  const evaluations: RuleEvaluation[] = [];
  const closed = accountTrades.filter((t) => t.accountId === account.id && t.status === 'closed');
  const byDay = dailyPnl(closed);
  const todayPnl = byDay.get(dayKey(now)) ?? 0;

  // Daily loss limit (fixed / scaling / none for this plan)
  const dll = dailyLossLimitFor(account);
  if (dll?.mode === 'none') {
    evaluations.push({ id: 'daily_loss', label: 'Daily loss limit', status: 'info', current: 'None', limit: 'None', proximity: null, message: 'This plan has no daily loss limit (verified configuration). Your personal daily stop still applies.' });
  } else if (dll?.limit != null && dll.limit > 0) {
    const used = Math.max(0, -todayPnl);
    const p = used / dll.limit;
    evaluations.push({
      id: 'daily_loss',
      label: dll.mode === 'scaling' ? 'Daily loss limit (scaling)' : 'Daily loss limit',
      status: proximityStatus(p),
      current: money(used),
      limit: money(dll.limit),
      proximity: Math.min(1, p),
      message:
        p >= 1
          ? dll.soft
            ? 'Daily loss limit reached — trading is locked until the next session (soft breach).'
            : 'Daily loss limit reached. Stop trading this account today.'
          : p >= WARNING_PROXIMITY
            ? `Close to the daily loss limit — ${money(dll.limit - used)} left today.`
            : `${money(dll.limit - used)} of daily loss remaining.`,
    });
  }

  // Max drawdown
  const floor = drawdownFloor(account);
  const buffer = drawdownBuffer(account);
  const mdd = maxDrawdownAmount(account);
  if (floor != null && buffer != null && mdd) {
    const p = 1 - buffer / mdd;
    const label =
      rules.drawdownType === 'static'
        ? 'Static drawdown'
        : rules.drawdownType === 'eod_trailing'
          ? 'EOD trailing drawdown'
          : 'Trailing drawdown';
    evaluations.push({
      id: 'max_drawdown',
      label,
      status: buffer <= 0 ? 'breached' : proximityStatus(Math.max(0, p)),
      current: `${money(buffer)} buffer`,
      limit: `Floor ${money(floor)}`,
      proximity: Math.min(1, Math.max(0, p)),
      message:
        buffer <= 0
          ? 'Drawdown floor breached.'
          : p >= WARNING_PROXIMITY
            ? `Near the drawdown floor — only ${money(buffer)} left before the account is breached.`
            : `${money(buffer)} above the drawdown floor${rules.calc?.trailingLockOffset != null && floor >= account.startingBalance + rules.calc.trailingLockOffset ? ' (floor locked)' : ''}.`,
    });
  }

  // Profit target
  let profitToTarget: number | null = null;
  let targetProgress: number | null = null;
  if (rules.profitTarget != null && rules.profitTarget > 0) {
    const profit = account.balance - account.cycleStartBalance;
    profitToTarget = Math.max(0, rules.profitTarget - profit);
    targetProgress = Math.max(0, Math.min(1, profit / rules.profitTarget));
    evaluations.push({
      id: 'profit_target',
      label: 'Profit target',
      status: 'info',
      current: money(profit),
      limit: money(rules.profitTarget),
      proximity: targetProgress,
      message: profitToTarget === 0 ? 'Profit target reached.' : `${money(profitToTarget)} to target.`,
    });
  }

  // Consistency rule: largest single day as % of total profit.
  if (rules.consistencyPct != null && rules.consistencyPct > 0) {
    const totalProfit = [...byDay.values()].reduce((a, b) => a + b, 0);
    const bestDay = Math.max(0, ...byDay.values());
    if (totalProfit > 0) {
      const pct = (bestDay / totalProfit) * 100;
      const p = pct / rules.consistencyPct;
      evaluations.push({
        id: 'consistency',
        label: 'Consistency rule',
        status: p > 1 ? 'warning' : proximityStatus(p * 0.9),
        current: `${pct.toFixed(0)}% best day`,
        limit: `${rules.consistencyPct}% max`,
        proximity: Math.min(1, p),
        message:
          p > 1
            ? `Best day is ${pct.toFixed(0)}% of profit. Spread profit across more days before payout.`
            : 'Profit distribution within your consistency rule.',
      });
    } else {
      evaluations.push({
        id: 'consistency',
        label: 'Consistency rule',
        status: 'info',
        current: '—',
        limit: `${rules.consistencyPct}% max`,
        proximity: null,
        message: 'Applies once the account is in profit.',
      });
    }
  }

  const tradingDays = byDay.size;
  if (rules.minTradingDays != null && rules.minTradingDays > 0) {
    evaluations.push({
      id: 'min_days',
      label: 'Minimum trading days',
      status: 'info',
      current: `${tradingDays} days`,
      limit: `${rules.minTradingDays} days`,
      proximity: Math.min(1, tradingDays / rules.minTradingDays),
      message:
        tradingDays >= rules.minTradingDays
          ? 'Minimum trading days met.'
          : `${rules.minTradingDays - tradingDays} more trading days required.`,
    });
  }

  if (rules.maxTradingDays != null && rules.maxTradingDays > 0) {
    const p = tradingDays / rules.maxTradingDays;
    evaluations.push({
      id: 'max_days',
      label: 'Maximum trading days',
      status: proximityStatus(p),
      current: `${tradingDays} days`,
      limit: `${rules.maxTradingDays} days`,
      proximity: Math.min(1, p),
      message: `${Math.max(0, rules.maxTradingDays - tradingDays)} trading days left.`,
    });
  }

  if (rules.payoutThreshold != null && rules.payoutThreshold > 0) {
    const profit = account.balance - account.cycleStartBalance;
    evaluations.push({
      id: 'payout',
      label: 'Payout threshold',
      status: 'info',
      current: money(profit),
      limit: money(rules.payoutThreshold),
      proximity: Math.max(0, Math.min(1, profit / rules.payoutThreshold)),
      message:
        profit >= rules.payoutThreshold
          ? 'Payout threshold reached.'
          : `${money(rules.payoutThreshold - profit)} until payout threshold.`,
    });
  }

  // Typed payout eligibility (verified firm configuration).
  const payout = rules.calc?.payout;
  if (payout) {
    const profit = account.balance - account.cycleStartBalance;
    const parts: string[] = [];
    let met = true;
    if (payout.cycleProfitGoal != null) {
      parts.push(`${money(Math.max(0, profit))} / ${money(payout.cycleProfitGoal)} cycle profit`);
      if (profit < payout.cycleProfitGoal) met = false;
    }
    if (payout.minProfitableDays != null && payout.minDayProfit != null) {
      const good = [...byDay.values()].filter((v) => v >= payout.minDayProfit!).length;
      parts.push(`${good} / ${payout.minProfitableDays} days ≥ ${money(payout.minDayProfit)}`);
      if (good < payout.minProfitableDays) met = false;
    }
    let available: number | null = null;
    if (payout.bufferAboveStart != null) {
      available = account.balance - (account.startingBalance + payout.bufferAboveStart);
      parts.push(`${money(Math.max(0, available))} above the payout buffer`);
      if (available < (payout.minRequest ?? 0)) met = false;
    }
    if (payout.minRequest != null && available == null && profit < payout.minRequest) met = false;
    evaluations.push({
      id: 'payout_eligibility',
      label: 'Payout eligibility',
      status: 'info',
      current: met ? 'Requirements met' : 'Not yet',
      limit: payout.minRequest != null ? `Min request ${money(payout.minRequest)}` : '—',
      proximity: null,
      message: `${parts.join(' · ') || 'See the firm’s payout rules.'}. Based on your journal — confirm in your firm dashboard before requesting.`,
    });
  }

  if (rules.maxContracts != null && rules.maxContracts > 0) {
    const maxUsed = closed
      .filter((t) => t.closedAt && dayKey(t.closedAt) === dayKey(now))
      .reduce((m, t) => Math.max(m, t.contracts), 0);
    evaluations.push({
      id: 'max_contracts',
      label: 'Max contracts',
      status: maxUsed > rules.maxContracts ? 'breached' : 'ok',
      current: `${maxUsed} today`,
      limit: `${rules.maxContracts}`,
      proximity: Math.min(1, maxUsed / rules.maxContracts),
      message: `Position size capped at ${rules.maxContracts} contracts.`,
    });
  }

  for (const custom of rules.custom) {
    evaluations.push({
      id: `custom_${custom.id}`,
      label: custom.label,
      status: 'info',
      current: '—',
      limit: '—',
      proximity: null,
      message: custom.description || 'Custom rule — tracked manually.',
    });
  }

  return {
    dataBasis: 'Based on the balance you entered and the trades in your journal — not live broker data.',
    drawdownFloor: floor,
    drawdownBuffer: buffer,
    profitToTarget,
    targetProgress,
    tradingDays,
    rules: evaluations,
    breached: evaluations.some((e) => e.status === 'breached'),
  };
}

export const EMPTY_PROP_RULES: PropRules = {
  dailyLossLimit: null,
  maxDrawdown: null,
  drawdownType: 'trailing',
  trailingLocksAtStart: true,
  profitTarget: null,
  maxContracts: null,
  consistencyPct: null,
  minTradingDays: null,
  maxTradingDays: null,
  payoutThreshold: null,
  custom: [],
};
