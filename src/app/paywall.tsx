import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Logo, Screen, SegmentedControl, StatusBadge } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { DISCLAIMER } from '@/constants/legal';
import { colors, radius, spacing } from '@/constants/theme';
import { subscriptionService, type Offering } from '@/services/subscriptionService';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';

type Cell = boolean | string;

/** Feature comparison. Mirrors entitlements in config/plans.ts — no hidden limits. */
const ROWS: { label: string; free: Cell; pro: Cell }[] = [
  { label: 'Rule-based trade check', free: true, pro: true },
  { label: 'Risk & position calculator', free: true, pro: true },
  { label: 'Daily Guard & cooldowns', free: true, pro: true },
  { label: 'AI setup analysis', free: false, pro: 'Unlimited' },
  { label: 'Strategy builder (plain English → rules)', free: '1 strategy', pro: 'Unlimited' },
  { label: 'Screenshot analysis', free: false, pro: 'Unlimited' },
  { label: 'AI trade journaling', free: false, pro: true },
  { label: 'Journal history', free: 'Latest 50', pro: 'Unlimited' },
  { label: 'Performance insights', free: 'Basic', pro: 'Advanced' },
  { label: 'Practice mode', free: false, pro: true },
  { label: 'AI session summaries', free: false, pro: true },
  { label: 'Discipline Score & AI Coach', free: false, pro: true },
  { label: 'Trading accounts', free: '1', pro: 'Unlimited' },
  { label: 'Strategy library templates', free: '3', pro: 'All' },
];

function CellView({ value, pro }: { value: Cell; pro?: boolean }) {
  if (value === true) return <Ionicons name="checkmark-circle" size={18} color={pro ? colors.accentBright : colors.positive} />;
  if (value === false) return <Ionicons name="remove" size={18} color={colors.textTertiary} />;
  return (
    <AppText variant="caption" align="center" style={{ color: pro ? colors.accentBright : colors.textSecondary, fontWeight: '600', fontSize: 11.5 }}>
      {value}
    </AppText>
  );
}

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
        <Logo size="lg" />
        <AppText variant="title" align="center">
          {PLANS.pro.tagline}
        </AppText>
        <AppText variant="body" tone="secondary" align="center">
          Every check, every rule, every insight — so you trade your strategy, not your emotions.
        </AppText>
      </View>

      <View style={styles.plans}>
        <View style={[styles.planCard, plan === 'free' && styles.planCurrent]}>
          <AppText variant="label">Free</AppText>
          <AppText variant="number">$0</AppText>
          <AppText variant="caption">Core risk tools</AppText>
        </View>
        <View style={[styles.planCard, styles.planPro, plan === 'pro' && styles.planCurrent]}>
          <View style={styles.row}>
            <AppText variant="label" tone="accent">
              Pro
            </AppText>
            <StatusBadge label="Best" tone="accent" size="sm" />
          </View>
          <AppText variant="number">{offering?.priceLabel ?? PLANS.pro.fallbackPriceLabel}</AppText>
          <AppText variant="caption">Full discipline engine</AppText>
        </View>
      </View>

      <Card padded={false}>
        <View style={[styles.tr, styles.th]}>
          <AppText variant="label" style={styles.feature}>
            Feature
          </AppText>
          <AppText variant="label" style={styles.col} align="center">
            Free
          </AppText>
          <AppText variant="label" tone="accent" style={styles.col} align="center">
            Pro
          </AppText>
        </View>
        {ROWS.map((r) => (
          <View key={r.label} style={styles.tr} accessible accessibilityLabel={`${r.label}: Free ${r.free === true ? 'included' : r.free === false ? 'not included' : r.free}; Pro ${r.pro === true ? 'included' : r.pro}`}>
            <AppText variant="body" style={[styles.feature, { fontSize: 14 }]}>
              {r.label}
            </AppText>
            <View style={styles.col}>
              <CellView value={r.free} />
            </View>
            <View style={styles.col}>
              <CellView value={r.pro} pro />
            </View>
          </View>
        ))}
      </Card>

      {subscriptionService.isDevelopment ? (
        <Card>
          <StatusBadge label="Development billing" tone="warning" size="sm" />
          <AppText variant="caption" style={{ marginVertical: spacing.sm }}>
            RevenueCat is not configured. Preview either tier — no charges are made.
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  plans: { flexDirection: 'row', gap: spacing.md },
  planCard: { flex: 1, gap: 4, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  planPro: { borderColor: colors.accent, backgroundColor: '#0D1B33' },
  planCurrent: { borderColor: colors.positive },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  th: { borderTopWidth: 0 },
  feature: { flex: 1 },
  col: { width: 74, alignItems: 'center' },
});
