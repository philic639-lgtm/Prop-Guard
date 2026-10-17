import type { DisciplineEvent, SessionReview, Trade, TradingRules } from '@/types/domain';

import { computeStats } from './analyticsEngine';
import { VIOLATION_TYPES } from './disciplineEngine';

export interface SessionSummary {
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  rulesFollowedPct: number;
  violations: DisciplineEvent[];
  /** Minutes between a loss and the next entry, when shorter than the cooldown. */
  cooldownGaps: number[];
}

export function summarizeSession(
  trades: Trade[],
  events: DisciplineEvent[],
  rules: TradingRules,
): SessionSummary {
  const stats = computeStats(trades);
  const followed = trades.reduce((s, t) => s + t.rulesFollowed.length, 0);
  const violated = trades.reduce((s, t) => s + t.rulesViolated.length, 0);
  const violations = events.filter((e) => VIOLATION_TYPES.has(e.type));
  const totalRules = followed + violated + violations.length;

  const sorted = [...trades].sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if ((prev.pnl ?? 0) < 0 && prev.closedAt) {
      const gap = (Date.parse(sorted[i].openedAt) - Date.parse(prev.closedAt)) / 60_000;
      if (gap < rules.cooldownMinutes) gaps.push(Math.max(0, Math.round(gap)));
    }
  }

  return {
    netPnl: stats.netPnl,
    trades: trades.length,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
    avgR: stats.avgR,
    rulesFollowedPct: totalRules === 0 ? 100 : Math.round((followed / totalRules) * 100),
    violations,
    cooldownGaps: gaps,
  };
}

/**
 * Deterministic session review used offline and as the AI fallback.
 * Focuses on process, never on "you should have taken more trades".
 */
export function localSessionReview(summary: SessionSummary, rules: TradingRules): SessionReview {
  const strengths: string[] = [];
  const improvements: string[] = [];

  if (summary.trades === 0) {
    return {
      summary: 'No trades taken. Sitting out when nothing meets your criteria is a valid, disciplined outcome.',
      strengths: ['Protected capital by not forcing trades.'],
      improvements: [],
      focusTomorrow: 'Review your pre-session plan and wait for your A-quality setup.',
      generatedAt: new Date().toISOString(),
      source: 'local',
    };
  }

  if (summary.violations.length === 0) strengths.push('No rule overrides recorded this session.');
  if (summary.trades <= rules.maxTradesPerDay) strengths.push(`Stayed within your ${rules.maxTradesPerDay}-trade limit.`);
  if (summary.rulesFollowedPct >= 90) strengths.push('Followed your entry criteria consistently.');

  for (const gap of summary.cooldownGaps) {
    improvements.push(
      `A trade was entered ${gap} minute${gap === 1 ? '' : 's'} after a loss despite a configured ${rules.cooldownMinutes}-minute cooldown.`,
    );
  }
  const widened = summary.violations.filter((v) => v.type === 'STOP_WIDENED').length;
  if (widened > 0) improvements.push(`Stop was widened ${widened} time${widened > 1 ? 's' : ''}. Keep the original stop.`);
  const overrides = summary.violations.filter((v) => v.type === 'RULE_OVERRIDDEN').length;
  if (overrides > 0) improvements.push(`${overrides} rule override${overrides > 1 ? 's' : ''} recorded.`);

  let focus = 'Repeat the process: same checklist, same risk.';
  if (summary.cooldownGaps.length > 0) focus = 'Respect the cooldown rule.';
  else if (widened > 0) focus = 'Never widen a stop after entry.';
  else if (overrides > 0) focus = 'Let the rules decide — no overrides.';

  const pnl = `${summary.netPnl >= 0 ? '+' : '-'}$${Math.abs(summary.netPnl).toFixed(0)}`;
  return {
    summary: `${summary.trades} trade${summary.trades > 1 ? 's' : ''}, ${pnl} net. Rules followed ${summary.rulesFollowedPct}% of the time.`,
    strengths,
    improvements,
    focusTomorrow: focus,
    generatedAt: new Date().toISOString(),
    source: 'local',
  };
}

export interface SessionFlags {
  revengeTrading: boolean;
  overtrading: boolean;
  riskBreaches: number;
  stopWidened: number;
  ruleAdherencePct: number;
  /** 0-100: share of trades whose planned risk stayed within the per-trade limit. */
  riskDiscipline: number;
}

/** Behavioural flags for the AI session summary. Discipline-first, P/L-agnostic. */
export function sessionFlags(summary: SessionSummary, trades: Trade[], rules: TradingRules): SessionFlags {
  const counted = trades.filter((t) => t.status !== 'cancelled');
  const withinRisk = counted.filter((t) => t.riskDollars <= rules.maxRiskPerTrade + 1e-9).length;
  const riskEvents = summary.violations.filter((v) => v.category === 'risk').length;
  return {
    revengeTrading: summary.cooldownGaps.length > 0 || summary.violations.some((v) => v.type === 'COOLDOWN_BROKEN'),
    overtrading: counted.length > rules.maxTradesPerDay || summary.violations.some((v) => v.category === 'trade_limit'),
    riskBreaches: Math.max(riskEvents, counted.length - withinRisk),
    stopWidened: summary.violations.filter((v) => v.type === 'STOP_WIDENED').length,
    ruleAdherencePct: summary.rulesFollowedPct,
    riskDiscipline: counted.length === 0 ? 100 : Math.round((withinRisk / counted.length) * 100),
  };
}
