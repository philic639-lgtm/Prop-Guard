import { LIMIT_SOURCE_LABEL, type DailyGuard } from './dailyGuardEngine';
import type { NewsRisk } from './economicCalendar';

/**
 * Personalized news alert: a scheduled release (from the official calendar) combined with the
 * SELECTED account's cushion (Daily Guard) and the trader's own risk limit. Guidance only — it
 * never blocks a trade, never predicts the release, and never treats an unknown cushion as room.
 */
export type NewsCushionLevel = 'info' | 'warning' | 'danger';

export interface NewsCushionAlert {
  level: NewsCushionLevel;
  /** One line about the account's cushion, always naming the limit it comes from. */
  cushionLine: string;
  /** Further plain-language lines (drawdown verification, snapshot age, guidance). */
  notes: string[];
  /** Room before the binding limit, or null when it cannot be established. */
  cushion: number | null;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function newsCushionAlert(risk: NewsRisk, guard: DailyGuard | null, maxRiskPerTrade: number, accountName?: string): NewsCushionAlert | null {
  if (risk.state === 'clear') return null;
  const near = risk.state === 'in_window' || risk.state === 'approaching';
  const high = risk.impact === 'high';
  const notes: string[] = [];
  if (!guard)
    return { level: 'warning', cushion: null, notes, cushionLine: 'No account selected — Prop Guard can’t compare this release with your cushion.' };

  const who = accountName ? `${accountName}: ` : '';
  let cushion: number | null = guard.riskRemainingSource === 'none' ? null : guard.riskRemaining;
  let cushionLine: string;
  if (guard.drawdownUnknown) {
    cushion = null;
    cushionLine = `${who}drawdown floor needs verification — your cushion is unknown.`;
  } else if (guard.status === 'STOP') {
    cushionLine = `${who}Daily Guard says stop — ${guard.reasons[0] ?? 'a limit is reached'}`;
  } else if (cushion == null) {
    cushionLine = `${who}no daily loss limit set — your cushion can’t be measured.`;
  } else {
    cushionLine = `${who}${usd(cushion)} left before ${LIMIT_SOURCE_LABEL[guard.riskRemainingSource]}.`;
  }

  let thin = cushion == null || guard.status === 'STOP';
  if (cushion != null && guard.status !== 'STOP') {
    if (maxRiskPerTrade <= 0) {
      notes.push('No max risk per trade is set — a news move can’t be compared with your plan.');
      thin = true;
    } else if (cushion < maxRiskPerTrade) {
      notes.push(`Less than one full-risk trade (${usd(maxRiskPerTrade)}) left — a news spike or slippage could take the rest.`);
      thin = true;
    } else if (cushion < maxRiskPerTrade * 2) {
      notes.push(`Less than two full-risk trades (${usd(maxRiskPerTrade)} each) left.`);
    }
  }
  if (guard.drawdownMinimum) notes.push('Intraday trailing floor — the room shown is a maximum; re-confirm the threshold from your dashboard.');
  if (guard.snapshot) notes.push(guard.snapshot.stale ? 'Cushion from an earlier day’s screenshot — update the account first.' : 'Cushion from your latest screenshot plus journaled trades — not live.');

  const level: NewsCushionLevel = near && high && thin ? 'danger' : thin || (near && high) ? 'warning' : 'info';
  return { level, cushion, cushionLine, notes };
}
