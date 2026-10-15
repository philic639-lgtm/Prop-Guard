/**
 * Economic calendar — SCHEDULED releases only, from official government calendars
 * (BLS, BEA, Federal Reserve). Prop Guard never shows breaking news or actual results:
 * nothing here carries a released number, a forecast or a surprise.
 *
 * Shared with the `economic-calendar-sync` Edge Function (`npm run shared:sync`):
 * keep these modules dependency-free with relative imports only.
 */

export type EconSource = 'bls' | 'bea' | 'fed';

/** Official update feeds (published-release notices), kept apart from the scheduled calendars. */
export type UpdateFeed = 'bls_updates' | 'fed_updates';
/** Everything with a refresh status row. */
export type FeedId = EconSource | UpdateFeed;

/** Normalised event families. `OTHER` = published by the source but not in the impact table. */
export type EconCode =
  | 'CPI'
  | 'NFP'
  | 'PPI'
  | 'JOLTS'
  | 'ECI'
  | 'PRODUCTIVITY'
  | 'IMPORT_PRICES'
  | 'REAL_EARNINGS'
  | 'STATE_EMPLOYMENT'
  | 'GDP'
  | 'PCE'
  | 'TRADE'
  | 'FOMC_STATEMENT'
  | 'FOMC_PRESS_CONFERENCE'
  | 'FOMC_MINUTES'
  | 'OTHER';

/**
 * How sure we are of the clock time:
 * - `published`    the source states the time (e.g. BLS ICS DTSTART with a time zone)
 * - `conventional` the source gives only the date; the time is the publisher's usual
 *                  practice (FOMC statement 2:00 PM ET) — shown as "usually" and to be confirmed
 * - `unknown`      no time — never used to schedule an alert
 */
export type TimeStatus = 'published' | 'conventional' | 'unknown';

export interface EconomicEvent {
  /** Stable id: source + code + local date (+ sub-key) — the same release always maps to the same id. */
  id: string;
  source: EconSource;
  /** The source's own identifier when it has one (ICS UID …). */
  sourceEventId: string | null;
  /** Title exactly as the source published it. */
  title: string;
  /** Normalised display name ("CPI — Consumer Price Index"). */
  name: string;
  code: EconCode;
  /** Release date in US Eastern time (YYYY-MM-DD) — always known. */
  dateET: string;
  /** Release time in US Eastern time (HH:MM, 24 h) — null when unknown. */
  timeET: string | null;
  timeStatus: TimeStatus;
  /** UTC instant of the release, when the time is known (published or conventional). */
  startsAt: string | null;
  /** Page a trader can open to confirm (official source). */
  sourceUrl: string;
  /** When Prop Guard last read this from the source. */
  retrievedAt: string;
  /** Always 'scheduled_release' — breaking news and actual results are not supported. */
  kind: 'scheduled_release';
  /** Listed by the source on the last successful refresh. False = withdrawn / rescheduled. */
  active: boolean;
}

export interface FeedStatus {
  source: FeedId;
  /** Last attempt, successful or not. */
  checkedAt: string | null;
  /** Last attempt that fetched AND parsed the feed. */
  lastSuccessAt: string | null;
  /** Result of the last attempt. */
  status: 'ok' | 'not_modified' | 'error' | 'never';
  /** Sanitised reason for the last failure (HTTP status, "format changed" …). */
  error: string | null;
  /** Events parsed on the last successful refresh. */
  eventCount: number;
  /** Latest release date the source lists (coverage horizon). */
  coverageUntil: string | null;
}

/** One item of an official update feed, exactly as published (no numbers read out of it). */
export interface OfficialUpdate {
  /** feed + the item's own guid / link — re-reading never duplicates. */
  id: string;
  feed: UpdateFeed;
  title: string;
  link: string;
  /** Publication time from the feed (UTC); null when the feed gives none. */
  publishedAt: string | null;
  retrievedAt: string;
}

export const SOURCE_LABEL: Record<EconSource, string> = {
  bls: 'U.S. Bureau of Labor Statistics',
  bea: 'U.S. Bureau of Economic Analysis',
  fed: 'Federal Reserve Board',
};

/** Every refreshed feed by name (calendars + update feeds). */
export const FEED_LABEL: Record<FeedId, string> = {
  ...SOURCE_LABEL,
  bls_updates: 'BLS latest releases (RSS)',
  fed_updates: 'Federal Reserve monetary-policy press releases (RSS)',
};
