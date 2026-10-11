import { easternToUtc } from './timezone';
import type { EconCode, EconomicEvent, EconSource, TimeStatus } from './types';

/**
 * Title → event family. Matched in order against the title exactly as the source published
 * it; the first match wins. Titles that match nothing stay `OTHER` (kept, never guessed into
 * a high-impact family). Extend this list to recognise more releases.
 */
export const TITLE_RULES: { code: EconCode; name: string; match: RegExp }[] = [
  { code: 'CPI', name: 'CPI — Consumer Price Index', match: /\bconsumer price index\b|^cpi\b/i },
  { code: 'NFP', name: 'Employment Situation (Nonfarm Payrolls)', match: /\bemployment situation\b/i },
  { code: 'PPI', name: 'PPI — Producer Price Index', match: /\bproducer price ind(ex|exes)\b|^ppi\b/i },
  { code: 'JOLTS', name: 'JOLTS — Job Openings and Labor Turnover', match: /\bjob openings and labor turnover\b|\bjolts\b/i },
  { code: 'ECI', name: 'Employment Cost Index', match: /\bemployment cost index\b/i },
  { code: 'PRODUCTIVITY', name: 'Productivity and Costs', match: /\bproductivity and costs\b/i },
  { code: 'IMPORT_PRICES', name: 'Import and Export Price Indexes', match: /\bimport and export price/i },
  { code: 'REAL_EARNINGS', name: 'Real Earnings', match: /^real earnings\b/i },
  { code: 'STATE_EMPLOYMENT', name: 'State Employment and Unemployment', match: /\bstate employment and unemployment\b/i },
  { code: 'GDP', name: 'GDP — Gross Domestic Product', match: /\bgross domestic product\b|^gdp\b/i },
  { code: 'PCE', name: 'Personal Income and Outlays (PCE)', match: /\bpersonal income and outlays\b/i },
  { code: 'TRADE', name: 'U.S. International Trade in Goods and Services', match: /\binternational trade in goods and services\b/i },
  { code: 'FOMC_PRESS_CONFERENCE', name: 'FOMC press conference', match: /\bfomc\b.*\bpress conference\b/i },
  { code: 'FOMC_MINUTES', name: 'FOMC minutes', match: /\bfomc\b.*\bminutes\b/i },
  { code: 'FOMC_STATEMENT', name: 'FOMC rate decision (statement)', match: /\bfomc\b.*\b(statement|decision)\b/i },
];

export function classify(title: string): { code: EconCode; name: string } {
  const clean = title.replace(/\s+/g, ' ').trim();
  for (const r of TITLE_RULES) if (r.match.test(clean)) return { code: r.code, name: r.name };
  return { code: 'OTHER', name: clean };
}

/** Build a normalised event. The id is deterministic, so re-reading a feed never duplicates a release. */
export function makeEvent(p: {
  source: EconSource;
  title: string;
  dateET: string;
  timeET: string | null;
  timeStatus: TimeStatus;
  sourceUrl: string;
  sourceEventId?: string | null;
  retrievedAt: string;
  /** Distinguishes two releases of the same family on the same day (rare). */
  subKey?: string;
}): EconomicEvent {
  const { code, name } = classify(p.title);
  const timeET = p.timeStatus === 'unknown' ? null : p.timeET;
  const startsAt = timeET ? easternToUtc(p.dateET, timeET) : null;
  const slug = code === 'OTHER' ? p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) : code.toLowerCase();
  return {
    id: [p.source, slug, p.dateET, p.subKey].filter(Boolean).join(':'),
    source: p.source,
    sourceEventId: p.sourceEventId ?? null,
    title: p.title.replace(/\s+/g, ' ').trim(),
    name,
    code,
    dateET: p.dateET,
    timeET: startsAt ? timeET : null,
    timeStatus: startsAt ? p.timeStatus : 'unknown',
    startsAt,
    sourceUrl: p.sourceUrl,
    retrievedAt: p.retrievedAt,
    kind: 'scheduled_release',
    active: true,
  };
}

/** One event per id (a feed listing the same release twice keeps the first). */
export function dedupeEvents(events: EconomicEvent[]): EconomicEvent[] {
  const seen = new Map<string, EconomicEvent>();
  for (const e of events) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()].sort((a, b) => (a.startsAt ?? `${a.dateET}T99`).localeCompare(b.startsAt ?? `${b.dateET}T99`));
}
