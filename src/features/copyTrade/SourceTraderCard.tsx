import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { FOLLOW_LABEL, type SourceTraderStats } from '@/lib/engines/copyTradeEngine';
import type { SourceTrader } from '@/types/copyTrade';
import { money } from '@/utils/format';

import { FOLLOW_UI, PLATFORM_ICON, PLATFORM_LABEL } from './copyUi';

/** A source trader with their copy record and the keep / reduce / stop read-out. */
export function SourceTraderCard({ trader, stats, onPress }: { trader: SourceTrader; stats: SourceTraderStats | undefined; onPress: () => void }) {
  const f = FOLLOW_UI[stats?.verdict ?? 'too_few'];
  return (
    <Card onPress={onPress} accessibilityLabel={`${trader.name}, ${FOLLOW_LABEL[stats?.verdict ?? 'too_few']}`}>
      <View style={styles.row}>
        <View style={[styles.avatar, !trader.isActive && styles.inactive]}>
          <Ionicons name={PLATFORM_ICON[trader.platform]} size={18} color={colors.accentBright} />
        </View>
        <View style={styles.flex}>
          <AppText variant="heading" numberOfLines={1}>
            {trader.name}
          </AppText>
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            {[PLATFORM_LABEL[trader.platform], trader.style, trader.instruments.slice(0, 3).join(' · ')].filter(Boolean).join(' · ')}
            {trader.archived ? ' · archived' : !trader.isActive ? ' · paused' : ''}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>
      <View style={styles.stats}>
        <Mini label="Copies" value={String(stats?.logged ?? 0)} />
        <Mini label="Win rate" value={stats?.winRate != null ? `${Math.round(stats.winRate * 100)}%` : '—'} />
        <Mini label="Avg R" value={stats?.avgR != null ? stats.avgR.toFixed(2) : '—'} tone={stats?.avgR != null ? (stats.avgR >= 0 ? colors.positive : colors.danger) : undefined} />
        <Mini label="Net P&L" value={stats && stats.live ? money(stats.netPnl) : '—'} tone={stats && stats.live && stats.netPnl !== 0 ? (stats.netPnl > 0 ? colors.positive : colors.danger) : undefined} />
      </View>
      <StatusBadge label={FOLLOW_LABEL[stats?.verdict ?? 'too_few']} tone={f.tone} icon={f.icon} size="sm" />
    </Card>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.mini}>
      <AppText variant="caption" tone="tertiary" style={styles.miniLabel} numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={[styles.num, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  avatar: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accentBright + '44' },
  inactive: { opacity: 0.5 },
  stats: { flexDirection: 'row', gap: spacing.xs, marginVertical: spacing.md },
  mini: { flex: 1, minWidth: 0, gap: 2 },
  miniLabel: { fontSize: 11 },
  num: { fontVariant: ['tabular-nums'] },
});
