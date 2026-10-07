import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, CircularScore, DetailTable, RuleChecklist, StatusBadge, VerdictBanner, type ChecklistRow, type DetailRow } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { CATEGORY_LABEL, type ConditionState, type SetupDecision, type SetupDisplayStatus } from '@/lib/engines/setupCheck';
import { money, price, rr } from '@/utils/format';

/**
 * The Setup Check result, in priority order:
 * 1 decision · 2 strategy + match · 3 action · 4 checklist · 5 levels & risk ·
 * 6 prop-firm checks · 7 why (collapsible) — journal actions live in the screen footer.
 * Everything shown comes from the deterministic decision (decision.ts).
 */

export const STATUS_UI: Record<SetupDisplayStatus, { title: string; tone: 'positive' | 'warning' | 'danger'; icon: keyof typeof Ionicons.glyphMap; badge?: string }> = {
  QUALIFIED: { title: 'QUALIFIED', tone: 'positive', icon: 'shield-checkmark' },
  WAIT: { title: 'WAIT', tone: 'warning', icon: 'hourglass-outline' },
  STAND_DOWN: { title: 'STAND DOWN', tone: 'danger', icon: 'hand-left' },
  BLOCKED: { title: 'BLOCKED', tone: 'danger', icon: 'lock-closed' },
};

const ROW_STATE: Record<ConditionState, ChecklistRow['state']> = { matched: 'pass', failed: 'fail', pending: 'pending' };
const STATUS_TONE = { PASS: 'positive', FAIL: 'danger', UNVERIFIED: 'warning' } as const;

function Collapsible({ title, children, initiallyOpen = false }: { title: string; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <Card>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title} style={styles.head}>
        <AppText variant="label" style={styles.flex}>
          {title}
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </Pressable>
      {open ? <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>{children}</View> : null}
    </Card>
  );
}

function Bullets({ title, items, icon, color }: { title: string; items: string[]; icon: string; color: string }) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: spacing.sm }}>
      <AppText variant="caption" style={{ fontWeight: '700' }}>
        {title}
      </AppText>
      {items.map((t, i) => (
        <AppText key={`${t}${i}`} variant="body" style={{ marginTop: 2 }}>
          <AppText variant="body" style={{ color }}>
            {icon}{' '}
          </AppText>
          {t}
        </AppText>
      ))}
    </View>
  );
}

export function SetupDecisionCard({
  decision: d,
  instrument,
  direction,
  pending,
  demo,
  details,
}: {
  decision: SetupDecision;
  instrument: string;
  direction: 'LONG' | 'SHORT' | null;
  /** The shown result is older than the current inputs (server re-checking). */
  pending?: boolean;
  demo?: boolean;
  /** Optional extra detail (e.g. the ICC breakdown), shown collapsed. */
  details?: ReactNode;
}) {
  const ui = STATUS_UI[d.displayStatus];
  const r = d.risk;
  const conditions = d.checklist.map((c) => ({ id: c.id, label: c.label, state: ROW_STATE[c.state] }));
  const done = conditions.filter((c) => c.state === 'pass');
  const todo = conditions.filter((c) => c.state === 'pending');
  const failed = conditions.filter((c) => c.state === 'fail');

  const levels: DetailRow[] = [
    { label: 'Direction', value: direction === 'LONG' ? 'Long' : direction === 'SHORT' ? 'Short' : 'Not chosen', tone: direction === 'LONG' ? 'positive' : direction === 'SHORT' ? 'danger' : 'warning' },
    { label: 'Entry', value: price(d.levels.entry, instrument) },
    ...(d.levels.invalidation != null ? [{ label: 'Invalidation', value: price(d.levels.invalidation, instrument) }] : []),
    { label: 'Stop', value: `${price(d.levels.stop, instrument)}${r.pointRisk != null ? ` (${Number(r.pointRisk.toFixed(4))} pts)` : ''}` },
    { label: 'Target 1', value: price(d.levels.tp1, instrument) },
    ...(d.levels.tp2 != null ? [{ label: 'Target 2', value: price(d.levels.tp2, instrument) }] : []),
    { label: 'Risk', value: money(r.dollarRisk, { cents: true }), tone: r.riskCapExceeded ? 'danger' : 'primary' },
    { label: 'Reward', value: money(r.reward, { cents: true }), tone: r.reward != null && r.reward > 0 ? 'positive' : 'primary' },
    { label: 'R:R', value: rr(r.rr), tone: r.rrBelowMinimum ? 'danger' : 'primary' },
    { label: 'Contracts', value: r.contracts != null ? String(r.contracts) : '—', tone: r.contractsExceeded ? 'danger' : 'primary' },
    { label: 'Risk per contract', value: money(r.riskPerContract, { cents: true }) },
    ...(r.maxAllowedContracts != null ? [{ label: 'Max contracts that fit', value: String(r.maxAllowedContracts), tone: r.contracts != null && r.contracts > r.maxAllowedContracts ? ('danger' as const) : ('primary' as const) }] : []),
    ...(r.maxRisk != null ? [{ label: 'Your max risk', value: money(r.maxRisk) }] : []),
  ];

  return (
    <View style={{ gap: spacing.md }} accessibilityLabel="Setup check result">
      {/* 1 — decision */}
      <Card tone={d.displayStatus === 'BLOCKED' ? 'danger' : undefined}>
        <View style={styles.head}>
          <AppText variant="label" style={styles.flex}>
            Setup status
          </AppText>
          {pending ? <StatusBadge label="Re-checking…" tone="neutral" size="sm" /> : null}
          {demo ? <StatusBadge label="DEMO" tone="warning" size="sm" /> : null}
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <VerdictBanner tone={ui.tone} title={ui.title} subtitle={d.statusNote ? `${d.statusNote} — ${d.headline}` : d.headline} icon={ui.icon} badge={ui.badge} />
        </View>

        {/* 2 — strategy + match */}
        <View style={[styles.head, { marginTop: spacing.md, gap: spacing.md }]}>
          <CircularScore value={d.match.score} tone={d.match.score >= 80 ? 'positive' : d.match.score >= 50 ? 'warning' : 'danger'} size={84} label="match" suffix="%" />
          <View style={styles.flex}>
            <AppText variant="caption">Strategy</AppText>
            <AppText variant="bodyStrong">{d.strategyName}</AppText>
            <AppText variant="caption" style={{ marginTop: 4 }}>
              Setup match {d.match.score}% · {d.match.matched.length}/{d.match.conditions.length} conditions
            </AppText>
            <AppText variant="caption">
              {d.icc ? 'ICC stage' : 'Strategy stage'}: <AppText variant="caption" style={{ fontWeight: '700', color: colors.text }}>{d.stage.label}</AppText>
            </AppText>
          </View>
        </View>
        {d.icc ? (
          <View style={styles.rail} accessibilityLabel={`ICC stages: ${d.icc.stages.map((s) => `${s.label} ${s.state}`).join(', ')}`}>
            {d.icc.stages.map((s) => {
              const c = s.state === 'done' ? colors.positive : s.state === 'failed' ? colors.danger : s.state === 'active' ? colors.warning : colors.textTertiary;
              return (
                <View key={s.n} style={[styles.step, { borderColor: c, backgroundColor: s.state === 'pending' ? 'transparent' : `${c}1F` }]}>
                  <AppText variant="caption" style={{ color: c, fontWeight: '700' }}>
                    {s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : s.state === 'active' ? '◐' : '○'} {s.n}. {s.label}
                  </AppText>
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={[styles.wrap, { marginTop: spacing.sm }]}>
          {d.entryQuality ? <StatusBadge label={`Entry quality: ${d.entryQuality}`} tone={d.entryQuality === 'Strong' || d.entryQuality === 'Good' ? 'positive' : 'warning'} size="sm" /> : null}
          <StatusBadge label={`Confidence ${d.confidence.level}`} tone={d.confidence.level === 'HIGH' ? 'positive' : d.confidence.level === 'MEDIUM' ? 'warning' : 'danger'} size="sm" />
        </View>
        <AppText variant="caption" tone="tertiary" style={{ marginTop: 4 }}>
          {d.confidence.basis === 'chart' ? 'Analysis confidence from the chart reading.' : d.confidence.basis === 'manual' ? 'Based on your own confirmations.' : d.confidence.basis === 'demo' ? 'Demo data — never counted.' : 'Nothing confirmed yet.'}
          {d.confidence.notes.length ? ` ${d.confidence.notes[0]}` : ''}
        </AppText>
      </Card>

      {/* 3 — required action */}
      <Card>
        <AppText variant="label">{d.displayStatus === 'QUALIFIED' ? 'Suggested action' : 'Action'}</AppText>
        <AppText variant="bodyStrong" style={{ marginTop: spacing.xs }}>
          {d.action}
        </AppText>
        {d.alert ? (
          <View style={styles.alert} accessibilityRole="alert">
            <Ionicons name="notifications-outline" size={18} color={colors.warning} />
            <AppText variant="body" style={styles.flex}>
              {d.alert}
            </AppText>
          </View>
        ) : null}
        {d.blocking.length ? (
          <View style={[styles.box, { borderColor: `${colors.danger}88`, backgroundColor: colors.dangerMuted }]}>
            <AppText variant="caption" style={{ color: colors.danger, fontWeight: '700' }}>
              Blocking rule{d.blocking.length > 1 ? 's' : ''}
            </AppText>
            {d.blocking.map((b) => (
              <View key={b.label} style={{ marginTop: spacing.xs }}>
                <AppText variant="bodyStrong">{b.label}</AppText>
                <AppText variant="body">{b.detail}</AppText>
              </View>
            ))}
          </View>
        ) : null}
        {d.status === 'NEEDS_INPUT' && d.needsInput.length ? <Bullets title="Needed before Prop Guard can decide" items={d.needsInput.slice(0, 4)} icon="○" color={colors.warning} /> : null}
      </Card>

      {/* 4 — setup checklist */}
      <Card>
        <AppText variant="label" style={{ marginBottom: spacing.sm }}>
          Setup checklist
        </AppText>
        {d.displayStatus === 'QUALIFIED' ? (
          <RuleChecklist rows={conditions} />
        ) : (
          <View style={{ gap: spacing.md }}>
            {failed.length ? (
              <View>
                <AppText variant="caption" style={styles.group}>
                  {d.displayStatus === 'STAND_DOWN' ? 'Failed conditions' : 'Not met'}
                </AppText>
                <RuleChecklist rows={failed} />
              </View>
            ) : null}
            {todo.length ? (
              <View>
                <AppText variant="caption" style={styles.group}>
                  Still required
                </AppText>
                <RuleChecklist rows={todo} />
              </View>
            ) : null}
            {done.length ? (
              <View>
                <AppText variant="caption" style={styles.group}>
                  Completed
                </AppText>
                <RuleChecklist rows={done} />
              </View>
            ) : null}
          </View>
        )}
      </Card>

      {/* 5 — entry / stop / target / risk */}
      <Card>
        <DetailTable title="Trade & risk" rows={levels} />
      </Card>

      {/* 6 — prop-firm checks */}
      {d.prop.applicable ? (
        <Card>
          <AppText variant="label">Prop firm check</AppText>
          {d.prop.rows.map((p) => (
            <View key={p.id} style={styles.prop} accessible accessibilityLabel={`${p.label}: ${p.status}. ${p.reason}`}>
              <View style={styles.head}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  {p.label}
                </AppText>
                <StatusBadge label={p.status} tone={STATUS_TONE[p.status]} size="sm" />
              </View>
              <AppText variant="caption">{p.reason}</AppText>
            </View>
          ))}
          <AppText variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
            UNVERIFIED means Prop Guard could not confirm it from the data it has — it is never counted as a pass.
          </AppText>
        </Card>
      ) : null}

      {/* 7 — why */}
      <Collapsible title="Why this decision?">
        <AppText variant="body">{d.why.summary}</AppText>
        <Bullets title="Matched strategy rules" items={d.why.matched} icon="✓" color={colors.positive} />
        <Bullets title="Missing confirmations" items={d.why.missing} icon="○" color={colors.warning} />
        <Bullets title="Failed rules" items={d.why.failed} icon="✕" color={colors.danger} />
        <Bullets title="Risk violations" items={d.why.riskViolations} icon="✕" color={colors.danger} />
        <Bullets title="Prop-firm violations" items={d.why.propViolations} icon="✕" color={colors.danger} />
        <Bullets title="Could not verify" items={d.why.unverified} icon="?" color={colors.warning} />
        <View style={{ marginTop: spacing.sm }}>
          <AppText variant="caption" style={{ fontWeight: '700' }}>
            How the {d.match.score}% match is built
          </AppText>
          {d.match.conditions.map((c) => (
            <AppText key={c.id} variant="caption">
              {c.state === 'matched' ? '✓' : c.state === 'failed' ? '✕' : '○'} {c.label} · {CATEGORY_LABEL[c.category]} · {c.weight} pts{c.mandatory ? ' · required' : ''}
            </AppText>
          ))}
          <AppText variant="caption" tone="tertiary" style={{ marginTop: 4 }}>
            Weighted from your saved rules only. A high match never overrides a missing required confirmation, a risk limit or a prop-firm rule — and it is not a win probability.
          </AppText>
        </View>
      </Collapsible>

      {details}
    </View>
  );
}

export { Collapsible };

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rail: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  step: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  alert: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.warning}66`, backgroundColor: colors.warningMuted },
  box: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  group: { fontWeight: '700', marginBottom: spacing.xs },
  prop: { paddingTop: spacing.sm, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 2 },
});
