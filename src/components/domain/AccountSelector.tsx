import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Sheet, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useActiveAccount } from '@/hooks/useAppData';
import { useAppStore } from '@/store/useAppStore';
import { money } from '@/utils/format';

/** Account balance hero with a dropdown to switch accounts. */
export function AccountSelector() {
  const account = useActiveAccount();
  const accounts = useAppStore((s) => s.accounts);
  const setActive = useAppStore((s) => s.setActiveAccount);
  const [open, setOpen] = useState(false);

  if (!account) {
    return (
      <Card>
        <AppText variant="heading">No trading account</AppText>
        <AppText variant="caption" style={{ marginVertical: spacing.sm }}>
          Add an account so Prop Guard can track your limits.
        </AppText>
        <Button label="Add account" onPress={() => router.push('/accounts/new')} size="md" />
      </Card>
    );
  }

  const cycle = account.balance - account.cycleStartBalance;
  return (
    <>
      <Card onPress={() => setOpen(true)} accessibilityLabel={`Account ${account.name}, balance ${money(account.balance)}. Tap to switch.`}>
        <View style={styles.head}>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {account.name}
          </AppText>
          <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
        </View>
        <AppText variant="hero" style={styles.balance}>
          {money(account.balance)}
        </AppText>
        <AppText variant="label">Account balance</AppText>
        <AppText variant="bodyStrong" tone={cycle > 0 ? 'positive' : cycle < 0 ? 'danger' : 'secondary'} style={styles.cycle}>
          {money(cycle, { sign: true })} this cycle
        </AppText>
      </Card>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Switch account">
        {accounts.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityState={{ selected: a.id === account.id }}
            onPress={() => {
              setActive(a.id);
              setOpen(false);
            }}
            style={[styles.option, a.id === account.id && styles.optionActive]}>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">{a.name}</AppText>
              <AppText variant="caption">{a.firm || (a.kind === 'personal' ? 'Personal' : 'Prop')}</AppText>
            </View>
            <View style={styles.optionRight}>
              <AppText variant="number" style={{ fontSize: 16 }}>
                {money(a.balance)}
              </AppText>
              {a.status !== 'active' ? <StatusBadge label={a.status} tone="neutral" size="sm" /> : null}
            </View>
          </Pressable>
        ))}
        <Button
          label="Manage accounts"
          variant="secondary"
          icon="briefcase-outline"
          onPress={() => {
            setOpen(false);
            router.push('/accounts');
          }}
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  balance: { marginTop: spacing.md },
  cycle: { marginTop: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  optionActive: { borderColor: colors.accent },
  optionRight: { alignItems: 'flex-end', gap: 4 },
});
