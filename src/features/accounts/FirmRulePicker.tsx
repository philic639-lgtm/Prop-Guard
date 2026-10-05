import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Input, Sheet, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { FirmRulesDatabase, PropFirm, PropFirmProgram } from '@/data/propFirms/types';
import { activeRuleVersion, isVerified, programsForFirm, ruleLines, searchFirms, STAGE_LABEL } from '@/lib/engines/firmRulesEngine';
import type { AccountFirmLink, FirmRuleField } from '@/types/domain';
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
  const programs = programsForFirm(db, firmId);
  if (!programs.length) return 'Programs not yet verified — enter rules manually';
  const verified = programs.filter((p) => isVerified(activeRuleVersion(p, today()))).length;
  return `${programs.length} program${programs.length === 1 ? '' : 's'} · ${verified ? `${verified} with verified rules` : 'rules not yet verified'}`;
}

// ───────────────────────────── Program / Account ─────────────────────────────

const programSub = (p: PropFirmProgram) => {
  const v = activeRuleVersion(p, today());
  return `${STAGE_LABEL[p.stage]} · ${isVerified(v) && v?.lastVerifiedAt ? `Rules verified ${longDate(v.lastVerifiedAt)}` : 'Rules not yet verified'}`;
};

/** Second field after a database firm is chosen: the exact program / account. */
export function ProgramPicker({
  db,
  firm,
  link,
  onSelectProgram,
  onCustomProgram,
}: {
  db: FirmRulesDatabase;
  firm: PropFirm;
  link: AccountFirmLink | null;
  onSelectProgram: (p: PropFirmProgram) => void;
  onCustomProgram: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const programs = programsForFirm(db, firm.id);
  const current = programs.find((p) => p.id === link?.programId) ?? null;
  const custom = !current && link?.programName ? link.programName : null;
  const [writing, setWriting] = useState(!programs.length || !!custom);

  if (!programs.length || writing) {
    return (
      <View style={styles.gap}>
        <Input label="Program / Account" value={custom ?? ''} onChangeText={onCustomProgram} placeholder="e.g. 50K Evaluation" />
        <AppText variant="caption" tone="warning">
          {programs.length ? 'Custom program — enter its rules manually.' : `${firm.name}’s programs are not yet verified in Prop Guard — enter the program and its rules manually.`}
        </AppText>
        {programs.length ? <Button label="Choose from the list instead" variant="ghost" size="md" onPress={() => setWriting(false)} /> : null}
      </View>
    );
  }

  const stages = (['evaluation', 'funded', 'live'] as const).filter((s) => programs.some((p) => p.stage === s));
  return (
    <View style={styles.gap}>
      <AppText variant="label">Program / Account</AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`Program / Account: ${current?.name ?? 'Select'}`} onPress={() => setOpen(true)} style={({ pressed }) => [styles.select, pressed && styles.pressed]}>
        <Ionicons name="layers-outline" size={18} color={colors.textSecondary} />
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={1} tone={current ? 'primary' : 'tertiary'}>
            {current ? current.name : `Select a ${firm.name} program`}
          </AppText>
          {current ? <AppText variant="caption">{programSub(current)}</AppText> : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={`${firm.name} · PROGRAM / ACCOUNT`}>
        {stages.map((stage) => (
          <View key={stage} style={styles.gap}>
            <AppText variant="label" style={{ marginTop: spacing.sm }}>
              {STAGE_LABEL[stage]}
            </AppText>
            {programs
              .filter((p) => p.stage === stage)
              .map((p) => {
                const on = p.id === current?.id;
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={p.name}
                    onPress={() => {
                      onSelectProgram(p);
                      setOpen(false);
                    }}
                    style={[styles.option, on && styles.optionOn]}>
                    <View style={styles.flex}>
                      <AppText variant="bodyStrong">{p.name}</AppText>
                      <AppText variant="caption">{programSub(p)}</AppText>
                    </View>
                    {on ? <Ionicons name="checkmark-circle" size={20} color={colors.accentBright} /> : null}
                  </Pressable>
                );
              })}
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setOpen(false);
            setWriting(true);
          }}
          style={[styles.option, { marginTop: spacing.sm }]}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Other / not listed</AppText>
            <AppText variant="caption">Enter the program and its rules manually</AppText>
          </View>
        </Pressable>
      </Sheet>
    </View>
  );
}

// ───────────────────────────── Imported rules status ─────────────────────────────

/** Underneath the rules: where they came from, when they were verified, and a full review. */
export function FirmRulesStatus({ link, program, overrides, firmName }: { link: AccountFirmLink | null; program: PropFirmProgram | null; overrides: FirmRuleField[]; firmName: string }) {
  const [review, setReview] = useState(false);
  if (!link || link.status === 'custom') return null;
  if (link.status !== 'verified') {
    if (!link.firmId) return null;
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
          Prop Guard has no verified copy of these rules yet, so nothing was filled in. Enter them from the firm’s current official terms — Prop Guard never guesses firm rules.
        </AppText>
      </Card>
    );
  }
  const version = program ? activeRuleVersion(program, today()) : null;
  return (
    <Card tone="positive">
      <View style={styles.row}>
        <Ionicons name="shield-checkmark" size={18} color={colors.positive} />
        <AppText variant="bodyStrong" tone="positive" style={styles.flex}>
          Firm rules imported
        </AppText>
        {overrides.length ? <StatusBadge label={`${overrides.length} custom override${overrides.length === 1 ? '' : 's'}`} tone="warning" size="sm" /> : null}
      </View>
      <AppText variant="body" style={{ marginTop: 4 }}>
        {firmName} · {link.programName}
      </AppText>
      <AppText variant="caption">
        Last verified: {link.lastVerifiedAt ? longDate(link.lastVerifiedAt) : '—'} · Rule version {link.ruleVersion}
        {link.effectiveDate ? ` (effective ${longDate(link.effectiveDate)})` : ''}
      </AppText>
      <AppText variant="caption" tone="tertiary" style={{ marginTop: 4 }}>
        Every imported value stays editable. Firm terms change — check the official source before trading.
      </AppText>
      <View style={{ marginTop: spacing.md }}>
        <Button label="Review rules" icon="document-text-outline" variant="secondary" size="md" onPress={() => setReview(true)} />
      </View>
      <Sheet visible={review} onClose={() => setReview(false)} title={`${firmName} · ${link.programName ?? ''}`.toUpperCase()}>
        {version ? <ReviewBody version={version} overrides={overrides} /> : <AppText variant="body">This rule version is no longer in the database.</AppText>}
      </Sheet>
    </Card>
  );
}

const LINE_FIELD: Record<string, FirmRuleField | undefined> = {
  profitTarget: 'profitTarget',
  dailyLossLimit: 'dailyLossLimit',
  maxDrawdown: 'maxDrawdown',
  drawdownType: 'drawdownType',
  maxContracts: 'maxContracts',
  consistency: 'consistencyPct',
  minTradingDays: 'minTradingDays',
  maxTradingDays: 'maxTradingDays',
  minProfitableDays: 'minProfitableDays',
  payoutThreshold: 'payoutThreshold',
  payoutFrequency: 'payoutFrequency',
  payoutRequirements: 'payoutRequirements',
  scalingRule: 'scalingRule',
  positionLimits: 'positionLimits',
  activationThreshold: 'activationThreshold',
  news: 'newsTrading',
  overnight: 'overnight',
  weekend: 'weekendHolding',
  copy: 'copyTrading',
};

function ReviewBody({ version, overrides }: { version: NonNullable<ReturnType<typeof activeRuleVersion>>; overrides: FirmRuleField[] }) {
  const lines = ruleLines(version.rules);
  return (
    <View style={styles.gap}>
      <AppText variant="caption">
        Rule version {version.ruleVersion} · effective {longDate(version.effectiveDate)} · verified {version.lastVerifiedAt ? longDate(version.lastVerifiedAt) : '—'}
        {version.verification.verifiedBy ? ` by ${version.verification.verifiedBy}` : ''}
      </AppText>
      {lines.map((l) => {
        const overridden = LINE_FIELD[l.key] && overrides.includes(LINE_FIELD[l.key]!);
        return (
          <View key={l.key} style={styles.line}>
            <View style={styles.row}>
              <AppText variant="label" style={styles.flex}>
                {l.label}
              </AppText>
              {overridden ? <StatusBadge label="Custom override" tone="warning" size="sm" /> : null}
            </View>
            <AppText variant="body" tone={l.value ? 'primary' : 'tertiary'}>
              {l.value ?? 'Not stated in the verified source — enter it if it applies'}
            </AppText>
          </View>
        );
      })}
      {version.verification.notes ? <AppText variant="caption">{version.verification.notes}</AppText> : null}
      <AppText variant="label" style={{ marginTop: spacing.sm }}>
        Sources
      </AppText>
      {version.verification.sources.map((s) => (
        <Pressable key={s.url} accessibilityRole="link" onPress={() => Linking.openURL(s.url)}>
          <AppText variant="caption" tone="accent">
            {s.title ?? s.url} · read {longDate(s.retrievedAt)}
          </AppText>
        </Pressable>
      ))}
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
