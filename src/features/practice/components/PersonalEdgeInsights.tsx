import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { MIN_INSIGHT_ATTEMPTS, type PracticeInsight } from '@/lib/engines';

/**
 * PROP GUARD INSIGHT cards from the rules-based Personal Edge analyzer.
 * Shown only once there is enough practice history.
 */
export function PersonalEdgeInsights({ insights, attempts }: { insights: PracticeInsight[]; attempts: number }) {
  if (attempts < MIN_INSIGHT_ATTEMPTS) {
    return (
      <Card>
        <View style={styles.head}>
          <Ionicons name="analytics-outline" size={16} color={colors.accentBright} />
          <AppText variant="label" tone="accent">
            Personal edge insights
          </AppText>
        </View>
        <AppText variant="body" style={{ marginTop: spacing.sm }}>
          Complete {MIN_INSIGHT_ATTEMPTS - attempts} more scenario{MIN_INSIGHT_ATTEMPTS - attempts === 1 ? '' : 's'} to unlock insights. Prop Guard only compares setups once each side has enough attempts.
        </AppText>
        <View style={styles.progress}>
          <View style={[styles.fill, { width: `${(attempts / MIN_INSIGHT_ATTEMPTS) * 100}%` }]} />
        </View>
      </Card>
    );
  }
  if (!insights.length) {
    return (
      <Card>
        <AppText variant="label" tone="accent">
          Personal edge insights
        </AppText>
        <AppText variant="body" style={{ marginTop: spacing.sm }}>
          No meaningful differences yet — your accuracy is similar across the setups you&apos;ve practised. Keep practising varied scenarios.
        </AppText>
      </Card>
    );
  }
  return (
    <View style={{ gap: spacing.md }}>
      {insights.map((i) => (
        <Card key={i.id} tone="accent">
          <View style={styles.head}>
            <Ionicons name="sparkles" size={16} color={colors.accentBright} />
            <AppText variant="label" tone="accent">
              Prop Guard insight
            </AppText>
          </View>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            {i.title}
          </AppText>
          <AppText variant="body" style={{ marginTop: spacing.xs }}>
            {i.body}
          </AppText>
          <View style={styles.compare}>
            {i.comparison.map((c) => (
              <View key={c.label} style={styles.flex}>
                <AppText variant="caption">{c.label}</AppText>
                <AppText variant="number">{c.value}</AppText>
                <AppText variant="caption" tone="tertiary">
                  {c.attempts} attempts
                </AppText>
              </View>
            ))}
          </View>
          {i.focus ? (
            <AppText variant="caption" style={{ marginTop: spacing.sm }}>
              Suggested practice focus: <AppText variant="caption" style={{ color: colors.text, fontWeight: '700' }}>{i.focus}</AppText>
            </AppText>
          ) : null}
        </Card>
      ))}
      <AppText variant="caption" tone="tertiary">
        Observations from your own practice attempts only. Small samples can change quickly.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  compare: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  progress: { height: 6, borderRadius: 3, backgroundColor: colors.surface, marginTop: spacing.md, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
});
