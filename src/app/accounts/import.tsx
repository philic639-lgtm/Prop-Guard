import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Chip, DetailTable, RiskProgress, Screen, SectionHeader, StatusBadge, ToggleRow } from '@/components/ui';
import { isDemoMode } from '@/config/env';
import { colors, radius, spacing } from '@/constants/theme';
import { DROP_SUPPORTED, DropZone } from '@/features/accountImport/DropZone';
import { ImportFieldRow } from '@/features/accountImport/ImportFieldRow';
import { SAMPLE_SETS, sampleImages } from '@/features/accountImport/samples';
import { useImportReview } from '@/features/accountImport/useImportReview';
import { useImportSession } from '@/features/accountImport/useImportSession';
import { usePendingImport } from '@/features/accountImport/usePendingImport';
import { applyImport, confirmImport, lockedRuleFields, type ApplyResult, type FieldKey } from '@/lib/engines/accountImport';
import { drawdownBuffer } from '@/lib/engines/propRuleEngine';
import { aiIsLive } from '@/services/ai';
import { MAX_IMAGES, pickImages, type ImportImage } from '@/services/accountImport/images';
import { OCR_ENGINE, ocrAvailable } from '@/services/accountImport/ocr';
import { useAppStore } from '@/store/useAppStore';
import { money } from '@/utils/format';
import { uuid } from '@/utils/id';

const GROUPS: { title: string; keys: FieldKey[] }[] = [
  { title: 'Account', keys: ['firm', 'program', 'stage', 'status', 'accountSize', 'startDate', 'statementDate'] },
  { title: 'Balance', keys: ['balance', 'startingBalance', 'netPnl', 'dailyPnl'] },
  { title: 'Drawdown', keys: ['maxDrawdown', 'drawdownThreshold', 'currentDrawdown', 'drawdownRemaining'] },
  { title: 'Limits', keys: ['dailyLossLimit', 'profitTarget'] },
];
const RULE_KEYS = ['maxDrawdown', 'dailyLossLimit', 'profitTarget'] as const;
type RuleKey = (typeof RULE_KEYS)[number];

/**
 * Import account values from prop-firm dashboard screenshots:
 * upload → read (on-device OCR) → review & correct → confirm → update.
 * `accountId` = update that account; `from=new|onboarding` = prefill a new account form.
 */
export default function AccountScreenshotImport() {
  const params = useLocalSearchParams<{ accountId?: string; from?: 'new' | 'onboarding' }>();
  const accounts = useAppStore((s) => s.accounts);
  const upsert = useAppStore((s) => s.upsertAccount);
  const [targetId, setTargetId] = useState<string | null>(params.accountId ?? null);
  const target = accounts.find((a) => a.id === targetId) ?? null;
  const mode: 'new' | 'update' = target ? 'update' : 'new';
  const from = params.from ?? 'new';

  const session = useImportSession();
  const { images, reading } = session;
  const review = useImportReview(mode, target, from !== 'onboarding');
  const { extraction, match, edited, db } = review;
  const [phase, setPhase] = useState<'add' | 'review' | 'done'>('add');
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [saveRules, setSaveRules] = useState<Partial<Record<RuleKey, boolean>>>({});
  const [useProgram, setUseProgram] = useState(true);
  const [keepMasked, setKeepMasked] = useState(false);
  const [rememberAccount, setRememberAccount] = useState(true);
  const [differentAccount, setDifferentAccount] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  // Session lives only while this screen is open.
  useEffect(() => () => useImportSession.getState().reset(), []);

  const add = useCallback((list: ImportImage[]) => {
    const r = useImportSession.getState().add(list);
    setError(r.skipped ? `Up to ${MAX_IMAGES} screenshots per import${r.added ? '' : ' — already added'}.` : null);
  }, []);
  const pick = async (source: 'library' | 'camera') => {
    setError(null);
    const r = await pickImages(source, MAX_IMAGES - images.length);
    if (r.status === 'ok') add(r.images);
    else if (r.status === 'denied') setError(source === 'camera' ? 'Camera access is needed to take a photo.' : 'Photo access is needed to choose screenshots.');
    else if (r.status === 'error') setError(r.message);
  };
  const read = async () => {
    setPhase('review');
    await useImportSession.getState().readAll(db);
  };

  const fields = extraction.fields;
  const locked = useMemo(() => (mode === 'update' ? lockedRuleFields(target) : new Set<RuleKey>()), [mode, target]);
  // Rules come from the program only when it has a verified version for the purchase date.
  const verifiedProgram = mode === 'new' && useProgram && match.program != null && match.rulesStatus !== 'not_verified';
  const blocking = [
    ...match.conflicts.filter((c) => c.severity === 'conflict').map((c) => ({ id: `m:${c.field}:${c.message}`, message: c.message })),
    ...extraction.checks.filter((c) => c.status === 'conflict').map((c) => ({ id: `c:${c.id}`, message: c.message })),
  ];
  const warnings = [...match.conflicts.filter((c) => c.severity === 'warning').map((c) => c.message), ...extraction.checks.filter((c) => c.status === 'warning').map((c) => c.message)];
  const consistent = extraction.checks.filter((c) => c.status === 'consistent');
  const duplicateHard = mode === 'new' && match.duplicate?.reason === 'same_account_number';
  const duplicateSoft = mode === 'new' && match.duplicate?.reason === 'same_configuration';
  const unresolved = blocking.filter((b) => !ack[b.id]).length;
  const hasValues = Object.keys(fields).length > 0;
  const canConfirm = confirmed && unresolved === 0 && hasValues && !duplicateHard && (!duplicateSoft || differentAccount) && !reading;
  const engine = images.some((i) => i.image.sample) ? 'sample' : images.some((i) => i.reader === 'vision') ? 'vision' : images.some((i) => i.page) ? 'ocr' : 'manual';
  const idItem = extraction.sensitive.find((s) => s.kind === 'account_id');

  const ruleUpdates = () => {
    const out: Partial<Record<RuleKey, number>> = {};
    for (const k of RULE_KEYS) {
      const v = fields[k]?.value;
      if (saveRules[k] && typeof v === 'number' && !locked.has(k) && !verifiedProgram) out[k] = v;
    }
    return out;
  };

  const confirm = () => {
    if (!canConfirm) return;
    const c = confirmImport({
      fields,
      edited,
      ruleUpdates: ruleUpdates(),
      fingerprint: rememberAccount ? extraction.fingerprint : null,
      maskedId: keepMasked && idItem ? idItem.masked : null,
      engine,
      pages: images.filter((i) => i.page).length,
      now: new Date(),
    });
    if (mode === 'update' && target) {
      const r = applyImport(target, c, uuid());
      upsert(r.account);
      setResult(r);
      setPhase('done');
      useImportSession.getState().reset();
      return;
    }
    // The program is still selected on the form (its rule version follows the purchase date).
    const prog = mode === 'new' && useProgram && match.program ? match.program.programId : null;
    usePendingImport.getState().set({
      for: from === 'onboarding' ? 'onboarding' : 'new',
      confirmed: c,
      programId: prog,
      options: prog ? match.options : {},
      firmName: match.firm?.name ?? (typeof fields.firm?.value === 'string' ? fields.firm.value : null),
      size: match.size,
      startDate: typeof fields.startDate?.value === 'string' ? fields.startDate.value : null,
      rules: c.ruleUpdates,
    });
    router.back();
  };

  const header = <AppHeader title={mode === 'update' ? `Update ${target?.name ?? 'account'}` : 'Import account screenshot'} subtitle="Upload · review · confirm" back />;

  // ── Done
  if (phase === 'done' && result) {
    const buffer = drawdownBuffer(result.account);
    return (
      <Screen header={header} footer={<Button label="Done" icon="checkmark" onPress={() => router.back()} />}>
        <Card tone="positive" style={styles.gap}>
          <StatusBadge label="Screenshot updated" tone="positive" icon="camera-outline" size="sm" />
          <AppText variant="title">{result.account.name}</AppText>
          <AppText variant="caption" tone="secondary">
            Values from your screenshot, confirmed by you — not a live broker connection.
          </AppText>
        </Card>
        <DetailTable
          rows={[
            { label: 'Balance', value: `${money(result.record.before.balance)} → ${money(result.account.balance)}`, bold: true },
            { label: 'Drawdown remaining', value: buffer != null ? money(buffer) : 'Not enough data', tone: buffer != null && buffer < 500 ? 'warning' : 'primary' },
            ...(result.floorCheck
              ? [{ label: 'Firm threshold vs rules', value: result.floorCheck.matches ? `Matches (${money(result.floorCheck.reported)})` : 'Differs — see note', tone: result.floorCheck.matches ? ('positive' as const) : ('warning' as const) }]
              : []),
          ]}
        />
        {result.record.notes.map((n) => (
          <AppText key={n} variant="caption" tone="warning">
            • {n}
          </AppText>
        ))}
      </Screen>
    );
  }

  // ── Add screenshots
  if (phase === 'add') {
    return (
      <Screen
        header={header}
        footer={
          <>
            <Button label={images.length ? `Read ${images.length} screenshot${images.length === 1 ? '' : 's'}` : 'Add a screenshot to continue'} icon="scan-outline" disabled={!images.length} onPress={() => void read()} />
            <Button label="Enter values manually instead" variant="ghost" onPress={() => (mode === 'update' ? setPhase('review') : router.back())} />
          </>
        }>
        <DropZone onFiles={add}>
          <Card style={styles.drop}>
            <Ionicons name="images-outline" size={34} color={colors.accentBright} />
            <AppText variant="heading" align="center">
              Upload your account dashboard
            </AppText>
            <AppText variant="caption" align="center">
              {DROP_SUPPORTED ? 'Drag & drop or paste screenshots here, or choose them below.' : 'Choose screenshots or take a photo of your screen.'} Add up to {MAX_IMAGES} if the details are spread across pages.
            </AppText>
            <View style={styles.row}>
              <Button label="Upload" icon="cloud-upload-outline" style={styles.flex} onPress={() => void pick('library')} />
              <Button label="Take photo" icon="camera-outline" variant="secondary" style={styles.flex} onPress={() => void pick('camera')} />
            </View>
          </Card>
        </DropZone>
        {error ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}

        {images.length ? (
          <View style={styles.thumbs}>
            {images.map((i, n) => (
              <View key={i.image.id} style={styles.thumb}>
                <Image source={{ uri: i.image.uri }} style={styles.thumbImg} contentFit="cover" accessibilityLabel={`Screenshot ${n + 1}`} />
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove screenshot ${n + 1}`} style={styles.thumbX} onPress={() => session.remove(i.image.id)} hitSlop={8}>
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
                <AppText variant="caption" numberOfLines={1} style={styles.thumbName}>
                  {i.image.name}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        {isDemoMode ? (
          <Card style={styles.gap}>
            <AppText variant="label">Try a sample (synthetic mock-ups)</AppText>
            <View style={styles.chips}>
              {SAMPLE_SETS.map((s) => (
                <Chip key={s.label} label={s.label} icon="image-outline" onPress={() => void sampleImages(s.keys).then(add)} />
              ))}
            </View>
          </Card>
        ) : null}

        <Card style={styles.gap}>
          <View style={styles.row}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.positive} />
            <AppText variant="bodyStrong">Private by design</AppText>
          </View>
          <AppText variant="caption">
            • {ocrAvailable() ? `${OCR_ENGINE.label}: the text is read on this device; screenshots are not uploaded or stored.` : 'Text reading runs in the browser version; on this device you can enter the values on the next screen.'}
          </AppText>
          <AppText variant="caption">• Account numbers and emails are detected and hidden. Prop Guard never asks for trading passwords or API keys.</AppText>
          <AppText variant="caption">• Nothing is saved until you review and confirm every value.</AppText>
        </Card>
      </Screen>
    );
  }

  // ── Review
  const progress = images.length ? images.reduce((s, i) => s + (i.status === 'done' || i.status === 'error' ? 1 : i.progress), 0) / images.length : 1;
  const ruleNote = (k: FieldKey): string | undefined => {
    if (!(RULE_KEYS as readonly string[]).includes(k)) return undefined;
    const rk = k as RuleKey;
    if (locked.has(rk)) return 'Account uses verified program rules — kept; this reading is for comparison only.';
    if (verifiedProgram) {
      const cmp = match.ruleComparisons.find((r) => r.field === rk);
      return cmp?.verified != null ? `Verified ${match.program!.name} rule: ${money(cmp.verified)} — this is what will be saved.` : 'Loaded from the verified program when you save.';
    }
    return undefined;
  };

  return (
    <Screen
      header={header}
      footer={
        <>
          <Button
            label={reading ? 'Reading…' : duplicateHard ? 'Already in Prop Guard' : mode === 'update' ? 'Confirm & update account' : 'Use these values'}
            icon="checkmark-done"
            disabled={!canConfirm}
            onPress={confirm}
          />
          <Button label="Add or change screenshots" variant="ghost" onPress={() => setPhase('add')} />
        </>
      }>
      {reading || images.some((i) => i.status === 'reading') ? (
        <Card style={styles.gap}>
          <AppText variant="bodyStrong">Reading your screenshots…</AppText>
          <RiskProgress value={progress} tone="accent" label="Reading progress" />
          <AppText variant="caption">The first read downloads the text reader (about 4 MB, once).</AppText>
        </Card>
      ) : null}

      {images.map((i, n) =>
        i.status === 'error' || i.page?.quality === 'poor' || (i.error && i.status === 'done') ? (
          <Card key={i.image.id} tone="warning" style={styles.gap}>
            <AppText variant="bodyStrong">Screenshot {n + 1}: {i.status === 'error' ? 'could not be read' : i.error ? 'advanced reader unavailable' : 'hard to read'}</AppText>
            <AppText variant="caption" tone="secondary">
              {i.error ?? 'The image looks blurry or too small. Retake it straight-on and closer, upload the original screenshot, or type the values below.'}
            </AppText>
            {aiIsLive && i.reader !== 'vision' ? (
              <Button label="Try the advanced reader" variant="secondary" icon="sparkles-outline" onPress={() => void session.readWithVision(i.image.id, db)} />
            ) : null}
            {aiIsLive && i.reader !== 'vision' ? (
              <AppText variant="caption" tone="tertiary">
                Sends a copy with detected account numbers blacked out to Prop Guard’s server for a one-time reading. It is not stored.
              </AppText>
            ) : null}
          </Card>
        ) : null,
      )}

      {/* Match */}
      {match.firm || match.program ? (
        <Card raised style={styles.gap}>
          <AppText variant="label">{mode === 'update' ? 'Screenshot shows' : 'Looks like'}</AppText>
          <AppText variant="heading">{match.program?.name ?? match.firm?.name}</AppText>
          {match.program ? (
            <AppText variant="caption" tone="secondary">
              {match.firm?.name} · {match.program.reasons.join(' · ')}
            </AppText>
          ) : (
            <AppText variant="caption" tone="secondary">
              Program not identified{match.alternatives.length ? ` — possibly ${match.alternatives.map((a) => a.name).join(', ')}` : ''}.
            </AppText>
          )}
          {mode === 'new' && match.program && match.rulesStatus !== 'not_verified' ? (
            <ToggleRow label="Load this program’s verified rules" value={useProgram} onChange={setUseProgram} />
          ) : null}
          {match.rulesNote ? (
            <AppText variant="caption" tone="warning">
              {match.rulesNote}
            </AppText>
          ) : null}
          {mode === 'new' && !match.program ? (
            <AppText variant="caption" tone="tertiary">
              You can pick the firm program yourself on the account form. Rules are never taken from a different program.
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {duplicateHard || duplicateSoft ? (
        <Card tone={duplicateHard ? 'danger' : 'warning'} style={styles.gap}>
          <AppText variant="bodyStrong">{duplicateHard ? 'This account is already in Prop Guard' : 'You may already have this account'}</AppText>
          <AppText variant="caption" tone="secondary">
            {duplicateHard
              ? `The account number matches “${match.duplicate!.name}”. Update it instead of creating a duplicate.`
              : `“${match.duplicate!.name}” is the same firm program. Update it, or confirm this is a different account.`}
          </AppText>
          {from !== 'onboarding' ? (
            <Button label={`Update “${match.duplicate!.name}” instead`} icon="refresh" onPress={() => setTargetId(match.duplicate!.accountId)} />
          ) : null}
          {duplicateSoft ? <ToggleRow label="This is a different account" value={differentAccount} onChange={setDifferentAccount} /> : null}
        </Card>
      ) : null}

      {blocking.length ? (
        <Card tone="danger" style={styles.gap}>
          <AppText variant="bodyStrong">Check before saving</AppText>
          {blocking.map((b) => (
            <View key={b.id} style={styles.gap}>
              <AppText variant="caption">{b.message}</AppText>
              <ToggleRow label="I checked this" value={!!ack[b.id]} onChange={(v) => setAck((a) => ({ ...a, [b.id]: v }))} />
            </View>
          ))}
        </Card>
      ) : null}
      {warnings.length ? (
        <Card tone="warning" style={styles.gap}>
          {warnings.map((w) => (
            <AppText key={w} variant="caption">
              ⚠ {w}
            </AppText>
          ))}
        </Card>
      ) : null}
      {consistent.length ? (
        <View style={styles.gap}>
          {consistent.map((c) => (
            <AppText key={c.id} variant="caption" tone="positive">
              ✓ {c.message}
            </AppText>
          ))}
        </View>
      ) : null}

      {GROUPS.map((g) => (
        <View key={g.title} style={styles.gap}>
          <SectionHeader title={g.title} />
          {g.keys.map((k) => (
            <View key={k} style={styles.gap}>
              <ImportFieldRow
                k={k}
                field={fields[k]}
                edited={edited.has(k)}
                onChange={(v) => session.setEdit(k, v)}
                onReset={() => session.resetEdit(k)}
                note={ruleNote(k)}
              />
              {(RULE_KEYS as readonly string[]).includes(k) && typeof fields[k]?.value === 'number' && !locked.has(k as RuleKey) && !verifiedProgram ? (
                <ToggleRow label={`Save as this account’s ${k === 'maxDrawdown' ? 'max drawdown' : k === 'dailyLossLimit' ? 'daily loss limit' : 'profit target'} (unverified)`} value={!!saveRules[k as RuleKey]} onChange={(v) => setSaveRules((s) => ({ ...s, [k]: v }))} />
              ) : null}
            </View>
          ))}
        </View>
      ))}

      {extraction.sensitive.length ? (
        <Card style={styles.gap}>
          <AppText variant="label">Private details found — hidden</AppText>
          {extraction.sensitive.map((s) => (
            <AppText key={`${s.kind}${s.masked}`} variant="caption">
              • {s.kind === 'account_id' ? 'Account number' : s.kind === 'email' ? 'Email' : s.kind === 'name' ? 'Name' : 'Phone'} {s.masked} — not stored
            </AppText>
          ))}
          {idItem ? <ToggleRow label={`Show ${idItem.masked} on this account`} value={keepMasked} onChange={setKeepMasked} /> : null}
          {idItem ? (
            <ToggleRow label="Remember this account (one-way fingerprint) to prevent duplicate imports" value={rememberAccount} onChange={setRememberAccount} />
          ) : null}
        </Card>
      ) : null}

      <Card tone="accent" style={styles.gap}>
        <ToggleRow label="I checked these values against my dashboard" value={confirmed} onChange={setConfirmed} />
        <AppText variant="caption" tone="tertiary">
          {unresolved
            ? `${unresolved} item${unresolved === 1 ? '' : 's'} above still need your check.`
            : !hasValues
              ? 'Nothing was detected yet — type the values you see, or add a clearer screenshot.'
              : mode === 'update'
                ? 'Updates the balance and drawdown tracking, keeps a dated history and marks the account “Screenshot updated”. Verified program rules are never changed.'
                : 'Fills the new account form; the account is saved when you tap Save.'}
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  drop: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent + '88', backgroundColor: '#0B1730' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 100, gap: 4 },
  thumbImg: { width: 100, height: 72, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbX: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10, padding: 3 },
  thumbName: { fontSize: 10 },
});
