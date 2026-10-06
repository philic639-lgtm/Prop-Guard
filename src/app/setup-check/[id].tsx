import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { AppHeader, AppText, Button, Card, ConfirmationSheet, EmptyState, Screen, SelectField } from '@/components/ui';
import { SetupCheckResult } from '@/features/setupCheck/SetupCheckResult';
import { useAppStore } from '@/store/useAppStore';

/** A saved Setup Check, with its link to the trade taken from it. */
export default function SavedSetupCheck() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const check = useAppStore((s) => s.setupChecks.find((c) => c.id === id) ?? null);
  const trades = useAppStore((s) => s.trades);
  const link = useAppStore((s) => s.linkSetupCheck);
  const remove = useAppStore((s) => s.deleteSetupCheck);
  const [confirm, setConfirm] = useState(false);
  const linked = trades.find((t) => t.id === check?.tradeId) ?? null;
  // Trades on the same instrument from the check's day onward (most likely the one taken).
  const candidates = useMemo(
    () =>
      check
        ? trades
            .filter((t) => t.instrument === check.instrument && Date.parse(t.openedAt) >= Date.parse(check.createdAt) - 3_600_000 && !t.setupCheckId)
            .slice(0, 20)
            .map((t) => ({ value: t.id, label: `${t.instrument} ${t.direction} · ${new Date(t.openedAt).toLocaleString()}`, sub: t.pnl != null ? `P&L ${t.pnl}` : t.status }))
        : [],
    [trades, check],
  );

  if (!check) {
    return (
      <Screen header={<AppHeader title="Setup check" back />}>
        <EmptyState icon="scan-outline" title="Setup check not found" message="It may have been deleted." actionLabel="Saved checks" onAction={() => router.replace('/setup-check/history')} />
      </Screen>
    );
  }

  return (
    <Screen header={<AppHeader title="Setup check" subtitle={new Date(check.createdAt).toLocaleString()} back />}>
      <SetupCheckResult check={check} />
      <Card>
        <AppText variant="label">Journal link</AppText>
        {linked ? (
          <Button label={`Open linked trade (${linked.instrument} ${linked.direction})`} icon="book-outline" variant="secondary" size="md" onPress={() => router.push({ pathname: '/journal/[id]', params: { id: linked.id } })} />
        ) : candidates.length ? (
          <SelectField label="Link the trade you took" value={null} options={candidates} onChange={(tradeId) => link(check.id, tradeId)} placeholder="Choose a trade" icon="link-outline" />
        ) : (
          <AppText variant="caption">No trade linked. Trades opened from “Plan in Check Trade” are linked automatically.</AppText>
        )}
      </Card>
      <Button label="Delete setup check" variant="ghost" onPress={() => setConfirm(true)} />
      <ConfirmationSheet
        visible={confirm}
        title="Delete setup check"
        message="The linked trade stays in your journal."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          remove(check.id);
          setConfirm(false);
          router.back();
        }}
      />
    </Screen>
  );
}
