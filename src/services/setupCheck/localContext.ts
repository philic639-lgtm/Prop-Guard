import type { AccountRiskState, StrategyRecord, TrustedContext } from '@/lib/engines/setupCheck';
import { rulesFromStrategy, systemEvidence } from '@/lib/engines/setupCheck';
import { findInstrument } from '@/lib/engines/instrumentEngine';
import type { Account, Trade, TradingRules } from '@/types/domain';

/**
 * Trusted context computed ON THE DEVICE — used only in demo and manual-only
 * mode (no server). In cloud mode the server computes the same thing from
 * the user's own database rows (supabase/functions/setup-validation).
 */
const etDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
const RISK_FIELDS = ['maxDrawdown', 'dailyLossLimit', 'maxContracts'] as const;

export function accountRiskState(account: Account, trades: Trade[], now: Date): AccountRiskState {
  const mine = trades.filter((t) => t.accountId === account.id);
  const today = etDay(now.toISOString());
  const link = account.firmLink;
  return {
    kind: account.kind,
    balance: account.balance,
    startingBalance: account.startingBalance,
    highWaterMark: account.highWaterMark,
    maxDrawdown: account.rules.maxDrawdown,
    drawdownType: account.rules.drawdownType,
    trailingLocksAtStart: account.rules.trailingLocksAtStart,
    dailyLossLimit: account.rules.dailyLossLimit,
    realizedPnlToday: mine.filter((t) => t.status === 'closed' && t.closedAt && etDay(t.closedAt) === today).reduce((s, t) => s + (t.pnl ?? 0), 0),
    openRisk: mine.filter((t) => t.status === 'open').reduce((s, t) => s + t.riskDollars, 0),
    maxContracts: account.rules.maxContracts,
    verified: link?.status === 'verified' && !RISK_FIELDS.some((f) => link.overrides.includes(f)),
    lastVerifiedAt: link?.lastVerifiedAt ?? null,
    consistencyPct: account.rules.consistencyPct,
    trailingLockOffset: account.rules.calc?.trailingLockOffset ?? null,
    dailyLossMode: account.rules.calc?.dailyLossMode ?? null,
    // Balance and P&L come from the journal — no live broker feed is connected.
    liveData: false,
  };
}

export function localTrustedContext(args: { record: StrategyRecord; instrument: string; account: Account | null; trades: Trade[]; tradingRules: TradingRules; now: Date }): Omit<TrustedContext, 'visionEvidence' | 'analysisMode' | 'iccObservation'> {
  const rules = rulesFromStrategy(args.record);
  const spec = findInstrument(args.instrument);
  return {
    rules,
    systemEvidence: systemEvidence(args.record, rules, args.instrument, args.now),
    instrument: spec ? { pointValue: spec.pointValue, tickSize: spec.tickSize, miniEquivalentRatio: spec.miniEquivalentRatio } : null,
    minimumRR: args.record.minRR,
    maxRisk: args.tradingRules.maxRiskPerTrade,
    account: args.account ? accountRiskState(args.account, args.trades, args.now) : null,
    now: args.now,
    strategyTimeframe: args.record.timeframe,
    strategyName: args.record.name,
  };
}

/** Firm restrictions the trader must confirm (from the account's verified firm snapshot). */
const RESTRICTION_KEYS = ['tradingHours', 'overnight', 'weekend', 'news', 'products', 'hedging', 'vpsVpn', 'automation', 'copyTrading', 'accountSharing', 'scaling', 'scalingTable', 'consistency'];

export function firmRestrictions(account: Account | null): { id: string; label: string; detail: string; status: string }[] {
  if (!account || account.kind !== 'prop') return [];
  const rules = account.firmLink?.snapshot?.rules.filter((r) => RESTRICTION_KEYS.includes(r.key)) ?? [];
  const out: { id: string; label: string; detail: string; status: string }[] = rules.map((r) => ({ id: r.key, label: r.label, detail: r.value, status: r.status }));
  // The account's own consistency rule must be confirmed too (Setup Check never assumes it passes).
  if (account.rules.consistencyPct && !out.some((r) => r.id === 'consistency'))
    out.push({ id: 'consistency', label: 'Consistency rule', detail: `Largest day may not exceed ${account.rules.consistencyPct}% of total profit — confirm this trade keeps today within it.`, status: 'manual' });
  if (!out.length) return [{ id: 'none_applicable', label: 'No other firm restrictions apply', detail: 'Confirm that no other firm rule (session, news, instruments, scaling, consistency…) applies to this setup.', status: 'manual' }];
  return out;
}
