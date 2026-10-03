import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, FieldRow, LoadingState, Screen, StatusBadge, ToggleRow } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import { aiService, type AccountExtraction } from '@/services/ai';
import { pickScreenshot } from '@/services/screenshotService';
import { useAppStore } from '@/store/useAppStore';
import { numToInput, parseNum } from '@/utils/format';

const SUPPORTED = ['Account dashboard', 'Trade history', 'Positions / P&L'];

/** Import account values from a prop-firm dashboard screenshot (user must confirm). */
export default function ConnectScreenshot() {
  const demo = useAppStore((s) => s.mode === 'demo' || !s.user);
  const set = useOnboardingStore((s) => s.set);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'review'>('idle');
  const [uri, setUri] = useState<string | null>(null);
  const [x, setX] = useState<AccountExtraction | null>(null);
  const [balance, setBalance] = useState('');
  const [daily, setDaily] = useState('');
  const [total, setTotal] = useState('');
  const [dd, setDd] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (base64: string, imageUri: string | null) => {
    setUri(imageUri);
    setPhase('loading');
    const r = await aiService.analyzeAccountScreenshot({ imageBase64: base64, mimeType: 'image/jpeg', demo });
    setX(r);
    setBalance(numToInput(r.balance));
    setDaily(numToInput(r.dailyPnl));
    setTotal(numToInput(r.totalPnl));
    setDd(numToInput(r.drawdownRemaining));
    setPhase('review');
  };

  const pick = async () => {
    setError(null);
    const r = await pickScreenshot('library');
    if (r.status === 'ok') await run(r.image.base64, r.image.uri);
    else if (r.status === 'denied') setError('Photo access is required. Enable it in Settings.');
    else if (r.status === 'error') setError(r.message);
  };

  return (
    <Screen
      header={<AppHeader title="Import from screenshot" back />}
      footer={
        phase === 'review' ? (
          <Button
            label="Confirm & Import"
            disabled={!confirmed}
            onPress={() => {
              set({ imported: { balance: parseNum(balance), drawdownRemaining: parseNum(dd), accountType: x?.accountType ?? null } });
              router.back();
            }}
          />
        ) : undefined
      }>
      {phase === 'idle' ? (
        <>
          <AppText variant="body" tone="secondary">
            Upload a screenshot of your account dashboard or trade history.
          </AppText>
          <Card>
            <View style={styles.drop}>
              <Ionicons name="camera" size={34} color={colors.accentBright} />
              <AppText variant="heading">Tap to upload screenshot</AppText>
              <AppText variant="caption">or use a sample in demo mode</AppText>
            </View>
            <Button label="Upload screenshot" icon="images-outline" onPress={() => void pick()} />
            {demo ? <Button label="Use sample dashboard (demo)" variant="ghost" size="md" onPress={() => void run('', null)} /> : null}
            {error ? (
              <AppText variant="caption" tone="danger">
                {error}
              </AppText>
            ) : null}
          </Card>
          <AppText variant="label">Supported screenshots</AppText>
          <View style={styles.tags}>
            {SUPPORTED.map((s) => (
              <StatusBadge key={s} label={s} tone="neutral" size="sm" />
            ))}
          </View>
        </>
      ) : null}
      {phase === 'loading' ? <LoadingState label="Reading balance, P&L and drawdown…" /> : null}
      {phase === 'review' && x ? (
        <>
          {uri ? <Image source={{ uri }} style={styles.preview} contentFit="contain" /> : null}
          <Card tone={x.confidence === 'low' ? 'warning' : 'accent'}>
            <StatusBadge label={`${x.confidence} confidence`} tone={x.confidence === 'low' ? 'warning' : 'accent'} icon="scan" size="sm" />
            <AppText variant="caption" style={{ marginTop: spacing.sm }}>
              {x.notes}
            </AppText>
          </Card>
          <Card>
            <AppText variant="label" style={{ marginBottom: spacing.xs }}>
              Extracted information — edit anything that is wrong
            </AppText>
            <FieldRow label="Account balance" prefix="$" value={balance} onChangeText={(t) => { setBalance(t); setConfirmed(false); }} />
            <FieldRow label="Daily P&L" prefix="$" value={daily} onChangeText={(t) => { setDaily(t); setConfirmed(false); }} />
            <FieldRow label="Total P&L" prefix="$" value={total} onChangeText={(t) => { setTotal(t); setConfirmed(false); }} />
            <FieldRow label="Drawdown remaining" prefix="$" value={dd} onChangeText={(t) => { setDd(t); setConfirmed(false); }} />
            {x.accountType ? (
              <AppText variant="caption" style={{ marginTop: spacing.sm }}>
                Account type: {x.accountType}
              </AppText>
            ) : null}
            <ToggleRow label="These values match my dashboard" value={confirmed} onChange={setConfirmed} />
          </Card>
          <Button label="Retake screenshot" variant="ghost" onPress={() => setPhase('idle')} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  drop: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent + '88', borderRadius: radius.md, marginBottom: spacing.lg, backgroundColor: '#0B1730' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preview: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.surface },
});
