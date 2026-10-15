import { formatClock } from './timezone';
import type { EconCode, EconomicEvent, FeedId, FeedStatus } from './types';

/**
 * Which scheduled releases matter for US equity-index futures (ES, MES, NQ, MNQ) and how
 * wide the caution window is around each. Deterministic and transparent: the same table
 * drives the list, the warnings and the notifications, and the app shows the "why".
 * Override any entry with `NewsRuleConfig.overrides`.
 */
export type Impact = 'high' | 'medium' | 'low';

export interface ImpactRule {
  impact: Impact;
  /** Caution window around the release time (minutes). */
  beforeMin: number;
  afterMin: number;
  why: string;
}

export const DEFAULT_INSTRUMENTS = ['ES', 'MES', 'NQ', 'MNQ'] as const;

export const IMPACT_RULES: Record<EconCode, ImpactRule> = {
  CPI: { impact: 'high', beforeMin: 15, afterMin: 15, why: 'Inflation print — repricing of Fed expectations moves index futures sharply at 8:30 AM ET.' },
  NFP: { impact: 'high', beforeMin: 15, afterMin: 15, why: 'Monthly jobs report — one of the largest scheduled volatility events for index futures.' },
  FOMC_STATEMENT: { impact: 'high', beforeMin: 15, afterMin: 30, why: 'Fed rate decision — prices can gap and reverse within seconds of the statement.' },
  FOMC_PRESS_CONFERENCE: { impact: 'high', beforeMin: 0, afterMin: 60, why: 'Fed Chair press conference — follow-through and reversals continue for the hour.' },
  PCE: { impact: 'high', beforeMin: 15, afterMin: 15, why: 'The Fed’s preferred inflation gauge (PCE price index).' },
  GDP: { impact: 'high', beforeMin: 15, afterMin: 15, why: 'Quarterly growth estimate — the advance estimate in particular can move index futures.' },
  PPI: { impact: 'medium', beforeMin: 5, afterMin: 10, why: 'Producer inflation — often moves futures, usually less than CPI.' },
  JOLTS: { impact: 'medium', beforeMin: 5, afterMin: 10, why: 'Job openings — a labour-market signal released at 10:00 AM ET during the session.' },
  ECI: { impact: 'medium', beforeMin: 5, afterMin: 10, why: 'Quarterly labour-cost inflation.' },
  FOMC_MINUTES: { impact: 'medium', beforeMin: 5, afterMin: 15, why: 'Minutes of the previous Fed meeting, released at 2:00 PM ET.' },
  TRADE: { impact: 'low', beforeMin: 0, afterMin: 5, why: 'Trade balance — rarely moves index futures on its own.' },
  PRODUCTIVITY: { impact: 'low', beforeMin: 0, afterMin: 5, why: 'Productivity and unit labour costs — usually a minor mover.' },
  IMPORT_PRICES: { impact: 'low', beforeMin: 0, afterMin: 5, why: 'Import / export prices — usually a minor mover.' },
  REAL_EARNINGS: { impact: 'low', beforeMin: 0, afterMin: 0, why: 'Released together with CPI; covered by the CPI window.' },
  STATE_EMPLOYMENT: { impact: 'low', beforeMin: 0, afterMin: 0, why: 'State-level jobs data — not a market mover for index futures.' },
  OTHER: { impact: 'low', beforeMin: 0, afterMin: 0, why: 'Not in Prop Guard’s impact table.' },
};

export interface NewsRuleConfig {
  /** Instruments the trader trades (the table above covers US equity-index futures). */
  instruments: string[];
  /** Lowest impact that produces warnings and alerts. */
  minImpact: Impact;
  /** "Approaching" warning starts this many minutes before a window. */
  lookaheadMin: number;
  /** Suggested size inside a caution window, as a fraction of usual size (guidance only). */
  sizeFactor: number;
  overrides?: Partial<Record<EconCode, Partial<ImpactRule>>>;
  /** The trader's time zone for displayed times (IANA, e.g. America/Los_Angeles); Eastern when unset. */
  displayZone?: string;
}

export const DEFAULT_NEWS_RULES: NewsRuleConfig = { instruments: [...DEFAULT_INSTRUMENTS], minImpact: 'high', lookaheadMin: 60, sizeFactor: 0.5 };

const RANK: Record<Impact, number> = { high: 3, medium: 2, low: 1 };
const INDEX = new Set<string>(DEFAULT_INSTRUMENTS);

export function ruleFor(code: EconCode, cfg: NewsRuleConfig = DEFAULT_NEWS_RULES): ImpactRule {
  return { ...IMPACT_RULES[code], ...(cfg.overrides?.[code] ?? {}) };
}

/** Does this release matter for the trader's instruments at the configured impact level? */
export function isRelevant(e: EconomicEvent, cfg: NewsRuleConfig = DEFAULT_NEWS_RULES): boolean {
  if (!e.active || e.kind !== 'scheduled_release') return false;
  if (!cfg.instruments.some((i) => INDEX.has(i.toUpperCase()))) return false;
  return RANK[ruleFor(e.code, cfg).impact] >= RANK[cfg.minImpact];
}

/** Upcoming relevant releases (by date when the time is unknown), soonest first. */
export function upcoming(events: EconomicEvent[], now: Date, days: number, cfg: NewsRuleConfig = DEFAULT_NEWS_RULES): EconomicEvent[] {
  const from = now.getTime();
  const to = from + days * 86_400_000;
  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  return events
    .filter((e) => isRelevant(e, cfg))
    .filter((e) => {
      if (e.startsAt) {
        const t = Date.parse(e.startsAt);
        return t + ruleFor(e.code, cfg).afterMin * 60_000 >= from && t <= to;
      }
      return e.dateET >= todayET && Date.parse(`${e.dateET}T12:00:00Z`) <= to;
    })
    .sort((a, b) => (a.startsAt ?? `${a.dateET}T99`).localeCompare(b.startsAt ?? `${b.dateET}T99`));
}

export type NewsRiskState = 'clear' | 'approaching' | 'in_window' | 'time_unconfirmed';

export interface NewsRisk {
  state: NewsRiskState;
  event: EconomicEvent | null;
  impact: Impact | null;
  windowStart: string | null;
  windowEnd: string | null;
  /** Minutes until the release (negative once it has happened). */
  minutesToRelease: number | null;
  headline: string;
  /** Prop Guard guidance — suggestions, never a block and never a prediction. */
  guidance: string[];
}


/** The most pressing scheduled release right now for the trader's instruments. */
export function newsRisk(events: EconomicEvent[], now: Date, cfg: NewsRuleConfig = DEFAULT_NEWS_RULES): NewsRisk {
  // Times in the trader's zone with that date's abbreviation (EST / EDT, PST / PDT …).
  const hhmm = (iso: string) => formatClock(iso, cfg.displayZone);
  const t = now.getTime();
  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  const relevant = events.filter((e) => isRelevant(e, cfg));
  const timed = relevant
    .filter((e) => e.startsAt)
    .map((e) => {
      const r = ruleFor(e.code, cfg);
      const at = Date.parse(e.startsAt!);
      return { e, r, at, start: at - r.beforeMin * 60_000, end: at + r.afterMin * 60_000 };
    })
    .filter((x) => x.end >= t)
    .sort((a, b) => a.start - b.start || RANK[b.r.impact] - RANK[a.r.impact]);
  const usual = (e: EconomicEvent) => (e.timeStatus === 'conventional' ? ' (usual time — confirm on the official calendar)' : '');
  const size = `smaller size (e.g. ${Math.round(cfg.sizeFactor * 100)}% of usual)`;

  const inside = timed.find((x) => x.start <= t && t <= x.end);
  if (inside) {
    const high = inside.r.impact === 'high';
    return {
      state: 'in_window',
      event: inside.e,
      impact: inside.r.impact,
      windowStart: new Date(inside.start).toISOString(),
      windowEnd: new Date(inside.end).toISOString(),
      minutesToRelease: Math.round((inside.at - t) / 60_000),
      headline: `${inside.e.name} ${inside.at > t ? `at ${hhmm(inside.e.startsAt!)}` : `released at ${hhmm(inside.e.startsAt!)}`}${usual(inside.e)}`,
      guidance: [
        high ? `Consider avoiding new entries until ${hhmm(new Date(inside.end).toISOString())}.` : `Expect faster moves until ${hhmm(new Date(inside.end).toISOString())}.`,
        `If you trade, consider ${size} and a stop you can actually get filled at.`,
        'Spreads widen and stops can slip around scheduled releases.',
      ],
    };
  }
  const next = timed.find((x) => x.start > t && x.start - t <= cfg.lookaheadMin * 60_000);
  if (next) {
    const mins = Math.round((next.at - t) / 60_000);
    return {
      state: 'approaching',
      event: next.e,
      impact: next.r.impact,
      windowStart: new Date(next.start).toISOString(),
      windowEnd: new Date(next.end).toISOString(),
      minutesToRelease: mins,
      headline: `${next.e.name} at ${hhmm(next.e.startsAt!)} — in ${mins} min${usual(next.e)}`,
      guidance: [
        next.r.impact === 'high' ? 'Consider being flat, or reducing size, before the release.' : 'Consider tightening risk before the release.',
        `Caution window: ${hhmm(new Date(next.start).toISOString())}–${hhmm(new Date(next.end).toISOString())}.`,
      ],
    };
  }
  const unknownToday = relevant.find((e) => !e.startsAt && e.dateET === todayET);
  if (unknownToday) {
    return {
      state: 'time_unconfirmed',
      event: unknownToday,
      impact: ruleFor(unknownToday.code, cfg).impact,
      windowStart: null,
      windowEnd: null,
      minutesToRelease: null,
      headline: `${unknownToday.name} today — release time not confirmed`,
      guidance: ['Check the release time on the official calendar before trading.'],
    };
  }
  return { state: 'clear', event: null, impact: null, windowStart: null, windowEnd: null, minutesToRelease: null, headline: 'No major scheduled release in the next hour', guidance: [] };
}

// ───────────────────────────── Freshness ─────────────────────────────

export type Freshness = 'fresh' | 'stale' | 'failing' | 'never' | 'not_configured';

/**
 * What the app shows per source:
 * - Connected   the last refresh succeeded and is recent;
 * - Stale       data exists, but the last refresh failed or is too old — releases may have changed;
 * - Unavailable never loaded (or not configured) — the app has NO data from this source.
 * None of them is ever read as "no upcoming news".
 */
export type SourceConnection = 'connected' | 'stale' | 'unavailable';
export const CONNECTION_LABEL: Record<SourceConnection, string> = { connected: 'Connected', stale: 'Stale', unavailable: 'Unavailable' };

export function connectionOf(state: Freshness, lastSuccessAt: string | null): SourceConnection {
  if (state === 'fresh') return 'connected';
  return lastSuccessAt ? 'stale' : 'unavailable';
}

export interface CalendarFreshness {
  perSource: { source: FeedId; state: Freshness; connection: SourceConnection; lastSuccessAt: string | null; error: string | null }[];
  /** True when any source is missing, failing or older than `maxAgeHours`: events may be missing. */
  degraded: boolean;
  /** Oldest successful refresh across sources (what the app calls "last refreshed"). */
  lastRefreshedAt: string | null;
}

export function calendarFreshness(statuses: FeedStatus[], now: Date, maxAgeHours = 36, sources: FeedId[] = ['bls', 'bea', 'fed']): CalendarFreshness {
  const perSource = sources.map((source) => {
    const s = statuses.find((x) => x.source === source);
    let state: Freshness;
    if (!s || s.status === 'never') state = s?.error === 'not configured' ? 'not_configured' : 'never';
    else if (s.error === 'not configured') state = 'not_configured';
    else if (!s.lastSuccessAt) state = 'failing';
    else if (now.getTime() - Date.parse(s.lastSuccessAt) > maxAgeHours * 3_600_000) state = 'stale';
    else state = s.status === 'error' ? 'failing' : 'fresh';
    return { source, state, connection: connectionOf(state, s?.lastSuccessAt ?? null), lastSuccessAt: s?.lastSuccessAt ?? null, error: s?.error ?? null };
  });
  const ok = perSource.map((p) => p.lastSuccessAt).filter((x): x is string => !!x).sort();
  return { perSource, degraded: perSource.some((p) => p.state !== 'fresh'), lastRefreshedAt: ok[0] ?? null };
}
