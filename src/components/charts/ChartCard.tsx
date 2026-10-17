import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { spacing } from '@/constants/theme';

interface ChartCardProps {
  title: string;
  value?: string;
  valueTone?: 'positive' | 'danger' | 'primary';
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
}

export function ChartCard({ title, value, valueTone = 'primary', subtitle, children, right }: ChartCardProps) {
  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.titles}>
          <AppText variant="label">{title}</AppText>
          {value ? (
            <AppText variant="display" tone={valueTone}>
              {value}
            </AppText>
          ) : null}
          {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
        </View>
        {right}
      </View>
      <View style={styles.body}>{children}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  titles: { gap: spacing.xs, flex: 1 },
  body: { marginTop: spacing.lg },
});
