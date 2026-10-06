import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, ErrorState, HeaderIconButton, Input, LoadingState, NumericInput, Screen, SegmentedControl, SelectField, StatusBadge, ToggleRow } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { newDraft } from '@/features/session/draft';
import { IccSetupCard, IccStagePanel } from '@/features/setupCheck/IccPanels';
import { ConfirmChips, RuleConfirmations } from '@/features/setupCheck/RuleConfirmations';
import { SAMPLE_CHART_JPEG_BASE64 } from '@/features/setupCheck/sampleChart';
import { SetupCheckResult } from '@/features/setupCheck/SetupCheckResult';
import { toSetupCheck } from '@/features/setupCheck/toSetupCheck';
import { useSetupCheck } from '@/features/setupCheck/useSetupCheck';
import { useActiveAccount, useActiveStrategy } from '@/hooks/useAppData';
import { instrumentOptions } from '@/lib/engines';
import { contentHash } from '@/lib/engines/setupCheck';
import { pickScreenshot } from '@/services/screenshotService';
import { validateImage } from '@/services/setupCheck/imageValidation';
import { firmRestrictions } from '@/services/setupCheck/localContext';
import { useAppStore } from '@/store/useAppStore';
import { numToInput, parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';

const TIMEFRAMES = ['1m', '2m', '3m', '5m', '15m', '30m', '1h', '4h', 'D'] as const;

/**
 * Setup Check: does this setup satisfy MY saved rules and risk limits right
 * now? Every result comes from the deterministic engine — on Prop Guard's
 * server when signed in with chart analysis configured, otherwise on this
 * device (demo / manual-only). The AI only reports chart evidence.
 */
export default function SetupCheckScreen() {
  const params = useLocalSearchParams<{ strategyId?: string }>();
  const strategies = useAppStore((s) => s.strategies);
  const accounts = useAppStore((s) => s.accounts);
  const markets = useAppStore((s) => s.preferences.markets);
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const saveSetupCheck = useAppStore((s) => s.saveSetupCheck);
  const setDraft = useAppStore((s) => s.setDraft);
  const activeAccount = useActiveAccount();
  const activeStrategy = useActiveStrategy();
  const firstStrategy = strategies.find((s) => s.id === params.strategyId) ?? activeStrategy;

  const { controller, state, view, mode } = useSetupCheck({
    strategyId: firstStrategy?.id ?? null,
    accountId: activeAccount?.id ?? null,
    instrument: firstStrategy?.markets[0] ?? defaultInstrument,
    side: null,
    entry: null,
    stop: null,
    target: null,
    target2: null,
    quantity: null,
    costs: null,
    slippage: null,
    reserve: null,
    noDailyLimitConfirmed: false,
    timeframe: null,
    notes: '',
  });
  const form = state.form;
  const strategy = strategies.find((s) => s.id === form.strategyId) ?? null;
  const account = accounts.find((a) => a.id === form.accountId) ?? null;
  const restrictions = useMemo(() => firmRestrictions(account), [account]);

  // Text fields keep what the trader typed; the controller gets parsed numbers.
  const [text, setText] = useState({ entry: '', stop: '', target: '', target2: '', quantity: '', costs: '', slippage: '', reserve: '' });
  const setNum = (k: keyof typeof text) => (t: string) => {
    setText((cur) => ({ ...cur, [k]: t }));
    controller.setForm({ [k]: parseNum(t) } as Partial<typeof form>);
  };
  const isIcc = view.rules.some((r) => r.kind === 'icc');
  // ICC: chart-read levels are only applied when the trader taps "Use these levels".
  const useChartLevels = () => {
    const lv = view.icc?.chartLevels;
    if (!lv) return;
    const patch = { entry: lv.entry, stop: lv.stop, target: lv.tp1, target2: lv.tp2 };
    setText((cur) => ({ ...cur, entry: numToInput(patch.entry), stop: numToInput(patch.stop), target: numToInput(patch.target), target2: numToInput(patch.target2) }));
    controller.setForm(patch);
  };
  const [pickError, setPickError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const strategyOptions = useMemo(() => strategies.map((s) => ({ value: s.id, label: s.name, sub: `${s.markets.join(', ') || 'Any market'} · ${s.timeframe}` })), [strategies]);
  const accountOptions = useMemo(() => accounts.map((a) => ({ value: a.id, label: a.name, sub: `${a.kind === 'prop' ? a.firm || 'Prop' : 'Personal'} · ${a.firmLink?.status === 'verified' ? 'verified firm rules' : 'firm rules not verified'}` })), [accounts]);
  const instruments = useMemo(() => instrumentOptions([...(strategy?.markets ?? []), ...markets]), [strategy, markets]);

  if (!strategies.length) {
    return (
      <Screen header={<AppHeader title="Setup check" back />}>
        <EmptyState icon="list-outline" title="Save a strategy first" message="Setup Check compares a setup with YOUR saved rules, so it needs at least one strategy." actionLabel="Add a strategy" onAction={() => router.push('/strategy')} />
      </Screen>
    );
  }

  const pick = async (source: 'library' | 'camera') => {
    setPickError(null);
    const r = await pickScreenshot(source);
    if (r.status === 'ok') {
      const check = validateImage({ base64: r.image.base64, mimeType: r.image.mimeType });
      if (!check.ok) return setPickError('That file isn’t a supported chart image (JPEG, PNG or WebP up to 10 MB).');
      controller.setScreenshot({ base64: r.image.base64, mimeType: r.image.mimeType, uri: r.image.uri, hash: contentHash(r.image.base64) });
    } else if (r.status === 'denied') setPickError(source === 'camera' ? 'Camera access was denied. Allow it in Settings or upload a screenshot instead.' : 'Photo access was denied. Allow it in Settings to upload a chart.');
    else if (r.status === 'error') setPickError('That image could not be opened. Try another screenshot.');
  };

  const evaluation = view.evaluation;
  const save = () => {
    if (!evaluation || !strategy || !view.evaluatedBy || view.pending) return;
    const check = toSetupCheck({
      id: uuid(),
      now: new Date().toISOString(),
      evaluation,
      evaluatedBy: view.evaluatedBy,
      form,
      strategyName: strategy.name,
      strategyVersion: strategy.updatedAt,
      analysisId: view.analysis?.analysisId ?? null,
      analysisKey: view.key,
      screenshotUri: state.screenshot?.uri ?? null,
      icc: view.icc,
    });
    saveSetupCheck(check);
    setSaved(check.id);
  };

  const planInCheckTrade = () => {
    if (!strategy) return;
    let id = saved;
    if (!id) {
      save();
      id = useAppStore.getState().setupChecks[0]?.id ?? null;
    }
    const d = newDraft(strategy, form.instrument);
    setDraft({
      ...d,
      direction: form.side === 'SHORT' ? 'short' : 'long',
      entry: numToInput(form.entry),
      stop: numToInput(form.stop),
      target: numToInput(form.target),
      contracts: form.quantity ? String(form.quantity) : d.contracts,
      screenshotUri: state.screenshot?.uri ?? null,
      notes: form.notes,
      setupCheckId: id,
    });
    router.push('/analyze');
  };

  const modeBadge =
    mode === 'REMOTE'
      ? { label: 'Chart analysis by Prop Guard server', tone: 'accent' as const, icon: 'cloud-done-outline' as const }
      : mode === 'DEMO'
        ? { label: 'DEMO — chart reading is simulated and never counts', tone: 'warning' as const, icon: 'flask-outline' as const }
        : { label: 'Chart analysis unavailable — confirm rules manually', tone: 'warning' as const, icon: 'eye-off-outline' as const };

  return (
    <Screen
      header={<AppHeader title="Setup check" subtitle="Your saved rules · your risk limits" back right={<HeaderIconButton icon="time-outline" label="Saved setup checks" onPress={() => router.push('/setup-check/history')} />} />}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button label={saved ? 'Setup check saved' : 'Save Setup Check'} icon={saved ? 'checkmark' : 'bookmark-outline'} disabled={!!saved || !evaluation || view.pending} onPress={save} />
          <Button label="Plan in Check Trade" icon="shield-checkmark-outline" variant="secondary" size="md" disabled={!evaluation} onPress={planInCheckTrade} />
        </View>
      }>
      <Card>
        <AppText variant="body">
          Prop Guard checks whether this setup satisfies <AppText variant="bodyStrong">your saved rules</AppText> and risk limits — 🟢 QUALIFIED only when every required rule and risk check is confirmed. It never predicts a winner.
        </AppText>
        <View style={{ marginTop: spacing.sm, alignItems: 'flex-start' }}>
          <StatusBadge label={modeBadge.label} tone={modeBadge.tone} icon={modeBadge.icon} size="sm" />
        </View>
      </Card>

      <SelectField
        label="Strategy"
        value={form.strategyId}
        options={strategyOptions}
        onChange={(id) => {
          const s = strategies.find((x) => x.id === id);
          controller.setForm({ strategyId: id, ...(s?.markets[0] ? { instrument: s.markets[0] } : {}) });
          setSaved(null);
        }}
        placeholder="Choose a saved strategy"
        icon="list-outline"
      />
      <SelectField label="Instrument" value={form.instrument} options={instruments} onChange={(v) => { controller.setForm({ instrument: v }); setSaved(null); }} icon="stats-chart-outline" />
      {accounts.length ? <SelectField label="Account" value={form.accountId} options={accountOptions} onChange={(v) => { controller.setForm({ accountId: v }); setSaved(null); }} icon="briefcase-outline" /> : null}

      <Card>
        <AppText variant="label">Chart screenshot</AppText>
        {state.screenshot ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <Image source={{ uri: state.screenshot.uri ?? `data:${state.screenshot.mimeType};base64,${state.screenshot.base64}` }} style={styles.preview} contentFit="contain" accessibilityLabel="Selected chart screenshot" />
            {state.screenshot.sample ? <StatusBadge label="Sample chart — not market data" tone="warning" size="sm" /> : null}
            {mode !== 'MANUAL' ? (
              <Button
                label={view.analysis ? 'Chart analysed ✓ — re-run' : mode === 'DEMO' ? 'Run demo chart reading' : 'Analyze chart'}
                icon="scan-outline"
                size="md"
                disabled={state.analyzing}
                onPress={() => void controller.analyze()}
              />
            ) : (
              <AppText variant="caption" tone="warning">
                Chart analysis isn’t available here — the screenshot is kept for your journal, and each rule needs your confirmation below.
              </AppText>
            )}
            <Button label="Replace screenshot" icon="images-outline" variant="ghost" size="md" onPress={() => void pick('library')} />
          </View>
        ) : (
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={styles.row}>
              <Button label="Upload" icon="images-outline" variant="secondary" size="md" style={styles.flex} onPress={() => void pick('library')} />
              <Button label="Camera" icon="camera-outline" variant="secondary" size="md" style={styles.flex} onPress={() => void pick('camera')} />
            </View>
            {mode === 'DEMO' ? <Button label="Use a sample chart (demo)" variant="ghost" size="md" onPress={() => controller.setScreenshot({ base64: SAMPLE_CHART_JPEG_BASE64, mimeType: 'image/jpeg', uri: null, hash: contentHash(SAMPLE_CHART_JPEG_BASE64), sample: true })} /> : null}
            <AppText variant="caption">JPEG, PNG or WebP up to 10 MB. Changing the screenshot, strategy, instrument, account, prices or size invalidates the previous analysis.</AppText>
          </View>
        )}
        {state.analyzing ? <LoadingState label="Reading the chart against your saved rules…" /> : null}
        {state.analysisError ? <ErrorState message={state.analysisError.message} onRetry={state.analysisError.retry ? () => void controller.analyze() : undefined} /> : null}
        {pickError ? (
          <AppText variant="caption" tone="danger" style={{ marginTop: spacing.xs }}>
            {pickError}
          </AppText>
        ) : null}
      </Card>

      <AppText variant="label">Trade</AppText>
      <SegmentedControl
        label="Direction"
        options={[
          { value: 'LONG', label: 'Long' },
          { value: 'SHORT', label: 'Short' },
          { value: 'UNSURE', label: 'Unsure' },
        ]}
        value={form.side ?? 'UNSURE'}
        onChange={(v) => controller.setForm({ side: v === 'UNSURE' ? null : (v as 'LONG' | 'SHORT') })}
      />
      <SelectField label="Timeframe" value={form.timeframe} options={TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => controller.setForm({ timeframe: v })} placeholder="Not specified" icon="time-outline" />
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Entry" value={text.entry} onChangeText={setNum('entry')} placeholder="—" />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Stop" value={text.stop} onChangeText={setNum('stop')} placeholder="—" />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label={isIcc ? 'TP1' : 'Target'} value={text.target} onChangeText={setNum('target')} placeholder="—" />
        </View>
        {isIcc ? (
          <View style={styles.flex}>
            <NumericInput label="TP2 (optional)" value={text.target2} onChangeText={setNum('target2')} placeholder="—" hint="R:R only" />
          </View>
        ) : (
          <View style={styles.flex}>
            <NumericInput label="Contracts" value={text.quantity} onChangeText={setNum('quantity')} placeholder="Whole number" />
          </View>
        )}
      </View>
      {isIcc ? <NumericInput label="Contracts" value={text.quantity} onChangeText={setNum('quantity')} placeholder="Whole number" /> : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Fees ($)" value={text.costs} onChangeText={setNum('costs')} placeholder="0 allowed" hint="Whole position" />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Slippage ($)" value={text.slippage} onChangeText={setNum('slippage')} placeholder="0 allowed" hint="Whole position" />
        </View>
      </View>
      <Input label="Notes" value={form.notes} onChangeText={(t) => controller.setForm({ notes: t })} placeholder="e.g. 1H trend is up" multiline maxLength={240} />

      {isIcc ? <IccStagePanel manual={state.icc} onChange={(k, v) => controller.setIcc(k, v)} icc={view.icc} onUseLevels={useChartLevels} /> : null}

      {view.rules.length ? <RuleConfirmations rules={view.rules} manual={state.manual} chartEvidence={view.chartEvidence} evaluation={evaluation} onChange={(id, s) => controller.setManual(id, s)} /> : null}

      {account?.kind === 'prop' ? (
        <Card>
          <AppText variant="label">Account & firm rules</AppText>
          <AppText variant="caption" style={{ marginTop: 2 }}>
            Buffers are computed from {account.name}’s balance, its drawdown rules, today’s realized P&L and open positions (at their stops). Firm rules count only when verified and current.
          </AppText>
          <View style={{ marginTop: spacing.sm }}>
            <NumericInput label="Reserve ($)" value={text.reserve} onChangeText={setNum('reserve')} placeholder="0 allowed" hint="Dollars to keep above your limits" />
          </View>
          {account.rules.dailyLossLimit == null ? (
            <View style={{ marginTop: spacing.sm }}>
              <ToggleRow label="This account has no daily loss limit" description="Only if your firm’s current terms for this exact account have none." value={form.noDailyLimitConfirmed} onChange={(v: boolean) => controller.setForm({ noDailyLimitConfirmed: v })} />
            </View>
          ) : null}
          <AppText variant="label" style={{ marginTop: spacing.md }}>
            Other firm restrictions
          </AppText>
          {restrictions.map((r) => (
            <View key={r.id} style={styles.restriction}>
              <View style={styles.row}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  {r.label}
                </AppText>
                {r.status === 'needs_review' ? <StatusBadge label="Needs review" tone="warning" size="sm" /> : null}
              </View>
              <AppText variant="caption">{r.detail}</AppText>
              <ConfirmChips value={state.firm[r.id]} onChange={(s) => controller.setFirm(r.id, s)} label={r.label} />
            </View>
          ))}
        </Card>
      ) : null}

      {state.evaluationError ? <ErrorState message={state.evaluationError.message} onRetry={state.evaluationError.retry ? () => void controller.refresh() : undefined} /> : null}
      {evaluation && strategy && view.icc ? <IccSetupCard icc={view.icc} decision={evaluation.decision} riskCheck={evaluation.riskCheck} propCompliance={evaluation.propFirmCompliance} screenshotUri={state.screenshot?.uri ?? (state.screenshot ? `data:${state.screenshot.mimeType};base64,${state.screenshot.base64}` : null)} /> : null}
      {evaluation && strategy ? (
        <SetupCheckResult
          result={evaluation}
          pending={view.pending || state.evaluating}
          meta={{ strategyName: strategy.name, instrument: form.instrument, timeframe: form.timeframe, direction: form.side === 'LONG' ? 'Long' : form.side === 'SHORT' ? 'Short' : 'Direction not chosen', evaluatedBy: view.evaluatedBy }}
          screenshotUri={state.screenshot?.uri ?? null}
        />
      ) : mode === 'REMOTE' && strategy ? (
        <LoadingState label="Checking with Prop Guard…" />
      ) : null}
      <View style={styles.hint}>
        <Ionicons name="lock-closed-outline" size={14} color={colors.textTertiary} />
        <AppText variant="caption" tone="tertiary" style={styles.flex}>
          {mode === 'REMOTE' ? 'Screenshots are analysed on Prop Guard’s server and treated as chart content only — text inside an image is never followed as an instruction.' : mode === 'DEMO' ? 'Demo mode: the chart is not read — simulated observations are shown for illustration and never count.' : 'No chart analysis is configured: the screenshot is stored with your check and every rule is confirmed by you.'}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  preview: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.surface },
  hint: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  restriction: { paddingTop: spacing.md, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 2 },
});
