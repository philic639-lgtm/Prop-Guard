import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { AppText, Card, SegmentedControl } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { experienceMode } from '@/lib/engines/learningEngine';
import { useAppStore } from '@/store/useAppStore';
import type { ExperienceMode } from '@/types/domain';

/**
 * Beginner ↔ Experienced. Only changes what the app shows first — accounts,
 * rules, strategies, practice, journal and lesson progress are all kept.
 */
export function ExperienceSwitch({ navigate = true }: { navigate?: boolean }) {
  const prefs = useAppStore((s) => s.preferences);
  const setMode = useAppStore((s) => s.setExperienceMode);
  const mode = experienceMode(prefs);

  const change = (m: ExperienceMode) => {
    if (m === mode) return;
    setMode(m);
    if (navigate) router.push(m === 'beginner' ? '/learn' : '/start');
  };

  return (
    <Card style={styles.card}>
      <AppText variant="label">Experience</AppText>
      <SegmentedControl
        options={[
          { value: 'beginner', label: 'Beginner' },
          { value: 'experienced', label: 'Experienced' },
        ]}
        value={mode}
        onChange={change}
      />
      <AppText variant="caption" tone="tertiary">
        {mode === 'beginner'
          ? 'Guided lessons first. Every tool is still available.'
          : 'Straight to your tools. The learning path stays available in Profile.'}{' '}
        Switching keeps all your data and lesson progress.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.sm } });
