import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/constants/theme';

import { AppText } from './AppText';

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, action, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <AppText variant="label" accessibilityRole="header">
        {title}
      </AppText>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={action}>
          <AppText variant="caption" tone="accent" style={styles.action}>
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  action: { fontWeight: '600' },
});
