import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Chip, EmptyState, HeaderIconButton, LoadingState, Screen, SectionHeader, StatusBadge, ToggleRow } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, spacing } from '@/constants/theme';
import { EventRow } from '@/features/intelligence/EventRow';
import { NewsRiskBanner } from '@/features/intelligence/NewsRiskBanner';
import { syncEconAlerts, useEconomicCalendar } from '@/features/intelligence/useEconomicCalendar';
import { useEconomicCalendarStore } from '@/features/intelligence/useEconomicCalendarStore';
import { useActiveAccount } from '@/hooks/useAppData';
import { CONNECTION_LABEL, ET, FEED_LABEL, formatClock, formatDay, IMPACT_RULES, type EconCode, type SourceConnection } from '@/lib/engines/economicCalendar';
import { alertLeads, LEAD_CHOICES } from '@/lib/engines/economicCalendar/alerts';
import { firmNewsRule } from '@/lib/engines/economicCalendar/firmNewsRule';
import { notificationService } from '@/services/notificationService';

const CONNECTION_TONE: Record<SourceConnection, 'positive' | 'warning' | 'danger'> = { connected: 'positive', stale: 'warning', unavailable: 'danger' };

/** Sync timestamps are always shown in New York time (the official calendars' zone), with EST / EDT. */
const nyStamp = (iso: string) => `${formatDay(iso, ET)}, ${formatClock(iso, ET)}`;

const leadText = (leads: number[]) => leads.map((m) => `${m} min`).join(' and ');

function ago(iso: string | null, now: Date): string {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Prop Guard Intelligence — scheduled economic releases for ES / MES / NQ / MNQ traders. */
export default function IntelligenceScreen() {
  // This screen refreshes itself: on open, whenever it regains focus, and when the app returns to the foreground.
  const cal = useEconomicCalendar({ autoRefresh: false });
  const lastAsked = useRef(0);
  const { refresh } = cal;
  const refreshNow = useCallback(() => {
    lastAsked.current = Date.now();
    void refresh();
  }, [refresh]);
  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastAsked.current > 5_000) refreshNow();
    }, [refreshNow]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastAsked.current > 5_000) refreshNow();
    });
    return () => sub.remove();
  }, [refreshNow]);
  const notConnected = cal.connection === 'not_configured';
  const account = useActiveAccount();
  const firm = useMemo(() => firmNewsRule(account), [account]);
  const alerts = useEconomicCalendarStore((s) => s.alerts);
  const setAlerts = useEconomicCalendarStore((s) => s.setAlerts);
  const showMedium = useEconomicCalendarStore((s) => s.showMedium);
  const setShowMedium = useEconomicCalendarStore((s) => s.setShowMedium);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const hasData = cal.events.length > 0 || cal.statuses.length > 0;

  const toggleAlerts = async (on: boolean) => {
    setAlertMsg(null);
    if (on && !(await notificationService.requestPermission())) {
      setAlertMsg('Notifications are off for Prop Guard. Allow them in Settings to get release alerts.');
      return;
    }
    setAlerts({ enabled: on });
    await syncEconAlerts();
    if (on) setAlertMsg(`Alerts are on: ${leadText(alertLeads(alerts))} before each high-impact release with a confirmed time (next 14 days, refreshed when the calendar updates).`);
  };
  const toggleLead = async (lead: number) => {
    const cur = alertLeads(alerts);
    const next = cur.includes(lead) ? cur.filter((m) => m !== lead) : [...cur, lead];
    if (!next.length) return setAlertMsg('Keep at least one advance warning, or turn alerts off.');
    setAlertMsg(null);
    setAlerts({ leads: next });
    await syncEconAlerts();
  };
  const zone = cal.cfg.displayZone;
  const notLive = cal.freshness.perSource.filter((p) => p.connection !== 'connected');

  const header = (
    <AppHeader
      title="Intelligence"
      subtitle="Economic calendar · scheduled releases"
      back
      right={notConnected ? undefined : <HeaderIconButton icon="refresh" label={cal.loading ? 'Refreshing the calendar' : 'Refresh the calendar'} onPress={refreshNow} />}
    />
  );

  return (
    <Screen header={header} refreshing={cal.loading} onRefresh={refreshNow}>
      <View style={styles.scope}>
        <Icon name="information-circle-outline" size={16} color={colors.textTertiary} />
        <AppText variant="caption" tone="tertiary" style={styles.flex}>
          Scheduled releases from official calendars (BLS, BEA, Federal Reserve). No breaking news and no actual results — check the release itself when it is published.
        </AppText>
      </View>

      {cal.connection === 'not_configured' && !hasData ? (
        <Card>
          <EmptyState
            icon="economic-calendar"
            title="Calendar not connected"
            message="The economic calendar comes from the Prop Guard backend, which refreshes the official BLS, BEA and Federal Reserve calendars. It isn’t connected in this build, so no releases are shown — none are guessed."
          />
        </Card>
      ) : !hasData && cal.loading ? (
        <LoadingState label="Loading the economic calendar…" />
      ) : !hasData ? (
        <Card>
          <EmptyState
            icon="economic-calendar"
            title="Calendar unavailable"
            message={cal.error ?? (cal.connection === 'connected' ? 'The server has not loaded the official calendars yet, so upcoming releases are unknown — not “none”. Check the official calendars before trading.' : 'The calendar could not be loaded. No releases are shown rather than guessed.')}
            actionLabel="Try again"
            onAction={refreshNow}
          />
        </Card>
      ) : (
        <>
          {cal.connection === 'error' ? (
            <Card tone="warning">
              <AppText variant="bodyStrong">Couldn’t refresh just now</AppText>
              <AppText variant="caption" tone="secondary">
                Showing the calendar this device loaded {ago(cal.fetchedAt, cal.now)}. {cal.error}
              </AppText>
            </Card>
          ) : null}
          {!cal.tradesIndexFutures ? (
            <Card>
              <AppText variant="bodyStrong">Warnings cover ES, MES, NQ and MNQ</AppText>
              <AppText variant="caption" tone="secondary">
                None of your markets is an equity-index future, so no release is flagged. Add ES, MES, NQ or MNQ in your preferences to use these warnings.
              </AppText>
              <Button label="Trading preferences" variant="secondary" size="md" onPress={() => router.push('/settings/preferences')} style={styles.mt} />
            </Card>
          ) : null}

          <SectionHeader title="Right now" />
          {cal.risk.state === 'clear' && notLive.length ? (
            <Card tone="warning">
              <View style={styles.row}>
                <StatusBadge label="Can’t confirm" tone="warning" icon="alert-circle-outline" size="sm" />
                <AppText variant="body" style={styles.flex}>
                  No release found in the next hour on the data Prop Guard has — but {notLive.map((p) => `${FEED_LABEL[p.source]} is ${CONNECTION_LABEL[p.connection].toLowerCase()}`).join(', ')}.
                </AppText>
              </View>
              <AppText variant="caption" tone="secondary" style={styles.mt}>
                A release from that source could be missing. Check the official calendar before trading.
              </AppText>
            </Card>
          ) : cal.risk.state === 'clear' ? (
            <Card>
              <View style={styles.row}>
                <StatusBadge label="Clear" tone="positive" icon="checkmark-circle" size="sm" />
                <AppText variant="body" style={styles.flex}>
                  {cal.tradesIndexFutures ? 'No major scheduled release in the next hour.' : 'No warnings for your markets.'}
                </AppText>
              </View>
            </Card>
          ) : (
            <Card>
              <NewsRiskBanner risk={cal.risk} compact />
              <View style={styles.guidance}>
                {cal.risk.guidance.map((g) => (
                  <View key={g} style={styles.row}>
                    <View style={styles.dot} />
                    <AppText variant="caption" style={styles.flex}>
                      {g}
                    </AppText>
                  </View>
                ))}
                <AppText variant="caption" tone="tertiary">
                  Prop Guard guidance — not a prediction. Your rules and your firm’s rules still decide.
                </AppText>
              </View>
            </Card>
          )}

          <SectionHeader title="Your prop firm’s news rule" />
          <Card>
            {firm.status === 'verified' ? (
              <>
                <StatusBadge label={`Verified · ${firm.firmName}`} tone="positive" icon="shield-checkmark" size="sm" />
                <AppText variant="body" style={styles.mt}>
                  {firm.text}
                </AppText>
                <AppText variant="caption" tone="tertiary" style={styles.mt}>
                  Rule checked {firm.checkedAt}. Always confirm with your firm.
                </AppText>
                {firm.sources[0] ? (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(firm.sources[0].url)} style={styles.mt}>
                    <AppText variant="caption" tone="accent">
                      {firm.sources[0].title ?? 'Official source'} ↗
                    </AppText>
                  </Pressable>
                ) : null}
              </>
            ) : firm.status === 'needs_review' ? (
              <>
                <StatusBadge label="Needs review" tone="warning" size="sm" />
                <AppText variant="caption" tone="secondary" style={styles.mt}>
                  {firm.firmName}’s news rule is on file but not verified, so Prop Guard doesn’t apply it. Check your firm’s rules before trading releases.
                </AppText>
              </>
            ) : (
              <AppText variant="caption" tone="secondary">
                {firm.reason}
              </AppText>
            )}
          </Card>

          <SectionHeader title="Next 14 days" />
          <Card>
            <ToggleRow label="Include medium-impact releases" description="PPI, JOLTS, ECI and FOMC minutes" value={showMedium} onChange={setShowMedium} />
            {cal.list.length === 0 ? (
              <AppText variant="caption" tone="secondary" style={styles.mt}>
                {cal.tradesIndexFutures ? 'No relevant scheduled release in the next 14 days on the current calendar.' : 'No releases flagged for your markets.'}
                {cal.freshness.degraded ? ' Some sources are out of date — check “Calendar data”.' : ''}
              </AppText>
            ) : (
              cal.list.map((e) => <EventRow key={e.id} event={e} cfg={cal.cfg} zone={zone} />)
            )}
            <Pressable accessibilityRole="button" aria-expanded={showWhy} onPress={() => setShowWhy((v) => !v)} style={[styles.row, styles.mt]}>
              <Icon name={showWhy ? 'chevron-up' : 'chevron-down'} size={16} color={colors.accentBright} />
              <AppText variant="caption" tone="accent">
                How Prop Guard rates impact
              </AppText>
            </Pressable>
            {showWhy ? (
              <View style={styles.why}>
                <AppText variant="caption" tone="tertiary">
                  Impact is Prop Guard’s own classification for ES / MES / NQ / MNQ — not a rating from BLS, BEA or the Federal Reserve. Times are shown in {zone} with the abbreviation for that date (daylight saving included).
                </AppText>
                {(Object.keys(IMPACT_RULES) as EconCode[])
                  .filter((c) => IMPACT_RULES[c].impact !== 'low')
                  .map((c) => (
                    <AppText key={c} variant="caption" tone="secondary">
                      <AppText variant="caption" style={styles.bold}>
                        {c.replace(/_/g, ' ')} · {IMPACT_RULES[c].impact} · {IMPACT_RULES[c].beforeMin} min before / {IMPACT_RULES[c].afterMin} min after.
                      </AppText>{' '}
                      {IMPACT_RULES[c].why}
                    </AppText>
                  ))}
              </View>
            ) : null}
          </Card>

          <SectionHeader title="Latest official updates" />
          <Card>
            <AppText variant="caption" tone="tertiary">
              Release notices as BLS and the Federal Reserve published them — title and link only. Open the release for the details.
            </AppText>
            {cal.updatesFreshness.perSource.every((p) => p.connection === 'unavailable') ? (
              <AppText variant="caption" tone="warning" style={styles.mt}>
                The official update feeds are unavailable — nothing is shown rather than an empty “no updates”.
              </AppText>
            ) : cal.updates.length === 0 ? (
              <AppText variant="caption" tone="secondary" style={styles.mt}>
                No items in the last 14 days on the feeds Prop Guard read.
              </AppText>
            ) : (
              cal.updates.slice(0, 8).map((u) => (
                <Pressable key={u.id} accessibilityRole="link" accessibilityLabel={`${u.title}, ${FEED_LABEL[u.feed]}. Opens the official page.`} onPress={() => void Linking.openURL(u.link)} style={styles.update}>
                  <AppText variant="body">{u.title}</AppText>
                  <AppText variant="caption" tone="tertiary">
                    {FEED_LABEL[u.feed]}
                    {u.publishedAt ? ` · ${formatDay(u.publishedAt, zone)}, ${formatClock(u.publishedAt, zone)}` : ''} ↗
                  </AppText>
                </Pressable>
              ))
            )}
          </Card>

          <SectionHeader title="Phone alerts" />
          <Card>
            {notificationService.supported ? (
              <>
                <ToggleRow label="Alert me before major releases" description="A local notification on this phone. Releases with an unconfirmed time get no alert." value={alerts.enabled} onChange={(v) => void toggleAlerts(v)} />
                {alerts.enabled ? (
                  <View style={styles.gapSm}>
                    <AppText variant="caption" tone="secondary">
                      Advance warnings (choose one or more)
                    </AppText>
                    <View style={styles.chips}>
                      {LEAD_CHOICES.map((m) => (
                        <Chip key={m} label={`${m} min before`} selected={alertLeads(alerts).includes(m)} onPress={() => void toggleLead(m)} />
                      ))}
                    </View>
                  </View>
                ) : null}
                {alertMsg ? (
                  <AppText variant="caption" tone="secondary" style={styles.mt} accessibilityRole="alert">
                    {alertMsg}
                  </AppText>
                ) : null}
              </>
            ) : (
              <AppText variant="caption" tone="secondary">
                Phone alerts are available in the iOS and Android app{Platform.OS === 'web' ? '' : ' with notifications enabled'}.
              </AppText>
            )}
          </Card>
        </>
      )}

      <SectionHeader title="Calendar data" />
      <Card>
        {notConnected ? (
          <AppText variant="bodyStrong" accessibilityRole="alert">
            Not connected — this build has no calendar server settings, so nothing can be loaded.
          </AppText>
        ) : cal.fetchedAt ? (
          <AppText variant="bodyStrong">
            Last refreshed {nyStamp(cal.fetchedAt)} ({ago(cal.fetchedAt, cal.now)})
          </AppText>
        ) : cal.loading ? (
          <AppText variant="bodyStrong">Refreshing the calendar…</AppText>
        ) : (
          <AppText variant="bodyStrong" tone="danger" accessibilityRole="alert">
            Couldn’t load the calendar{cal.error ? `: ${cal.error}` : '.'}
          </AppText>
        )}
        {notConnected ? null : (
          <AppText variant="caption" tone={cal.connection === 'error' ? 'warning' : 'tertiary'}>
            {cal.lastCheckedAt
              ? `This device last checked ${nyStamp(cal.lastCheckedAt)} — ${cal.connection === 'error' ? (cal.fetchedAt ? `failed (${(cal.error ?? 'unknown error').replace(/\.$/, '')}); showing the copy from the last refresh.` : 'failed (see above).') : 'OK.'}`
              : 'This device is checking now.'}
          </AppText>
        )}
        {!notConnected && cal.connection === 'error' && cal.errorDetail ? (
          <AppText variant="caption" tone="tertiary" selectable>
            Connection details: {cal.errorDetail}
          </AppText>
        ) : null}
        {notConnected ? null : (
          <AppText variant="caption" tone="tertiary">
            {cal.serverLastSyncAt
              ? `Server’s last successful sync of the official sources: ${nyStamp(cal.serverLastSyncAt)} (${ago(cal.serverLastSyncAt, cal.now)}). It syncs every 6 hours.`
              : cal.fetchedAt
                ? 'The server has not completed a sync of the official sources yet.'
                : 'Server sync time appears once the calendar loads.'}
          </AppText>
        )}
        <View style={styles.sources}>
          {[...cal.freshness.perSource, ...cal.updatesFreshness.perSource].map((p) => (
            <View key={p.source} style={styles.gapXs}>
              <View style={styles.sourceRow}>
                <AppText variant="caption" style={styles.flex}>
                  {FEED_LABEL[p.source]}
                </AppText>
                {/* No backend in this build: nothing will ever load — say so. */}
                <StatusBadge label={notConnected ? 'Not connected' : CONNECTION_LABEL[p.connection]} tone={notConnected ? 'neutral' : CONNECTION_TONE[p.connection]} size="sm" />
              </View>
              {notConnected ? null : (
                <AppText variant="caption" tone="tertiary">
                  Last successful sync: {p.lastSuccessAt ? `${nyStamp(p.lastSuccessAt)} (${ago(p.lastSuccessAt, cal.now)})` : 'none yet on the server'}
                  {p.connection !== 'connected' && p.error ? ` · last attempt: ${p.error}` : ''}
                </AppText>
              )}
            </View>
          ))}
        </View>
        {cal.freshness.degraded && hasData ? (
          <AppText variant="caption" tone="warning">
            Releases from a source that is out of date or not configured may be missing. Prop Guard never fills the gap with guesses.
          </AppText>
        ) : null}
        {notConnected ? null : <Button label={cal.loading ? 'Refreshing…' : 'Refresh now'} variant="secondary" size="md" icon="refresh" disabled={cal.loading} onPress={refreshNow} style={styles.mt} />}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scope: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mt: { marginTop: spacing.sm },
  guidance: { gap: spacing.sm, marginTop: spacing.md },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.warning },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  why: { gap: spacing.sm, marginTop: spacing.sm },
  bold: { fontWeight: '700' },
  sources: { gap: spacing.sm, marginVertical: spacing.md },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gapXs: { gap: 2 },
  gapSm: { gap: spacing.xs, marginTop: spacing.sm },
  update: { gap: 2, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
