import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, DetailTable, EmptyState, Input, NumericInput, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { MODE_LABEL, VERDICT_UI } from '@/features/copyTrade/copyUi';
import { useTrade } from '@/hooks/useAppData';
import { copyOutcomeFor, copyResult, VERDICT_LABEL } from '@/lib/engines/copyTradeEngine';
import { formatPrice, isInstrumentSymbol } from '@/lib/engines/instrumentEngine';
import { useAppStore } from '@/store/useAppStore';
import { money, parseNum } from '@/utils/format';

/** One copied trade: details, source trader, screenshot, translated risk (as logged), result, lessons. */
export default function CopyTradeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const copy = useAppStore((s) => s.copyTrades.find((c) => c.id === id) ?? null);
  const update = useAppStore((s) => s.updateCopyTrade);
  const remove = useAppStore((s) => s.deleteCopyTrade);
  const trade = useTrade(copy?.tradeId);
  const [exit, setExit] = useState(copy?.outcome?.exitPrice != null ? String(copy.outcome.exitPrice) : '');
  const [lesson, setLesson] = useState(copy?.lesson ?? '');
  const [saved, setSaved] = useState(false);
  const result = useMemo(() => (copy ? copyResult(copy, new Map(trade ? [[trade.id, trade]] : [])) : null), [copy, trade]);

  if (!copy || !result) {
    return (
      <Screen header={<AppHeader title="Copy trade" back />}>
        <EmptyState illustration="copy" title="Copy not found" message="It may have been deleted." actionLabel="Back to Copy Trade" onAction={() => router.replace('/copy')} />
      </Screen>
    );
  }

  const px = (n: number | null) => (n == null ? '—' : isInstrumentSymbol(copy.instrument) ? formatPrice(copy.instrument, n) : String(n));
  const v = VERDICT_UI[copy.translation.verdict];
  const exitNum = parseNum(exit);
  const preview = copy.mode !== 'live' && exitNum != null ? copyOutcomeFor(copy, exitNum) : null;

  const saveOutcome = () => {
    const patch: Parameters<typeof update>[1] = { lesson: lesson.trim() };
    if (copy.mode !== 'live') patch.outcome = exitNum != null ? { exitPrice: exitNum, ...copyOutcomeFor(copy, exitNum), closedAt: new Date().toISOString() } : null;
    update(copy.id, patch);
    setSaved(true);
  };

  return (
    <Screen header={<AppHeader title={`${copy.instrument} ${copy.direction === 'long' ? 'Long' : 'Short'}`} subtitle={`Copied from ${copy.sourceTraderName}`} back />}>
      <Card accent={v.tone}>
        <View style={styles.head}>
          <StatusBadge label={VERDICT_LABEL[copy.translation.verdict]} tone={v.tone} icon={v.icon} />
          <StatusBadge label={MODE_LABEL[copy.mode]} tone={copy.mode === 'live' ? 'accent' : 'neutral'} size="sm" />
        </View>
        <View style={styles.result}>
          <AppText variant="caption" tone="tertiary">
            {copy.mode === 'live' ? 'Result (journal)' : 'Result at your size (hypothetical)'}
          </AppText>
          <AppText variant="display" style={{ color: result.pnl == null ? colors.textSecondary : result.pnl >= 0 ? colors.positive : colors.danger }}>
            {result.closed ? (result.pnl != null ? money(result.pnl, { sign: true }) : result.r != null ? `${result.r > 0 ? '+' : ''}${result.r.toFixed(2)}R` : '—') : 'Open'}
          </AppText>
          {result.closed && result.r != null ? (
            <AppText variant="bodyStrong" tone="secondary">
              {result.r > 0 ? '+' : ''}
              {result.r.toFixed(2)}R
            </AppText>
          ) : null}
        </View>
      </Card>

      <DetailTable
        rows={[
          { label: 'Source trader', value: copy.sourceTraderName, bold: true },
          { label: 'Entry / stop / target', value: `${px(copy.entry)} / ${px(copy.stop)} / ${px(copy.target)}` },
          { label: 'Their size', value: copy.sourceContracts != null ? `${copy.sourceContracts} ${copy.sourceInstrument ?? copy.instrument}` : '—' },
          { label: 'Your size', value: `${copy.contracts} ${copy.instrument}`, bold: true },
          { label: 'Estimated risk', value: money(copy.translation.riskDollars) },
          { label: 'Daily risk left (when logged)', value: money(copy.translation.dailyRiskRemaining) },
          { label: 'Setup', value: copy.setup || '—' },
          { label: 'Conviction', value: copy.conviction ?? '—' },
          { label: 'Logged', value: new Date(copy.at).toLocaleString() },
        ]}
      />

      {copy.translation.reasons.length ? (
        <Card>
          <AppText variant="label">Rule check when logged</AppText>
          {copy.translation.reasons.map((r) => (
            <AppText key={r} variant="caption" style={styles.mt}>
              • {r}
            </AppText>
          ))}
        </Card>
      ) : null}

      {copy.notes ? (
        <Card>
          <AppText variant="label">Notes</AppText>
          <AppText variant="body" style={styles.mt}>
            {copy.notes}
          </AppText>
        </Card>
      ) : null}
      {copy.screenshotUri ? <Image source={{ uri: copy.screenshotUri }} style={styles.shot} contentFit="contain" accessibilityLabel="Copy screenshot" /> : null}

      <SectionHeader title="Result & lessons" />
      {copy.mode === 'live' ? (
        trade ? (
          trade.status === 'open' ? (
            <Button label="Manage in live monitor" icon="pulse-outline" variant="secondary" onPress={() => router.push({ pathname: '/session/live', params: { id: trade.id } })} />
          ) : (
            <Button label="Open journal entry" icon="book-outline" variant="secondary" onPress={() => router.push({ pathname: '/journal/[id]', params: { id: trade.id } })} />
          )
        ) : (
          <AppText variant="caption" tone="tertiary">
            The journal trade for this copy was removed.
          </AppText>
        )
      ) : (
        <>
          <NumericInput label="Exit price (what happened)" value={exit} onChangeText={setExit} placeholder="e.g. where it hit target or stop" hint="Hypothetical — never counted as account P&L." />
          {preview?.r != null ? (
            <AppText variant="caption" tone="secondary">
              {preview.pnl != null ? `At ${copy.contracts} ${copy.instrument}: ${money(preview.pnl, { sign: true })} · ` : 'No size fit your limits — measured in R only: '}
              {preview.r.toFixed(2)}R
            </AppText>
          ) : null}
        </>
      )}
      <Input label="Lesson" value={lesson} onChangeText={setLesson} placeholder="What did copying this trade teach you?" multiline maxLength={1000} />
      <Button label={saved ? 'Saved' : 'Save'} icon="checkmark" onPress={saveOutcome} />
      <Button
        label="Delete from copy log"
        icon="trash-outline"
        variant="ghost"
        onPress={() => {
          remove(copy.id);
          router.replace('/copy');
        }}
      />
      {copy.mode === 'live' ? (
        <AppText variant="caption" tone="tertiary" align="center">
          Deleting the copy log keeps the journal trade.
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  result: { marginTop: spacing.md, gap: 2 },
  mt: { marginTop: spacing.xs },
  shot: { width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.surface },
});
