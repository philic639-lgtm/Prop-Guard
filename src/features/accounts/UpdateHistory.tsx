import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ConfirmationSheet, StatusBadge } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { undoLatestUpdate } from '@/lib/engines/accountImport';
import { confirmAccountSaved, useAppStore } from '@/store/useAppStore';
import type { Account, AccountImportRecord } from '@/types/domain';
import { money } from '@/utils/format';

const SOURCE: Record<AccountImportRecord['engine'], string> = { ocr: 'Screenshot', vision: 'Screenshot (advanced reader)', sample: 'Sample screenshot', manual: 'Edited by you' };
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Every confirmed update (screenshot or manual), newest first, with what it changed.
 * The latest one can be undone — the account returns to the values it had before.
 */
export function UpdateHistory({ account, onUndone }: { account: Account; onUndone?: () => void }) {
  const upsert = useAppStore((s) => s.upsertAccount);
  const [confirm, setConfirm] = useState<AccountImportRecord | null>(null);
  const [message, setMessage] = useState<{ tone: 'positive' | 'danger'; text: string } | null>(null);
  const history = account.importState?.history ?? [];
  if (!history.length) return null;
  const latestId = history.find((r) => !r.undoneAt)?.id;

  const undo = async (r: AccountImportRecord) => {
    setConfirm(null);
    const res = undoLatestUpdate(account, r.id, new Date());
    if (!res.ok) return setMessage({ tone: 'danger', text: res.reason });
    upsert(res.account);
    const saved = await confirmAccountSaved(res.account);
    setMessage(saved.ok ? { tone: 'positive', text: `Update undone — balance is back to ${money(res.account.balance)}.` } : { tone: 'danger', text: saved.error });
    if (saved.ok) onUndone?.();
  };

  return (
    <Card style={styles.gap}>
      <AppText variant="bodyStrong">Update history</AppText>
      {history.slice(0, 10).map((r) => (
        <View key={r.id} style={styles.item}>
          <View style={styles.row}>
            <AppText variant="caption" style={styles.flex}>
              {when(r.at)} · {SOURCE[r.engine]}
            </AppText>
            {r.undoneAt ? <StatusBadge label="Undone" tone="neutral" size="sm" /> : null}
          </View>
          <AppText variant="caption" tone="secondary">
            Balance {money(r.before.balance)} → {money(r.after.balance)}
          </AppText>
          {r.notes.slice(0, 2).map((n) => (
            <AppText key={n} variant="caption" tone="tertiary">
              {n}
            </AppText>
          ))}
          {r.id === latestId && r.previous ? <Button label="Undo this update" icon="arrow-undo-outline" variant="ghost" size="md" onPress={() => setConfirm(r)} /> : null}
        </View>
      ))}
      {message ? (
        <AppText variant="caption" tone={message.tone} accessibilityRole="alert">
          {message.text}
        </AppText>
      ) : null}
      <ConfirmationSheet
        visible={!!confirm}
        title="Undo this update?"
        message={confirm ? `The account goes back to the values it had before ${when(confirm.at)} (balance ${money(confirm.before.balance)}). The update stays in the history, marked as undone.` : ''}
        confirmLabel="Undo update"
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void undo(confirm)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  item: { gap: 2, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
