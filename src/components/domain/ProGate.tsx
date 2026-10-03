import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card } from '@/components/ui';
import type { Feature } from '@/config/plans';
import { colors, spacing } from '@/constants/theme';
import { useEntitlement } from '@/store/useSubscriptionStore';

interface ProGateProps {
  feature: Feature;
  title: string;
  description: string;
  children: ReactNode;
}

/** Renders children when entitled, otherwise an upgrade card. */
export function ProGate({ feature, title, description, children }: ProGateProps) {
  const allowed = useEntitlement(feature);
  if (allowed) return <>{children}</>;
  return (
    <Card tone="accent">
      <View style={styles.head}>
        <Ionicons name="lock-closed" size={16} color={colors.accent} />
        <AppText variant="label" tone="accent">
          Prop Guard Pro
        </AppText>
      </View>
      <AppText variant="heading" style={styles.title}>
        {title}
      </AppText>
      <AppText variant="caption">{description}</AppText>
      <Button label="See Pro" size="md" onPress={() => router.push('/paywall')} style={styles.btn} />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { marginTop: spacing.sm, marginBottom: spacing.xs },
  btn: { marginTop: spacing.lg },
});
