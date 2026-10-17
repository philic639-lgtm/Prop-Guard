import { StyleSheet, View } from 'react-native';

import { spacing, type Tone } from '@/constants/theme';

import { AppText } from './AppText';
import { Card } from './Card';

interface MetricProps {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  compact?: boolean;
}

/** Bare label/value pair, used inside other cards. */
export function Metric({ label, value, sub, tone, compact }: MetricProps) {
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <AppText variant="label" style={{ fontSize: 10 }}>
        {label}
      </AppText>
      <AppText variant="number" tone={tone} style={compact ? { fontSize: 17 } : undefined}>
        {value}
      </AppText>
      {sub ? (
        <AppText variant="caption" tone="tertiary">
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

export function MetricCard(props: MetricProps & { onPress?: () => void }) {
  return (
    <Card style={styles.card} onPress={props.onPress}>
      <Metric {...props} />
    </Card>
  );
}

export function MetricRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  metric: { gap: 4, flex: 1 },
  card: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.md },
});
