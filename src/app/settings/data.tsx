import { router } from 'expo-router';
import { useState } from 'react';
import { Share } from 'react-native';

import { AppHeader, AppText, Card, ConfirmationSheet, Divider, ListRow, Screen } from '@/components/ui';
import { useAppStore } from '@/store/useAppStore';

export default function DataSettings() {
  const [confirm, setConfirm] = useState<'none' | 'demo' | 'erase'>('none');
  const trades = useAppStore((s) => s.trades.length);

  const exportJson = async () => {
    const s = useAppStore.getState();
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'Prop Guard',
      accounts: s.accounts,
      strategies: s.strategies,
      trades: s.trades,
      sessions: s.sessions,
      disciplineEvents: s.events,
      tradingRules: s.tradingRules,
    };
    await Share.share({ title: 'Prop Guard export', message: JSON.stringify(payload, null, 2) });
  };

  const exportCsv = async () => {
    const s = useAppStore.getState();
    const names = new Map(s.strategies.map((x) => [x.id, x.name]));
    const header = 'opened_at,closed_at,account,strategy,instrument,direction,contracts,entry,stop,target,exit,points,pnl,realized_r,setup_score,discipline_score,notes';
    const accounts = new Map(s.accounts.map((a) => [a.id, a.name]));
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = s.trades.map((t) =>
      [t.openedAt, t.closedAt, accounts.get(t.accountId), t.strategyId ? names.get(t.strategyId) : '', t.instrument, t.direction, t.contracts, t.entryPrice, t.originalStopPrice, t.targetPrice, t.exitPrice, t.points, t.pnl, t.realizedR, t.setupScore, t.disciplineScore, t.notes]
        .map(esc)
        .join(','),
    );
    await Share.share({ title: 'Prop Guard trades.csv', message: [header, ...rows].join('\n') });
  };

  return (
    <Screen header={<AppHeader title="Data export" back />}>
      <Card padded={false} style={{ paddingHorizontal: 16 }}>
        <ListRow icon="document-text-outline" iconTone="accent" title="Export trades (CSV)" subtitle={`${trades} trades`} onPress={() => void exportCsv()} />
        <Divider />
        <ListRow icon="code-download-outline" iconTone="accent" title="Export everything (JSON)" subtitle="Accounts, strategies, trades, sessions, discipline" onPress={() => void exportJson()} />
      </Card>
      <Card padded={false} style={{ paddingHorizontal: 16 }}>
        <ListRow icon="flask-outline" title="Load demo data" subtitle="Replaces data on this device" onPress={() => setConfirm('demo')} />
        <Divider />
        <ListRow icon="trash-outline" title="Erase data on this device" destructive onPress={() => setConfirm('erase')} />
      </Card>
      <AppText variant="caption" tone="tertiary">
        When signed in, your data is stored in your private Supabase project and protected by row-level security.
      </AppText>
      <ConfirmationSheet
        visible={confirm !== 'none'}
        title={confirm === 'demo' ? 'Load demo data' : 'Erase data'}
        message={confirm === 'demo' ? 'Your local data will be replaced with demo data.' : 'All accounts, strategies and trades on this device will be removed.'}
        confirmLabel={confirm === 'demo' ? 'Load demo' : 'Erase'}
        destructive={confirm === 'erase'}
        onCancel={() => setConfirm('none')}
        onConfirm={() => {
          const s = useAppStore.getState();
          if (confirm === 'demo') {
            s.loadDemo();
            router.replace('/home');
          } else {
            s.startFresh(s.user ? 'cloud' : 'local');
            router.replace('/onboarding/welcome');
          }
          setConfirm('none');
        }}
      />
    </Screen>
  );
}
