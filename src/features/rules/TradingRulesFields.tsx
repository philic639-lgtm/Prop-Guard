import { StyleSheet, View } from 'react-native';

import { Card, Divider, NumericInput, ToggleRow } from '@/components/ui';
import { spacing } from '@/constants/theme';
import type { TradingRules } from '@/types/domain';
import { parseNum } from '@/utils/format';

export interface RulesDraft {
  maxRiskPerTrade: string;
  maxTradesPerDay: string;
  dailyStop: string;
  cooldownMinutes: string;
  maxConsecutiveLosses: string;
  noRevengeTrades: boolean;
  requireStop: boolean;
  requireTarget: boolean;
  allowCooldownOverride: boolean;
  allowStopWidening: boolean;
}

export function rulesToDraft(r: TradingRules): RulesDraft {
  return {
    maxRiskPerTrade: String(r.maxRiskPerTrade),
    maxTradesPerDay: String(r.maxTradesPerDay),
    dailyStop: String(r.dailyStop),
    cooldownMinutes: String(r.cooldownMinutes),
    maxConsecutiveLosses: String(r.maxConsecutiveLosses),
    noRevengeTrades: r.noRevengeTrades,
    requireStop: r.requireStop,
    requireTarget: r.requireTarget,
    allowCooldownOverride: r.allowCooldownOverride,
    allowStopWidening: r.allowStopWidening,
  };
}

/** Returns parsed rules or a list of validation errors. */
export function draftToRules(d: RulesDraft): { rules: TradingRules | null; errors: Partial<Record<keyof RulesDraft, string>> } {
  const errors: Partial<Record<keyof RulesDraft, string>> = {};
  const pos = (k: keyof RulesDraft, int = false, allowZero = false) => {
    const v = parseNum(d[k] as string);
    if (v == null || v < 0 || (!allowZero && v === 0) || (int && !Number.isInteger(v))) {
      errors[k] = int ? 'Whole number required' : 'Enter a positive amount';
      return 0;
    }
    return v;
  };
  const rules: TradingRules = {
    maxRiskPerTrade: pos('maxRiskPerTrade'),
    maxTradesPerDay: pos('maxTradesPerDay', true),
    dailyStop: pos('dailyStop'),
    cooldownMinutes: pos('cooldownMinutes', true, true),
    maxConsecutiveLosses: pos('maxConsecutiveLosses', true),
    noRevengeTrades: d.noRevengeTrades,
    requireStop: true,
    requireTarget: d.requireTarget,
    allowCooldownOverride: d.allowCooldownOverride,
    allowStopWidening: d.allowStopWidening,
  };
  if (!errors.maxRiskPerTrade && !errors.dailyStop && rules.maxRiskPerTrade > rules.dailyStop) {
    errors.maxRiskPerTrade = 'Cannot exceed your daily stop';
  }
  return { rules: Object.keys(errors).length ? null : rules, errors };
}

export function TradingRulesFields({
  draft,
  onChange,
  errors = {},
}: {
  draft: RulesDraft;
  onChange: (d: RulesDraft) => void;
  errors?: Partial<Record<keyof RulesDraft, string>>;
}) {
  const set = <K extends keyof RulesDraft>(k: K, v: RulesDraft[K]) => onChange({ ...draft, [k]: v });
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Max risk per trade" prefix="$" value={draft.maxRiskPerTrade} onChangeText={(t) => set('maxRiskPerTrade', t)} error={errors.maxRiskPerTrade} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Max trades / day" value={draft.maxTradesPerDay} onChangeText={(t) => set('maxTradesPerDay', t)} keyboardType="number-pad" error={errors.maxTradesPerDay} />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Daily stop" prefix="-$" value={draft.dailyStop} onChangeText={(t) => set('dailyStop', t)} error={errors.dailyStop} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Stop after losses" suffix="in a row" value={draft.maxConsecutiveLosses} onChangeText={(t) => set('maxConsecutiveLosses', t)} keyboardType="number-pad" error={errors.maxConsecutiveLosses} />
        </View>
      </View>
      <Card>
        <ToggleRow label="No revenge trades" description="Lock new trades during a cooldown after each loss." value={draft.noRevengeTrades} onChange={(v) => set('noRevengeTrades', v)} />
        {draft.noRevengeTrades ? (
          <View style={{ paddingBottom: spacing.sm }}>
            <NumericInput label="Cooldown after loss" suffix="minutes" value={draft.cooldownMinutes} onChangeText={(t) => set('cooldownMinutes', t)} keyboardType="number-pad" error={errors.cooldownMinutes} />
          </View>
        ) : null}
        <Divider />
        <ToggleRow label="Allow cooldown override" description="Overrides are always recorded." value={draft.allowCooldownOverride} onChange={(v) => set('allowCooldownOverride', v)} />
        <Divider />
        <ToggleRow label="Require stop before entry" description="Always on — every trade needs a stop." value disabled onChange={() => undefined} />
        <Divider />
        <ToggleRow label="Require target before entry" value={draft.requireTarget} onChange={(v) => set('requireTarget', v)} />
        <Divider />
        <ToggleRow label="Allow widening stops" description="Off is strongly recommended." value={draft.allowStopWidening} onChange={(v) => set('allowStopWidening', v)} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
