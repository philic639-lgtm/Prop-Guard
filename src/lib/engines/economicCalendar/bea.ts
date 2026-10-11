import { FeedFormatError } from './ics';
import { dedupeEvents, makeEvent } from './normalize';
import { utcToEastern } from './timezone';
import type { EconomicEvent } from './types';

/**
 * BEA release schedule (JSON). The address is configuration (`ECON_BEA_URL`) — Prop Guard
 * ships no guessed default. The reader looks for a list of release records and takes, from
 * each, a release name and a release date (+ time):
 *
 *   name:  release_name | releaseName | name | title | release
 *   date:  release_date | releaseDate | date | datetime | release_datetime
 *   time:  release_time | releaseTime | time            (optional)
 *
 * Dates may be ISO dates, ISO date-times (with Z / an offset → converted exactly) or
 * "Month D, YYYY". A bare clock time ("8:30 AM") is read as Eastern ONLY when
 * `timesAreEastern` is set (BEA publishes its schedule in Eastern time — confirm this on the
 * first live run); otherwise the time is left unknown. A record without a name or a
 * readable date is skipped, and a feed with no readable records is a format error —
 * never an empty "all clear".
 */
export const BEA_SCHEDULE_PAGE = 'https://www.bea.gov/news/schedule';

const NAME_KEYS = ['release_name', 'releaseName', 'ReleaseName', 'name', 'Name', 'title', 'Title', 'release', 'Release'];
const DATE_KEYS = ['release_date', 'releaseDate', 'ReleaseDate', 'date', 'Date', 'datetime', 'release_datetime', 'releaseDateTime'];
const TIME_KEYS = ['release_time', 'releaseTime', 'ReleaseTime', 'time', 'Time'];
const URL_KEYS = ['url', 'URL', 'link', 'Link'];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n: number) => String(n).padStart(2, '0');

function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** "8:30 AM" / "08:30" / "8:30 a.m. ET" → "08:30" (24 h). */
export function clock(raw: string): string | null {
  const m = /(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const mer = m[3]?.toLowerCase().replace(/\./g, '');
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return h < 24 && Number(m[2]) < 60 ? `${pad(h)}:${m[2]}` : null;
}

/** A date / date-time string → Eastern date (+ time if exact). */
function readWhen(dateRaw: string, timeRaw: string | null, timesAreEastern: boolean): { dateET: string; timeET: string | null; exact: boolean } | null {
  const isoZoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.exec(dateRaw);
  if (isoZoned && !Number.isNaN(Date.parse(dateRaw))) {
    const et = utcToEastern(new Date(dateRaw).toISOString());
    return { ...et, exact: true };
  }
  let dateET: string | null = null;
  let inlineTime: string | null = null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(dateRaw);
  if (iso) {
    dateET = `${iso[1]}-${iso[2]}-${iso[3]}`;
    inlineTime = iso[4] ?? null;
  } else {
    const us = /([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(dateRaw);
    const mi = us ? MONTHS.findIndex((m) => m.startsWith(us[1].toLowerCase().slice(0, 3))) : -1;
    if (us && mi >= 0) dateET = `${us[3]}-${pad(mi + 1)}-${pad(Number(us[2]))}`;
    inlineTime = clock(dateRaw.replace(us?.[0] ?? '', ''));
  }
  if (!dateET) return null;
  const t = timeRaw ? clock(timeRaw) : inlineTime ? clock(inlineTime) : null;
  return t && timesAreEastern ? { dateET, timeET: t, exact: true } : { dateET, timeET: null, exact: false };
}

/** The first array of objects found in the document (the release list). */
function findRecords(doc: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 4 || doc == null) return null;
  if (Array.isArray(doc)) return doc.length && doc.every((x) => x && typeof x === 'object' && !Array.isArray(x)) ? (doc as Record<string, unknown>[]) : null;
  if (typeof doc === 'object') for (const v of Object.values(doc as Record<string, unknown>)) {
    const r = findRecords(v, depth + 1);
    if (r) return r;
  }
  return null;
}

export function parseBeaSchedule(json: unknown, retrievedAt: string, opts: { timesAreEastern?: boolean } = {}): EconomicEvent[] {
  const records = findRecords(json);
  if (!records) throw new FeedFormatError('no release list found in the BEA schedule');
  const out: EconomicEvent[] = [];
  for (const r of records) {
    const title = pick(r, NAME_KEYS);
    const dateRaw = pick(r, DATE_KEYS);
    if (!title || !dateRaw) continue;
    const when = readWhen(dateRaw, pick(r, TIME_KEYS), opts.timesAreEastern === true);
    if (!when) continue;
    out.push(
      makeEvent({
        source: 'bea',
        title,
        dateET: when.dateET,
        timeET: when.timeET,
        timeStatus: when.exact ? 'published' : 'unknown',
        sourceUrl: pick(r, URL_KEYS) ?? BEA_SCHEDULE_PAGE,
        retrievedAt,
      }),
    );
  }
  if (!out.length) throw new FeedFormatError('BEA schedule format not recognised (no record with a release name and date)');
  return dedupeEvents(out);
}
