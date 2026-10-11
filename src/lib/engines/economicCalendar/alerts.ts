import { DEFAULT_NEWS_RULES, isRelevant, type NewsRuleConfig } from './rules';
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
  /** Minutes before the release. */
  leadMinutes: number;
  minImpact: NewsRuleConfig['minImpact'];
}

export const DEFAULT_ALERT_SETTINGS: EconAlertSettings = { enabled: false, leadMinutes: 15, minImpact: 'high' };
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

const clockET = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export function planEconAlerts(events: EconomicEvent[], settings: EconAlertSettings, now: Date, rules: NewsRuleConfig = DEFAULT_NEWS_RULES): PlannedAlert[] {
  if (!settings.enabled) return [];
  const cfg = { ...rules, minImpact: settings.minImpact };
  const from = now.getTime() + 30_000;
  const to = now.getTime() + HORIZON_DAYS * 86_400_000;
  return events
    .filter((e) => e.startsAt && isRelevant(e, cfg))
    .map((e) => ({ e, fire: Date.parse(e.startsAt!) - settings.leadMinutes * 60_000 }))
    .filter(({ fire }) => fire >= from && fire <= to)
    .sort((a, b) => a.fire - b.fire)
    .slice(0, MAX_PENDING)
    .map(({ e, fire }) => ({
      identifier: `${PREFIX}${e.id}:${settings.leadMinutes}`,
      eventId: e.id,
      fireAt: new Date(fire).toISOString(),
      title: `${e.name} in ${settings.leadMinutes} min`,
      body: `Scheduled for ${clockET(e.startsAt!)} ET${e.timeStatus === 'conventional' ? ' (usual time — confirm)' : ''}. Consider being flat or trading smaller around the release.`,
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
