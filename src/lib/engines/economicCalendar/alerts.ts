import { DEFAULT_NEWS_RULES, isRelevant, type NewsRuleConfig } from './rules';
import { ET, formatClock, validZone } from './timezone';
import type { EconomicEvent } from './types';

/**
 * Phone alerts before scheduled releases — planned deterministically (client only).
 * Each release gets ONE identifier (`econ:<event id>:<lead>`), so re-planning after every
 * refresh replaces rather than duplicates, a moved release moves its alert, and a withdrawn
 * release loses it. Only releases with a known time get an alert; "usual time" FOMC alerts
 * say so.
 */
export interface EconAlertSettings {
  enabled: boolean;
  /** Advance warnings, in minutes before the release (one alert per release and lead). */
  leads: number[];
  minImpact: NewsRuleConfig['minImpact'];
}

export const DEFAULT_ALERT_SETTINGS: EconAlertSettings = { enabled: false, leads: [15], minImpact: 'high' };

/** Valid, distinct leads from stored settings (older versions stored one `leadMinutes`). */
export function alertLeads(s: Partial<EconAlertSettings> & { leadMinutes?: number }): number[] {
  const raw = Array.isArray(s.leads) ? s.leads : typeof s.leadMinutes === 'number' ? [s.leadMinutes] : DEFAULT_ALERT_SETTINGS.leads;
  const ok = [...new Set(raw.filter((m) => Number.isInteger(m) && m > 0 && m <= 24 * 60))].sort((a, b) => b - a);
  return ok.length ? ok : DEFAULT_ALERT_SETTINGS.leads;
}
export const LEAD_CHOICES = [5, 15, 30, 60] as const;
/** Upper bound of pending alerts (iOS keeps at most 64 local notifications per app). */
export const MAX_PENDING = 20;
export const HORIZON_DAYS = 14;

export interface PlannedAlert {
  identifier: string;
  eventId: string;
  fireAt: string;
  title: string;
  body: string;
}

const PREFIX = 'econ:';
export const isEconAlert = (identifier: string) => identifier.startsWith(PREFIX);


export function planEconAlerts(events: EconomicEvent[], settings: EconAlertSettings, now: Date, rules: NewsRuleConfig = DEFAULT_NEWS_RULES): PlannedAlert[] {
  if (!settings.enabled) return [];
  const cfg = { ...rules, minImpact: settings.minImpact };
  const zone = validZone(rules.displayZone) ?? ET;
  // Stored instant is UTC; shown in the trader's zone with that date's abbreviation (DST-aware), plus ET when different.
  const when = (iso: string) => `${formatClock(iso, zone)}${zone !== ET ? ` (${formatClock(iso, ET)})` : ''}`;
  const from = now.getTime() + 30_000;
  const to = now.getTime() + HORIZON_DAYS * 86_400_000;
  const leads = alertLeads(settings);
  return events
    .filter((e) => e.startsAt && isRelevant(e, cfg))
    .flatMap((e) => leads.map((lead) => ({ e, lead, fire: Date.parse(e.startsAt!) - lead * 60_000 })))
    .filter(({ fire }) => fire >= from && fire <= to)
    .sort((a, b) => a.fire - b.fire)
    .slice(0, MAX_PENDING)
    .map(({ e, lead, fire }) => ({
      identifier: `${PREFIX}${e.id}:${lead}`,
      eventId: e.id,
      fireAt: new Date(fire).toISOString(),
      title: `${e.name} in ${lead} min`,
      body: `Scheduled for ${when(e.startsAt!)}${e.timeStatus === 'conventional' ? ' (usual time — confirm)' : ''}. Consider being flat or trading smaller around the release.`,
    }));
}

/** What to cancel and what to (re)schedule, given what is already pending. Never schedules the same alert twice. */
export function diffEconAlerts(planned: PlannedAlert[], pending: { identifier: string; fireAt: string | null }[]): { cancel: string[]; schedule: PlannedAlert[] } {
  const want = new Map(planned.map((p) => [p.identifier, p]));
  const have = new Map(pending.filter((p) => isEconAlert(p.identifier)).map((p) => [p.identifier, p.fireAt]));
  const cancel = [...have.keys()].filter((id) => !want.has(id) || have.get(id) !== want.get(id)!.fireAt);
  const schedule = planned.filter((p) => have.get(p.identifier) !== p.fireAt);
  return { cancel, schedule };
}
