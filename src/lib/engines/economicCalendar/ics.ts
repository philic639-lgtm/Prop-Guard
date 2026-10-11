import { dedupeEvents, makeEvent } from './normalize';
import { isEastern, utcToEastern } from './timezone';
import type { EconomicEvent } from './types';

/**
 * BLS release calendar (iCalendar / RFC 5545). Minimal, strict reader: unfolds lines,
 * reads each VEVENT's SUMMARY, UID, URL and DTSTART. A DTSTART is accepted only as
 *   - UTC (`…Z`),
 *   - a local time with an Eastern TZID, or
 *   - a date (`VALUE=DATE`, time unknown).
 * Any other time zone is NOT guessed: the event keeps its date and an unknown time.
 */
export const BLS_ICS_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';
export const BLS_SCHEDULE_PAGE = 'https://www.bls.gov/schedule/news_release/';

export class FeedFormatError extends Error {}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

const unescape = (v: string) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}
function prop(line: string): Prop | null {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const [name, ...ps] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of ps) {
    const [k, v] = p.split('=');
    if (k && v != null) params[k.toUpperCase()] = v;
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

/** DTSTART → Eastern date + time + how sure we are. */
function readStart(p: Prop): { dateET: string; timeET: string | null; known: boolean } | null {
  const v = p.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date || p.params.VALUE === 'DATE') {
    const m = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    return m ? { dateET: `${m[1]}-${m[2]}-${m[3]}`, timeET: null, known: false } : null;
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!dt) return null;
  if (dt[7] === 'Z') {
    const iso = `${dt[1]}-${dt[2]}-${dt[3]}T${dt[4]}:${dt[5]}:${dt[6]}Z`;
    const et = utcToEastern(iso);
    return { dateET: et.dateET, timeET: et.timeET, known: true };
  }
  const local = { dateET: `${dt[1]}-${dt[2]}-${dt[3]}`, timeET: `${dt[4]}:${dt[5]}` };
  if (p.params.TZID && isEastern(p.params.TZID)) return { ...local, known: true };
  // Floating time or another zone: keep the date, never guess the clock time.
  return { ...local, timeET: null, known: false };
}

export function parseBlsIcs(text: string, retrievedAt: string): EconomicEvent[] {
  if (!/BEGIN:VCALENDAR/.test(text)) throw new FeedFormatError('not an iCalendar file');
  const out: EconomicEvent[] = [];
  let cur: Prop[] | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = [];
    else if (line === 'END:VEVENT') {
      if (cur) {
        const get = (n: string) => cur!.find((p) => p.name === n);
        const summary = get('SUMMARY');
        const start = get('DTSTART');
        const when = start ? readStart(start) : null;
        if (summary && when) {
          out.push(
            makeEvent({
              source: 'bls',
              title: unescape(summary.value),
              dateET: when.dateET,
              timeET: when.timeET,
              timeStatus: when.known ? 'published' : 'unknown',
              sourceUrl: get('URL')?.value.trim() || BLS_SCHEDULE_PAGE,
              sourceEventId: get('UID')?.value.trim() ?? null,
              retrievedAt,
            }),
          );
        }
      }
      cur = null;
    } else if (cur) {
      const p = prop(line);
      if (p) cur.push(p);
    }
  }
  if (!out.length) throw new FeedFormatError('no events found in the BLS calendar');
  return dedupeEvents(out);
}
