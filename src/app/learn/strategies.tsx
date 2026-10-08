import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Screen, StatusBadge } from '@/components/ui';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { finderAnswersFromProfile } from '@/features/strategy/finderProfile';
import { COMPLEXITY_TONE, windowLabel } from '@/features/strategy/LibraryCard';
import { recommendStrategies } from '@/lib/engines/learningEngine';
import { matchTemplates } from '@/lib/engines/strategyLibraryEngine';
import { useAppStore } from '@/store/useAppStore';

/** Library frameworks that fit the trader's personality (or profile). Fit = structure, never results. */
export default function LearnStrategies() {
  const prefs = useAppStore((s) => s.preferences);
  const rules = useAppStore((s) => s.tradingRules);
  const personality = prefs.learning?.personality ?? null;
  const planId = prefs.learning?.plan?.templateId ?? null;

  const matches = useMemo(
    () => (personality ? recommendStrategies(personality.answers, prefs.markets, 3) : matchTemplates(finderAnswersFromProfile(prefs, rules), 3)),
    [personality, prefs, rules],
  );

  return (
    <Screen header={<AppHeader title="Strategies for you" subtitle={personality ? `Matched to: ${personality.archetype}` : 'Matched to your profile'} back />}>
      {!personality ? (
        <Card tone="accent" style={styles.gap}>
          <AppText variant="bodyStrong">Take the personality assessment for better matches</AppText>
          <AppText variant="caption" tone="secondary">
            These use your onboarding profile for now.
          </AppText>
          <Button label="Take the assessment" variant="secondary" onPress={() => router.push('/learn/personality')} />
        </Card>
      ) : null}

      {matches.map((m, i) => {
        const t = getTemplate(m.templateId);
        if (!t) return null;
        return (
          <Card key={m.templateId} raised={i === 0} style={styles.gap}>
            <View style={styles.head}>
              <View style={styles.flex}>
                <AppText variant="label">{i === 0 ? 'Best fit' : `Option ${i + 1}`}</AppText>
                <AppText variant="heading">{t.shortName}</AppText>
              </View>
              <StatusBadge label={`${m.fitScore}% fit`} tone="accent" size="sm" />
            </View>
            <AppText variant="caption" tone="secondary">
              {t.description}
            </AppText>
            <View style={styles.badges}>
              <StatusBadge label={t.experienceLevel} tone={COMPLEXITY_TONE[t.experienceLevel]} size="sm" />
              <StatusBadge label={windowLabel(t)} size="sm" />
              <StatusBadge label={t.isBacktested ? 'Backtested data' : 'Not backtested'} size="sm" />
            </View>
            {m.reasons.slice(0, 3).map((r) => (
              <AppText key={r} variant="caption" tone="positive">
                ✓ {r}
              </AppText>
            ))}
            {m.cautions.slice(0, 2).map((c) => (
              <AppText key={c} variant="caption" tone="warning">
                ! {c}
              </AppText>
            ))}
            <View style={styles.actions}>
              <Button label="How it works" variant="secondary" style={styles.flex} onPress={() => router.push({ pathname: '/strategy/library/[id]', params: { id: t.id } })} />
              <Button
                label={planId === t.id ? 'In my plan' : 'Build plan'}
                style={styles.flex}
                icon="map-outline"
                onPress={() => router.push({ pathname: '/learn/plan', params: { templateId: t.id } })}
              />
            </View>
          </Card>
        );
      })}

      <AppText variant="caption" tone="tertiary">
        Fit scores compare the framework’s session, frequency, hold time and style with your answers — they are not win rates or a prediction of results. {LIBRARY_DISCLAIMER}
      </AppText>
      <Button label="Browse the full library" variant="ghost" onPress={() => router.push('/strategy/library')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
