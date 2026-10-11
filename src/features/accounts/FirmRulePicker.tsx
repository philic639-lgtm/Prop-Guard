import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Input, SegmentedControl, Sheet, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { FirmRulesDatabase, PropFirm, PropFirmProgram } from '@/data/propFirms/types';
import { activeRuleVersion, isVerified, missingOptions, newerRulesAvailable, programFamilies, programLines, searchFirms, sizesForFamily, STAGE_LABEL, type ProgramFamily } from '@/lib/engines/firmRulesEngine';
import type { AccountFirmLink, AccountRuleSnapshot, FirmRuleField } from '@/types/domain';
import { longDate } from '@/utils/format';

const today = () => new Date().toISOString();

// ───────────────────────────── Firm autocomplete ─────────────────────────────

/**
 * Firm field with autocomplete from the firm rules database. Any text is
 * allowed — a firm that is not in the database is kept as a custom firm.
 */
export function FirmAutocomplete({
  db,
  value,
  selected,
  onChangeText,
  onSelectFirm,
}: {
  db: FirmRulesDatabase;
  value: string;
  selected: PropFirm | null;
  onChangeText: (text: string) => void;
  onSelectFirm: (firm: PropFirm) => void;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matches = useMemo(() => searchFirms(db, value), [db, value]);
  const typed = value.trim();
  const exact = !!selected && selected.name === typed;
  const show = open && !exact;

  return (
    <View style={styles.gap}>
      <Input
        label="Firm"
        value={value}
        placeholder="Start typing — e.g. Topstep, Apex, Lucid"
        autoCorrect={false}
        autoCapitalize="words"
        onChangeText={(t) => {
          onChangeText(t);
          setOpen(true);
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        // Delay so a tap on a suggestion lands before the list closes.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 180);
        }}
        accessibilityHint="Shows matching prop firms as you type"
      />
      {show && (matches.length || typed) ? (
        <View style={styles.dropdown} accessibilityRole="list">
          {matches.map((f) => (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              accessibilityLabel={`Select ${f.name}`}
              onPress={() => {
                onSelectFirm(f);
                setOpen(false);
              }}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
              <Ionicons name="business-outline" size={16} color={colors.accentBright} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{f.name}</AppText>
                <AppText variant="caption">{programSummary(db, f.id)}</AppText>
              </View>
            </Pressable>
          ))}
          {typed && !matches.some((f) => f.name.toLowerCase() === typed.toLowerCase()) ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Use ${typed} as a custom firm`} onPress={() => setOpen(false)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
              <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Use “{typed}” as a custom firm</AppText>
                <AppText variant="caption">Not in the Prop Guard database — you enter the rules</AppText>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {selected && exact ? (
        <View style={styles.row}>
          <StatusBadge label="In firm rules database" tone="accent" icon="server-outline" size="sm" />
        </View>
      ) : typed && !show ? (
        <View style={styles.row}>
          <StatusBadge label="Custom firm" tone="neutral" icon="create-outline" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

function programSummary(db: FirmRulesDatabase, firmId: string) {
  const families = programFamilies(db, firmId);
  if (!families.length) return 'Programs not yet verified — enter rules manually';
  const verified = families.some((f) => f.programs.some((p) => isVerified(activeRuleVersion(p, today()))));
  return `${families.length} program${families.length === 1 ? '' : 's'} · ${verified ? '✓ verified rules' : 'rules not yet verified'}`;
}

// ───────────────────────────── Program / Account → Account size ─────────────────────────────

const verifiedOn = (p: PropFirmProgram) => {
  const v = activeRuleVersion(p, today());
  return isVerified(v) && v?.lastVerifiedAt ? v.lastVerifiedAt : null;
};

function Select({ label, value, placeholder, sub, icon, onPress }: { label: string; value: string | null; placeholder: string; sub?: string | null; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <View style={styles.gap}>
      <AppText variant="label">{label}</AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? placeholder}`} onPress={onPress} style={({ pressed }) => [styles.select, pressed && styles.pressed]}>
        <Ionicons name={icon} size={18} color={colors.textSecondary} />
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={1} tone={value ? 'primary' : 'tertiary'}>
            {value ?? placeholder}
          </AppText>
          {value && sub ? <AppText variant="caption">{sub}</AppText> : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

function Option({ title, sub, on, onPress }: { title: string; sub?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={title} onPress={onPress} style={[styles.option, on && styles.optionOn]}>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{title}</AppText>
        {sub ? <AppText variant="caption">{sub}</AppText> : null}
      </View>
      {on ? <Ionicons name="checkmark-circle" size={20} color={colors.accentBright} /> : null}
    </Pressable>
  );
}

/**
 * After a database firm is chosen:
 * Program (product line) → Stage → Account size → Purchase options → Purchase date.
 * Rules load automatically once the configuration is complete; a firm
 * without programs on file falls back to free text.
 */
export function ProgramPicker({
  db,
  firm,
  link,
  familyKey,
  options,
  purchasedOn,
  onSelectFamily,
  onSelectProgram,
  onSelectOption,
  onChangePurchasedOn,
  onCustomProgram,
}: {
  db: FirmRulesDatabase;
  firm: PropFirm;
  link: AccountFirmLink | null;
  familyKey: string | null;
  options: Record<string, string>;
  purchasedOn: string;
  onSelectFamily: (key: string) => void;
  onSelectProgram: (p: PropFirmProgram) => void;
  onSelectOption: (id: string, choice: string) => void;
  onChangePurchasedOn: (date: string) => void;
  onCustomProgram: (name: string) => void;
}) {
  const [sheet, setSheet] = useState<'program' | 'size' | null>(null);
  const families = programFamilies(db, firm.id);
  const lines = programLines(db, firm.id);
  const family = families.find((f) => f.key === familyKey) ?? null;
  const [lineName, setLineName] = useState<string | null>(() => (family ? (family.programs[0].line ?? family.family) : null));
  const line = lines.find((l) => l.line === lineName) ?? null;
  const current = family?.programs.find((p) => p.id === link?.programId) ?? null;
  const custom = !link?.programId && link?.programName ? link.programName : null;
  const [writing, setWriting] = useState(!families.length || !!custom);

  if (!families.length || writing) {
    return (
      <View style={styles.gap}>
        <Input label="Program / Account" value={custom ?? ''} onChangeText={onCustomProgram} placeholder="e.g. 50K Evaluation" />
        <AppText variant="caption" tone="warning">
          {families.length ? 'Custom program — enter its rules manually.' : `${firm.name}’s programs are not yet verified in Prop Guard — enter the program and its rules manually.`}
        </AppText>
        {families.length ? <Button label="Choose from the list instead" variant="ghost" size="md" onPress={() => setWriting(false)} /> : null}
      </View>
    );
  }

  const familyVerified = (f: ProgramFamily) => f.programs.some((p) => verifiedOn(p));
  const pickLine = (name: string) => {
    const l = lines.find((x) => x.line === name)!;
    setLineName(name);
    // One stage only (e.g. Topstep's Trading Combine): the stage is implied.
    if (l.stages.length === 1) {
      const f = l.stages[0];
      if (f.key !== familyKey) onSelectFamily(f.key);
      if (f.programs.length === 1) onSelectProgram(f.programs[0]);
      setSheet(f.programs.length > 1 ? 'size' : null);
    } else setSheet(null);
  };
  const missing = current ? missingOptions(current, options) : [];
  return (
    <View style={styles.gap}>
      <Select
        label="Program"
        icon="layers-outline"
        value={line?.line ?? null}
        placeholder={`Select a ${firm.name} program`}
        sub={line ? `${line.stages.map((f) => STAGE_LABEL[f.stage]).join(' · ')} · ${line.stages.some(familyVerified) ? 'Verified rules' : 'Rules not yet verified'}` : null}
        onPress={() => setSheet('program')}
      />
      {line && line.stages.length > 1 ? (
        <SegmentedControl
          label="Account stage"
          options={line.stages.map((f) => ({ value: f.key, label: STAGE_LABEL[f.stage] }))}
          value={family && line.stages.some((f) => f.key === family.key) ? family.key : ''}
          onChange={(key) => {
            if (key !== familyKey) onSelectFamily(key);
          }}
        />
      ) : null}
      {family && line?.stages.some((f) => f.key === family.key) ? (
        <Select
          label="Account size"
          icon="cash-outline"
          value={current ? sizeLabel(current) : null}
          placeholder="Select an account size"
          sub={current ? (verifiedOn(current) ? `Verified rules · checked ${longDate(verifiedOn(current)!)}` : 'Rules not yet verified') : null}
          onPress={() => setSheet('size')}
        />
      ) : null}
      {current?.options?.map((o) => (
        <View key={o.id} style={styles.gap}>
          <SegmentedControl label={o.label} options={o.choices.map((c) => ({ value: c.id, label: c.label }))} value={options[o.id] ?? ''} onChange={(v) => onSelectOption(o.id, v)} />
          <AppText variant="caption">{o.choices.find((c) => c.id === options[o.id])?.description ?? o.description ?? ''}</AppText>
        </View>
      ))}
      {missing.length ? (
        <AppText variant="caption" tone="warning">
          Choose {missing.map((o) => o.label).join(' and ')} — it changes this account’s rules, so nothing is loaded until it’s set.
        </AppText>
      ) : null}
      {current ? (
        <Input
          label="Purchase / reset date"
          value={purchasedOn}
          onChangeText={onChangePurchasedOn}
          placeholder="YYYY-MM-DD"
          hint="Accounts bought under older terms load the rules in force on that date."
          autoCorrect={false}
        />
      ) : null}

      <Sheet visible={sheet === 'program'} onClose={() => setSheet(null)} title={`${firm.name} · PROGRAM`}>
        {lines.map((l) => (
          <Option
            key={l.line}
            title={l.line}
            sub={`${l.stages.map((f) => STAGE_LABEL[f.stage]).join(' · ')} · ${l.stages.some(familyVerified) ? 'Verified rules' : 'Rules not yet verified'}`}
            on={l.line === line?.line}
            onPress={() => pickLine(l.line)}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSheet(null);
            setWriting(true);
          }}
          style={[styles.option, { marginTop: spacing.sm }]}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Other / not listed</AppText>
            <AppText variant="caption">Enter the program and its rules manually</AppText>
          </View>
        </Pressable>
      </Sheet>

      <Sheet visible={sheet === 'size' && !!family} onClose={() => setSheet(null)} title={`${family?.family ?? ''} · ACCOUNT SIZE`.toUpperCase()}>
        {(family ? sizesForFamily(family) : []).map(({ program: p }) => (
          <Option
            key={p.id}
            title={sizeLabel(p)}
            sub={verifiedOn(p) ? `Verified rules · checked ${longDate(verifiedOn(p)!)}` : 'Rules not yet verified — enter manually'}
            on={p.id === current?.id}
            onPress={() => {
              onSelectProgram(p);
              setSheet(null);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const sizeLabel = (p: PropFirmProgram) => (p.accountSize ? `$${Math.round(p.accountSize / 1000)}K` : p.name);

// ───────────────────────────── Imported rules status + sources ─────────────────────────────

/** Underneath the rules: verification status, last verified date and every rule's source. */
export function FirmRulesStatus({ db, link, overrides, firmName }: { db: FirmRulesDatabase; link: AccountFirmLink | null; overrides: FirmRuleField[]; firmName: string }) {
  const [sources, setSources] = useState(false);
  if (!link || link.status === 'custom') return null;
  if (link.status !== 'verified') {
    if (!link.firmId) return null;
    const prog = link.programId ? db.programs.find((p) => p.id === link.programId) : null;
    if (prog && missingOptions(prog, link.options).length) return null; // the picker asks for the option
    if (prog && isVerified(activeRuleVersion(prog, today()))) {
      return (
        <Card tone="warning">
          <AppText variant="bodyStrong" tone="warning">
            No verified rules for that purchase date.
          </AppText>
          <AppText variant="caption" style={{ marginTop: 4 }}>
            Prop Guard only has {link.programName}’s rules from a later date. Enter the terms from your purchase agreement — nothing was filled in.
          </AppText>
        </Card>
      );
    }
    return (
      <Card tone="warning">
        <View style={styles.row}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
          <AppText variant="bodyStrong" tone="warning">
            Rules not yet verified — enter manually.
          </AppText>
        </View>
        <AppText variant="caption" style={{ marginTop: 4 }}>
          {link.programName ? `${firmName} · ${link.programName}: ` : `${firmName}: `}
          {link.programName || !link.firmId ? 'Prop Guard has no verified copy of these rules yet, so nothing was filled in. Enter them from the firm’s current official terms — Prop Guard never guesses firm rules.' : 'Choose the program and account size to load its rules.'}
        </AppText>
      </Card>
    );
  }
  const snap = link.snapshot;
  const review = snap?.rules.filter((r) => r.status !== 'verified') ?? [];
  const newer = newerRulesAvailable(db, link, today());
  return (
    <Card tone="positive">
      <View style={styles.row}>
        <Ionicons name="shield-checkmark" size={18} color={colors.positive} />
        <AppText variant="bodyStrong" tone="positive" style={styles.flex}>
          ✓ Verified rules
        </AppText>
        {overrides.length ? <StatusBadge label={`${overrides.length} custom override${overrides.length === 1 ? '' : 's'}`} tone="warning" size="sm" /> : null}
      </View>
      <AppText variant="body" style={{ marginTop: 4 }}>
        {firmName} · {link.programName}
      </AppText>
      <AppText variant="caption">
        Last verified: {link.lastVerifiedAt ? longDate(link.lastVerifiedAt) : '—'} · Rule version {link.ruleVersion}
      </AppText>
      {link.options && Object.keys(link.options).length ? (
        <AppText variant="caption">Options: {Object.entries(link.options).map(([k, v]) => `${k === 'dll' ? 'Daily Loss Limit' : k} ${v === 'on' ? 'On' : v === 'off' ? 'Off' : v}`).join(' · ')}</AppText>
      ) : null}
      {review.length ? (
        <AppText variant="caption" tone="warning" style={{ marginTop: 4 }}>
          {review.length} rule{review.length === 1 ? '' : 's'} need review and {review.length === 1 ? 'was' : 'were'} not filled in: {review.map((r) => r.label).join(', ')}.
        </AppText>
      ) : null}
      {newer ? (
        <AppText variant="caption" tone="accent" style={{ marginTop: 4 }}>
          {firmName} rules were updated ({newer.ruleVersion}). This account keeps the rules it was set up with — re-select the account size to load the new ones.
        </AppText>
      ) : null}
      <AppText variant="caption" tone="tertiary" style={{ marginTop: 4 }}>
        Firm rules are read-only — use “Override firm rules” if your purchased agreement differs. Firm terms change — check the official source before trading.
      </AppText>
      <View style={{ marginTop: spacing.md }}>
        <Button label="View rule sources" icon="link-outline" variant="secondary" size="md" onPress={() => setSources(true)} />
      </View>
      <Sheet visible={sources} onClose={() => setSources(false)} title="RULE SOURCES">
        {snap ? <SourcesBody snap={snap} overrides={overrides} /> : <AppText variant="body">No source snapshot is stored for this account.</AppText>}
      </Sheet>
    </Card>
  );
}

const OVERRIDE_KEY: Record<string, FirmRuleField> = {
  profitTarget: 'profitTarget',
  maxLossLimit: 'maxDrawdown',
  drawdownMethod: 'drawdownType',
  dailyLossLimit: 'dailyLossLimit',
  maxContracts: 'maxContracts',
  consistency: 'consistencyPct',
  minTradingDays: 'minTradingDays',
  tradingDays: 'minTradingDays',
  winningDays: 'minProfitableDays',
  payoutEligibility: 'payoutRequirements',
  payoutFrequency: 'payoutFrequency',
  scaling: 'scalingRule',
  passing: 'activationThreshold',
  activation: 'activationThreshold',
  news: 'newsTrading',
  overnight: 'overnight',
  weekend: 'weekendHolding',
  copyTrading: 'copyTrading',
};

function SourcesBody({ snap, overrides }: { snap: AccountRuleSnapshot; overrides: FirmRuleField[] }) {
  const first = snap.rules[0];
  const rules = snap.rules.filter((r) => !r.key.startsWith('extra:'));
  return (
    <View style={styles.gap}>
      <AppText variant="bodyStrong">
        {snap.firmName} · {snap.programName}
      </AppText>
      <AppText variant="caption">
        {first ? `${STAGE_LABEL[first.stage]} · ${first.accountSize ? `$${first.accountSize.toLocaleString('en-US')}` : 'size set by firm'} · ` : ''}
        Rule version {snap.ruleVersion} · saved with this account {longDate(snap.takenAt)}
      </AppText>
      {rules.map((r) => {
        const overridden = OVERRIDE_KEY[r.key] && overrides.includes(OVERRIDE_KEY[r.key]);
        return (
          <View key={r.key} style={styles.line}>
            <View style={styles.row}>
              <AppText variant="label" style={styles.flex}>
                {r.label}
              </AppText>
              {r.status === 'verified' ? <StatusBadge label="Verified" tone="positive" size="sm" /> : <StatusBadge label="Needs review" tone="warning" icon="alert-circle-outline" size="sm" />}
              {overridden ? <StatusBadge label="Custom override" tone="warning" size="sm" /> : null}
            </View>
            <AppText variant="body">{r.value}</AppText>
            {r.note ? (
              <AppText variant="caption" tone="warning">
                {r.note}
              </AppText>
            ) : null}
            {r.sources.map((s) => (
              <Pressable key={s.url} accessibilityRole="link" accessibilityLabel={`Open source ${s.title ?? s.url}`} onPress={() => Linking.openURL(s.url)}>
                <AppText variant="caption" tone="accent">
                  {s.title ?? 'Source'} ↗
                </AppText>
                <AppText variant="caption" tone="tertiary" numberOfLines={1}>
                  {s.url}
                </AppText>
              </Pressable>
            ))}
            <AppText variant="caption" tone="tertiary">
              Checked {longDate(r.checkedAt)}
              {r.sources.some((s) => s.method === 'search_excerpt') ? ' · from the official page text (search excerpt)' : ''}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/** Small tag under an imported field: unchanged firm value, or a custom override with restore. */
export function ImportedTag({ imported, current, onRestore }: { imported: string | undefined; current: string; onRestore: () => void }) {
  if (imported == null) return null;
  const same = normalize(imported) === normalize(current);
  return (
    <View style={styles.row}>
      {same ? (
        <StatusBadge label="Firm rule" tone="positive" icon="shield-checkmark-outline" size="sm" />
      ) : (
        <>
          <StatusBadge label="Custom override" tone="warning" icon="create-outline" size="sm" />
          <Pressable accessibilityRole="button" accessibilityLabel={`Restore firm value ${imported}`} hitSlop={8} onPress={onRestore}>
            <AppText variant="caption" tone="accent">
              Restore {imported}
            </AppText>
          </Pressable>
        </>
      )}
    </View>
  );
}

const normalize = (v: string) => {
  const n = Number(v.replace(/[$,]/g, '').trim());
  return v.trim() !== '' && Number.isFinite(n) ? String(n) : v.trim().toLowerCase();
};

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  dropdown: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.cardRaised, overflow: 'hidden' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  select: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  option: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  optionOn: { borderColor: colors.accent },
  line: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
