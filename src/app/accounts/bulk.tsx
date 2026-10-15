import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Chip, Input, Screen, StatusBadge, ToggleRow } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { NativeOcrHost } from '@/features/accountImport/NativeOcrHost';
import { UpdateComparison } from '@/features/accountImport/UpdateComparison';
import { useImportSession } from '@/features/accountImport/useImportSession';
import { useFirmRules } from '@/features/accounts/useFirmRules';
import { applyImport, type FieldKey } from '@/lib/engines/accountImport';
import { BULK_STATUS_LABEL, extractionOf, matchToAccount, planBulk, type BulkItemInput, type BulkResult, type BulkStatus } from '@/lib/engines/bulkImport';
import { pickImages } from '@/services/accountImport/images';
import { confirmAccountSaved, useAppStore } from '@/store/useAppStore';
import type { AccountDetailKey } from '@/types/domain';
import { money } from '@/utils/format';
import { uuid } from '@/utils/id';
import { goBack } from '@/utils/navigation';

/** Several account overviews at once — up to one per account. */
export const BULK_MAX = 10;

type ItemState = Pick<BulkItemInput, 'matchConfirmed' | 'skipped' | 'acks' | 'manualChoice'> & {
  /** undefined = use the matched account; null = none chosen. */
  accountId?: string | null;
  edits: Partial<Record<FieldKey, number | null>>;
};
const EMPTY_ITEM: ItemState = { matchConfirmed: false, skipped: false, acks: {}, manualChoice: {}, edits: {} };
const STATUS_TONE: Record<BulkStatus, 'positive' | 'warning' | 'danger' | 'neutral'> = {
  ready: 'positive',
  needs_account: 'warning',
  needs_confirmation: 'warning',
  needs_values: 'warning',
  needs_ack: 'warning',
  duplicate_target: 'danger',
  single_update: 'danger',
  skipped: 'neutral',
};
const num = (t: string) => {
  const v = Number(t.replace(/[$,\s]/g, ''));
  return t.trim() === '' ? null : Number.isFinite(v) && v > 0 ? v : NaN;
};

/**
 * Update Multiple Accounts: every screenshot is read and matched on its own; nothing is
 * assigned to an account without an account-number match or the trader's confirmation;
 * each proposed update shows saved vs. new values; only "Ready" updates are saved, each
 * confirmed by reading it back; the result lists what succeeded and what did not.
 */
export default function BulkUpdateScreen() {
  return (
    <>
      <NativeOcrHost />
      <BulkFlow />
    </>
  );
}

function BulkFlow() {
  const accounts = useAppStore((s) => s.accounts);
  const upsert = useAppStore((s) => s.upsertAccount);
  const db = useFirmRules((s) => s.db);
  const images = useImportSession((s) => s.images);
  const reading = useImportSession((s) => s.reading);
  const [phase, setPhase] = useState<'add' | 'review' | 'done'>('add');
  const [state, setState] = useState<Record<string, ItemState>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [text, setText] = useState<Record<string, string>>({});

  // A new bulk session starts empty and is released when the screen closes.
  useEffect(() => {
    useImportSession.getState().reset();
    return () => useImportSession.getState().reset();
  }, []);

  const pick = async (source: 'library' | 'camera') => {
    setError(null);
    const r = await pickImages(source, BULK_MAX - images.length);
    if (r.status === 'ok') {
      const a = useImportSession.getState().add(r.images, BULK_MAX);
      if (a.rejected.length || a.skipped) setError([...a.rejected, ...(a.skipped ? [`Up to ${BULK_MAX} screenshots at once.`] : [])].join('\n'));
    } else if (r.status === 'denied') setError('Photo access was denied. Allow it in Settings.');
    else if (r.status === 'error') setError(r.message);
  };

  const items = useMemo(
    () =>
      images
        .filter((i) => i.page)
        .map((i): BulkItemInput & { uri: string; n: number } => {
          const st = state[i.image.id] ?? EMPTY_ITEM;
          const extraction = extractionOf(i.page!, st.edits);
          const match = matchToAccount(extractionOf(i.page!), accounts, db);
          return { id: i.image.id, uri: i.image.uri, n: images.indexOf(i) + 1, extraction, match, accountId: st.accountId === undefined ? match.accountId : st.accountId, matchConfirmed: st.matchConfirmed, skipped: st.skipped, acks: st.acks, manualChoice: st.manualChoice };
        }),
    [images, state, accounts, db],
  );
  const plan = useMemo(() => planBulk(items, { accounts, db, now: new Date() }), [items, accounts, db]);
  const ready = plan.filter((p) => p.status === 'ready');
  const failedReads = images.filter((i) => i.status === 'error');
  const set = (id: string, patch: Partial<ItemState>) => setState((s) => ({ ...s, [id]: { ...EMPTY_ITEM, ...s[id], ...patch } }));

  const read = async () => {
    setPhase('review');
    await useImportSession.getState().readAll(db);
  };

  const saveAll = async () => {
    setSaving(true);
    const out: BulkResult[] = [];
    // Plan again against the latest saved accounts, then save only what is ready.
    const fresh = planBulk(items, { accounts: useAppStore.getState().accounts, db, now: new Date() });
    for (const p of fresh) {
      if (p.status === 'skipped') continue;
      const name = p.account?.name ?? `Screenshot ${items.find((i) => i.id === p.id)?.n ?? ''}`;
      if (p.status !== 'ready' || !p.account || !p.confirmed) {
        out.push({ id: p.id, accountName: name, ok: false, message: `Not saved — ${BULK_STATUS_LABEL[p.status].toLowerCase()}${p.reasons[0] ? `: ${p.reasons[0]}` : ''}` });
        continue;
      }
      try {
        const r = applyImport(p.account, p.confirmed, uuid());
        upsert(r.account);
        const c = await confirmAccountSaved(r.account);
        out.push(c.ok ? { id: p.id, accountName: name, ok: true, message: `Balance ${money(r.record.before.balance)} → ${money(r.account.balance)}${c.cloud === 'pending' ? ' · saved on this device, cloud upload pending' : ''}` } : { id: p.id, accountName: name, ok: false, message: c.error });
      } catch (e) {
        out.push({ id: p.id, accountName: name, ok: false, message: (e as Error).message });
      }
    }
    setResults(out);
    setSaving(false);
    setPhase('done');
  };

  const header = <AppHeader title="Update Multiple Accounts" subtitle="One screenshot per account" back />;

  if (phase === 'done') {
    const ok = results.filter((r) => r.ok).length;
    return (
      <Screen header={header} footer={<Button label="Done" icon="checkmark" onPress={() => router.replace('/accounts')} />}>
        <Card tone={ok === results.length ? 'positive' : 'warning'} style={styles.gap}>
          <AppText variant="title">
            {ok} of {results.length} account{results.length === 1 ? '' : 's'} updated
          </AppText>
          <AppText variant="caption" tone="secondary">
            Snapshot-based — not live verified. Each saved update is in that account’s update history and can be undone there.
          </AppText>
        </Card>
        {results.map((r) => (
          <Card key={r.id} style={styles.gap}>
            <View style={styles.row}>
              <AppText variant="bodyStrong" style={styles.flex}>
                {r.accountName}
              </AppText>
              <StatusBadge label={r.ok ? 'Saved' : 'Not saved'} tone={r.ok ? 'positive' : 'danger'} size="sm" />
            </View>
            <AppText variant="caption" tone={r.ok ? 'secondary' : 'danger'}>
              {r.message}
            </AppText>
          </Card>
        ))}
      </Screen>
    );
  }

  if (phase === 'add') {
    return (
      <Screen header={header} footer={<Button label={images.length ? `Read ${images.length} screenshot${images.length > 1 ? 's' : ''}` : 'Add screenshots first'} icon="scan-outline" disabled={!images.length} onPress={() => void read()} />}>
        <Card style={styles.gap}>
          <AppText variant="bodyStrong">One account overview per screenshot</AppText>
          <AppText variant="caption" tone="secondary">
            Add the latest dashboard of each account (up to {BULK_MAX}). Each one is read on this device and matched to your accounts by its account number, or by firm and size — you confirm every match and every change before anything is saved.
          </AppText>
          <View style={styles.row}>
            <Button label="Upload" icon="upload-screenshot" size="md" style={styles.flex} onPress={() => void pick('library')} />
            <Button label="Take Photo" icon="camera-outline" variant="secondary" size="md" style={styles.flex} onPress={() => void pick('camera')} />
          </View>
          {error ? (
            <AppText variant="caption" tone="danger">
              {error}
            </AppText>
          ) : null}
        </Card>
        {images.length ? (
          <View style={styles.thumbs}>
            {images.map((i, n) => (
              <View key={i.image.id} style={styles.thumb}>
                <Image source={{ uri: i.image.uri }} style={styles.thumbImg} contentFit="cover" accessibilityLabel={`Screenshot ${n + 1}`} />
                <Button label="Remove" variant="ghost" size="md" onPress={() => useImportSession.getState().remove(i.image.id)} />
              </View>
            ))}
          </View>
        ) : null}
      </Screen>
    );
  }

  // ── Review
  const readingNow = reading || images.some((i) => i.status === 'reading' || i.status === 'queued');
  return (
    <Screen
      header={header}
      footer={
        <>
          <AppText variant="caption" tone="secondary" align="center">
            {readingNow ? 'Reading screenshots on this device…' : `${ready.length} ready · ${plan.filter((p) => p.status !== 'ready' && p.status !== 'skipped').length} need attention · ${plan.filter((p) => p.status === 'skipped').length} skipped`}
          </AppText>
          <Button label={saving ? 'Saving…' : `Save ${ready.length} update${ready.length === 1 ? '' : 's'}`} icon="checkmark-done" disabled={!ready.length || saving || readingNow} onPress={() => void saveAll()} />
        </>
      }>
      {failedReads.map((i) => (
        <Card key={i.image.id} tone="warning">
          <AppText variant="caption">
            Screenshot {images.indexOf(i) + 1} could not be read: {i.error}
          </AppText>
        </Card>
      ))}
      {items.map((it) => {
        const p = plan.find((x) => x.id === it.id)!;
        const st = state[it.id] ?? EMPTY_ITEM;
        const f = it.extraction.fields;
        const firm = typeof f.firm?.value === 'string' ? f.firm.value : 'Firm not read';
        const program = typeof f.program?.value === 'string' ? f.program.value : null;
        const candidates = it.match.candidates.length ? it.match.candidates : accounts.filter((a) => a.status !== 'archived').map((a) => ({ accountId: a.id, name: a.name }));
        const field = (k: 'balance' | 'drawdownThreshold', label: string) => {
          const key = `${it.id}:${k}`;
          const shown = text[key] ?? (typeof f[k]?.value === 'number' ? String(f[k]!.value) : '');
          return (
            <Input
              label={label}
              accessibilityLabel={`${label}, screenshot ${it.n}`}
              value={shown}
              prefix="$"
              keyboardType="decimal-pad"
              placeholder="Needs verification"
              onChangeText={(t) => {
                setText((s) => ({ ...s, [key]: t }));
                const v = num(t);
                if (v === null || Number.isFinite(v)) set(it.id, { edits: { ...st.edits, [k]: v } });
              }}
              error={Number.isNaN(num(shown)) ? 'Enter a positive amount' : undefined}
            />
          );
        };
        return (
          <Card key={it.id} style={styles.gap}>
            <View style={styles.row}>
              <Image source={{ uri: it.uri }} style={styles.mini} contentFit="cover" accessibilityLabel={`Screenshot ${it.n}`} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Screenshot {it.n}</AppText>
                <AppText variant="caption" tone="tertiary" numberOfLines={2}>
                  {[firm, program].filter(Boolean).join(' · ')}
                </AppText>
              </View>
              <StatusBadge label={BULK_STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} size="sm" />
            </View>
            {p.status !== 'skipped' ? (
              <>
                <AppText variant="caption" tone="secondary">
                  {it.match.note}
                </AppText>
                {it.match.certainty !== 'account_number' ? (
                  <View style={styles.wrap}>
                    {candidates.map((c) => (
                      <Chip key={c.accountId} single label={c.name} selected={it.accountId === c.accountId && st.matchConfirmed} onPress={() => set(it.id, { accountId: c.accountId, matchConfirmed: true })} />
                    ))}
                  </View>
                ) : null}
                {field('balance', 'Current balance')}
                {field('drawdownThreshold', 'Liquidation threshold')}
                {p.manual.map((c) => (
                  <View key={c.key} style={styles.gap}>
                    <AppText variant="caption">You corrected {c.label.toLowerCase()} by hand:</AppText>
                    <View style={styles.wrap}>
                      <Chip single label={`Keep mine · ${typeof c.manual === 'number' ? money(c.manual) : c.manual}`} selected={st.manualChoice[c.key as AccountDetailKey] !== 'screenshot'} onPress={() => set(it.id, { manualChoice: { ...st.manualChoice, [c.key]: 'keep' } })} />
                      <Chip single label={`Use screenshot · ${typeof c.screenshot === 'number' ? money(c.screenshot) : c.screenshot}`} selected={st.manualChoice[c.key as AccountDetailKey] === 'screenshot'} onPress={() => set(it.id, { manualChoice: { ...st.manualChoice, [c.key]: 'screenshot' } })} />
                    </View>
                  </View>
                ))}
                {p.acksNeeded.map((a) => (
                  <ToggleRow key={a.id} label={`${a.text} — I checked this`} value={!!st.acks[a.id]} onChange={(v) => set(it.id, { acks: { ...st.acks, [a.id]: v } })} />
                ))}
                {p.reasons.filter((r) => r !== it.match.note).map((r) => (
                  <AppText key={r} variant="caption" tone="warning">
                    {r}
                  </AppText>
                ))}
                {p.status === 'single_update' && p.account ? <Button label={`Update “${p.account.name}” separately`} variant="secondary" size="md" onPress={() => router.push({ pathname: '/accounts/import', params: { accountId: p.account!.id } })} /> : null}
                {p.changes.length ? <UpdateComparison rows={p.changes} title={p.account ? p.account.name : 'What changes'} /> : null}
              </>
            ) : null}
            <ToggleRow label="Skip this screenshot" value={st.skipped} onChange={(v) => set(it.id, { skipped: v })} />
          </Card>
        );
      })}
      <Button label="Cancel" variant="ghost" onPress={() => goBack('/accounts')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 100, gap: 4 },
  thumbImg: { width: 100, height: 72, borderRadius: radius.sm, backgroundColor: colors.card },
  mini: { width: 44, height: 32, borderRadius: radius.sm, backgroundColor: colors.card },
});
