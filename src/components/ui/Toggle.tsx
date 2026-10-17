import { StyleSheet, Switch, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

import { AppText } from './AppText';

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function ToggleRow({ label, description, value, onChange, disabled }: ToggleRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? <AppText variant="caption">{description}</AppText> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.borderStrong, true: colors.accent }}
        thumbColor="#fff"
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
});
