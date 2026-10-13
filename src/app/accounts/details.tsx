import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Chip, ConfirmationSheet, Input, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, radius, spacing } from '@/constants/theme';
import { DetailFieldRow, OriginBadge } from '@/features/accounts/DetailFieldRow';
import { SaveStatusLine } from '@/features/accounts/SaveStatusLine';
import {
  accountDetails,
  accountFreshness,
  applyDetailEdits,
  detailChanges,
  detailValues,
  DRAWDOWN_TYPE_NAME,
  parseAmount,
  STATUS_NAME,
  validateDetails,
  type DetailOrigin,
  type DetailValues,
} from '@/lib/engines/accountDetails';
import { floorStatus } from '@/lib/engines/propRuleEngine';
import { deleteReferenceCopy, loadReferenceCopy, type ReferenceCopy } from '@/services/accountImport/referenceCopy';
import { confirmAccountSaved, useAppStore } from '@/store/useAppStore';
import type { AccountStatus, DrawdownType } from '@/types/domain';
import { money } from '@/utils/format';
import { goBack } from '@/utils/navigation';

type MoneyKey = 'accountSize' | 'balance' | 'startingBalance' | 'profitTarget' | 'drawdownThreshold' | 'maxDrawdown' | 'dailyLossLimit' | 'personalDailyRisk';
const MONEY_KEYS: MoneyKey[] = ['accountSize', 'balance', 'startingBalance', 'profitTarget', 'drawdownThreshold', 'maxDrawdown', 'dailyLossLimit', 'personalDailyRisk'];
const toText = (v: number | null) => (v == null ? '' : String(v));

/**
 * Edit Account Details — correct any saved value without re-uploading a screenshot.
 * Prefilled from the saved account; every value shows where it comes from; changes
 * are previewed (and dependent numbers recalculated) before "Save Changes"; Cancel
 * leaves the account exactly as it was. Saved edits are tracked as manual
 * corrections, which later screenshot imports never overwrite silently.
 */
export default function EditAccountDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useAppStore((s) => s.accounts.find((a) => a.id === id) ?? null);
  const tradingRules = useAppStore((s) => s.tradingRules);
  const upsert = useAppStore((s) => s.upsertAccount);
  const setTradingRules = useAppStore((s) => s.setTradingRules);
  const setActiveAccount = useAppStore((s) => s.setActiveAccount);
  const activeAccountId = useAppStore((s) => s.activeAccountId);

  const personal = tradingRules.dailyStop > 0 ? tradingRules.dailyStop : null;
  // The saved values when the screen opened — the baseline for changes and for Cancel.
  const [before] = useState<DetailValues | null>(() => (account ? detailValues(account, personal) : null));
  const view = useMemo(() => (account ? accountDetails(account, personal) : null), [account, personal]);
  const [texts, setTexts] = useState<Record<MoneyKey, string>>(() => Object.fromEntries(MONEY_KEYS.map((k) => [k, toText(before?.[k] ?? null)])) as Record<MoneyKey, string>);
  const [name, setName] = useState(before?.name ?? '');
  const [firm, setFirm] = useState(before?.firm ?? '');
  const [status, setStatus] = useState<AccountStatus>(before?.status ?? 'active');
  const [ddType, setDdType] = useState<DrawdownType | null>(before?.drawdownType ?? null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reference, setReference] = useState<ReferenceCopy | null>(null);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    void loadReferenceCopy(account.id).then((r) => alive && setReference(r));
    return () => {
      alive = false;
    };
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft: DetailValues | null = useMemo(() => {
    if (!before) return null;
    const nums = Object.fromEntries(MONEY_KEYS.map((k) => [k, parseAmount(texts[k])])) as Record<MoneyKey, number | null>;
    return { ...before, ...nums, name, firm, status, drawdownType: ddType };
  }, [before, texts, name, firm, status, ddType]);

  const validation = useMemo(() => (draft && account ? validateDetails(draft, account.kind) : { errors: {}, warnings: [] }), [draft, account]);
  const changes = useMemo(() => (before && draft ? detailChanges(before, draft) : []), [before, draft]);
  const valid = Object.keys(validation.errors).length === 0;
  // Dependent numbers, recalculated immediately from the draft (only when it is valid).
  const preview = useMemo(() => (account && before && draft && valid ? applyDetailEdits(account, before, draft, new Date()).account : null), [account, before, draft, valid]);
  const previewFloor = preview ? floorStatus(preview) : null;

  if (!account || !view || !before || !draft) {
    return (
      <Screen header={<AppHeader title="Edit Account Details" back />}>
        <Card>
          <AppText variant="body">This account was not found.</AppText>
        </Card>
      </Screen>
    );
  }

  const fresh = accountFreshness(account, new Date());
  const setText = (k: MoneyKey) => (t: string) => setTexts((s) => ({ ...s, [k]: t }));
  const changed = new Set(changes.map((c) => c.key));
  const originOf = (k: keyof DetailValues, saved: DetailOrigin): { origin: DetailOrigin; originLabel?: string } =>
    changed.has(k) ? { origin: 'manual', originLabel: 'Changed — saved as entered by you' } : { origin: saved };
  const badge = (k: keyof DetailValues, saved: DetailOrigin) => {
    const o = originOf(k, saved);
    return <OriginBadge origin={o.origin} label={o.originLabel} />;
  };

  const save = async () => {
    if (!valid || !changes.length || saving) return;
    setSaving(true);
    setSaveError(null);
    const r = applyDetailEdits(account, before, draft, new Date());
    // The same record every screen reads (dashboard, Risk Manager, Check Trade): updated in place, by id.
    upsert(r.account);
    // The dashboard shows the account the trader just corrected.
    if (activeAccountId !== r.account.id) setActiveAccount(r.account.id);
    if (changes.some((c) => c.key === 'personalDailyRisk')) setTradingRules({ ...tradingRules, dailyStop: r.personalDailyRisk ?? 0 });
    // Reported as saved only after the stored copy reads back with these values.
    const confirmed = await confirmAccountSaved(r.account);
    setSaving(false);
    if (!confirmed.ok) {
      setSaveError(`${confirmed.error} Your changes are still on this screen — try Save Changes again.`);
      return;
    }
    setSaved(true);
    goBack('/home');
  };
  const cancel = () => (changes.length && !saved ? setConfirmLeave(true) : goBack('/home'));

  const remaining = previewFloor?.floor != null && preview ? preview.balance - previewFloor.floor : null;
  const target = preview?.rules.profitTarget ?? null;
  const progress = preview && target ? Math.max(0, Math.min(1, (preview.balance - preview.cycleStartBalance) / target)) : null;
  const f = view.fields;
  const verifiedNote = (k: 'maxDrawdown' | 'dailyLossLimit' | 'profitTarget') => (f[k].origin === 'verified_program' ? 'From the verified program. Changing it records an override of the firm rule.' : null);

  return (
    <Screen
      header={<AppHeader title="Edit Account Details" subtitle={account.name} back />}
      footer={
        <>
          {!valid ? (
            <AppText variant="caption" tone="danger" align="center">
              Fix the highlighted values to save.
            </AppText>
          ) : null}
          {saveError ? (
            <AppText variant="caption" tone="danger" align="center" accessibilityRole="alert">
              {saveError}
            </AppText>
          ) : null}
          <Button label={saving ? 'Saving…' : changes.length ? `Save Changes (${changes.length})` : 'Save Changes'} icon="checkmark" disabled={!valid || !changes.length || saving} onPress={() => void save()} />
          <Button label="Cancel" variant="ghost" onPress={cancel} />
        </>
      }>
      <Card style={styles.gap}>
        <View style={styles.row}>
          <Icon name="time-outline" size={16} color={colors.textSecondary} />
          <AppText variant="caption" tone="secondary" style={styles.flex}>
            Last updated: {fresh.label}
          </AppText>
        </View>
        <SaveStatusLine accountId={account.id} />
        {account.importState?.reported ? <StatusBadge label="Snapshot-based — not live verified" tone="accent" icon="camera-outline" size="sm" /> : null}
        {fresh.staleMessage ? (
          <AppText variant="caption" tone="warning">
            {fresh.staleMessage}
          </AppText>
        ) : null}
      </Card>

      {view.floor.floor == null && account.kind === 'prop' ? (
        <Card tone="warning" style={styles.gap}>
          <AppText variant="bodyStrong" tone="warning">
            Critical risk information is incomplete
          </AppText>
          <AppText variant="caption">{view.floor.reason}</AppText>
          <AppText variant="caption" tone="secondary">
            Until it is entered, drawdown shows “Needs verification” and Prop Guard does not suggest trade sizes for this account.
          </AppText>
        </Card>
      ) : null}

      <SectionHeader title="Account" />
      <Card style={styles.gap}>
        <View style={styles.gap}>
          <View style={styles.row}>
            <AppText variant="label" style={styles.flex}>
              Account name
            </AppText>
            {badge('name', f.name.origin)}
          </View>
          <Input accessibilityLabel="Account name" value={name} onChangeText={setName} maxLength={60} error={validation.errors.name} />
        </View>
        <View style={styles.gap}>
          <View style={styles.row}>
            <AppText variant="label" style={styles.flex}>
              Prop firm
            </AppText>
            {badge('firm', f.firm.origin)}
          </View>
          <Input accessibilityLabel="Prop firm" value={firm} onChangeText={setFirm} maxLength={60} placeholder="e.g. Lucid Trading" />
        </View>
        <View style={styles.gap}>
          <View style={styles.row}>
            <AppText variant="label" style={styles.flex}>
              Program
            </AppText>
            {view.program ? <OriginBadge origin={view.programVerified ? 'verified_program' : 'manual'} label={view.programVerified ? 'Verified program' : 'Not verified'} /> : <OriginBadge origin="missing" label="Not set" />}
          </View>
          <AppText variant="body">{view.program ?? 'No program linked'}</AppText>
          <AppText variant="caption" tone="accent" onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: account.id } })}>
            Change the program on the full account form →
          </AppText>
        </View>
        <View style={styles.gap}>
          <AppText variant="label">Account status</AppText>
          <View style={styles.chips}>
            {(Object.keys(STATUS_NAME) as AccountStatus[]).map((s) => (
              <Chip key={s} label={STATUS_NAME[s]} selected={status === s} onPress={() => setStatus(s)} />
            ))}
          </View>
        </View>
      </Card>

      <SectionHeader title="Balance" />
      <Card style={styles.gap}>
        <DetailFieldRow label="Account size" value={texts.accountSize} onChangeText={setText('accountSize')} {...originOf('accountSize', f.accountSize.origin)} error={validation.errors.accountSize} />
        <DetailFieldRow label="Current balance" value={texts.balance} onChangeText={setText('balance')} {...originOf('balance', f.balance.origin)} error={validation.errors.balance} note="Your account balance right now — never calculated from P&L or the account size." />
        <DetailFieldRow label="Starting balance" value={texts.startingBalance} onChangeText={setText('startingBalance')} {...originOf('startingBalance', f.startingBalance.origin)} error={validation.errors.startingBalance} note="The balance the account started with (static drawdowns and profit progress use it)." />
      </Card>

      <SectionHeader title="Drawdown" />
      <Card style={styles.gap}>
        <View style={styles.gap}>
          <View style={styles.row}>
            <AppText variant="label" style={styles.flex}>
              Drawdown type
            </AppText>
            {badge('drawdownType', f.drawdownType.origin)}
          </View>
          <View style={styles.chips}>
            {(Object.keys(DRAWDOWN_TYPE_NAME) as DrawdownType[]).map((t) => (
              <Chip key={t} label={DRAWDOWN_TYPE_NAME[t]} selected={ddType === t} onPress={() => setDdType(t)} />
            ))}
          </View>
        </View>
        <DetailFieldRow label="Maximum drawdown (amount)" value={texts.maxDrawdown} onChangeText={setText('maxDrawdown')} {...originOf('maxDrawdown', f.maxDrawdown.origin)} error={validation.errors.maxDrawdown} note={verifiedNote('maxDrawdown') ?? 'The loss allowance, e.g. 1,500 — not a balance.'} />
        <DetailFieldRow
          label="Current liquidation threshold"
          value={texts.drawdownThreshold}
          onChangeText={setText('drawdownThreshold')}
          {...originOf('drawdownThreshold', f.drawdownThreshold.origin)}
          originLabel={originOf('drawdownThreshold', f.drawdownThreshold.origin).originLabel ?? (f.drawdownThreshold.origin === 'missing' ? 'Needs verification' : undefined)}
          error={validation.errors.drawdownThreshold}
          note={
            texts.drawdownThreshold.trim() === '' && f.drawdownThreshold.origin === 'calculated'
              ? `${f.drawdownThreshold.note} Enter the threshold from your dashboard to confirm it.`
              : 'The balance where the account fails (MLL / NLL), as your dashboard shows it today.'
          }
          placeholder={f.drawdownThreshold.origin === 'calculated' && f.drawdownThreshold.value != null ? `Calculated: ${f.drawdownThreshold.value}` : 'Needs verification'}
        />
        <View style={[styles.calc, remaining == null && styles.calcMissing]}>
          <View style={styles.row}>
            <AppText variant="label" style={styles.flex}>
              Current drawdown remaining
            </AppText>
            <OriginBadge origin={remaining != null ? 'calculated' : 'missing'} label={remaining != null ? 'Calculated' : 'Needs verification'} />
          </View>
          <AppText variant="title">{remaining != null ? money(remaining) : '—'}</AppText>
          <AppText variant="caption" tone={remaining == null ? 'warning' : 'tertiary'}>
            {remaining != null ? `Balance − liquidation threshold (${previewFloor?.reason ?? ''})` : (previewFloor?.reason ?? 'Fix the values above to recalculate.')}
          </AppText>
        </View>
      </Card>

      <SectionHeader title="Limits" />
      <Card style={styles.gap}>
        <DetailFieldRow label="Firm daily loss limit" value={texts.dailyLossLimit} onChangeText={setText('dailyLossLimit')} {...originOf('dailyLossLimit', f.dailyLossLimit.origin)} error={validation.errors.dailyLossLimit} note={verifiedNote('dailyLossLimit') ?? f.dailyLossLimit.note ?? 'Leave empty if your plan has none.'} />
        <DetailFieldRow label="Profit target (amount)" value={texts.profitTarget} onChangeText={setText('profitTarget')} {...originOf('profitTarget', f.profitTarget.origin)} error={validation.errors.profitTarget} note={verifiedNote('profitTarget') ?? (progress != null ? `Progress: ${Math.round(progress * 100)}% of the target.` : 'The profit still required in total — not the target balance.')} />
        <DetailFieldRow label="Personal daily risk budget" value={texts.personalDailyRisk} onChangeText={setText('personalDailyRisk')} {...originOf('personalDailyRisk', f.personalDailyRisk.origin)} error={validation.errors.personalDailyRisk} note="Your own daily stop — a plan setting that applies to all your accounts, separate from the firm’s limit." />
      </Card>

      {changes.length || validation.warnings.length ? (
        <>
          <SectionHeader title={changes.length ? `Changes to save (${changes.length})` : 'Check before saving'} />
          <Card style={styles.gap}>
            {changes.map((c) => (
              <View key={c.key} style={styles.change}>
                <AppText variant="caption" tone="secondary">
                  {c.label}
                </AppText>
                <AppText variant="body">
                  {c.before} → <AppText variant="bodyStrong">{c.after}</AppText>
                </AppText>
              </View>
            ))}
            {validation.warnings.map((w) => (
              <View key={w} style={styles.row}>
                <Icon name="alert-circle-outline" size={14} color={colors.warning} />
                <AppText variant="caption" tone="warning" style={styles.flex}>
                  {w}
                </AppText>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Reference screenshot" />
      <Card style={styles.gap}>
        {reference ? (
          <>
            <AppText variant="caption" tone="secondary">
              Redacted copy from {new Date(reference.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — kept on this device only, never uploaded.
            </AppText>
            {reference.pages.map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.ref} contentFit="contain" accessibilityLabel={`Reference screenshot ${i + 1} (redacted)`} />
            ))}
            <Button
              label="Delete reference copy"
              variant="ghost"
              icon="trash-outline"
              onPress={() => {
                void deleteReferenceCopy(account.id);
                setReference(null);
              }}
            />
          </>
        ) : (
          <AppText variant="caption" tone="secondary">
            No reference copy on this device. One is kept (redacted) when you import a screenshot and leave “Keep a redacted copy” on.
          </AppText>
        )}
        <Button label="Update from a new screenshot" variant="secondary" icon="camera-outline" onPress={() => router.push({ pathname: '/accounts/import', params: { accountId: account.id } })} />
      </Card>

      <ConfirmationSheet
        visible={confirmLeave}
        title="Discard your changes?"
        message="The account keeps its saved values."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          goBack('/home');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 120 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  calc: { gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  calcMissing: { borderColor: colors.warning + '66', backgroundColor: colors.warningMuted },
  change: { gap: 2, paddingVertical: 4 },
  ref: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.surface },
});
