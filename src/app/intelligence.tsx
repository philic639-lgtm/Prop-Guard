import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Chip, EmptyState, LoadingState, Screen, SectionHeader, StatusBadge, ToggleRow } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, spacing } from '@/constants/theme';
import { EventRow } from '@/features/intelligence/EventRow';
import { NewsRiskBanner } from '@/features/intelligence/NewsRiskBanner';
import { syncEconAlerts, useEconomicCalendar } from '@/features/intelligence/useEconomicCalendar';
import { useEconomicCalendarStore } from '@/features/intelligence/useEconomicCalendarStore';
import { useActiveAccount } from '@/hooks/useAppData';
import { IMPACT_RULES, SOURCE_LABEL, type EconCode, type Freshness } from '@/lib/engines/economicCalendar';
import { LEAD_CHOICES } from '@/lib/engines/economicCalendar/alerts';
import { firmNewsRule } from '@/lib/engines/economicCalendar/firmNewsRule';
import { notificationService } from '@/services/notificationService';

const FRESHNESS: Record<Freshness, { label: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' }> = {
  fresh: { label: 'Up to date', tone: 'positive' },
  stale: { label: 'Out of date', tone: 'warning' },
  failing: { label: 'Refresh failing', tone: 'danger' },
  never: { label: 'Not loaded yet', tone: 'neutral' },
  not_configured: { label: 'Not configured', tone: 'neutral' },
};

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
  const cal = useEconomicCalendar();
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
    if (on) setAlertMsg(`Alerts are on: a notification ${alerts.leadMinutes} min before each high-impact release with a confirmed time (next 14 days, refreshed when the calendar updates).`);
  };
  const setLead = async (lead: number) => {
    setAlerts({ leadMinutes: lead });
    await syncEconAlerts();
  };

  const header = <AppHeader title="Intelligence" subtitle="Economic calendar · scheduled releases" back />;

  return (
    <Screen header={header} refreshing={cal.loading} onRefresh={() => void cal.refresh()}>
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
          <EmptyState icon="economic-calendar" title="Calendar unavailable" message={cal.error ?? 'The calendar could not be loaded. No releases are shown rather than guessed.'} actionLabel="Try again" onAction={() => void cal.refresh()} />
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
          {cal.risk.state === 'clear' ? (
            <Card>
              <View style={styles.row}>
                <StatusBadge label="Clear" tone="positive" icon="checkmark-circle" size="sm" />
                <AppText variant="body" style={styles.flex}>
                  {cal.tradesIndexFutures ? 'No major scheduled release in the next hour.' : 'No warnings for your markets.'}
                </AppText>
              </View>
              {cal.freshness.degraded ? (
                <AppText variant="caption" tone="warning" style={styles.mt}>
                  Some calendar sources are out of date or unavailable — a release could be missing. See “Calendar data” below.
                </AppText>
              ) : null}
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
              cal.list.map((e) => <EventRow key={e.id} event={e} cfg={cal.cfg} />)
            )}
            <Pressable accessibilityRole="button" aria-expanded={showWhy} onPress={() => setShowWhy((v) => !v)} style={[styles.row, styles.mt]}>
              <Icon name={showWhy ? 'chevron-up' : 'chevron-down'} size={16} color={colors.accentBright} />
              <AppText variant="caption" tone="accent">
                How Prop Guard decides impact
              </AppText>
            </Pressable>
            {showWhy ? (
              <View style={styles.why}>
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

          <SectionHeader title="Phone alerts" />
          <Card>
            {notificationService.supported ? (
              <>
                <ToggleRow label="Alert me before major releases" description="A local notification on this phone. Releases with an unconfirmed time get no alert." value={alerts.enabled} onChange={(v) => void toggleAlerts(v)} />
                {alerts.enabled ? (
                  <View style={styles.chips}>
                    {LEAD_CHOICES.map((m) => (
                      <Chip key={m} label={`${m} min before`} selected={alerts.leadMinutes === m} onPress={() => void setLead(m)} />
                    ))}
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
        <AppText variant="bodyStrong">Last refreshed {ago(cal.freshness.lastRefreshedAt, cal.now)}</AppText>
        <AppText variant="caption" tone="tertiary">
          This device last checked {ago(cal.fetchedAt, cal.now)}. The server refreshes the official calendars a few times a day.
        </AppText>
        <View style={styles.sources}>
          {cal.freshness.perSource.map((p) => (
            <View key={p.source} style={styles.sourceRow}>
              <AppText variant="caption" style={styles.flex}>
                {SOURCE_LABEL[p.source]}
              </AppText>
              <StatusBadge label={`${FRESHNESS[p.state].label}${p.lastSuccessAt && p.state !== 'fresh' ? ` · ${ago(p.lastSuccessAt, cal.now)}` : ''}`} tone={FRESHNESS[p.state].tone} size="sm" />
            </View>
          ))}
        </View>
        {cal.freshness.degraded && hasData ? (
          <AppText variant="caption" tone="warning">
            Releases from a source that is out of date or not configured may be missing. Prop Guard never fills the gap with guesses.
          </AppText>
        ) : null}
        <Button label={cal.loading ? 'Refreshing…' : 'Refresh now'} variant="secondary" size="md" icon="refresh" disabled={cal.loading} onPress={() => void cal.refresh()} style={styles.mt} />
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
});
