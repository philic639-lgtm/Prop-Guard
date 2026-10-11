import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Chip, EmptyState, NumericInput, SectionHeader, SegmentedControl, StatusBadge, ToggleRow } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import { useNow } from '@/hooks/useNow';
import { canStartLive, connectionStatus, defaultFollower, MAX_MULTIPLIER, newCopyGroup, previewCopy, STATE_LABEL, transition, validateCopyGroup, withEvent } from '@/lib/engines/accountCopierEngine';
import { computeDailyGuard, type DailyGuard } from '@/lib/engines/dailyGuardEngine';
import { findInstrument } from '@/lib/engines/instrumentEngine';
import { connectedBrokers } from '@/services/broker';
import { useAppStore } from '@/store/useAppStore';
import type { CopierEventKind, CopierState, CopyGroup, FollowerLink } from '@/types/copyTrade';
import { money, parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';

const STATE_TONE: Record<CopierState, Tone> = { setup: 'accent', running: 'positive', paused: 'warning', stopped: 'neutral' };
const EVENT_ICON: Record<CopierEventKind, IconName> = {
  created: 'add-circle-outline',
  master: 'star-outline',
  linked: 'link-outline',
  unlinked: 'unlink-outline',
  settings: 'options-outline',
  paused: 'pause-circle-outline',
  resumed: 'play-circle-outline',
  stopped: 'stop-circle-outline',
  start_refused: 'ban-outline',
  preview: 'eye-outline',
};
const str = (n: number | null) => (n == null ? '' : String(n));

/**
 * Trade Copier (Copy Trade tab): link a master account to follower accounts,
 * set multipliers and per-account limits, see connection status, preview what
 * each follower would take, pause / stop, and the activity history.
 * SETUP / PREVIEW ONLY — no broker integration is connected, so nothing is
 * copied or executed and "Start live copying" stays disabled.
 */
export function AccountCopierPanel() {
  const accounts = useAppStore((s) => s.accounts);
  const groups = useAppStore((s) => s.copyGroups);
  const save = useAppStore((s) => s.upsertCopyGroup);
  const rules = useAppStore((s) => s.tradingRules);
  const trades = useAppStore((s) => s.trades);
  const now = useNow(30_000);
  const group = groups[0] ?? null;
  const brokers = useMemo(() => connectedBrokers().map((b) => b.name), []);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const guards = useMemo(() => new Map<string, DailyGuard>(accounts.map((a) => [a.id, computeDailyGuard({ account: a, rules, trades, now })])), [accounts, rules, trades, now]);
  const issues = useMemo(() => (group ? validateCopyGroup(group, accounts) : []), [group, accounts]);
  const live = group ? canStartLive(group, accounts, brokers) : null;

  const at = () => new Date().toISOString();
  const update = (g: CopyGroup, kind: CopierEventKind, detail: string) => save(withEvent(g, { id: uuid(), at: at(), kind, detail }));

  if (accounts.length < 2) {
    return (
      <Card>
        <EmptyState
          illustration="copy"
          title="Link two or more accounts"
          message="The trade copier mirrors a master account to follower accounts. Add at least two trading accounts to set one up."
          actionLabel="Add account"
          onAction={() => router.push('/accounts/new')}
        />
      </Card>
    );
  }
  if (!group) {
    return (
      <>
        <DemoBanner />
        <Card accent="accent" style={styles.gap}>
          <AppText variant="heading">Set up your trade copier</AppText>
          <AppText variant="caption">Pick the account you trade (master) and the accounts that follow it, each with its own size multiplier and risk limits.</AppText>
          <Button label="Start setup" icon="git-network-outline" onPress={() => save(newCopyGroup(uuid(), at()))} />
        </Card>
      </>
    );
  }

  const master = group.masterAccountId ? byId.get(group.masterAccountId) : undefined;
  const linked = new Set(group.followers.map((f) => f.accountId));
  const candidates = accounts.filter((a) => a.id !== group.masterAccountId && !linked.has(a.id));
  const setMaster = (id: string) => {
    const followers = group.followers.filter((f) => f.accountId !== id);
    update({ ...group, masterAccountId: id, followers }, 'master', `Master set to ${byId.get(id)?.name ?? 'account'}.`);
  };
  const link = (id: string) => update({ ...group, followers: [...group.followers, defaultFollower(id)] }, 'linked', `${byId.get(id)?.name ?? 'Account'} linked as a follower (1×).`);
  const unlink = (id: string) => update({ ...group, followers: group.followers.filter((f) => f.accountId !== id) }, 'unlinked', `${byId.get(id)?.name ?? 'Account'} unlinked.`);
  const patch = (id: string, p: Partial<FollowerLink>, what: string) =>
    update({ ...group, followers: group.followers.map((f) => (f.accountId === id ? { ...f, ...p } : f)) }, 'settings', `${byId.get(id)?.name ?? 'Follower'}: ${what}.`);

  return (
    <>
      <DemoBanner />

      {/* Status + controls */}
      <Card style={styles.gap}>
        <View style={styles.rowBetween}>
          <AppText variant="heading">{group.name}</AppText>
          <StatusBadge label={STATE_LABEL[group.state]} tone={STATE_TONE[group.state]} icon={group.state === 'paused' ? 'pause' : group.state === 'stopped' ? 'stop' : 'construct-outline'} size="sm" />
        </View>
        <AppText variant="caption">
          {master ? `${master.name} → ${group.followers.filter((f) => f.enabled).length} follower${group.followers.filter((f) => f.enabled).length === 1 ? '' : 's'}` : 'No master account yet'}
        </AppText>
        <Button
          label="Start live copying"
          icon="play"
          disabled={!live?.ok}
          onPress={() => update(group, 'start_refused', 'Start refused: no supported broker connected.')}
          accessibilityHint={live?.reason}
        />
        {!live?.ok ? (
          <AppText variant="caption" tone="warning">
            {live?.reason}
          </AppText>
        ) : null}
        <View style={styles.row}>
          {group.state === 'paused' || group.state === 'stopped' ? (
            <Button label="Resume" icon="refresh" variant="secondary" size="md" style={styles.flex} onPress={() => save(transition(group, 'resume', at(), uuid()))} />
          ) : (
            <Button label="Pause" icon="pause" variant="secondary" size="md" style={styles.flex} onPress={() => save(transition(group, 'pause', at(), uuid()))} />
          )}
          <Button label="Stop copier" icon="stop" variant="secondary" size="md" style={styles.flex} disabled={group.state === 'stopped'} onPress={() => save(transition(group, 'stop', at(), uuid()))} />
        </View>
      </Card>

      {/* Master */}
      <SectionHeader title="1 · Master account" />
      <View style={styles.chips}>
        {accounts.map((a) => (
          <Chip key={a.id} label={a.name} icon={group.masterAccountId === a.id ? 'star' : 'briefcase-outline'} selected={group.masterAccountId === a.id} onPress={() => setMaster(a.id)} />
        ))}
      </View>

      {/* Followers */}
      <SectionHeader title="2 · Follower accounts" />
      {group.followers.map((f) => {
        const acc = byId.get(f.accountId);
        const conn = acc ? connectionStatus(acc, brokers) : null;
        return (
          <Card key={f.accountId} style={styles.gap}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {acc?.name ?? 'Missing account'}
                </AppText>
                {acc ? (
                  <AppText variant="caption" tone="tertiary" numberOfLines={2}>
                    Balance {money(acc.balance)} · {conn?.label}
                  </AppText>
                ) : null}
              </View>
              <Button label="Unlink" icon="unlink-outline" variant="ghost" size="md" onPress={() => unlink(f.accountId)} />
            </View>
            <View style={styles.row}>
              <View style={styles.flex}>
                <LimitField label={`Multiplier (≤${MAX_MULTIPLIER}×)`} value={f.multiplier} suffix="×" onCommit={(v) => v != null && patch(f.accountId, { multiplier: v }, `multiplier ${v}×`)} />
              </View>
              <View style={styles.flex}>
                <LimitField label="Max contracts" value={f.maxContracts} onCommit={(v) => patch(f.accountId, { maxContracts: v != null ? Math.floor(v) : null }, v != null ? `max ${Math.floor(v)} contracts` : 'no contract cap')} />
              </View>
            </View>
            <LimitField label="Daily loss limit for copies" value={f.dailyLossLimit} prefix="$" onCommit={(v) => patch(f.accountId, { dailyLossLimit: v }, v != null ? `daily loss limit ${money(v)}` : 'no copy loss limit')} />
            <ToggleRow label="Follow the master" value={f.enabled} onChange={(v) => patch(f.accountId, { enabled: v }, v ? 'enabled' : 'disabled')} />
          </Card>
        );
      })}
      {candidates.length ? (
        <View style={styles.gap}>
          <AppText variant="caption" tone="secondary">
            Link a follower:
          </AppText>
          <View style={styles.chips}>
            {candidates.map((a) => (
              <Chip key={a.id} label={a.name} icon="link-outline" onPress={() => link(a.id)} />
            ))}
          </View>
        </View>
      ) : null}
      {issues.map((i) => (
        <AppText key={i.message} variant="caption" tone="warning">
          • {i.message}
        </AppText>
      ))}

      {/* Connection status */}
      <SectionHeader title="3 · Connection & sync" />
      <Card style={styles.gap}>
        {[...(master ? [master] : []), ...group.followers.map((f) => byId.get(f.accountId)).filter((a): a is NonNullable<typeof a> => !!a)].map((a) => {
          const c = connectionStatus(a, brokers);
          return (
            <View key={a.id} style={styles.conn}>
              <Icon name={c.state === 'connected' ? 'cloud-done-outline' : 'cloud-offline-outline'} size={18} color={c.state === 'connected' ? colors.positive : colors.textTertiary} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {a.name}
                  {a.id === group.masterAccountId ? ' · master' : ''}
                </AppText>
                <AppText variant="caption" tone="tertiary">
                  {c.label} — {c.detail}
                </AppText>
              </View>
            </View>
          );
        })}
        <AppText variant="caption" tone="tertiary">
          Broker integrations (Tradovate, NinjaTrader, ProjectX, Rithmic) are not available yet. Nothing syncs or executes automatically.
        </AppText>
      </Card>

      <SectionHeader title="4 · Preview a master trade" />
      <PreviewCard group={group} guards={guards} onRecord={(detail) => update(group, 'preview', detail)} disabled={issues.length > 0} />

      <SectionHeader title="Activity" />
      <Card style={styles.gap}>
        {group.activity.slice(0, 15).map((e) => (
          <View key={e.id} style={styles.event}>
            <Icon name={EVENT_ICON[e.kind]} size={16} color={colors.textSecondary} />
            <View style={styles.flex}>
              <AppText variant="caption" tone="primary">
                {e.detail}
              </AppText>
              <AppText variant="caption" tone="tertiary" style={styles.small}>
                {new Date(e.at).toLocaleString()}
              </AppText>
            </View>
          </View>
        ))}
      </Card>
    </>
  );
}

function DemoBanner() {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Icon name="construct-outline" size={18} color={colors.warning} />
      <AppText variant="caption" style={[styles.flex, { color: colors.warning }]}>
        Setup & preview only — no broker is connected, so live trade copying is not available. Prop Guard never places trades.
      </AppText>
    </View>
  );
}

/** Numeric field that saves on blur / submit (empty = no limit). */
function LimitField({ label, value, onCommit, prefix, suffix }: { label: string; value: number | null; onCommit: (v: number | null) => void; prefix?: string; suffix?: string }) {
  const [text, setText] = useState(str(value));
  const commit = () => {
    const v = text.trim() ? parseNum(text) : null;
    if (text.trim() && (v == null || v <= 0)) return setText(str(value));
    if (v !== value) onCommit(v);
  };
  return <NumericInput label={label} value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} placeholder="No limit" prefix={prefix} suffix={suffix} />;
}

function PreviewCard({ group, guards, onRecord, disabled }: { group: CopyGroup; guards: Map<string, DailyGuard>; onRecord: (detail: string) => void; disabled: boolean }) {
  const accounts = useAppStore((s) => s.accounts);
  const markets = useAppStore((s) => s.preferences.markets);
  const [instrument, setInstrument] = useState(markets.find((m) => findInstrument(m)) ?? 'MNQ');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [contracts, setContracts] = useState('2');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const p = useMemo(
    () => previewCopy(group, { instrument, direction, contracts: parseNum(contracts) ?? 0, entry: parseNum(entry), stop: parseNum(stop) }, accounts, guards),
    [group, instrument, direction, contracts, entry, stop, accounts, guards],
  );
  const tone = { ok: colors.positive, reduced: colors.warning, blocked: colors.danger, review: colors.warning } as const;
  return (
    <Card style={styles.gap}>
      <AppText variant="caption">Enter a trade on the master — see what each follower would take within its own limits. Nothing is sent anywhere.</AppText>
      <View style={styles.chips}>
        {[...new Set([...markets, 'MNQ', 'MES', 'NQ', 'ES'])].filter((m) => findInstrument(m)).slice(0, 8).map((m) => (
          <Chip key={m} label={m} selected={instrument === m} onPress={() => setInstrument(m)} />
        ))}
      </View>
      <SegmentedControl options={[{ value: 'long', label: 'Long', tone: 'positive' }, { value: 'short', label: 'Short', tone: 'danger' }]} value={direction} onChange={setDirection} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Master size" value={contracts} onChangeText={setContracts} suffix="ct" />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Entry" value={entry} onChangeText={setEntry} placeholder="0.00" />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Stop" value={stop} onChangeText={setStop} placeholder="0.00" />
        </View>
      </View>
      {disabled || !p.ok ? (
        <AppText variant="caption" tone="warning">
          {p.error ?? 'Finish the setup above to preview.'}
        </AppText>
      ) : (
        <>
          {p.masterRisk != null ? (
            <AppText variant="caption" tone="secondary">
              Master risk: {money(p.masterRisk)}
            </AppText>
          ) : null}
          {p.rows.map((r) => (
            <View key={r.accountId} style={styles.previewRow}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {r.accountName}
                </AppText>
                <AppText variant="caption" tone="tertiary">
                  {r.reason}
                </AppText>
              </View>
              <AppText variant="number" style={{ color: tone[r.status] }}>
                {r.contracts}
              </AppText>
            </View>
          ))}
          {p.rows.length === 0 ? (
            <AppText variant="caption" tone="tertiary">
              No enabled followers.
            </AppText>
          ) : null}
          <Button label="Save preview to activity" icon="bookmark-outline" variant="secondary" size="md" onPress={() => onRecord(`Preview: ${contracts} ${instrument} ${direction} → ${p.rows.map((r) => `${r.accountName} ${r.contracts}`).join(', ') || 'no followers'}.`)} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.warning + '55' },
  conn: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
  event: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  small: { fontSize: 11 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});

