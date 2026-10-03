import { StyleSheet, View } from 'react-native';

import { spacing } from '@/constants/theme';

import { AppText } from './AppText';
import { SegmentedControl } from './SegmentedControl';

interface YesNoProps {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}

export function YesNo({ label, value, onChange }: YesNoProps) {
  return (
    <View style={styles.row}>
      <AppText variant="bodyStrong" style={styles.label}>
        {label}
      </AppText>
      <View style={styles.control}>
        <SegmentedControl
          options={[
            { value: 'yes', label: 'Yes', tone: 'positive' },
            { value: 'no', label: 'No', tone: 'danger' },
          ]}
          value={value === null ? null : value ? 'yes' : 'no'}
          onChange={(v) => onChange(v === 'yes')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { flex: 1 },
  control: { width: 148 },
});
