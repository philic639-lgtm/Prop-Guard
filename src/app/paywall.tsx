import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Screen, SegmentedControl, StatusBadge } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { subscriptionService, type Offering } from '@/services/subscriptionService';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';

export default function Paywall() {
  const plan = useSubscriptionStore((s) => s.plan);
  const purchase = useSubscriptionStore((s) => s.purchase);
  const restore = useSubscriptionStore((s) => s.restore);
  const setDevPlan = useSubscriptionStore((s) => s.setDevPlan);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void subscriptionService.provider.getOfferings().then(setOfferings);
  }, []);

  const offering = offerings[0];
  const pro = PLANS.pro;

  return (
    <Screen
      header={<AppHeader title="Prop Guard Pro" back />}
      footer={
        plan === 'pro' ? (
          <Button label="You're on Pro" variant="secondary" icon="checkmark-circle" onPress={() => router.back()} />
        ) : (
          <>
            <Button
              label={offering ? `Start Pro · ${offering.priceLabel}` : 'Start Pro'}
              loading={busy}
              onPress={async () => {
                setBusy(true);
                const r = await purchase(offering?.id ?? 'pro_monthly');
                setBusy(false);
                if (r.ok) router.back();
              }}
            />
            <Button label="Restore purchases" variant="ghost" onPress={() => void restore()} />
          </>
        )
      }>
      <View style={styles.hero}>
        <View style={styles.icon}>
          <Ionicons name="shield-checkmark" size={30} color={colors.accent} />
        </View>
        <AppText variant="title" align="center">
          {pro.tagline}
        </AppText>
        <AppText variant="body" tone="secondary" align="center">
          Everything in Free, plus the full discipline engine.
        </AppText>
      </View>

      <Card tone="accent">
        {pro.highlights.map((h) => (
          <View key={h} style={styles.feature}>
            <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
            <AppText variant="body">{h}</AppText>
          </View>
        ))}
      </Card>

      <Card>
        <AppText variant="label">Free</AppText>
        {PLANS.free.highlights.map((h) => (
          <AppText key={h} variant="caption" style={{ marginTop: spacing.xs }}>
            • {h}
          </AppText>
        ))}
      </Card>

      {subscriptionService.isDevelopment ? (
        <Card>
          <View style={styles.devHead}>
            <StatusBadge label="Development billing" tone="warning" size="sm" />
          </View>
          <AppText variant="caption" style={{ marginVertical: spacing.sm }}>
            RevenueCat is not configured. Preview either tier below — no charges are made.
          </AppText>
          <SegmentedControl
            options={[
              { value: 'free', label: 'Free' },
              { value: 'pro', label: 'Pro' },
            ]}
            value={plan}
            onChange={setDevPlan}
          />
        </Card>
      ) : null}

      <AppText variant="caption" tone="tertiary" align="center">
        Subscriptions renew automatically until cancelled in your App Store settings. {DISCLAIMER}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  icon: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  devHead: { flexDirection: 'row' },
});
