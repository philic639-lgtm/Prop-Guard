import { FeedFormatError } from './ics';
import { dedupeEvents, makeEvent } from './normalize';
import type { EconomicEvent } from './types';

/**
 * FOMC meeting calendar (federalreserve.gov). The page lists each year's meetings as a
 * month and a day range ("January" "27-28", "April/May" "30-1", "*" = projections).
 * The policy statement follows the LAST day of each scheduled meeting.
 *
 * Times: the page gives dates only. The Fed's usual practice is a 2:00 PM ET statement and
 * a 2:30 PM ET press conference — used as `conventional` times (shown as "usually …,
 * confirm on federalreserve.gov"). A time a person has verified for a specific date can be
 * supplied in `verifiedTimes` ("YYYY-MM-DD" → "HH:MM" ET) and is then `published`.
 * Notation votes and unscheduled meetings are not scheduled releases and are skipped.
 * Minutes are not added: the page lists their dates only after they are released.
 */
export const FED_CALENDAR_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
export const FOMC_STATEMENT_TIME_ET = '14:00';
export const FOMC_PRESS_CONFERENCE_TIME_ET = '14:30';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthIndex = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3)));
const pad = (n: number) => String(n).padStart(2, '0');

/** Visible text of the page, one block per line. */
export function pageText(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr|\/td|\/strong|\/span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export interface FomcMeeting {
  year: number;
  /** Last day of the meeting (statement day), Eastern date. */
  statementDate: string;
  projections: boolean;
}

export function parseFomcMeetings(html: string): FomcMeeting[] {
  const lines = pageText(html);
  const out: FomcMeeting[] = [];
  let year: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\d{4}) FOMC Meetings$/i.exec(lines[i]);
    if (head) {
      year = Number(head[1]);
      continue;
    }
    if (!year) continue;
    const month = /^([A-Za-z]{3,9})(?:\/([A-Za-z]{3,9}))?$/.exec(lines[i]);
    if (!month || monthIndex(month[1]) < 0) continue;
    const next = lines[i + 1] ?? '';
    const days = /^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?(\*)?(.*)$/.exec(next);
    if (!days) continue;
    if (/notation|unscheduled|conference call/i.test(days[4] ?? '')) continue;
    const startDay = Number(days[1]);
    const endDay = Number(days[2] ?? days[1]);
    // "April/May 30-1": the meeting ends in the second month only when the day number wraps.
    const endMonth = month[2] && monthIndex(month[2]) >= 0 && endDay < startDay ? monthIndex(month[2]) : monthIndex(month[1]);
    if (endDay < 1 || endDay > 31) continue;
    out.push({ year, statementDate: `${year}-${pad(endMonth + 1)}-${pad(endDay)}`, projections: !!days[3] });
    i++;
  }
  return out;
}

export function parseFedCalendar(html: string, retrievedAt: string, opts: { verifiedTimes?: Record<string, string> } = {}): EconomicEvent[] {
  const meetings = parseFomcMeetings(html);
  if (!meetings.length) throw new FeedFormatError('FOMC calendar format not recognised (no meetings found)');
  const out: EconomicEvent[] = [];
  for (const m of meetings) {
    const verified = opts.verifiedTimes?.[m.statementDate];
    out.push(
      makeEvent({
        source: 'fed',
        title: `FOMC statement${m.projections ? ' and Summary of Economic Projections' : ''}`,
        dateET: m.statementDate,
        timeET: verified ?? FOMC_STATEMENT_TIME_ET,
        timeStatus: verified ? 'published' : 'conventional',
        sourceUrl: FED_CALENDAR_URL,
        retrievedAt,
      }),
      makeEvent({
        source: 'fed',
        title: 'FOMC press conference',
        dateET: m.statementDate,
        timeET: FOMC_PRESS_CONFERENCE_TIME_ET,
        timeStatus: 'conventional',
        sourceUrl: FED_CALENDAR_URL,
        retrievedAt,
      }),
    );
  }
  return dedupeEvents(out);
}
