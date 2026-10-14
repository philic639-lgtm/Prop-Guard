import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, RiskProgress, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, radius, spacing } from '@/constants/theme';
import type { AccountCard } from '@/lib/engines/accountOverview';
import { money } from '@/utils/format';

const STAGE_LABEL = { evaluation: 'Evaluation', funded: 'Funded', live: 'Live' } as const;

/**
 * One account, compact: who / size / program, balance, verified drawdown left, target
 * progress, last update and the most urgent attention reason. Tapping opens the account's
 * full dashboard; "Update" starts a screenshot / manual update for THIS account.
 */
export function AccountCardView({ card, onOpen, onUpdate, onMore, compact }: { card: AccountCard; onOpen: () => void; onUpdate?: () => void; onMore?: () => void; compact?: boolean }) {
  const top = card.attention[0];
  const tone = top?.level === 'critical' ? colors.danger : top?.level === 'warning' ? colors.warning : colors.textSecondary;
  const sub = [card.firm, card.size ? `$${Math.round(card.size / 1000)}K` : null, card.program, card.stage ? STAGE_LABEL[card.stage] : null].filter(Boolean).join(' · ');
  return (
    <View style={[styles.card, card.active && styles.active, card.status === 'archived' && styles.archived]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${card.name} dashboard`} onPress={onOpen} style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
        <View style={styles.row}>
          <View style={styles.mono}>
            <AppText variant="bodyStrong" style={styles.monoText}>
              {card.initials}
            </AppText>
          </View>
          <View style={styles.flex}>
            <View style={styles.row}>
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.flexShrink}>
                {card.name}
              </AppText>
              {card.primary ? <StatusBadge label="Primary" tone="accent" size="sm" /> : null}
              {card.status !== 'active' ? <StatusBadge label={card.status} tone="neutral" size="sm" /> : null}
            </View>
            <AppText variant="caption" tone="tertiary" numberOfLines={1}>
              {sub}
            </AppText>
          </View>
          <View style={styles.right}>
            <AppText variant="bodyStrong">{money(card.balance)}</AppText>
            <AppText variant="caption" tone={card.remaining == null ? 'warning' : card.remainingShare != null && card.remainingShare <= 0.25 ? 'danger' : 'secondary'}>
              {card.remaining == null ? 'DD: Needs update' : `DD left ${money(card.remaining)}`}
            </AppText>
          </View>
        </View>
        {!compact && card.targetProgress != null ? <RiskProgress value={card.targetProgress} tone="positive" height={4} label={`${card.name} profit target progress`} /> : null}
        {top ? (
          <View style={styles.row}>
            <Icon name={top.level === 'critical' ? 'alert-circle' : 'alert-circle-outline'} size={13} color={tone} />
            <AppText variant="caption" style={[styles.flex, { color: tone }]} numberOfLines={2}>
              {top.text}
              {card.attention.length > 1 ? ` (+${card.attention.length - 1} more)` : ''}
            </AppText>
          </View>
        ) : null}
      </Pressable>
      <View style={styles.foot}>
        <Icon name={card.snapshotBased ? 'camera-outline' : 'time-outline'} size={12} color={colors.textTertiary} />
        <AppText variant="caption" tone="tertiary" numberOfLines={1} style={styles.flex}>
          {card.snapshotBased ? 'Snapshot · not live verified · ' : ''}
          {card.lastUpdate.label}
          {card.targetProgress != null && !compact ? ` · Target ${Math.round(card.targetProgress * 100)}%` : ''}
        </AppText>
        {onUpdate ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Update ${card.name}`} onPress={onUpdate} hitSlop={8} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
            <Icon name="refresh" size={14} color={colors.accentBright} />
            <AppText variant="caption" style={styles.linkText}>
              Update
            </AppText>
          </Pressable>
        ) : null}
        {onMore ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`More actions for ${card.name}`} onPress={onMore} hitSlop={8} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
            <Icon name="options-outline" size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  active: { borderColor: colors.accent },
  archived: { opacity: 0.6 },
  main: { padding: spacing.md, gap: spacing.xs },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1, minWidth: 0 },
  mono: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  monoText: { color: colors.accentBright, fontSize: 13 },
  right: { alignItems: 'flex-end' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, marginTop: -spacing.xs },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm },
  linkText: { color: colors.accentBright, fontWeight: '700' },
});
