import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Chip, DetailTable, NumericInput, RiskProgress, SegmentedControl, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { WidgetKind } from '@/data/learning/curriculum';
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { getProgram, importProgramRules } from '@/lib/engines/firmRulesEngine';
import { getInstrument } from '@/lib/engines/instrumentEngine';
import { dailyLossLimitFor, drawdownFloor, EMPTY_PROP_RULES } from '@/lib/engines/propRuleEngine';
import { calculateTradeRisk, maxContractsForRisk } from '@/lib/engines/riskEngine';
import type { Account, InstrumentSymbol, PropRules } from '@/types/domain';
import { money, parseNum, rr } from '@/utils/format';

/**
 * Interactive lesson examples. Every number is computed by the same engines
 * the app uses for real accounts and trades (propRuleEngine, riskEngine) —
 * nothing here is a separate "teaching" formula.
 */

function simAccount(start: number, balance: number, hwm: number, rules: Partial<PropRules>): Account {
  return {
    id: 'lesson-sim',
    name: 'Lesson example',
    firm: '',
    kind: 'prop',
    size: start,
    startingBalance: start,
    balance,
    cycleStartBalance: start,
    highWaterMark: hwm,
    status: 'active',
    createdAt: '',
    rules: { ...EMPTY_PROP_RULES, ...rules },
  };
}

// ───────────────────────────── Drawdown ─────────────────────────────

interface DrawdownPreset {
  key: 'example' | 'verified';
  label: string;
  start: number;
  rules: Partial<PropRules>;
  note: string;
}

/** LucidPro 50K (evaluation, DLL on) straight from the verified rules database — or nothing if it isn't verified. */
function verifiedPreset(): DrawdownPreset | null {
  const program = getProgram(FIRM_RULES_SEED, 'lucid:pro-eval:50k');
  if (!program) return null;
  const r = importProgramRules(program, new Date().toISOString().slice(0, 10), { dll: 'on' });
  if (r.status !== 'verified' || !r.values.maxDrawdown) return null;
  const src = r.version.verification.sources[0];
  return {
    key: 'verified',
    label: 'LucidPro 50K',
    start: program.accountSize ?? 50000,
    rules: { maxDrawdown: Number(r.values.maxDrawdown), drawdownType: (r.values.drawdownType as PropRules['drawdownType']) ?? 'eod_trailing', calc: r.calc },
    note: `Verified firm rules${r.version.lastVerifiedAt ? ` (checked ${r.version.lastVerifiedAt.slice(0, 10)})` : ''}${src?.title ? ` · ${src.title}` : ''}. Always confirm with your firm.`,
  };
}

const EXAMPLE: DrawdownPreset = {
  key: 'example',
  label: 'Simple example',
  start: 50000,
  rules: { maxDrawdown: 2000, drawdownType: 'eod_trailing', trailingLocksAtStart: true },
  note: 'Illustrative numbers — not any specific firm. Trailing on closing balance, stops trailing at the starting balance.',
};

/** Day-by-day closing balance, high-water mark and floor (floor from propRuleEngine). */
function simulateDays(preset: DrawdownPreset, days: number[]) {
  const out: { day: number; pnl: number; balance: number; hwm: number; floor: number | null }[] = [];
  for (const pnl of days) {
    const prev = out[out.length - 1];
    const balance = (prev?.balance ?? preset.start) + pnl;
    const hwm = Math.max(prev?.hwm ?? preset.start, balance);
    out.push({ day: out.length + 1, pnl, balance, hwm, floor: drawdownFloor(simAccount(preset.start, balance, hwm, preset.rules)) });
  }
  return out;
}

export function DrawdownSimulator() {
  const verified = useMemo(() => verifiedPreset(), []);
  const presets = verified ? [EXAMPLE, verified] : [EXAMPLE];
  const [presetKey, setPresetKey] = useState<DrawdownPreset['key']>('example');
  const [days, setDays] = useState<number[]>([]);
  const preset = presets.find((p) => p.key === presetKey) ?? EXAMPLE;

  const rows = simulateDays(preset, days);
  const last = rows[rows.length - 1];
  const balance = last?.balance ?? preset.start;
  const hwm = last?.hwm ?? preset.start;
  const floor = drawdownFloor(simAccount(preset.start, balance, hwm, preset.rules)) ?? 0;
  const buffer = balance - floor;
  const maxDd = preset.rules.maxDrawdown ?? 0;
  const breached = buffer <= 0;

  return (
    <View style={styles.gap}>
      {presets.length > 1 ? (
        <SegmentedControl
          options={presets.map((p) => ({ value: p.key, label: p.label }))}
          value={presetKey}
          onChange={(k) => {
            setPresetKey(k);
            setDays([]);
          }}
        />
      ) : null}
      <AppText variant="caption" tone="tertiary">
        {preset.note}
      </AppText>
      <DetailTable
        rows={[
          { label: 'Closing balance', value: money(balance), bold: true },
          { label: 'Highest close', value: money(hwm) },
          { label: 'Drawdown floor', value: money(floor), tone: 'warning' },
          { label: 'Room left', value: breached ? 'Account breached' : money(buffer), tone: breached ? 'danger' : buffer < maxDd * 0.35 ? 'warning' : 'positive', bold: true },
        ]}
      />
      <RiskProgress value={maxDd ? Math.min(1, Math.max(0, 1 - buffer / maxDd)) : 0} label="Drawdown used" />
      <View style={styles.row}>
        <Chip label="+$500 day" icon="trending-up" onPress={() => !breached && setDays((d) => [...d, 500])} />
        <Chip label="+$1,000 day" icon="trending-up" onPress={() => !breached && setDays((d) => [...d, 1000])} />
        <Chip label="−$600 day" icon="trending-down" onPress={() => !breached && setDays((d) => [...d, -600])} />
        <Chip label="Reset" icon="refresh" onPress={() => setDays([])} />
      </View>
      {rows.length ? (
        <View style={styles.days}>
          {rows.slice(-6).map((r) => (
            <AppText key={r.day} variant="caption">
              Day {r.day}: {r.pnl > 0 ? '+' : '−'}
              {money(Math.abs(r.pnl))} → balance {money(r.balance)}, floor {money(r.floor)}
            </AppText>
          ))}
        </View>
      ) : (
        <AppText variant="caption" tone="secondary">
          Add a few winning days and watch the floor rise — then a losing day. The floor never comes back down.
        </AppText>
      )}
    </View>
  );
}

// ───────────────────────────── Daily loss ─────────────────────────────

export function DailyLossCalculator() {
  const [limit, setLimit] = useState('1000');
  const [today, setToday] = useState('-450');
  const [risk, setRisk] = useState('300');
  const lim = parseNum(limit) ?? 0;
  const dll = dailyLossLimitFor(simAccount(50000, 50000, 50000, { dailyLossLimit: lim > 0 ? lim : null }));
  const pnl = parseNum(today) ?? 0;
  const r = Math.max(0, parseNum(risk) ?? 0);
  const left = dll?.limit != null ? dll.limit + Math.min(0, pnl) : null;
  const fits = left != null && r <= left;
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Daily loss limit" prefix="$" value={limit} onChangeText={setLimit} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Today’s P&L" prefix="$" value={today} onChangeText={setToday} />
        </View>
      </View>
      <NumericInput label="Risk on next trade" prefix="$" value={risk} onChangeText={setRisk} />
      {left == null ? (
        <AppText variant="caption" tone="secondary">
          Enter a daily loss limit.
        </AppText>
      ) : (
        <Card tone={left <= 0 ? 'danger' : fits ? 'positive' : 'warning'}>
          <AppText variant="heading">{left <= 0 ? 'Limit reached — done for the day' : `${money(left)} left today`}</AppText>
          <AppText variant="caption" tone="secondary">
            {left <= 0
              ? 'Any further loss breaks the rule.'
              : fits
                ? `A full ${money(r)} loss would leave ${money(left - r)}.`
                : `A full ${money(r)} loss would break the limit — reduce size or stop for the day.`}
          </AppText>
        </Card>
      )}
    </View>
  );
}

// ───────────────────────────── Position sizing ─────────────────────────────

const SIZER_SYMBOLS: InstrumentSymbol[] = ['MES', 'ES', 'MNQ', 'NQ'];

export function PositionSizer() {
  const [sym, setSym] = useState<InstrumentSymbol>('MES');
  const [stopPts, setStopPts] = useState('6');
  const [budget, setBudget] = useState('150');
  const spec = getInstrument(sym);
  const pts = Math.max(0, parseNum(stopPts) ?? 0);
  const b = Math.max(0, parseNum(budget) ?? 0);
  const perContract = pts * spec.pointValue;
  const n = maxContractsForRisk(sym, 0, pts, b);
  return (
    <View style={styles.gap}>
      <SegmentedControl options={SIZER_SYMBOLS.map((s) => ({ value: s, label: s }))} value={sym} onChange={setSym} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Stop distance" suffix="pts" value={stopPts} onChangeText={setStopPts} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Max risk" prefix="$" value={budget} onChangeText={setBudget} />
        </View>
      </View>
      <DetailTable
        rows={[
          { label: `${sym} point value`, value: money(spec.pointValue, { cents: spec.pointValue < 10 }) },
          { label: 'Risk per contract', value: money(perContract, { cents: true }) },
          { label: 'Contracts within max risk', value: String(n), bold: true, tone: n > 0 ? 'positive' : 'danger' },
          { label: 'Total risk', value: n > 0 ? money(perContract * n, { cents: true }) : '—' },
        ]}
      />
      {n === 0 && pts > 0 ? (
        <AppText variant="caption" tone="warning">
          Even one contract risks more than {money(b)}. Use the micro contract or skip the trade.
        </AppText>
      ) : null}
    </View>
  );
}

// ───────────────────────────── R:R ─────────────────────────────

export function RRCalculator() {
  const [entry, setEntry] = useState('5000');
  const [stop, setStop] = useState('4994');
  const [target, setTarget] = useState('5012');
  const e = parseNum(entry);
  const s = parseNum(stop);
  const t = parseNum(target);
  const direction = e != null && s != null && s > e ? 'short' : 'long';
  const res = calculateTradeRisk({ instrument: 'MES', direction, entry: e, stop: s, target: t, contracts: 1 });
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Entry" value={entry} onChangeText={setEntry} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Stop" value={stop} onChangeText={setStop} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Target" value={target} onChangeText={setTarget} />
        </View>
      </View>
      {res.valid ? (
        <DetailTable
          title={`1 MES · ${direction}`}
          rows={[
            { label: 'Risk', value: `${res.pointsRisk} pts · ${money(res.riskDollars, { cents: true })}`, tone: 'danger' },
            { label: 'Reward', value: `${res.pointsReward ?? '—'} pts · ${money(res.rewardDollars, { cents: true })}`, tone: 'positive' },
            { label: 'Reward : risk', value: rr(res.rr), bold: true, tone: (res.rr ?? 0) >= 1.5 ? 'positive' : 'warning' },
          ]}
        />
      ) : (
        <AppText variant="caption" tone="warning">
          {res.errors[0] ?? 'Enter entry, stop and target.'}
        </AppText>
      )}
    </View>
  );
}

// ───────────────────────────── Consistency ─────────────────────────────

export function ConsistencyChecker() {
  const [best, setBest] = useState('1200');
  const [total, setTotal] = useState('2500');
  const [rule, setRule] = useState('40');
  const b = Math.max(0, parseNum(best) ?? 0);
  const tot = Math.max(0, parseNum(total) ?? 0);
  const pctRule = Math.max(1, parseNum(rule) ?? 40);
  const share = tot > 0 ? (b / tot) * 100 : null;
  const ok = share != null && share <= pctRule;
  const needed = Math.ceil(b / (pctRule / 100));
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Best day" prefix="$" value={best} onChangeText={setBest} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Total profit" prefix="$" value={total} onChangeText={setTotal} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Rule" suffix="%" value={rule} onChangeText={setRule} />
        </View>
      </View>
      {share == null ? null : (
        <View style={styles.result}>
          <StatusBadge label={ok ? 'Within the rule' : 'Rule not met yet'} tone={ok ? 'positive' : 'warning'} />
          <AppText variant="caption" tone="secondary">
            Best day is {share.toFixed(0)}% of total profit (limit {pctRule}%).
            {ok ? '' : ` Total profit must reach ${money(needed)} with this best day — the rule rewards steady days, not one big one.`}
          </AppText>
        </View>
      )}
    </View>
  );
}

export function LessonWidget({ kind }: { kind: WidgetKind }) {
  switch (kind) {
    case 'drawdownSimulator':
      return <DrawdownSimulator />;
    case 'dailyLossCalculator':
      return <DailyLossCalculator />;
    case 'positionSizer':
      return <PositionSizer />;
    case 'rrCalculator':
      return <RRCalculator />;
    case 'consistencyChecker':
      return <ConsistencyChecker />;
  }
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1, minWidth: 90 },
  days: { gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  result: { gap: spacing.sm, alignItems: 'flex-start' },
});
