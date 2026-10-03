import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppHeader,
  AppText,
  Button,
  Card,
  ConfirmationSheet,
  Input,
  RiskProgress,
  Screen,
  SectionHeader,
  SegmentedControl,
  StatusBadge,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { AccountFields } from '@/features/accounts/AccountFields';
import { accountSchema, accountToForm, formToAccount, type AccountFormValues } from '@/features/accounts/accountSchema';
import { evaluateAccount, type RuleStatus } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { AccountStatus, CustomRule } from '@/types/domain';
import { uuid } from '@/utils/id';

const STATUS_TONE: Record<RuleStatus, 'positive' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'positive',
  warning: 'warning',
  breached: 'danger',
  info: 'neutral',
};

export default function AccountEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accounts = useAppStore((s) => s.accounts);
  const trades = useAppStore((s) => s.trades);
  const upsert = useAppStore((s) => s.upsertAccount);
  const remove = useAppStore((s) => s.deleteAccount);
  const existing = accounts.find((a) => a.id === id) ?? null;
  const [custom, setCustom] = useState<CustomRule[]>(existing?.rules.custom ?? []);
  const [status, setStatus] = useState<AccountStatus>(existing?.status ?? 'active');
  const [newRule, setNewRule] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { control, handleSubmit } = useForm<AccountFormValues>({ resolver: zodResolver(accountSchema), defaultValues: accountToForm(existing), mode: 'onBlur' });
  const evaluation = useMemo(() => (existing ? evaluateAccount(existing, trades) : null), [existing, trades]);

  const save = handleSubmit((v) => {
    const base = existing ? { ...existing, status, rules: { ...existing.rules, custom } } : null;
    const account = formToAccount(v, base, existing?.id ?? uuid());
    account.rules.custom = custom;
    account.status = status;
    upsert(account);
    router.back();
  });

  return (
    <Screen header={<AppHeader title={existing ? 'Account' : 'New account'} back />} footer={<Button label="Save account" icon="checkmark" onPress={save} />}>
      {evaluation ? (
        <>
          <SectionHeader title="Rule status" />
          <Card>
            {evaluation.rules.map((r, i) => (
              <View key={r.id} style={[styles.rule, i > 0 && styles.ruleBorder]}>
                <View style={styles.ruleHead}>
                  <AppText variant="bodyStrong" style={styles.flex}>
                    {r.label}
                  </AppText>
                  <StatusBadge label={r.status === 'info' ? r.current : r.status} tone={STATUS_TONE[r.status]} size="sm" />
                </View>
                <AppText variant="caption">{r.message}</AppText>
                {r.proximity != null && r.status !== 'info' ? <RiskProgress value={r.proximity} height={5} label={r.label} /> : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Details" />
      <AccountFields control={control} />

      <SectionHeader title="Custom rules" />
      <Card>
        {custom.length === 0 ? <AppText variant="caption">Track any other rule your firm has, e.g. &quot;No trading during FOMC&quot;.</AppText> : null}
        {custom.map((c) => (
          <View key={c.id} style={styles.custom}>
            <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
            <AppText variant="body" style={styles.flex}>
              {c.label}
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c.label}`} hitSlop={10} onPress={() => setCustom((cur) => cur.filter((x) => x.id !== c.id))}>
              <Ionicons name="close" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))}
        <View style={[styles.customAdd]}>
          <View style={styles.flex}>
            <Input value={newRule} onChangeText={setNewRule} placeholder="Add a custom rule" />
          </View>
          <Button
            label="Add"
            size="md"
            variant="secondary"
            onPress={() => {
              if (!newRule.trim()) return;
              setCustom((c) => [...c, { id: uuid().slice(0, 8), label: newRule.trim() }]);
              setNewRule('');
            }}
          />
        </View>
      </Card>

      {existing ? (
        <>
          <SegmentedControl
            label="Status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'passed', label: 'Passed' },
              { value: 'failed', label: 'Failed' },
              { value: 'archived', label: 'Archived' },
            ]}
            value={status}
            onChange={setStatus}
          />
          <Button label="Delete account" variant="ghost" onPress={() => setConfirmDelete(true)} />
        </>
      ) : null}

      <ConfirmationSheet
        visible={confirmDelete}
        title="Delete account"
        message="Trades and sessions for this account will also be removed when synced."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (existing) remove(existing.id);
          setConfirmDelete(false);
          router.back();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  rule: { gap: 6, paddingVertical: spacing.md },
  ruleBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  ruleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  custom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  customAdd: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
});
