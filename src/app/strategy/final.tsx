import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, Screen, StatusBadge } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import { useResolvedStrategy } from '@/features/strategy/useResolvedStrategy';
import { finalRuleSheet, type SheetOrigin } from '@/lib/engines';

const ORIGIN_TONE: Record<SheetOrigin, Tone> = {
  'YOUR RULE': 'positive',
  'CUSTOM RULE': 'positive',
  'AI SUGGESTION — APPROVED': 'accent',
  'AI INTERPRETATION': 'neutral',
};

/** The finished strategy as a clean rule sheet — every line shows who defined it. */
export default function FinalStrategyScreen() {
  const { resolved, finalRules, readiness, score, savedId, error, practicing, save, testInPractice } = useResolvedStrategy();
  const sheet = useMemo(() => (resolved ? finalRuleSheet(resolved, finalRules) : []), [resolved, finalRules]);

  if (!resolved || !readiness || !score) {
    return (
      <Screen header={<AppHeader title="Final strategy" back />}>
        <EmptyState icon="document-text-outline" title="No strategy yet" message="Describe and analyze your strategy first." actionLabel="Describe my strategy" onAction={() => router.replace('/strategy/describe')} />
      </Screen>
    );
  }

  const filled = sheet.filter((s) => s.lines.length);
  const empty = sheet.filter((s) => !s.lines.length);

  return (
    <Screen
      header={<AppHeader title="Final strategy" subtitle={resolved.name} back />}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            label={savedId ? 'UPDATE MY STRATEGY' : 'SAVE AS MY STRATEGY'}
            icon="save-outline"
            onPress={() => {
              const id = save();
              if (id) router.replace({ pathname: '/strategy/next', params: { id } });
            }}
          />
          <Button label="TEST IN HISTORICAL PRACTICE" icon="time-outline" variant="secondary" size="md" loading={practicing} onPress={testInPractice} />
        </View>
      }>
      <Card tone={readiness.ready ? 'positive' : undefined}>
        <AppText variant="label" tone={readiness.ready ? 'positive' : 'warning'}>
          {readiness.ready ? 'Strategy test ready ✓' : `${readiness.requiredOpen.length} rule${readiness.requiredOpen.length === 1 ? '' : 's'} still need a definition`}
        </AppText>
        <AppText variant="body" style={{ marginTop: 4 }}>
          Definition score {score.total}/100 · {readiness.ready ? 'well defined — rules are measurable.' : 'resolve the remaining rules to make it testable.'}
        </AppText>
        <AppText variant="caption" style={{ marginTop: 4 }}>
          This score measures how clearly your strategy is defined — not whether it makes money.
        </AppText>
      </Card>

      {error ? (
        <Card tone="danger">
          <AppText variant="body">{error}</AppText>
        </Card>
      ) : null}

      <Card>
        {filled.map((s, i) => (
          <View key={s.key} style={[styles.section, i > 0 && styles.border]}>
            <AppText variant="label">{s.title}</AppText>
            {s.lines.map((l) => (
              <View key={l.text} style={styles.line}>
                <AppText variant="body">{l.text}</AppText>
                <StatusBadge label={l.origin} tone={ORIGIN_TONE[l.origin]} size="sm" />
              </View>
            ))}
          </View>
        ))}
      </Card>

      {empty.length ? (
        <AppText variant="caption" tone="tertiary">
          Not defined (optional or not part of this plan): {empty.map((s) => s.title).join(', ')}.
        </AppText>
      ) : null}
      {!readiness.ready ? <Button label="Back to resolve rules" icon="construct-outline" variant="ghost" size="md" onPress={() => router.back()} /> : null}
      <AppText variant="caption" tone="tertiary">
        YOUR RULE = your own words · CUSTOM RULE = a definition you wrote while resolving · AI SUGGESTION — APPROVED = a Prop Guard option you chose · AI INTERPRETATION = how Prop Guard reads your wording. Historical Practice shows how these rules behaved on past or simulated data — never a promise of future results.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: spacing.sm, gap: 4 },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  line: { gap: 4, alignItems: 'flex-start', padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
});
