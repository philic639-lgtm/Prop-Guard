import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';

interface Props {
  step: number;
  total?: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  cta: string;
  onNext: () => void;
  disabled?: boolean;
  secondary?: { label: string; onPress: () => void };
}

export function OnboardingScaffold({ step, total = 6, title, subtitle, children, cta, onNext, disabled, secondary }: Props) {
  return (
    <Screen
      header={
        <View>
          <AppHeader back title={`Step ${step} of ${total}`} />
          <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
            {Array.from({ length: total }).map((_, i) => (
              <View key={i} style={[styles.seg, i < step && styles.segOn]} />
            ))}
          </View>
        </View>
      }
      footer={
        <>
          <Button label={cta} onPress={onNext} disabled={disabled} />
          {secondary ? <Button label={secondary.label} variant="ghost" onPress={secondary.onPress} /> : null}
        </>
      }>
      <View style={styles.titles}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="body" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 4, paddingHorizontal: 20, marginBottom: spacing.sm },
  seg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.border },
  segOn: { backgroundColor: colors.accent },
  titles: { gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
});
