import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { Evidence, SetupEvaluation, SetupRule, Status } from '@/lib/engines/setupCheck';

const CHOICES: { status: Status; label: string; color: string }[] = [
  { status: 'PASS', label: '✓ Met', color: colors.positive },
  { status: 'FAIL', label: '✕ Not met', color: colors.danger },
  { status: 'UNVERIFIED', label: '? Can’t tell', color: colors.warning },
];

/** Tri-state chips — nothing is pre-selected; tapping the selected chip clears it. */
export function ConfirmChips({ value, onChange, label }: { value: Status | undefined; onChange: (s: Status | null) => void; label: string }) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {CHOICES.map((c) => {
        const on = value === c.status;
        return (
          <Pressable
            key={c.status}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${label}: ${c.label}`}
            onPress={() => onChange(on ? null : c.status)}
            style={[styles.chip, on && { borderColor: c.color, backgroundColor: c.color + '22' }]}>
            <AppText variant="caption" style={{ color: on ? c.color : colors.textSecondary, fontWeight: '700' }}>
              {c.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const SOURCE: Record<string, string> = { vision: 'Chart analysis', demo: 'DEMO — simulated, ignored' };

/** The saved strategy's rules: chart evidence (if any) plus the trader's explicit confirmation. */
export function RuleConfirmations({ rules, manual, chartEvidence, evaluation, onChange }: { rules: SetupRule[]; manual: Record<string, Status>; chartEvidence: Record<string, Evidence>; evaluation: SetupEvaluation | null; onChange: (ruleId: string, s: Status | null) => void }) {
  return (
    <Card>
      <AppText variant="label">Your saved rules</AppText>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Confirm each rule from what you can see. Nothing is pre-ticked — a rule you don’t confirm stays UNVERIFIED. Your confirmation replaces the chart reading for that rule.
      </AppText>
      {rules.map((r) => {
        const ev = chartEvidence[r.id];
        const computed = r.kind !== 'visual' ? evaluation?.evaluatedRules.find((x) => x.id === r.id) : undefined;
        return (
          <View key={r.id} style={styles.rule}>
            <View style={styles.row}>
              <AppText variant="bodyStrong" style={styles.flex}>
                {r.label}
              </AppText>
              <StatusBadge label={r.critical ? 'Critical' : r.required ? 'Required' : 'Optional'} tone={r.critical ? 'danger' : 'neutral'} size="sm" />
            </View>
            {r.description !== r.label ? (
              <AppText variant="caption" style={{ marginTop: 2 }}>
                {r.description}
              </AppText>
            ) : null}
            {r.kind !== 'visual' ? (
              <AppText variant="caption" tone={computed?.status === 'PASS' ? 'positive' : computed?.status === 'FAIL' ? 'danger' : 'warning'} style={{ marginTop: 4 }}>
                {r.kind === 'icc' ? 'From the ICC stages' : 'Checked by Prop Guard'}: {computed ? `${computed.status} — ${computed.reason}` : 'pending'}
              </AppText>
            ) : (
              <>
                {ev ? (
                  <AppText variant="caption" tone={ev.source === 'demo' ? 'warning' : 'secondary'} style={{ marginTop: 4 }}>
                    {SOURCE[ev.source] ?? ev.source}: {ev.status} ({Math.round(ev.confidence * 100)}%) — {ev.reason}
                  </AppText>
                ) : null}
                <ConfirmChips value={manual[r.id]} onChange={(s) => onChange(r.id, s)} label={r.label} />
              </>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  rule: { paddingTop: spacing.md, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
