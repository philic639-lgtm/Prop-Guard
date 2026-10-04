/**
 * US/Eastern market-time helpers (DST-aware via Intl). Futures sessions,
 * opening ranges and "time of day" features are all defined in ET.
 */

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});

export interface EtParts {
  /** ET calendar date YYYY-MM-DD. */
  date: string;
  /** Minutes after ET midnight. */
  minutes: number;
  weekday: number;
}

const cache = new Map<number, EtParts>();
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** ET date/time for a UTC instant (memoized per minute). */
export function etParts(iso: string | number): EtParts {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  const key = Math.floor(ms / 60_000);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const out = { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: WD[p.weekday as string] ?? 0 };
  if (cache.size > 200_000) cache.clear();
  cache.set(key, out);
  return out;
}

const offsetCache = new Map<string, number>();

/** Minutes ET is behind UTC on a date at midday (DST changes happen at 2am, outside market hours). */
function etOffsetMinutes(date: string): number {
  const hit = offsetCache.get(date);
  if (hit != null) return hit;
  const noonUtc = Date.parse(`${date}T17:00:00Z`);
  const p = etParts(noonUtc);
  const off = 17 * 60 - p.minutes + (p.date === date ? 0 : p.date < date ? 24 * 60 : -24 * 60);
  offsetCache.set(date, off);
  return off;
}

/** UTC ISO timestamp for an ET wall-clock time on an ET date. */
export function etToUtcIso(date: string, minutes: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (minutes + etOffsetMinutes(date)) * 60_000).toISOString();
}

export const RTH_OPEN = 9 * 60 + 30;
export const RTH_CLOSE = 16 * 60;

export function isWeekday(date: string): boolean {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}

/** ET dates (weekdays) between two ISO instants, inclusive of the start date. */
export function etWeekdaysBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let d = new Date(`${etParts(startIso).date}T12:00:00Z`);
  const end = Date.parse(endIso);
  while (Date.parse(etToUtcIso(d.toISOString().slice(0, 10), 0)) < end) {
    const s = d.toISOString().slice(0, 10);
    if (isWeekday(s)) out.push(s);
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

export type MarketSession = 'ny_open' | 'ny_morning' | 'ny_midday' | 'ny_afternoon' | 'overnight';

export function marketSessionAt(minutes: number): MarketSession {
  if (minutes >= RTH_OPEN && minutes < 10 * 60 + 30) return 'ny_open';
  if (minutes >= 10 * 60 + 30 && minutes < 12 * 60) return 'ny_morning';
  if (minutes >= 12 * 60 && minutes < 13 * 60 + 30) return 'ny_midday';
  if (minutes >= 13 * 60 + 30 && minutes < RTH_CLOSE) return 'ny_afternoon';
  return 'overnight';
}
