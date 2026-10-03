import type { DisciplineCategory, DisciplineEvent, DisciplineEventType, Trade } from '@/types/domain';
import { dayKey } from '@/utils/dates';

/**
 * Discipline Score — measures ADHERENCE to the trader's own rules.
 * P/L is deliberately not an input: a disciplined losing day scores well,
 * an undisciplined winning day does not.
 */

export type DisciplineComponentKey = 'risk' | 'entry' | 'tradeLimits' | 'stop' | 'cooldown' | 'journal' | 'consistency';

export interface DisciplineComponent {
  key: DisciplineComponentKey;
  label: string;
  score: number;
  weight: number;
  violations: number;
}

export interface DisciplineScore {
  score: number;
  label: string;
  tone: 'positive' | 'accent' | 'warning' | 'danger';
  hasData: boolean;
  components: DisciplineComponent[];
  rulesFollowed: number;
  rulesTotal: number;
}

export interface DisciplinePoint {
  date: string;
  score: number;
}

export const VIOLATION_TYPES: ReadonlySet<DisciplineEventType> = new Set([
  'RULE_OVERRIDDEN',
  'STOP_WIDENED',
  'COOLDOWN_BROKEN',
  'STRATEGY_VIOLATION',
]);

const COMPONENTS: { key: DisciplineComponentKey; label: string; weight: number; categories: DisciplineCategory[] }[] = [
  { key: 'risk', label: 'Risk Discipline', weight: 0.25, categories: ['risk'] },
  { key: 'entry', label: 'Entry Discipline', weight: 0.2, categories: ['entry', 'strategy'] },
  { key: 'tradeLimits', label: 'Trade Limits', weight: 0.15, categories: ['trade_limit'] },
  { key: 'stop', label: 'Stop Discipline', weight: 0.15, categories: ['stop'] },
  { key: 'cooldown', label: 'Cooldown', weight: 0.1, categories: ['cooldown'] },
  { key: 'journal', label: 'Journal', weight: 0.1, categories: ['journal'] },
  { key: 'consistency', label: 'Strategy Consistency', weight: 0.05, categories: [] },
];

export function disciplineLabel(score: number): { label: string; tone: DisciplineScore['tone'] } {
  if (score >= 90) return { label: 'Elite discipline', tone: 'positive' };
  if (score >= 80) return { label: 'Strong discipline', tone: 'positive' };
  if (score >= 65) return { label: 'Developing', tone: 'accent' };
  if (score >= 50) return { label: 'Inconsistent', tone: 'warning' };
  return { label: 'At risk', tone: 'danger' };
}

function categoryOf(e: DisciplineEvent): DisciplineCategory {
  if (e.type === 'STOP_WIDENED') return 'stop';
  if (e.type === 'COOLDOWN_BROKEN') return 'cooldown';
  return e.category;
}

/** Count distinct violated trades (or standalone events) for a set of categories. */
function countViolations(events: DisciplineEvent[], categories: DisciplineCategory[]): number {
  const keys = new Set<string>();
  for (const e of events) {
    if (!VIOLATION_TYPES.has(e.type)) continue;
    if (!categories.includes(categoryOf(e))) continue;
    keys.add(e.tradeId ?? `event:${e.id}`);
  }
  return keys.size;
}

export function computeDisciplineScore(trades: Trade[], events: DisciplineEvent[]): DisciplineScore {
  const relevant = trades.filter((t) => t.status !== 'cancelled');
  const closed = relevant.filter((t) => t.status === 'closed');
  const n = relevant.length;

  if (n === 0) {
    const { label, tone } = disciplineLabel(100);
    return {
      score: 100,
      label: events.length ? label : 'No trades yet',
      tone,
      hasData: false,
      components: COMPONENTS.map((c) => ({ key: c.key, label: c.label, score: 100, weight: c.weight, violations: 0 })),
      rulesFollowed: 0,
      rulesTotal: 0,
    };
  }

  // Primary strategy = the most-used strategy in the window.
  const counts = new Map<string, number>();
  for (const t of relevant) if (t.strategyId) counts.set(t.strategyId, (counts.get(t.strategyId) ?? 0) + 1);
  const primary = Math.max(0, ...counts.values());

  const components: DisciplineComponent[] = COMPONENTS.map((c) => {
    if (c.key === 'journal') {
      const done = closed.filter((t) => t.journaled).length;
      const score = closed.length === 0 ? 100 : Math.round((done / closed.length) * 100);
      return { key: c.key, label: c.label, weight: c.weight, score, violations: closed.length - done };
    }
    if (c.key === 'consistency') {
      return {
        key: c.key,
        label: c.label,
        weight: c.weight,
        score: Math.round((primary / n) * 100),
        violations: n - primary,
      };
    }
    const v = Math.min(n, countViolations(events, c.categories));
    return { key: c.key, label: c.label, weight: c.weight, score: Math.round(((n - v) / n) * 100), violations: v };
  });

  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0));
  const { label, tone } = disciplineLabel(score);

  // Rules followed: each trade's checked rules + violation events as failures.
  const rulesFollowed = relevant.reduce((s, t) => s + t.rulesFollowed.length, 0);
  const rulesViolated = relevant.reduce((s, t) => s + t.rulesViolated.length, 0);
  const overrideCount = events.filter((e) => VIOLATION_TYPES.has(e.type)).length;

  return {
    score,
    label,
    tone,
    hasData: true,
    components,
    rulesFollowed,
    rulesTotal: rulesFollowed + rulesViolated + overrideCount,
  };
}

/** Per-trade discipline: 100 minus 25 per violation recorded against the trade. */
export function tradeDisciplineScore(tradeId: string, events: DisciplineEvent[]): number {
  const v = events.filter((e) => e.tradeId === tradeId && VIOLATION_TYPES.has(e.type)).length;
  return Math.max(0, 100 - v * 25);
}

/** Daily discipline timeline, oldest first. */
export function disciplineTimeline(trades: Trade[], events: DisciplineEvent[]): DisciplinePoint[] {
  const days = new Map<string, { trades: Trade[]; events: DisciplineEvent[] }>();
  for (const t of trades) {
    if (t.status === 'cancelled') continue;
    const k = dayKey(t.openedAt);
    if (!days.has(k)) days.set(k, { trades: [], events: [] });
    days.get(k)!.trades.push(t);
  }
  for (const e of events) {
    const k = dayKey(e.at);
    days.get(k)?.events.push(e);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, score: computeDisciplineScore(d.trades, d.events).score }));
}
