import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Chip, EmptyState, Illustration, SectionHeader, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { MODE_LABEL, VERDICT_UI } from './copyUi';
import { SourceTraderCard } from './SourceTraderCard';
import { useCopyAnalytics, useSourceTraders } from './useCopyTrade';
import { copyResult, FOLLOW_MIN_SAMPLE, VERDICT_LABEL } from '@/lib/engines/copyTradeEngine';
import { useAppStore } from '@/store/useAppStore';
import { money } from '@/utils/format';

/**
 * Follow Traders (Copy Trade tab): who you copy, how copying them is going,
 * and the copy log. An assistant — Prop Guard never places or mirrors trades.
 */
export function FollowTradersPanel() {
  const [showArchived, setShowArchived] = useState(false);
  const traders = useSourceTraders(showArchived);
  const archivedCount = useAppStore((s) => s.sourceTraders.filter((t) => t.archived).length);
  const copies = useAppStore((s) => s.copyTrades);
  const trades = useAppStore((s) => s.trades);
  const a = useCopyAnalytics();
  const byTrader = useMemo(() => new Map(a.traders.map((t) => [t.sourceTraderId, t])), [a.traders]);
  const tradesById = useMemo(() => new Map(trades.map((t) => [t.id, t])), [trades]);
  const recent = useMemo(() => [...copies].sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, 8), [copies]);
  const cmp = a.copiedVsOwn;

  if (traders.length === 0 && !showArchived && archivedCount === 0) {
    return (
      <>
        <Card accent="accent" style={styles.hero}>
          <Illustration kind="copy" size={88} />
          <AppText variant="title" align="center">
            Copy other traders — on your terms
          </AppText>
          <AppText variant="body" align="center" tone="secondary">
            Add the traders you follow. For every idea you copy, Prop Guard sizes it to your account, checks your daily loss limit and drawdown, and tracks whether following them is actually working.
          </AppText>
          <View style={styles.steps}>
            <Step icon="person-add-outline" text="Add a source trader and how you size their trades" />
            <Step icon="calculator-outline" text="Log a copy — get your size, risk and a rule check" />
            <Step icon="stats-chart-outline" text="See who to keep copying, reduce, or stop following" />
          </View>
          <Button label="Add your first source trader" icon="person-add-outline" onPress={() => router.push('/copy/trader/new')} style={styles.stretch} />
        </Card>
        <AppText variant="caption" tone="tertiary" align="center">
          Prop Guard does not place, mirror or execute trades. It checks the copy against your own rules before you act.
        </AppText>
      </>
    );
  }

  return (
    <>
      <View style={styles.actions}>
        <Button label="Log Copy Trade" icon="add-circle-outline" size="md" style={styles.flex} onPress={() => router.push('/copy/log')} disabled={!traders.some((t) => !t.archived)} />
        <Button label="Add trader" icon="person-add-outline" variant="secondary" size="md" style={styles.flex} onPress={() => router.push('/copy/trader/new')} />
      </View>
      <View style={styles.summary}>
        <Summary icon="people-outline" label="Active traders" value={String(a.activeTraders)} />
        <Summary icon="today-outline" label="Copied today" value={String(a.copiedToday)} />
        <Summary icon="cash-outline" label="P&L today" value={a.copiedToday ? money(a.todayPnl, { sign: true }) : '—'} tone={a.todayPnl > 0 ? colors.positive : a.todayPnl < 0 ? colors.danger : undefined} />
      </View>

      <SectionHeader title="Source traders" action={archivedCount ? (showArchived ? 'Hide archived' : `Archived (${archivedCount})`) : undefined} onAction={() => setShowArchived((v) => !v)} />
      {traders.map((t) => (
        <SourceTraderCard key={t.id} trader={t} stats={byTrader.get(t.id)} onPress={() => router.push({ pathname: '/copy/trader/[id]', params: { id: t.id } })} />
      ))}

      <SectionHeader title="Who is worth following?" />
      <Card>
        <Insight icon="ribbon-outline" label="Most copied" value={a.mostCopied ? `${a.mostCopied.name} · ${a.mostCopied.logged} copies` : '—'} />
        <Insight icon="trending-up-outline" label="Best average R" value={a.best ? `${a.best.name} · ${a.best.avgR!.toFixed(2)}R` : 'Needs 3 closed copies'} />
        <Insight icon="trending-down-outline" label="Most losses (live)" value={a.mostLosses ? `${a.mostLosses.name} · ${money(-a.mostLosses.lossesTotal)}` : '—'} />
        <Insight
          icon="git-compare-outline"
          label="Copied vs your own trades"
          value={cmp.copiedCount && cmp.ownCount ? `${cmp.copiedAvgR!.toFixed(2)}R vs ${cmp.ownAvgR!.toFixed(2)}R avg` : 'Needs closed copied and own trades'}
        />
        {a.setups.length ? <Insight icon="flash-outline" label="Best copied setup" value={`${a.setups[0].setup} · ${a.setups[0].avgR.toFixed(2)}R (${a.setups[0].count})`} /> : null}
        <AppText variant="caption" tone="tertiary" style={styles.note}>
          Keep / reduce / stop appears after {FOLLOW_MIN_SAMPLE} closed copies. Simulated and missed copies are hypothetical and never count as account P&L. Past results do not guarantee future ones.
        </AppText>
      </Card>

      <SectionHeader title="Copy log" action={copies.length ? 'Journal' : undefined} onAction={() => router.push({ pathname: '/journal', params: { origin: 'copied' } })} />
      {recent.length === 0 ? (
        <Card>
          <EmptyState illustration="trades" title="No copies logged yet" message="Log the next trade you copy — even one you only watch — to start measuring this trader." actionLabel="Log Copy Trade" onAction={() => router.push('/copy/log')} />
        </Card>
      ) : (
        recent.map((c) => {
          const res = copyResult(c, tradesById);
          const v = VERDICT_UI[c.translation.verdict];
          return (
            <Card key={c.id} onPress={() => router.push({ pathname: '/copy/[id]', params: { id: c.id } })} accessibilityLabel={`${c.sourceTraderName} ${c.instrument} ${c.direction}`}>
              <View style={styles.logRow}>
                <View style={[styles.dirIcon, { backgroundColor: c.direction === 'long' ? colors.positiveMuted : colors.dangerMuted }]}>
                  <Ionicons name={c.direction === 'long' ? 'arrow-up' : 'arrow-down'} size={16} color={c.direction === 'long' ? colors.positive : colors.danger} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {c.instrument} {c.direction === 'long' ? 'Long' : 'Short'} · {c.contracts} ct
                  </AppText>
                  <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                    {c.sourceTraderName} · {MODE_LABEL[c.mode]}
                    {c.setup ? ` · ${c.setup}` : ''}
                  </AppText>
                </View>
                <View style={styles.right}>
                  <AppText variant="bodyStrong" style={{ color: res.pnl == null ? colors.textSecondary : res.pnl >= 0 ? colors.positive : colors.danger }}>
                    {res.closed ? (res.r != null ? `${res.r > 0 ? '+' : ''}${res.r.toFixed(2)}R` : money(res.pnl)) : 'Open'}
                  </AppText>
                  <StatusBadge label={VERDICT_LABEL[c.translation.verdict]} tone={v.tone} size="sm" />
                </View>
              </View>
            </Card>
          );
        })
      )}
      <View style={styles.chips}>
        <Chip label="All copied trades in Journal" icon="book-outline" onPress={() => router.push({ pathname: '/journal', params: { origin: 'copied' } })} />
      </View>
    </>
  );
}

function Step({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}>
        <Ionicons name={icon} size={16} color={colors.accentBright} />
      </View>
      <AppText variant="caption" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

function Summary({ icon, label, value, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; tone?: string }) {
  return (
    <View style={styles.sumTile}>
      <Ionicons name={icon} size={16} color={colors.accentBright} />
      <AppText variant="number" style={tone ? { color: tone } : null} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" tone="tertiary" numberOfLines={1} style={styles.sumLabel}>
        {label}
      </AppText>
    </View>
  );
}

function Insight({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <Pressable style={styles.insight} accessible accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <AppText variant="caption" tone="secondary" style={styles.insightLabel}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={styles.insightValue} numberOfLines={2}>
        {value}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm },
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  steps: { alignSelf: 'stretch', gap: spacing.sm, marginVertical: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  stretch: { alignSelf: 'stretch' },
  flex: { flex: 1, minWidth: 0 },
  summary: { flexDirection: 'row', gap: spacing.sm },
  sumTile: { flex: 1, minWidth: 0, gap: 4, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  sumLabel: { fontSize: 11 },
  insight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, flexWrap: 'wrap' },
  insightLabel: { flex: 1, minWidth: 110 },
  insightValue: { textAlign: 'right', flexShrink: 1 },
  note: { marginTop: spacing.sm },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dirIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  right: { alignItems: 'flex-end', gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
