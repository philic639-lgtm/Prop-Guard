import { StyleSheet, View } from 'react-native';

import { AppText, Card, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, radius, spacing, toneColor } from '@/constants/theme';
import type { CopyTranslation } from '@/lib/engines/copyTradeEngine';
import { money } from '@/utils/format';

import { VERDICT_UI } from './copyUi';

/** The risk translation: verdict, your size, risk, daily impact, why — and the next step. */
export function CopyVerdictCard({ t, sourceLine }: { t: CopyTranslation; sourceLine?: string | null }) {
  const ui = VERDICT_UI[t.verdict];
  const c = toneColor[ui.tone];
  return (
    <Card accent={ui.tone} accessibilityLabel={`${t.label}. ${t.suggestion ?? ''}`}>
      <View style={styles.head}>
        <StatusBadge label={t.label} tone={ui.tone} icon={ui.icon} />
        {sourceLine ? (
          <AppText variant="caption" tone="tertiary" numberOfLines={1} style={styles.flex}>
            {sourceLine}
          </AppText>
        ) : null}
      </View>

      <View style={styles.stats}>
        <Stat label="Your size" value={t.contracts != null ? `${t.contracts} ${t.instrument}` : '—'} strong />
        <Stat label="Est. risk" value={t.riskDollars != null ? money(t.riskDollars) : t.riskPerContract != null ? `${money(t.riskPerContract)}/ct` : '—'} />
        <Stat label="Daily risk left" value={t.remainingAfter != null ? money(t.remainingAfter) : t.dailyRiskRemaining != null ? money(t.dailyRiskRemaining) : '—'} sub={t.remainingAfter != null ? 'after this trade' : t.dailyRiskRemaining != null ? 'today' : 'unknown'} />
      </View>
      {t.rr != null ? (
        <AppText variant="caption" tone="tertiary">
          Reward : risk {t.rr.toFixed(2)}
          {t.rewardDollars != null ? ` · target ${money(t.rewardDollars)}` : ''}
        </AppText>
      ) : null}

      {t.suggestion ? (
        <View style={[styles.suggest, { backgroundColor: c.bg, borderColor: c.fg + '44' }]}>
          <Icon name={t.verdict === 'safe' ? 'checkmark-circle' : 'arrow-forward-circle'} size={18} color={c.fg} />
          <AppText variant="bodyStrong" style={[styles.flex, { color: c.fg }]}>
            {t.suggestion}
          </AppText>
        </View>
      ) : null}
      {t.alternative ? (
        <AppText variant="caption" tone="secondary">
          Smaller contract: {t.alternative.contracts} {t.alternative.instrument} = {money(t.alternative.riskDollars)} risk.
        </AppText>
      ) : null}

      <View style={styles.reasons}>
        {t.reasons.map((r) => (
          <View key={r} style={styles.reason}>
            <View style={[styles.dot, { backgroundColor: c.fg }]} />
            <AppText variant="caption" style={styles.flex}>
              {r}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <View style={styles.stat}>
      <AppText variant="caption" tone="tertiary" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant={strong ? 'number' : 'bodyStrong'} numberOfLines={1} adjustsFontSizeToFit style={styles.num}>
        {value}
      </AppText>
      {sub ? (
        <AppText variant="caption" tone="tertiary" numberOfLines={1} style={styles.sub}>
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, minWidth: 0, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, gap: 2 },
  num: { fontVariant: ['tabular-nums'] },
  sub: { fontSize: 11 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginTop: spacing.md },
  reasons: { gap: spacing.xs, marginTop: spacing.md },
  reason: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
});
