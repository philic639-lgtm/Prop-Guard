/**
 * Session times in New York local time (the exchange clock for US index futures).
 * "EST", "ET", "Eastern", "NY time" all mean New York local time: 9:30 is the open in
 * summer (EDT, UTC−4) and in winter (EST, UTC−5).
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** "9:30", "9.30", "9:30am", "930am", "9am", "13:45" → "HH:mm" (24h). Hours 1–6 without am/pm are afternoon. */
export function parseClock(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/\.$/, '');
  let m = /^(\d{1,2})[:.](\d{2})(am|pm|a\.m\.|p\.m\.)?$/.exec(t);
  let h: number;
  let min: number;
  let ap: string | undefined;
  if (m) {
    h = +m[1];
    min = +m[2];
    ap = m[3];
  } else if ((m = /^(\d{1,2})(\d{2})(am|pm)$/.exec(t))) {
    h = +m[1];
    min = +m[2];
    ap = m[3];
  } else if ((m = /^(\d{1,2})(am|pm)$/.exec(t))) {
    h = +m[1];
    min = 0;
    ap = m[2];
  } else return null;
  if (min > 59 || h > 23) return null;
  const pm = ap?.startsWith('p');
  const am = ap?.startsWith('a');
  if (pm && h < 12) h += 12;
  else if (am && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 6) h += 12;
  return `${pad(h)}:${pad(min)}`;
}

export const minutesOf = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

/** "09:30" → "9:30 AM". */
export function formatClock(hhmm: string): string {
  const h = +hhmm.slice(0, 2);
  const m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** UTC offset of New York on a date, in minutes (−240 in summer, −300 in winter). */
export function newYorkOffset(dateIso: string): number {
  const probe = new Date(`${dateIso}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23', minute: '2-digit' }).formatToParts(probe);
  const h = +parts.find((p) => p.type === 'hour')!.value;
  const m = +parts.find((p) => p.type === 'minute')!.value;
  return h * 60 + m - 12 * 60;
}

/** The instant of a New York session time on a date (daylight saving handled). */
export function sessionInstant(dateIso: string, hhmm: string): Date {
  const local = Date.parse(`${dateIso}T${hhmm}:00Z`);
  return new Date(local - newYorkOffset(dateIso) * 60_000);
}

/** "New York time (EDT, UTC−4)" for a date — what the trader confirms. */
export function newYorkLabel(dateIso: string): string {
  const off = newYorkOffset(dateIso);
  return `New York time (${off === -240 ? 'EDT, UTC−4' : 'EST, UTC−5'} on ${dateIso})`;
}
