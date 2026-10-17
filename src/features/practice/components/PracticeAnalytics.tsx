import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import type { AccuracyGroup, SetupProfile } from '@/lib/engines';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const barColor = (v: number) => (v >= 0.7 ? colors.positive : v >= 0.5 ? colors.warning : colors.danger);

/** Accuracy rows with bars — used for strategy, instrument, direction, session and retest breakdowns. */
export function AccuracyList({ groups, empty, minAttempts = 1 }: { groups: AccuracyGroup[]; empty?: string; minAttempts?: number }) {
  const rows = groups.filter((g) => g.attempts >= minAttempts);
  if (!rows.length) {
    return (
      <Card>
        <AppText variant="caption">{empty ?? 'Not enough attempts yet.'}</AppText>
      </Card>
    );
  }
  return (
    <Card>
      {rows.map((g, i) => (
        <View key={g.key} style={[styles.row, i > 0 && styles.border]} accessible accessibilityLabel={`${g.label}: ${pct(g.accuracy)} accuracy over ${g.attempts} attempts`}>
          <View style={styles.labelCol}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {g.label}
            </AppText>
            <AppText variant="caption">
              {g.attempts} attempt{g.attempts === 1 ? '' : 's'}
              {g.avgScore != null ? ` · avg score ${g.avgScore}` : ''}
            </AppText>
          </View>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${Math.max(4, g.accuracy * 100)}%`, backgroundColor: barColor(g.accuracy) }]} />
          </View>
          <AppText variant="bodyStrong" style={[styles.val, { color: barColor(g.accuracy) }]}>
            {pct(g.accuracy)}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

/** YOUR STRONGEST / WEAKEST SETUP card. */
export function SetupProfileCard({ title, profile, tone }: { title: string; profile: SetupProfile | null; tone: 'positive' | 'warning' }) {
  return (
    <Card tone={profile ? tone : undefined} style={styles.flex}>
      <AppText variant="label" tone={profile ? tone : undefined}>
        {title}
      </AppText>
      {profile ? (
        <>
          <AppText variant="heading" style={{ marginTop: spacing.sm }}>
            {profile.strategyName}
          </AppText>
          {[profile.retest, profile.direction, profile.instrument].filter(Boolean).map((x) => (
            <AppText key={x} variant="caption">
              {x}
            </AppText>
          ))}
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            Accuracy: {pct(profile.accuracy)}
          </AppText>
          <AppText variant="caption">{profile.attempts} attempts</AppText>
        </>
      ) : (
        <AppText variant="caption" style={{ marginTop: spacing.sm }}>
          Needs at least 5 attempts on the same setup.
        </AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  labelCol: { width: '42%' },
  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  val: { width: 44, textAlign: 'right' },
  flex: { flex: 1 },
});
