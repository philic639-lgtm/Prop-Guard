import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Chip, DetailTable, Illustration, Input, RiskProgress, Screen, SectionHeader, StatusBadge, ToggleRow } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { isDemoMode } from '@/config/env';
import { colors, radius, spacing } from '@/constants/theme';
import { createAccountFromImport } from '@/features/accountImport/createAccount';
import { DROP_SUPPORTED, DropZone } from '@/features/accountImport/DropZone';
import { NativeOcrHost } from '@/features/accountImport/NativeOcrHost';
import { ExampleScreenshotGuide } from '@/features/accountImport/ExampleScreenshotGuide';
import type { GuidePage } from '@/features/accountImport/exampleGuide';
import { displayValue, ImportFieldRow } from '@/features/accountImport/ImportFieldRow';
import { ImportReviewCard } from '@/features/accountImport/ImportReviewCard';
import { ImportSteps } from '@/features/accountImport/ImportSteps';
import { SAMPLE_SETS, sampleImages } from '@/features/accountImport/samples';
import { useImportReview } from '@/features/accountImport/useImportReview';
import { IMPORT_DEBUG, useImportSession, type ImportStep } from '@/features/accountImport/useImportSession';
import { usePendingImport } from '@/features/accountImport/usePendingImport';
import { olderSnapshot } from '@/lib/engines/accountSync';
import { compareUpdate, providedFigures, updateSummary, type ChangeRow } from '@/lib/engines/accountUpdate';
import { UpdateComparison } from '@/features/accountImport/UpdateComparison';
import { applyImport, buildReview, confirmImport, lockedRuleFields, RESET_BLOCKER, rowsNeedingInput, type ApplyResult, type FieldKey } from '@/lib/engines/accountImport';
import { getProgram, importProgramRules, missingOptions } from '@/lib/engines/firmRulesEngine';
import { drawdownBuffer, drawdownFloor } from '@/lib/engines/propRuleEngine';
import { aiIsLive } from '@/services/ai';
import { saveReferenceCopy } from '@/services/accountImport/referenceCopy';
import { manualConflicts, type ManualConflict } from '@/lib/engines/accountDetails';
import type { Account, AccountDetailKey } from '@/types/domain';
import { MAX_IMAGES, pickImages, type ImportImage } from '@/services/accountImport/images';
import { ocrAvailable } from '@/services/accountImport/ocr';
import { confirmAccountSaved, useAppStore } from '@/store/useAppStore';
import { money } from '@/utils/format';
import { uuid } from '@/utils/id';
import { goBack } from '@/utils/navigation';

/** The account details shown (editable) on the review — in the order traders read their dashboard. */
const DETAIL_KEYS: FieldKey[] = ['firm', 'program', 'accountSize', 'balance', 'startingBalance', 'profitTarget', 'drawdownThreshold', 'maxDrawdown', 'drawdownRemaining', 'dailyLossLimit', 'drawdownType', 'status', 'statementDate'];
/** Everything else the reader may find, under "Screenshot evidence, other fields & privacy". */
const OTHER_KEYS: FieldKey[] = ['stage', 'startDate', 'netPnl', 'dailyPnl', 'unrealizedPnl', 'equity', 'tradingDays', 'currentDrawdown', 'profitTargetBalance', 'profitRemaining'];
const RULE_KEYS = ['maxDrawdown', 'dailyLossLimit', 'profitTarget'] as const;
type RuleKey = (typeof RULE_KEYS)[number];
const RULE_NAME: Record<RuleKey, string> = { maxDrawdown: 'max loss allowance', dailyLossLimit: 'daily loss limit', profitTarget: 'profit target' };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Import account values from prop-firm dashboard screenshots:
 * upload → read (on-device OCR) → review the essentials → Confirm & Save Account.
 * `accountId` = update that account; otherwise a new account is saved
 * (`from=onboarding` hands the confirmed values to the onboarding form).
 */
export default function AccountScreenshotImport() {
  // iOS / Android: the on-device reader lives in a hidden WebView for the whole import (web: renders nothing).
  return (
    <>
      <ImportFlow />
      <NativeOcrHost />
    </>
  );
}

function ImportFlow() {
  const params = useLocalSearchParams<{ accountId?: string; from?: 'new' | 'onboarding'; autoread?: string }>();
  const accounts = useAppStore((s) => s.accounts);
  const upsert = useAppStore((s) => s.upsertAccount);
  const setActiveAccount = useAppStore((s) => s.setActiveAccount);
  const [targetId, setTargetId] = useState<string | null>(params.accountId ?? null);
  const target = accounts.find((a) => a.id === targetId) ?? null;
  const mode: 'new' | 'update' = target ? 'update' : 'new';
  const from = params.from ?? 'new';

  const session = useImportSession();
  const { images, reading } = session;
  const [pickedProgram, setPickedProgram] = useState<string | null>(null);
  const review = useImportReview(mode, target, from !== 'onboarding', pickedProgram);
  const { extraction, match, edited, db } = review;
  const [phase, setPhase] = useState<'add' | 'review' | 'done'>('add');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // "Looks right" / "I checked this" belong to the readings they were given for: new or re-read screenshots reset them.
  const readingsKey = images.map((i) => `${i.image.id}:${i.status}:${i.run}:${i.reader ?? ''}`).join('|');
  const [checked, setChecked] = useState<{ key: string; acks: Record<string, boolean>; fields: Set<FieldKey> }>(() => ({ key: readingsKey, acks: {}, fields: new Set() }));
  const current = checked.key === readingsKey;
  const acks = useMemo(() => (current ? checked.acks : {}), [current, checked.acks]);
  const confirmedFields = useMemo(() => (current ? checked.fields : new Set<FieldKey>()), [current, checked.fields]);
  const setAcks = (f: (a: Record<string, boolean>) => Record<string, boolean>) =>
    setChecked((c) => (c.key === readingsKey ? { ...c, acks: f(c.acks) } : { key: readingsKey, acks: f({}), fields: new Set() }));
  const setConfirmedFields = (f: (s: Set<FieldKey>) => Set<FieldKey>) =>
    setChecked((c) => (c.key === readingsKey ? { ...c, fields: f(c.fields) } : { key: readingsKey, acks: {}, fields: f(new Set()) }));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const createdIdRef = useRef<string | null>(null);
  const [saveRules, setSaveRules] = useState<Partial<Record<RuleKey, boolean>>>({});
  const [useProgram, setUseProgram] = useState(true);
  const [chosenOptions, setChosenOptions] = useState<Record<string, string>>({});
  const [nameText, setNameText] = useState<string | null>(null);
  const [keepMasked, setKeepMasked] = useState(false);
  const [rememberAccount, setRememberAccount] = useState(true);
  const [differentAccount, setDifferentAccount] = useState(false);
  const [more, setMore] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [savedChanges, setSavedChanges] = useState<ChangeRow[] | null>(null);
  const [guide, setGuide] = useState<GuidePage | null>(null);
  // Manual corrections vs this screenshot: the trader decides each one (never silently overwritten).
  const [manualChoice, setManualChoice] = useState<Partial<Record<AccountDetailKey, 'keep' | 'screenshot'>>>({});
  const tradingRules = useAppStore((s) => s.tradingRules);
  const setTradingRules = useAppStore((s) => s.setTradingRules);
  const [personalRisk, setPersonalRisk] = useState<string>(() => (tradingRules.dailyStop > 0 ? String(tradingRules.dailyStop) : ''));
  const [keepReference, setKeepReference] = useState(true);
  const [referenceNote, setReferenceNote] = useState<string | null>(null);

  // Session lives only while this screen is open.
  useEffect(() => () => useImportSession.getState().reset(), []);

  const add = useCallback((list: ImportImage[]) => {
    const r = useImportSession.getState().add(list);
    const msgs = [...r.rejected, ...(r.skipped ? [`Up to ${MAX_IMAGES} screenshots per import${r.added ? '' : ' — already added'}.`] : [])];
    setError(msgs.length ? msgs.join('\n') : null);
  }, []);
  const pick = async (source: 'library' | 'camera') => {
    setError(null);
    const r = await pickImages(source, MAX_IMAGES - images.length);
    if (r.status === 'ok') add(r.images);
    else if (r.status === 'denied') setError(source === 'camera' ? 'Camera access was denied. Allow it in Settings, or choose a screenshot instead.' : 'Photo access was denied. Allow it in Settings, or enter the values manually.');
    else if (r.status === 'error') setError(r.message);
  };
  const read = async () => {
    setPhase('review');
    await useImportSession.getState().readAll(db);
  };
  // Opened from "Update Account" with the pictures already picked: read them right away.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (params.autoread !== '1' || autoStarted.current || !images.length) return;
    autoStarted.current = true;
    void read();
  }, [params.autoread, images.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = extraction.fields;

  // Rules: the matched program's VERIFIED rules (new account), or the account's own locked rules (update).
  const program = mode === 'new' && useProgram && match.program ? getProgram(db, match.program.programId) : null;
  const options = useMemo(() => ({ ...match.options, ...chosenOptions }), [match.options, chosenOptions]);
  const imp = useMemo(() => (program ? importProgramRules(program, match.ruleDate, options) : null), [program, match.ruleDate, options]);
  const locked = useMemo(() => (mode === 'update' ? lockedRuleFields(target) : new Set<RuleKey>()), [mode, target]);
  const verifiedRules = useMemo(() => {
    const out: Partial<Record<RuleKey, number>> = {};
    for (const k of RULE_KEYS) {
      const v = mode === 'new' ? (imp?.status === 'verified' && imp.values[k] ? Number(imp.values[k]) : null) : locked.has(k) ? target?.rules[k] : null;
      if (v != null && Number.isFinite(v)) out[k] = v;
    }
    return out;
  }, [mode, imp, locked, target]);
  const pendingOptions = useMemo(() => (program ? missingOptions(program, options) : []), [program, options]);

  const firmName = match.firm?.name ?? (typeof fields.firm?.value === 'string' ? fields.firm.value : null);
  const suggestedName = [firmName, program?.name ?? (typeof fields.program?.value === 'string' ? fields.program.value : null)].filter(Boolean).join(' ').slice(0, 60);
  const name = nameText ?? suggestedName;

  // Drawdown methodology from VERIFIED rules only (new: the program's verified version; update: a verified firm link).
  const verifiedDrawdownType = useMemo(() => {
    const t = mode === 'new' ? (imp?.status === 'verified' ? imp.values.drawdownType : null) : target?.firmLink?.status === 'verified' ? target.rules.drawdownType : null;
    return t === 'static' || t === 'trailing' || t === 'eod_trailing' ? t : null;
  }, [mode, imp, target]);
  // Update: the account's saved floor, trailed to the new balance (never lower than what the account already knows).
  const balanceNow = num(fields.balance?.value);
  const accountFloor = useMemo(() => {
    if (mode !== 'update' || !target || balanceNow == null) return null;
    return drawdownFloor({ ...target, balance: balanceNow, highWaterMark: Math.max(target.highWaterMark, balanceNow) });
  }, [mode, target, balanceNow]);
  const extractionFailed = images.length > 0 && images.every((i) => i.status === 'error');

  const model = useMemo(
    () =>
      buildReview({
        mode,
        fields,
        checks: extraction.checks,
        match,
        verifiedRules,
        locked,
        edited,
        confirmedFields,
        acks,
        missingOptions: pendingOptions.map((o) => ({ id: o.id, label: o.label })),
        name,
        programSize: program?.accountSize ?? null,
        programName: program?.name ?? null,
        ambiguous: extraction.ambiguous,
        verifiedDrawdownType,
        accountFloor,
        extractionFailed,
      }),
    [mode, fields, extraction.checks, extraction.ambiguous, match, verifiedRules, locked, edited, confirmedFields, acks, pendingOptions, name, program, verifiedDrawdownType, accountFloor, extractionFailed],
  );

  // Values this screenshot would change that the trader corrected by hand (update only).
  const conflicts: ManualConflict[] = useMemo(() => {
    if (mode !== 'update' || !target) return [];
    const values: Record<string, number | string | null> = {};
    for (const [k, f] of Object.entries(fields)) if (f && f.source !== 'derived') values[k] = f.value;
    return manualConflicts(target, values);
  }, [mode, target, fields]);
  const unresolvedConflicts = conflicts.filter((c) => !manualChoice[c.key]);
  const keepManual = conflicts.filter((c) => manualChoice[c.key] === 'keep').map((c) => c.key);
  // The dashboard date on the screenshot: an older one is stale data (shown, never hidden).
  const statementDate = typeof fields.statementDate?.value === 'string' ? fields.statementDate.value : null;
  const todayKey = new Date().toISOString().slice(0, 10);
  const staleScreenshot = statementDate != null && statementDate < todayKey;
  // Read, but nothing recognised: never presented as a successful read.
  const recognised = Object.values(fields).some((f) => f && f.source !== 'derived' && f.source !== 'user');
  const personalRiskValue = personalRisk.trim() === '' ? null : Number(personalRisk.replace(/[$,\s]/g, ''));
  const personalRiskError = personalRiskValue != null && !(Number.isFinite(personalRiskValue) && personalRiskValue > 0) ? 'Enter a positive amount, or leave it empty.' : null;

  const duplicateHard = mode === 'new' && match.duplicate?.reason === 'same_account_number';
  const duplicateSoft = mode === 'new' && match.duplicate?.reason === 'same_configuration';
  const engine = images.some((i) => i.image.sample) ? 'sample' : images.some((i) => i.reader === 'vision') ? 'vision' : images.some((i) => i.page) ? 'ocr' : 'manual';
  const idItem = extraction.sensitive.find((s) => s.kind === 'account_id');
  // Keeping a manual threshold means the screenshot's (lower) threshold is not applied — no reset question.
  const keepThreshold = manualChoice.drawdownThreshold === 'keep';
  const resetIssue = keepThreshold ? undefined : model.issues.find((i) => i.kind === 'reset');
  const issues = keepThreshold ? model.issues.filter((i) => i.kind !== 'reset') : model.issues;
  const blockers = keepThreshold ? model.blockers.filter((b) => b !== RESET_BLOCKER) : model.blockers;
  // An update from a screenshot older than what the account already knows replaces newer values: only on explicit confirmation.
  const older = mode === 'update' ? olderSnapshot(target, statementDate) : null;
  const [olderOk, setOlderOk] = useState(false);
  const ready =
    blockers.length === 0 && unresolvedConflicts.length === 0 && !personalRiskError && !reading && !duplicateHard && (!duplicateSoft || differentAccount) && (!older || olderOk);
  // Confirming IS the trader's confirmation of the extracted values; only unresolved mandatory data disables it.
  const canSave = ready && !saving;

  // Screenshot rule values that are plausible and confirmed — kept unless the trader turns them off.
  const ruleUpdates = () => {
    const out: Partial<Record<RuleKey, number>> = {};
    for (const [k, v] of Object.entries(model.saveableRules) as [RuleKey, number][]) if (saveRules[k] !== false) out[k] = v;
    return out;
  };

  const edit = (k: FieldKey, v: number | null) => session.setEdit(k, v);

  const confirm = async () => {
    // One save per tap: a double click never creates two accounts or applies twice.
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  /** Shown as saved only after the stored copy reads back with these values. */
  const confirmSaved = async (account: Account): Promise<boolean> => {
    const r = await confirmAccountSaved(account);
    if (!r.ok) setSaveError(`${r.error} Your review is unchanged — tap Confirm & Save Account again.`);
    return r.ok;
  };
  /** The trader's confirmed values, exactly as Save will apply them (also used for the old → new preview). */
  const buildConfirmed = (now: Date) => {
    const values = { ...fields };
    // A size from the matched program is the account's size.
    if (mode === 'new' && program?.accountSize) values.accountSize = { key: 'accountSize', value: program.accountSize, confidence: 1, source: 'user', evidence: 'Program size', page: -1 };
    return confirmImport({
      fields: values,
      edited,
      ruleUpdates: ruleUpdates(),
      reset: !!(resetIssue && acks[resetIssue.id]),
      fingerprint: rememberAccount ? extraction.fingerprint : null,
      maskedId: keepMasked && idItem ? idItem.masked : null,
      engine,
      pages: images.filter((i) => i.page).length,
      now,
      keepManual,
    });
  };
  // Update: the saved account next to the account as this update would save it (same engine as Save).
  let comparison: ChangeRow[] = [];
  if (mode === 'update' && target && phase === 'review' && recognised) {
    try {
      const c = buildConfirmed(new Date());
      comparison = compareUpdate(target, applyImport(target, c, 'preview').account, providedFigures(Object.keys(c.values).filter((k) => c.sources[k as FieldKey]?.source !== 'derived')));
    } catch {
      comparison = [];
    }
  }
  const save = async () => {
    setSaveError(null);
    const c = buildConfirmed(new Date());
    const afterSave = async (accountId: string, recordId: string): Promise<void> => {
      // The trader's own daily stop (a plan setting for all accounts), when changed here.
      const cur = tradingRules.dailyStop > 0 ? tradingRules.dailyStop : null;
      if (!personalRiskError && personalRiskValue !== cur) setTradingRules({ ...tradingRules, dailyStop: personalRiskValue ?? 0 });
      // Optional redacted reference copy: on this device, and in the trader's private cloud folder when signed in.
      if (keepReference) {
        const shots = images.filter((i) => i.page && !i.image.sample).map((i) => ({ image: i.image, sensitive: i.page!.sensitive }));
        if (shots.length) {
          const r = await saveReferenceCopy(accountId, shots, c.confirmedAt, { recordId, dashboardDate: statementDate });
          const device = r.saved ? `A redacted copy (${r.saved} page${r.saved > 1 ? 's' : ''}) is kept on this device` : (r.reason ?? null);
          const cloud =
            r.cloud === 'stored'
              ? 'and in your private cloud folder.'
              : r.cloud === 'failed'
                ? `— it could not be stored in your cloud account (${r.cloudError}); the account values themselves are saved.`
                : r.cloud === 'not_signed_in'
                  ? '(not uploaded — sign in to keep it in your account).'
                  : '';
          setReferenceNote(device ? `${device} ${cloud}`.trim() : null);
        }
      }
    };
    // The session (and its images) is released only after the optional reference copy is made.
    const finish = (accountId: string, recordId: string) => void afterSave(accountId, recordId).finally(() => useImportSession.getState().reset());
    if (mode === 'update' && target) {
      const r = applyImport(target, c, uuid());
      // The existing record, updated in place (same id) — never a second account.
      upsert(r.account);
      setActiveAccount(r.account.id);
      if (!(await confirmSaved(r.account))) return;
      setSavedChanges(compareUpdate(target, r.account, providedFigures(Object.keys(c.values).filter((k) => c.sources[k as FieldKey]?.source !== 'derived'))));
      setResult(r);
      setPhase('done');
      finish(r.account.id, r.record.id);
      return;
    }
    if (from === 'onboarding') {
      // Onboarding saves the account on its own form.
      usePendingImport.getState().set({
        for: 'onboarding',
        confirmed: c,
        programId: program?.id ?? null,
        options: program ? options : {},
        firmName,
        size: program?.accountSize ?? num(c.values.accountSize),
        startDate: typeof fields.startDate?.value === 'string' ? fields.startDate.value : null,
        rules: c.ruleUpdates,
      });
      goBack('/onboarding/account');
      return;
    }
    // A retry after a failed save confirmation reuses the same id — never a second account.
    createdIdRef.current ??= uuid();
    const created = createAccountFromImport({ db, id: createdIdRef.current, name, firmName, programId: program?.id ?? null, options: program ? options : {}, ruleDate: match.ruleDate, confirmed: c, now: new Date() });
    if (!created.ok) {
      setSaveError(created.issues.map((i) => i.message).join(' '));
      return;
    }
    upsert(created.result.account);
    setActiveAccount(created.result.account.id);
    if (!(await confirmSaved(created.result.account))) return;
    setResult(created.result);
    setPhase('done');
    finish(created.result.account.id, created.result.record.id);
  };

  // Opened directly (e.g. from More) there may be no screen to go back to.
  const leave = () => goBack('/accounts');
  const header = <AppHeader title={mode === 'update' ? `Update ${target?.name ?? 'account'}` : 'Import account'} subtitle="From a dashboard screenshot" back />;

  // ── Done
  if (phase === 'done' && result) {
    const floor = drawdownFloor(result.account);
    const buffer = drawdownBuffer(result.account);
    return (
      <Screen header={header} footer={<Button label="Done" icon="checkmark" onPress={() => (mode === 'new' ? router.replace('/accounts') : leave())} />}>
        <ImportSteps current="Saved" />
        <Card tone="positive" style={styles.gap}>
          <StatusBadge label={mode === 'update' ? 'Account updated' : 'Account saved'} tone="positive" icon="checkmark-circle" size="sm" />
          <AppText variant="title">{result.account.name}</AppText>
          {savedChanges ? <AppText variant="bodyStrong">{updateSummary(savedChanges, (n, sign) => money(n, { sign }))}</AppText> : null}
          <AppText variant="caption" tone="secondary">
            Snapshot-based — not live verified. Values from your screenshot, confirmed by you. Your dashboard now shows them; you can undo this update from the account’s update history.
          </AppText>
        </Card>
        {savedChanges ? <UpdateComparison rows={savedChanges} title="Updated" /> : null}
        <DetailTable
          rows={[
            { label: 'Balance', value: mode === 'update' ? `${money(result.record.before.balance)} → ${money(result.account.balance)}` : money(result.account.balance), bold: true },
            { label: 'Liquidation threshold', value: floor != null ? money(floor) : 'Needs verification' },
            { label: 'Remaining before liquidation', value: buffer != null ? money(buffer) : 'Needs verification', tone: buffer != null && buffer < 500 ? 'warning' : buffer == null ? 'warning' : 'primary' },
          ]}
        />
        {floor == null && result.account.kind === 'prop' ? (
          <Card tone="warning" style={styles.gap}>
            <AppText variant="caption">The liquidation threshold was not on the screenshot and cannot be calculated from it. Add it so Prop Guard can check trades against your drawdown.</AppText>
            <Button label="Add it in Edit Account Details" variant="secondary" icon="create-outline" size="md" onPress={() => router.replace({ pathname: '/accounts/details', params: { id: result.account.id } })} />
          </Card>
        ) : null}
        {referenceNote ? (
          <AppText variant="caption" tone="secondary">
            {referenceNote}
          </AppText>
        ) : null}
      </Screen>
    );
  }

  // ── Upload
  if (phase === 'add') {
    return (
      <Screen
        header={header}
        footer={
          <>
            <Button label={images.length ? `Read ${images.length} screenshot${images.length === 1 ? '' : 's'}` : 'Add a screenshot to continue'} icon="scan-outline" disabled={!images.length} onPress={() => void read()} />
            <Button label="Enter values manually instead" variant="ghost" onPress={() => (mode === 'update' ? setPhase('review') : params.from ? leave() : router.replace({ pathname: '/accounts/[id]', params: { id: 'new' } }))} />
          </>
        }>
        <ImportSteps current="Uploading" />
        <DropZone onFiles={add}>
          <Card style={styles.drop}>
            <Illustration kind="upload" size={72} />
            <AppText variant="heading" align="center">
              Upload your account dashboard
            </AppText>
            <AppText variant="caption" align="center">
              {DROP_SUPPORTED ? 'Drag & drop, paste, or choose screenshots.' : 'Choose screenshots or take a photo of your screen.'} Up to {MAX_IMAGES} if the details are on several pages.
            </AppText>
            <View style={styles.row}>
              <Button label="Upload" icon="cloud-upload-outline" style={styles.flex} onPress={() => void pick('library')} />
              <Button label="Take photo" icon="camera-outline" variant="secondary" style={styles.flex} onPress={() => void pick('camera')} />
            </View>
          </Card>
        </DropZone>
        {error ? (
          <AppText variant="caption" tone="danger" accessibilityRole="alert">
            {error}
          </AppText>
        ) : null}

        {images.length ? (
          <View style={styles.thumbs}>
            {images.map((i, n) => (
              <View key={i.image.id} style={styles.thumb}>
                <Image source={{ uri: i.image.uri }} style={styles.thumbImg} contentFit="cover" accessibilityLabel={`Screenshot ${n + 1}`} />
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove screenshot ${n + 1}`} style={styles.thumbX} onPress={() => session.remove(i.image.id)} hitSlop={8}>
                  <Icon name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable accessibilityRole="button" onPress={() => setGuide('overview')} style={styles.linkRow}>
          <Icon name="help-circle-outline" size={16} color={colors.accentBright} />
          <AppText variant="caption" tone="accent">
            See example screenshots
          </AppText>
        </Pressable>
        <View style={styles.row}>
          <Icon name="eye-off-outline" size={14} color={colors.warning} />
          <AppText variant="caption" tone="secondary" style={styles.flex}>
            Hide passwords, API keys, emails and personal details first. Screenshots are read on this device; the original is never uploaded. You can keep a redacted copy (account numbers blacked out) for reference — on this device, and in your private cloud folder when you are signed in.
          </AppText>
        </View>

        {isDemoMode ? (
          <View style={styles.gap}>
            <AppText variant="caption" tone="tertiary">
              Try a sample (synthetic mock-ups)
            </AppText>
            <View style={styles.chips}>
              {SAMPLE_SETS.map((s) => (
                <Chip key={s.label} label={s.label} icon="image-outline" onPress={() => void sampleImages(s.keys).then(add)} />
              ))}
            </View>
          </View>
        ) : null}
        <ExampleScreenshotGuide key={guide ?? 'closed'} visible={guide != null} initial={guide ?? 'overview'} onClose={() => setGuide(null)} />
      </Screen>
    );
  }

  // ── Review
  const readingNow = reading || images.some((i) => i.status === 'reading');
  const failed = images.filter((i) => i.status === 'error');
  const anyRead = images.some((i) => i.page);
  const warnings = [...match.conflicts.filter((c) => c.severity === 'warning').map((c) => c.message), ...extraction.checks.filter((c) => c.status === 'warning').map((c) => c.message)];
  const consistent = extraction.checks.filter((c) => c.status === 'consistent');
  const subtitle =
    mode === 'update'
      ? 'Screenshot values for this account'
      : program
        ? `${firmName ?? ''} · ${program.name}${imp?.status === 'verified' ? ' · verified rules' : ''}`
        : firmName
          ? `${firmName} · program not identified — rules stay as you enter them`
          : null;

  return (
    <Screen
      header={header}
      footer={
        <>
          {!readingNow && (blockers.length || unresolvedConflicts.length) && anyRead ? (
            <AppText variant="caption" tone="tertiary" align="center">
              {unresolvedConflicts.length ? 'Choose which values to keep (you corrected them by hand).' : blockers[0]}
            </AppText>
          ) : null}
          <Button label={readingNow ? 'Reading…' : saving ? 'Saving…' : mode === 'update' ? 'Confirm & Update Account' : 'Confirm & Save Account'} icon="checkmark-done" disabled={!canSave} onPress={() => void confirm()} />
          <Button label="Add or Change Screenshots" variant="ghost" onPress={() => setPhase('add')} />
        </>
      }>
      <ImportSteps current={readingNow ? (images.some((i) => i.step?.stage === 'extracting') ? 'Extracting' : 'Reading') : 'Reviewing'} failed={!readingNow && failed.length > 0 && failed.length === images.length} />
      {readingNow ? (
        <Card style={styles.gap}>
          <AppText variant="bodyStrong">
            Reading {images.length > 1 ? `screenshot ${Math.min(images.length, images.findIndex((i) => i.status === 'reading' || i.status === 'queued') + 1 || images.length)} of ${images.length}` : 'your screenshot'}…
          </AppText>
          {images.map((i, n) =>
            i.status === 'reading' ? (
              <View key={i.image.id} style={styles.gap}>
                <AppText variant="caption" tone="secondary">
                  {images.length > 1 ? `Screenshot ${n + 1}: ` : ''}
                  {stepLabel(i.step)}
                </AppText>
                {stepFraction(i.step) != null ? <RiskProgress value={stepFraction(i.step)!} tone="accent" label="Progress of this step" /> : null}
              </View>
            ) : null,
          )}
          <AppText variant="caption">The first read downloads the text reader (about 7 MB, once).</AppText>
        </Card>
      ) : null}

      {!readingNow && anyRead && !failed.length && recognised ? (
        <View style={styles.row} accessibilityRole="alert">
          <Icon name="document-text-outline" size={16} color={colors.textSecondary} />
          <AppText variant="caption" tone="secondary" style={styles.flex}>
            {images.length > 1 ? `${images.length} screenshots read.` : 'Screenshot read.'} Check the values below — nothing is saved until you confirm.
          </AppText>
        </View>
      ) : null}

      {!readingNow
        ? failed.map((i) => (
            <Card key={i.image.id} tone="warning" style={styles.gap}>
              <AppText variant="bodyStrong">Screenshot {images.indexOf(i) + 1} could not be read</AppText>
              <AppText variant="caption" tone="secondary">
                {i.error ?? 'Try again, or enter the values yourself.'}
              </AppText>
              {i.reader !== 'vision' && ocrAvailable() ? <Button label="Try again" variant="secondary" icon="refresh" disabled={reading} onPress={() => void session.retry(i.image.id, db)} /> : null}
            </Card>
          ))
        : null}

      {duplicateHard || duplicateSoft ? (
        <Card tone={duplicateHard ? 'danger' : 'warning'} style={styles.gap}>
          <AppText variant="bodyStrong">{duplicateHard ? 'This account is already in Prop Guard' : 'You may already have this account'}</AppText>
          <AppText variant="caption" tone="secondary">
            {duplicateHard ? `It matches “${match.duplicate!.name}”. Update it instead of creating a duplicate.` : `“${match.duplicate!.name}” is the same program. Update it, or confirm this is a different account.`}
          </AppText>
          {from !== 'onboarding' ? <Button label={`Update “${match.duplicate!.name}” instead`} icon="refresh" onPress={() => setTargetId(match.duplicate!.accountId)} /> : null}
          {duplicateSoft ? <ToggleRow label="This is a different account" value={differentAccount} onChange={setDifferentAccount} /> : null}
        </Card>
      ) : null}

      {!readingNow ? (
        <ImportReviewCard
          title={mode === 'update' ? (target?.name ?? 'Account') : program?.name ?? (name || 'Imported account')}
          subtitle={subtitle}
          state={model.state}
          notice={model.notice}
          name={mode === 'new' && from !== 'onboarding' ? name : null}
          onName={setNameText}
          summary={model.summary}
          details={model.details}
          extraRows={rowsNeedingInput(model)}
          issues={issues}
          acks={acks}
          onAck={(id, v) => setAcks((a) => ({ ...a, [id]: v }))}
          programChoices={mode === 'new' && !match.program ? match.alternatives.filter((a) => a.score >= (match.alternatives[0]?.score ?? 0) - 1 && a.score >= 5) : []}
          onPickProgram={setPickedProgram}
          options={pendingOptions}
          chosen={options}
          onChoose={(id, c) => setChosenOptions((o) => ({ ...o, [id]: c }))}
          onEdit={edit}
          onConfirm={(k) => setConfirmedFields((s) => new Set(s).add(k))}
        />
      ) : null}

      {!readingNow && comparison.length ? <UpdateComparison rows={comparison} /> : null}

      {!readingNow && anyRead && !recognised ? (
        <Card tone="warning" style={styles.gap}>
          <AppText variant="bodyStrong">No account values were recognised</AppText>
          <AppText variant="caption" tone="secondary">
            The text was read, but no account labels (balance, liquidation threshold, drawdown…) were found next to a number. Nothing below was filled in from this screenshot. Try a sharper or cropped screenshot of the account panel, or enter the values yourself.
          </AppText>
          <View style={styles.row}>
            <Button label="Try another screenshot" variant="secondary" icon="refresh" size="md" style={styles.flex} onPress={() => setPhase('add')} />
            <Button label="What to capture" variant="ghost" size="md" style={styles.flex} onPress={() => setGuide('overview')} />
          </View>
        </Card>
      ) : null}

      {!readingNow && older ? (
        <Card tone="danger" style={styles.gap}>
          <AppText variant="bodyStrong">This screenshot is older than the account’s current data</AppText>
          <AppText variant="caption" tone="secondary">
            The screenshot is from {older.screenshot}; {target?.name ?? 'the account'} already has values from {older.account}. Saving it would replace newer values with older ones.
          </AppText>
          <ToggleRow label="Replace the newer values with this older screenshot" value={olderOk} onChange={setOlderOk} />
        </Card>
      ) : null}

      {!readingNow && staleScreenshot ? (
        <Card tone="warning" style={styles.gap}>
          <AppText variant="bodyStrong">This screenshot is from {statementDate}</AppText>
          <AppText variant="caption" tone="secondary">
            Balance and threshold may have changed since. Prop Guard will show these values as stale — a screenshot from today is more accurate.
          </AppText>
        </Card>
      ) : null}

      {!readingNow && conflicts.length ? (
        <Card tone="warning" style={styles.gap}>
          <AppText variant="bodyStrong">You corrected these values by hand</AppText>
          <AppText variant="caption" tone="secondary">
            The screenshot shows something different. Choose which value to keep — your corrections are never replaced without asking.
          </AppText>
          {conflicts.map((c) => (
            <View key={c.key} style={styles.gap}>
              <AppText variant="label">{c.label}</AppText>
              <View style={styles.chips}>
                <Chip label={`Keep mine · ${typeof c.manual === 'number' ? money(c.manual) : c.manual}`} selected={manualChoice[c.key] === 'keep'} onPress={() => setManualChoice((m) => ({ ...m, [c.key]: 'keep' }))} />
                <Chip label={`Use screenshot · ${typeof c.screenshot === 'number' ? money(c.screenshot) : c.screenshot}`} selected={manualChoice[c.key] === 'screenshot'} onPress={() => setManualChoice((m) => ({ ...m, [c.key]: 'screenshot' }))} />
              </View>
              <AppText variant="caption" tone="tertiary">
                Corrected by you on {new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </AppText>
            </View>
          ))}
        </Card>
      ) : null}

      {!readingNow && (anyRead || mode === 'update') ? (
        <View style={styles.gap}>
          <SectionHeader title="Account details" />
          <AppText variant="caption" tone="secondary">
            Every value is editable. Each shows where it comes from: extracted from the screenshot, a verified program rule, calculated, entered by you — or missing. Missing values stay empty; nothing is guessed.
          </AppText>
          {DETAIL_KEYS.map((k) => {
            const rule = k === 'maxDrawdown' || k === 'dailyLossLimit' || k === 'profitTarget' ? verifiedRules[k] : undefined;
            const note =
              rule != null
                ? `Verified program configuration: ${money(rule)} — this is the value saved.`
                : k === 'drawdownThreshold' && !fields.drawdownThreshold
                  ? model.drawdown.status === 'unavailable'
                    ? model.drawdown.note
                    : undefined
                  : k === 'statementDate'
                    ? 'Snapshot date — the dashboard date on the screenshot. Imported now; values are not live.'
                    : undefined;
            return <ImportFieldRow key={k} k={k} field={fields[k]} edited={edited.has(k)} onChange={(v) => edit(k, v as number | null)} onReset={() => session.resetEdit(k)} note={note} />;
          })}
          {from !== 'onboarding' ? (
            <Card style={styles.gap}>
              <AppText variant="bodyStrong">Personal daily risk budget</AppText>
              <AppText variant="caption" tone="tertiary">
                Your own daily stop — applies to all your accounts, separate from the firm’s daily loss limit. {personalRisk.trim() ? 'Entered by you.' : 'Missing — add it to get daily risk guidance.'}
              </AppText>
              <Input accessibilityLabel="Personal daily risk budget" value={personalRisk} onChangeText={setPersonalRisk} prefix="$" keyboardType="decimal-pad" placeholder="Not set" error={personalRiskError} />
            </Card>
          ) : null}
          {images.some((i) => i.page && !i.image.sample) && from !== 'onboarding' ? (
            <ToggleRow label="Keep a redacted copy for reference (account numbers blacked out; stored on this device and, when signed in, in your private cloud folder)" value={keepReference} onChange={setKeepReference} />
          ) : null}
        </View>
      ) : null}

      {!readingNow ? (
        <>
          {saveError ? (
            <AppText variant="caption" tone="danger" accessibilityRole="alert">
              {saveError}
            </AppText>
          ) : null}

          <Pressable accessibilityRole="button" aria-expanded={more} onPress={() => setMore((m) => !m)} style={styles.moreHead}>
            <AppText variant="bodyStrong" style={styles.flex}>
              Screenshot evidence, other values & privacy
            </AppText>
            <Icon name={more ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
          </Pressable>
          {more ? (
            <View style={styles.gap}>
              <MoreDetails
                mode={mode}
                images={images}
                warnings={warnings}
                consistent={consistent.map((c) => c.message)}
                rejected={model.rejected.map((r) => `${displayValue(r.key, r.value)}: ${r.reason}`)}
                matchText={match.program ? `${match.program.name} — ${match.program.reasons.join(' · ')}` : match.alternatives.length ? `Program not identified — possibly ${match.alternatives.map((a) => a.name).join(', ')}` : null}
                rulesNote={match.rulesNote}
                canToggleProgram={mode === 'new' && !!match.program}
                useProgram={useProgram}
                onUseProgram={setUseProgram}
              />
              {(Object.keys(model.saveableRules) as RuleKey[]).map((k) => (
                <ToggleRow key={k} label={`Save the ${RULE_NAME[k]} from the screenshot (${money(model.saveableRules[k]!)})`} value={saveRules[k] !== false} onChange={(v) => setSaveRules((s) => ({ ...s, [k]: v }))} />
              ))}
              <SectionHeader title="Other values on the screenshot" />
              {OTHER_KEYS.map((k) => (
                <ImportFieldRow key={k} k={k} field={fields[k]} edited={edited.has(k)} onChange={(v) => edit(k, v as number | null)} onReset={() => session.resetEdit(k)} />
              ))}
              {extraction.sensitive.length ? (
                <Card style={styles.gap}>
                  <AppText variant="label">Private details found — hidden</AppText>
                  {extraction.sensitive.map((s) => (
                    <AppText key={`${s.kind}${s.masked}`} variant="caption">
                      • {s.kind === 'account_id' ? 'Account number' : s.kind === 'email' ? 'Email' : s.kind === 'phone' ? 'Phone' : 'Name'} {s.masked} — not stored
                    </AppText>
                  ))}
                  {idItem ? <ToggleRow label={`Show ${idItem.masked} on this account`} value={keepMasked} onChange={setKeepMasked} /> : null}
                  {extraction.fingerprint ? <ToggleRow label="Remember this account (one-way fingerprint) to prevent duplicates" value={rememberAccount} onChange={setRememberAccount} /> : null}
                </Card>
              ) : null}
              {aiIsLive
                ? images
                    .filter((i) => i.reader !== 'vision')
                    .map((i) => (
                      <Button key={i.image.id} label={`Try the advanced reader on screenshot ${images.indexOf(i) + 1}`} variant="secondary" icon="sparkles-outline" onPress={() => void session.readWithVision(i.image.id, db)} />
                    ))
                : null}
              {IMPORT_DEBUG && images.some((i) => i.ocrText) ? <OcrDebugPanel images={images} /> : null}
              <Pressable accessibilityRole="button" onPress={() => setGuide('overview')} style={styles.linkRow}>
                <Icon name="help-circle-outline" size={16} color={colors.accentBright} />
                <AppText variant="caption" tone="accent">
                  See example screenshots
                </AppText>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
      <ExampleScreenshotGuide key={guide ?? 'closed'} visible={guide != null} initial={guide ?? 'overview'} onClose={() => setGuide(null)} />
    </Screen>
  );
}

/** Advanced information, collapsed by default: per-screenshot results, checks, warnings, readings not used, program match. */
function MoreDetails(p: {
  mode: 'new' | 'update';
  images: { image: { id: string }; status: string; page: { fields: object; wordCount: number; ocrConfidence: number } | null }[];
  warnings: string[];
  consistent: string[];
  rejected: string[];
  matchText: string | null;
  rulesNote: string | null;
  canToggleProgram: boolean;
  useProgram: boolean;
  onUseProgram: (v: boolean) => void;
}) {
  return (
    <Card style={styles.gap}>
      {p.images.map((i, n) => (
        <AppText key={i.image.id} variant="caption" tone="secondary">
          Screenshot {n + 1}: {i.status === 'error' ? 'not read' : i.page ? `${Object.keys(i.page.fields).length} values · ${i.page.wordCount} words, ${i.page.ocrConfidence}% clear` : 'waiting'}
        </AppText>
      ))}
      {p.matchText ? (
        <AppText variant="caption" tone="secondary">
          Program: {p.matchText}
        </AppText>
      ) : null}
      {p.rulesNote ? (
        <AppText variant="caption" tone="warning">
          {p.rulesNote}
        </AppText>
      ) : null}
      {p.canToggleProgram ? <ToggleRow label="Load this program’s verified rules" value={p.useProgram} onChange={p.onUseProgram} /> : null}
      {p.rejected.map((r) => (
        <AppText key={r} variant="caption" tone="warning">
          Not used: {r}
        </AppText>
      ))}
      {p.warnings.map((w) => (
        <AppText key={w} variant="caption" tone="warning">
          ⚠ {w}
        </AppText>
      ))}
      {p.consistent.map((c) => (
        <AppText key={c} variant="caption" tone="positive">
          ✓ {c}
        </AppText>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  debugHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mono: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  moreHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  flex: { flex: 1 },
  drop: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent + '88', backgroundColor: '#0B1730' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 100 },
  thumbImg: { width: 100, height: 72, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbX: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10, padding: 3 },
});

/** Development aid: what OCR actually read, to tell a reading problem from a parsing problem. */
function OcrDebugPanel({ images }: { images: { image: { id: string }; ocrText?: string[]; page: { labelsFound?: number; fields: object } | null }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={styles.gap}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" aria-expanded={open} style={styles.debugHead}>
        <AppText variant="label">OCR text (debug)</AppText>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </Pressable>
      {open
        ? images.map((i, n) =>
            i.ocrText ? (
              <View key={i.image.id} style={styles.gap}>
                <AppText variant="caption" tone="secondary">
                  Screenshot {n + 1} · {i.ocrText.length} lines · {i.page?.labelsFound ?? 0} labels recognised · {Object.keys(i.page?.fields ?? {}).length} values
                </AppText>
                <AppText variant="caption" style={styles.mono} selectable>
                  {i.ocrText.length ? i.ocrText.join('\n') : '(no text recognised)'}
                </AppText>
              </View>
            ) : null,
          )
        : null}
    </Card>
  );
}

const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
/** Plain-language name of the current step, with real numbers only. */
function stepLabel(step: ImportStep | null): string {
  switch (step?.stage) {
    case 'loading_engine':
      return 'Starting the text reader…';
    case 'downloading_model':
      return step.total ? `Downloading the text reader: ${mb(step.received)} of ${mb(step.total)} MB` : `Downloading the text reader: ${mb(step.received)} MB`;
    case 'starting_engine':
      return 'Preparing the text reader…';
    case 'recognizing':
      return step.fraction != null ? `Recognising text: ${Math.round(step.fraction * 100)}%` : 'Recognising text…';
    case 'extracting':
      return 'Finding account values…';
    default:
      return 'Waiting…';
  }
}
function stepFraction(step: ImportStep | null): number | null {
  if (step?.stage === 'downloading_model') return step.total ? Math.min(1, step.received / step.total) : null;
  if (step?.stage === 'recognizing') return step.fraction;
  return null;
}
