import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import { ScreenshotStatus } from '@/features/accountImport/ScreenshotStatus';
import { useConsumeImport } from '@/features/accountImport/useConsumeImport';
import { AccountFields } from '@/features/accounts/AccountFields';
import { accountSchema, accountToForm, formToAccount, ruleValuesOf, type AccountFormValues } from '@/features/accounts/accountSchema';
import { FirmAutocomplete, FirmRulesStatus, ProgramPicker } from '@/features/accounts/FirmRulePicker';
import { isFirmCustomRule, useFirmRuleLink } from '@/features/accounts/useFirmRuleLink';
import { detectOverrides, evaluateAccount, type RuleStatus } from '@/lib/engines';
import { calcAfterOverrides, validateFirmConfiguration, type ConfigIssue } from '@/lib/engines/firmRulesEngine';
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

  const { control, handleSubmit, setValue, getValues } = useForm<AccountFormValues>({ resolver: zodResolver(accountSchema), defaultValues: accountToForm(existing), mode: 'onBlur' });
  const evaluation = useMemo(() => (existing ? evaluateAccount(existing, trades) : null), [existing, trades]);
  const firmRules = useFirmRuleLink({ existing, setValue, getValues, setCustom });
  const { link } = firmRules;
  const imported = useConsumeImport({ target: 'new', setValue, getValues, loadFromImport: firmRules.loadFromImport });
  const firmText = useWatch({ control, name: 'firm' });
  const values = useWatch({ control }) as AccountFormValues;
  const overrides = useMemo(() => (link ? detectOverrides(link.imported, ruleValuesOf(values)) : []), [link, values]);
  // Firm rules are read-only by default; overriding is an explicit choice.
  const [overriding, setOverriding] = useState(() => (existing?.firmLink?.overrides.length ?? 0) > 0);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const locked = link?.status === 'verified' && !overriding;
  const toggleLock = () => {
    if (!link) return;
    if (overriding) for (const [k, v] of Object.entries(link.imported)) firmRules.restore(k as keyof typeof link.imported, v);
    setOverriding((o) => !o);
  };

  const save = handleSubmit((v) => {
    // Never save a mismatched configuration (rules from another program / options / size).
    const problems = validateFirmConfiguration(firmRules.db, link, { size: v.size }, new Date().toISOString());
    setIssues(problems);
    if (problems.length) return;
    const base = existing ? { ...existing, status, rules: { ...existing.rules, custom } } : null;
    const firmLink = link && (link.firmId || v.firm.trim()) ? { ...link, overrides: detectOverrides(link.imported, ruleValuesOf(v)) } : undefined;
    let account = formToAccount(v, base, existing?.id ?? uuid(), undefined, firmLink);
    account.rules.custom = custom;
    // Verified typed calculations (lock offset, DLL mode, payout) — minus any rule the trader overrode.
    const calc = firmLink?.status === 'verified' ? calcAfterOverrides(firmLink.calc, firmLink.overrides, v.dailyLossLimit) : undefined;
    if (calc) account.rules.calc = calc;
    else delete account.rules.calc;
    account.status = status;
    // A confirmed screenshot import: drawdown tracking from the firm's numbers + history.
    if (!existing) account = imported.finish(account);
    upsert(account);
    router.back();
  });

  return (
    <Screen header={<AppHeader title={existing ? 'Account' : 'New account'} back />} footer={<Button label="Save account" icon="checkmark" onPress={save} />}>
      {evaluation ? (
        <>
          <SectionHeader title="Rule status" />
          <AppText variant="caption">{evaluation.dataBasis}</AppText>
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

      {existing ? <ScreenshotStatus account={existing} /> : null}
      {!existing ? (
        imported.active ? (
          <Card tone="positive">
            <StatusBadge label="Screenshot values loaded" tone="positive" icon="camera-outline" size="sm" />
            <AppText variant="caption" style={{ marginTop: spacing.sm }}>
              Confirmed values from your screenshot are filled in{imported.active.programId ? ' and the matched program’s verified rules are loaded' : ''}. Review and save.
            </AppText>
            <Button label="Discard screenshot values" variant="ghost" size="md" onPress={imported.discard} />
          </Card>
        ) : (
          <Button label="Import account screenshot" icon="camera-outline" variant="secondary" onPress={() => router.push({ pathname: '/accounts/import', params: { from: 'new' } })} />
        )
      ) : null}

      <SectionHeader title="Details" />
      <AccountFields
        control={control}
        imported={link?.status === 'verified' ? link.imported : undefined}
        onRestore={firmRules.restore}
        locked={locked}
        onToggleLock={link?.status === 'verified' ? toggleLock : undefined}
        firmSlot={
          <>
            <FirmAutocomplete db={firmRules.db} value={firmText ?? ''} selected={firmRules.firm} onChangeText={firmRules.changeFirmText} onSelectFirm={firmRules.selectFirm} />
            {firmRules.firm ? <ProgramPicker
                key={firmRules.firm.id}
                db={firmRules.db}
                firm={firmRules.firm}
                link={link}
                familyKey={firmRules.familyKey}
                options={firmRules.options}
                purchasedOn={firmRules.purchasedOn}
                onSelectFamily={firmRules.selectFamily}
                onSelectProgram={firmRules.selectProgram}
                onSelectOption={firmRules.selectOption}
                onChangePurchasedOn={firmRules.changePurchasedOn}
                onCustomProgram={firmRules.customProgram}
              /> : null}
          </>
        }
        rulesFooter={<FirmRulesStatus db={firmRules.db} link={link} overrides={overrides} firmName={firmRules.firm?.name ?? firmText ?? ''} />}
      />

      {issues.length ? (
        <Card tone="danger">
          <AppText variant="bodyStrong" tone="danger">
            Fix the account configuration before saving
          </AppText>
          {issues.map((i) => (
            <AppText key={i.message} variant="body" style={{ marginTop: 4 }}>
              • {i.message}
            </AppText>
          ))}
        </Card>
      ) : null}

      <SectionHeader title="Custom rules" />
      <Card>
        {custom.length === 0 ? <AppText variant="caption">Track any other rule your firm has, e.g. &quot;No trading during FOMC&quot;.</AppText> : null}
        {custom.map((c) => (
          <View key={c.id} style={styles.custom}>
            <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
            <View style={styles.flex}>
              <AppText variant="body">{c.label}</AppText>
              {c.description ? <AppText variant="caption">{c.description}</AppText> : null}
            </View>
            {isFirmCustomRule(c) ? <StatusBadge label="Firm rule" tone="positive" size="sm" /> : null}
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
