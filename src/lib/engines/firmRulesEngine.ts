import { z } from 'zod';

import {
  FIRM_RULES_SCHEMA_VERSION,
  type FirmRuleRecord,
  type FirmRulesDatabase,
  type ProgramOption,
  type ProgramRules,
  type ProgramRuleVersion,
  type ProgramStage,
  type PropFirm,
  type PropFirmProgram,
} from '@/data/propFirms/types';
import type { AccountFirmLink, AccountRuleCalc, AccountRuleSnapshot, AccountRuleSnapshotRule, DrawdownType, FirmRuleField, FirmRuleValues } from '@/types/domain';

/**
 * Prop-firm rules: search, program lookup, rule-version selection and import.
 * Pure — the database comes from `src/services/firmRules` (seed + remote).
 *
 * Invariant: only a VERIFIED rule version (official source + reviewer +
 * verification date) is ever applied to an account. Everything else returns
 * `unverified` and the trader enters the rules.
 */

// ───────────────────────────── Search ─────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const initials = (s: string) =>
  norm(s)
    .split(' ')
    .map((w) => w[0])
    .join('');

function matchScore(f: PropFirm, q: string): number {
  const names = [f.name, ...f.aliases].map(norm);
  const compact = q.replace(/ /g, '');
  let best = 0;
  for (const n of names) {
    if (n === q) best = Math.max(best, 100);
    else if (n.startsWith(q)) best = Math.max(best, 80);
    else if (n.replace(/ /g, '').startsWith(compact)) best = Math.max(best, 70);
    else if (n.split(' ').some((w) => w.startsWith(q))) best = Math.max(best, 60);
    else if (n.includes(q)) best = Math.max(best, 30);
  }
  if (compact.length >= 2 && initials(f.name).startsWith(compact)) best = Math.max(best, 50);
  return best;
}

/** Firms matching what the trader typed ("top" → Topstep, "ap" → Apex Trader Funding). */
export function searchFirms(db: FirmRulesDatabase, query: string, limit = 6): PropFirm[] {
  const q = norm(query);
  const active = db.firms.filter((f) => f.active);
  if (!q) return [...active].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  return active
    .map((f) => ({ f, s: matchScore(f, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name))
    .slice(0, limit)
    .map((x) => x.f);
}

/** Exact firm for a stored firm name (restoring an account), by name or alias. */
export function findFirm(db: FirmRulesDatabase, name: string | null | undefined): PropFirm | null {
  const q = norm(name ?? '');
  if (!q) return null;
  return db.firms.find((f) => [f.name, ...f.aliases].some((n) => norm(n) === q)) ?? null;
}

export const getFirm = (db: FirmRulesDatabase, id: string | null | undefined) => db.firms.find((f) => f.id === id) ?? null;
export const getProgram = (db: FirmRulesDatabase, id: string | null | undefined) => db.programs.find((p) => p.id === id) ?? null;

// ───────────────────────────── Programs ─────────────────────────────

export const STAGE_LABEL: Record<ProgramStage, string> = { evaluation: 'Evaluation', funded: 'Funded (simulated)', live: 'Live' };
const STAGE_ORDER: ProgramStage[] = ['evaluation', 'funded', 'live'];

/** Active programs of a firm: evaluation → funded → live, then by family and size. */
export function programsForFirm(db: FirmRulesDatabase, firmId: string): PropFirmProgram[] {
  const own = db.programs.filter((p) => p.firmId === firmId && p.active);
  // Families keep the database's order (e.g. Standard before Consistency).
  const familyRank = (f: string) => own.findIndex((p) => p.family === f);
  return own.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || familyRank(a.family) - familyRank(b.family) || (a.accountSize ?? Infinity) - (b.accountSize ?? Infinity));
}

export interface ProgramFamily {
  /** Stable key: `${stage}:${family}`. */
  key: string;
  family: string;
  stage: ProgramStage;
  programs: PropFirmProgram[];
}

/** The "Program" choices for a firm (family + stage), each with its sizes. */
export function programFamilies(db: FirmRulesDatabase, firmId: string): ProgramFamily[] {
  const out: ProgramFamily[] = [];
  for (const p of programsForFirm(db, firmId)) {
    const key = `${p.stage}:${p.family}`;
    const f = out.find((x) => x.key === key);
    if (f) f.programs.push(p);
    else out.push({ key, family: p.family, stage: p.stage, programs: [p] });
  }
  return out;
}

/** A product line ("LucidPro") with the stages it offers, each a family with its own sizes. */
export interface ProgramLine {
  line: string;
  stages: ProgramFamily[];
}

/** Firm → Program (line) → Stage → Size. Programs without a `line` form their own line (family). */
export function programLines(db: FirmRulesDatabase, firmId: string): ProgramLine[] {
  const families = programFamilies(db, firmId);
  const out: ProgramLine[] = [];
  for (const f of families) {
    const line = f.programs[0].line ?? f.family;
    const l = out.find((x) => x.line === line);
    if (l) l.stages.push(f);
    else out.push({ line, stages: [f] });
  }
  return out;
}

/** Account sizes available for one program family — only that family's own programs. */
export const sizesForFamily = (family: ProgramFamily) => family.programs.map((p) => ({ size: p.accountSize, program: p }));

/** The rule version in force on `onDate` (latest effective date not in the future). */
export function activeRuleVersion(program: PropFirmProgram, onDate: string): ProgramRuleVersion | null {
  const day = onDate.slice(0, 10);
  return (
    [...program.versions]
      .filter((v) => v.effectiveDate.slice(0, 10) <= day)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.ruleVersion.localeCompare(a.ruleVersion))[0] ?? null
  );
}

/** A version may be applied only with sources, a reviewer and a verification date. */
export const isVerified = (v: ProgramRuleVersion | null): boolean =>
  !!v && v.verification.status === 'verified' && v.verification.sources.length > 0 && !!v.verification.verifiedBy && !!v.lastVerifiedAt;

// ───────────────────────────── Import ─────────────────────────────

const tri = (b: boolean | null): string => (b == null ? '' : b ? 'allowed' : 'not_allowed');

/** Form values for every rule the version actually states (nulls are left for the trader). */
export function rulesToValues(rules: ProgramRules): FirmRuleValues {
  const out: FirmRuleValues = {};
  const put = (k: FirmRuleField, v: string | number | null | undefined) => {
    if (v == null || v === '') return;
    out[k] = String(v);
  };
  put('profitTarget', rules.profitTarget);
  if (rules.dailyLossMode !== 'none') put('dailyLossLimit', rules.dailyLossLimit);
  put('maxDrawdown', rules.maxDrawdown);
  put('drawdownType', rules.drawdownType);
  put('maxContracts', rules.maxContracts);
  put('consistencyPct', rules.consistencyRule?.maxDayPctOfProfit);
  put('minTradingDays', rules.minTradingDays);
  put('maxTradingDays', rules.maxTradingDays);
  put('minProfitableDays', rules.minProfitableDays);
  put('payoutThreshold', rules.payoutThreshold);
  put('payoutFrequency', rules.payoutFrequency);
  put('payoutRequirements', rules.payoutRequirements.join('\n'));
  put('scalingRule', rules.scalingRule);
  put('positionLimits', rules.positionLimits);
  put('activationThreshold', rules.activationThreshold);
  put('newsTrading', tri(rules.newsTradingAllowed));
  put('overnight', tri(rules.overnightAllowed));
  put('weekendHolding', tri(rules.weekendHoldingAllowed));
  put('copyTrading', tri(rules.copyTradingAllowed));
  return out;
}

/** Which `ProgramRules` field fills each form field. */
const FIELD_SOURCE: Record<Exclude<FirmRuleField, 'size'>, keyof ProgramRules> = {
  profitTarget: 'profitTarget',
  dailyLossLimit: 'dailyLossLimit',
  maxDrawdown: 'maxDrawdown',
  drawdownType: 'drawdownType',
  maxContracts: 'maxContracts',
  consistencyPct: 'consistencyRule',
  minTradingDays: 'minTradingDays',
  maxTradingDays: 'maxTradingDays',
  minProfitableDays: 'minProfitableDays',
  payoutThreshold: 'payoutThreshold',
  payoutFrequency: 'payoutFrequency',
  payoutRequirements: 'payoutRequirements',
  scalingRule: 'scalingRule',
  positionLimits: 'positionLimits',
  activationThreshold: 'activationThreshold',
  newsTrading: 'newsTradingAllowed',
  overnight: 'overnightAllowed',
  weekendHolding: 'weekendHoldingAllowed',
  copyTrading: 'copyTradingAllowed',
};

// ───────────────────────────── Purchase options ─────────────────────────────

/** Does a rule record apply to the chosen purchase options? Records without `when` always apply. */
export const recordApplies = (r: FirmRuleRecord, options: Record<string, string> | undefined) => !r.when || Object.entries(r.when).every(([k, v]) => options?.[k] === v);

/** Options the trader still has to choose (or chose a value the program doesn't offer). */
export function missingOptions(program: PropFirmProgram, options: Record<string, string> | undefined): ProgramOption[] {
  return (program.options ?? []).filter((o) => !o.choices.some((c) => c.id === options?.[o.id]));
}

const hasEvidence = (r: FirmRuleRecord) => r.sources.length > 0 && r.sources.every((s) => !!s.url && !!s.title && !!s.retrievedAt) && !!r.checkedAt;

/** Structured fields backed by an applicable, VERIFIED record (null set = version without records: all fields). */
function verifiedFields(version: ProgramRuleVersion, options: Record<string, string> | undefined): Set<keyof ProgramRules> | null {
  if (!version.records?.length) return null;
  const out = new Set<keyof ProgramRules>();
  for (const r of version.records) {
    if (r.status !== 'verified' || !hasEvidence(r) || !recordApplies(r, options)) continue;
    if (r.field) out.add(r.field);
    for (const k of Object.keys(r.structured ?? {}) as (keyof ProgramRules)[]) out.add(k);
  }
  return out;
}

/**
 * Is this structured field backed by a VERIFIED rule record (for these options)?
 * Versions without per-rule records rely on the version-level verification alone.
 */
export function fieldVerified(version: ProgramRuleVersion, field: keyof ProgramRules, options?: Record<string, string>): boolean {
  const set = verifiedFields(version, options);
  return set == null || set.has(field);
}

/** The version's rules with option-dependent values applied (verified, applicable records only). */
export function rulesForOptions(version: ProgramRuleVersion, options: Record<string, string> | undefined): ProgramRules {
  const rules: ProgramRules = { ...version.rules };
  for (const r of version.records ?? []) if (r.structured && r.status === 'verified' && hasEvidence(r) && recordApplies(r, options)) Object.assign(rules, r.structured);
  return rules;
}

/** Typed calculations for the account — verified fields only (everything else stays unknown). */
export function calcOf(rules: ProgramRules, verified: (f: keyof ProgramRules) => boolean): AccountRuleCalc {
  const calc: AccountRuleCalc = {};
  const put = <K extends keyof AccountRuleCalc & keyof ProgramRules>(k: K) => {
    if (verified(k) && rules[k] != null) (calc as Record<string, unknown>)[k] = rules[k];
  };
  put('trailingLockOffset');
  put('maxDrawdownPct');
  put('drawdownLocksOnPayout');
  put('dailyLossMode');
  put('dailyLossBreach');
  put('dailyLossScaling');
  put('payout');
  put('inactivityRule');
  return calc;
}

/** Drop typed calculations that belong to a rule the trader overrode (their own value wins). */
export function calcAfterOverrides(calc: AccountRuleCalc | undefined, overrides: FirmRuleField[], dailyLossValue: string | undefined): AccountRuleCalc | undefined {
  if (!calc) return undefined;
  const c: AccountRuleCalc = { ...calc };
  if (overrides.includes('maxDrawdown') || overrides.includes('drawdownType')) {
    delete c.trailingLockOffset;
    delete c.maxDrawdownPct;
    delete c.drawdownLocksOnPayout;
  }
  if (overrides.includes('dailyLossLimit')) {
    delete c.dailyLossScaling;
    delete c.dailyLossBreach;
    c.dailyLossMode = dailyLossValue && dailyLossValue.trim() ? 'fixed' : null;
    if (!c.dailyLossMode) delete c.dailyLossMode;
  }
  if (overrides.includes('payoutThreshold') || overrides.includes('payoutRequirements') || overrides.includes('minProfitableDays')) delete c.payout;
  return Object.keys(c).length ? c : undefined;
}

export type FirmRuleImport =
  | { status: 'verified'; version: ProgramRuleVersion; values: FirmRuleValues; additionalRules: ProgramRules['additionalRules']; withheld: FirmRuleRecord[]; rules: ProgramRules; calc: AccountRuleCalc; options: Record<string, string>; unknown: string[] }
  | { status: 'needs_options'; version: ProgramRuleVersion | null; missing: ProgramOption[]; reason: string }
  | { status: 'unverified'; version: ProgramRuleVersion | null; reason: string };

/** Key rules every account needs — reported when the verified configuration doesn't state them. */
const KEY_FIELDS: [keyof ProgramRules, string][] = [
  ['maxDrawdown', 'Maximum drawdown'],
  ['drawdownType', 'Drawdown method'],
  ['dailyLossMode', 'Daily loss limit'],
  ['profitTarget', 'Profit target'],
  ['maxContracts', 'Maximum contracts'],
  ['consistencyRule', 'Consistency rule'],
];

/**
 * What selecting `program` (+ purchase options) imports — from THIS
 * program's own active version only (never another program or size).
 * Every option must be chosen first; unverified / needs-review rules and
 * rules for other options are never applied.
 */
export function importProgramRules(program: PropFirmProgram, onDate: string, options: Record<string, string> = {}): FirmRuleImport {
  const version = activeRuleVersion(program, onDate);
  if (!version) return { status: 'unverified', version: null, reason: 'No verified rules are on file for this program yet.' };
  if (!isVerified(version)) return { status: 'unverified', version, reason: 'The rules on file for this program have not been verified against the firm’s official terms.' };
  const missing = missingOptions(program, options);
  if (missing.length) return { status: 'needs_options', version, missing, reason: `Choose ${missing.map((o) => o.label).join(' and ')} first — the rules depend on it.` };
  const chosen = Object.fromEntries((program.options ?? []).map((o) => [o.id, options[o.id]]));
  const rules = rulesForOptions(version, chosen);
  const ok = (f: keyof ProgramRules) => fieldVerified(version, f, chosen);
  const all = rulesToValues(rules);
  const values: FirmRuleValues = {};
  for (const [k, v] of Object.entries(all) as [Exclude<FirmRuleField, 'size'>, string][]) if (ok(FIELD_SOURCE[k])) values[k] = v;
  if (program.accountSize) values.size = String(program.accountSize);
  const extraOk = (id: string) => !version.records?.length || version.records.some((r) => r.key === `extra:${id}` && r.status === 'verified' && recordApplies(r, chosen));
  const applicable = (version.records ?? []).filter((r) => recordApplies(r, chosen));
  return {
    status: 'verified',
    version,
    values,
    rules,
    calc: calcOf(rules, ok),
    options: chosen,
    additionalRules: rules.additionalRules.filter((a) => extraOk(a.id)),
    withheld: applicable.filter((r) => r.status !== 'verified'),
    unknown: KEY_FIELDS.filter(([f]) => !ok(f) || rules[f] == null).map(([, label]) => label),
  };
}

/** Every rule of a program version with its evidence, labelled with program, size and stage. */
export function ruleSourceRows(program: PropFirmProgram, version: ProgramRuleVersion, options?: Record<string, string>): AccountRuleSnapshotRule[] {
  const records: FirmRuleRecord[] = version.records?.length
    ? version.records.filter((r) => recordApplies(r, options))
    : ruleLines(version.rules)
        .filter((l) => l.value != null)
        .map((l) => ({ key: l.key, label: l.label, value: l.value!, status: version.verification.status, sources: version.verification.sources, checkedAt: version.lastVerifiedAt ?? version.effectiveDate }));
  return records.map((r) => ({
    key: r.key,
    label: r.label,
    value: r.value,
    status: r.status,
    sources: r.sources.map((x) => ({ ...x })),
    checkedAt: r.checkedAt,
    ...(r.note ? { note: r.note } : {}),
    program: program.name,
    accountSize: program.accountSize,
    stage: program.stage,
  }));
}

/** Frozen copy of the rules an account was set up with (survives later master updates). */
export function snapshotOf(firm: PropFirm, program: PropFirmProgram, version: ProgramRuleVersion, now: string, options?: Record<string, string>): AccountRuleSnapshot {
  return {
    takenAt: now,
    firmId: firm.id,
    firmName: firm.name,
    programId: program.id,
    programName: program.name,
    ruleVersion: version.ruleVersion,
    effectiveDate: version.effectiveDate,
    lastVerifiedAt: version.lastVerifiedAt,
    rules: ruleSourceRows(program, version, options),
  };
}

/** The account's link to the database after selecting a program. */
export function linkFor(firm: PropFirm | null, program: PropFirmProgram | null, imp: FirmRuleImport | null, now: string, options?: Record<string, string>): AccountFirmLink {
  const verified = imp?.status === 'verified' ? imp : null;
  return {
    firmId: firm?.id ?? null,
    programId: program?.id ?? null,
    programName: program?.name ?? null,
    stage: program?.stage ?? null,
    status: verified ? 'verified' : firm ? 'unverified' : 'custom',
    ruleVersion: verified?.version.ruleVersion ?? null,
    effectiveDate: verified?.version.effectiveDate ?? null,
    lastVerifiedAt: verified?.version.lastVerifiedAt ?? null,
    importedAt: verified ? now : null,
    imported: verified?.values ?? {},
    overrides: [],
    family: program?.family ?? null,
    accountSize: program?.accountSize ?? null,
    line: program ? (program.line ?? program.family) : null,
    ...(options && Object.keys(options).length ? { options } : {}),
    ...(verified && Object.keys(verified.calc).length ? { calc: verified.calc } : {}),
    ...(verified && firm && program ? { snapshot: snapshotOf(firm, program, verified.version, now, verified.options) } : {}),
  };
}

/** A newer rule version than the account's snapshot exists (shown, never auto-applied). */
export function newerRulesAvailable(db: FirmRulesDatabase, link: AccountFirmLink | null, onDate: string): ProgramRuleVersion | null {
  if (!link?.snapshot) return null;
  const p = db.programs.find((x) => x.id === link.snapshot!.programId);
  const v = p ? activeRuleVersion(p, onDate) : null;
  return v && isVerified(v) && v.ruleVersion !== link.snapshot.ruleVersion ? v : null;
}

const normValue = (v: string | undefined | null) => {
  const t = (v ?? '').trim();
  const n = Number(t.replace(/[$,]/g, ''));
  return t !== '' && Number.isFinite(n) ? String(n) : t.toLowerCase();
};

/** Imported rules the trader has changed — shown as "Custom override". */
export function detectOverrides(imported: FirmRuleValues, current: FirmRuleValues): FirmRuleField[] {
  return (Object.keys(imported) as FirmRuleField[]).filter((k) => normValue(imported[k]) !== normValue(current[k]));
}

// ───────────────────────────── Review ─────────────────────────────

export interface RuleLine {
  key: string;
  label: string;
  value: string | null;
}

const money = (n: number | null | undefined) => (n == null ? null : `$${n.toLocaleString('en-US')}`);
const yesNo = (b: boolean | null, extra?: string | null) => (b == null ? null : `${b ? 'Allowed' : 'Not allowed'}${extra ? ` — ${extra}` : ''}`);
const DD_LABEL: Record<DrawdownType, string> = { static: 'Static', trailing: 'Intraday trailing', eod_trailing: 'End-of-day trailing' };

/** Every rule of a version as display lines; `value: null` = not stated / not verified. */
export function ruleLines(r: ProgramRules): RuleLine[] {
  return [
    { key: 'profitTarget', label: 'Profit target', value: money(r.profitTarget) },
    { key: 'dailyLossLimit', label: 'Daily loss limit', value: money(r.dailyLossLimit) },
    { key: 'maxDrawdown', label: 'Maximum drawdown / loss limit', value: money(r.maxDrawdown) },
    { key: 'drawdownType', label: 'Drawdown type', value: r.drawdownType ? `${DD_LABEL[r.drawdownType]}${r.trailingLocksAtStart ? ' (stops trailing at starting balance)' : ''}` : null },
    { key: 'drawdownLock', label: 'Drawdown lock', value: r.trailingLockOffset == null ? null : `Stops trailing at starting balance + ${money(r.trailingLockOffset)}${r.drawdownLocksOnPayout ? '; locks there when a payout is requested' : ''}` },
    { key: 'maxDrawdownPct', label: 'Max drawdown (% of start)', value: r.maxDrawdownPct == null ? null : `${r.maxDrawdownPct}%` },
    { key: 'dailyLossMode', label: 'Daily loss limit type', value: r.dailyLossMode == null ? null : r.dailyLossMode === 'none' ? 'None for this configuration' : `${r.dailyLossMode === 'scaling' ? 'Scaling' : 'Fixed'}${r.dailyLossBreach ? ` · ${r.dailyLossBreach} breach` : ''}` },
    { key: 'dailyLossScaling', label: 'Scaling daily loss limit', value: r.dailyLossScaling ? `${r.dailyLossScaling.pct}% of ${r.dailyLossScaling.basis === 'peak_eod_profit' ? 'peak end-of-day profit' : 'peak end-of-day balance'}${r.dailyLossScaling.afterBalance ? ` once above ${money(r.dailyLossScaling.afterBalance)}` : ''}` : null },
    { key: 'maxContracts', label: 'Maximum contracts', value: r.maxContracts == null ? null : String(r.maxContracts) },
    { key: 'consistency', label: 'Consistency rule', value: r.consistencyRule ? `${r.consistencyRule.maxDayPctOfProfit != null ? `${r.consistencyRule.maxDayPctOfProfit}% max in one day — ` : ''}${r.consistencyRule.description}` : null },
    { key: 'minTradingDays', label: 'Minimum trading days', value: r.minTradingDays == null ? null : String(r.minTradingDays) },
    { key: 'maxTradingDays', label: 'Maximum trading days', value: r.maxTradingDays == null ? null : String(r.maxTradingDays) },
    { key: 'minProfitableDays', label: 'Minimum profitable days', value: r.minProfitableDays == null ? null : String(r.minProfitableDays) },
    { key: 'payoutThreshold', label: 'Payout threshold', value: money(r.payoutThreshold) },
    { key: 'payoutFrequency', label: 'Payout frequency', value: r.payoutFrequency },
    { key: 'payoutRequirements', label: 'Payout eligibility', value: r.payoutRequirements.length ? r.payoutRequirements.join('; ') : null },
    { key: 'inactivity', label: 'Inactivity rule', value: r.inactivityRule },
    { key: 'scalingRule', label: 'Scaling rules', value: r.scalingRule },
    { key: 'positionLimits', label: 'Position limits', value: r.positionLimits },
    { key: 'activationThreshold', label: 'Activation / funded threshold', value: r.activationThreshold },
    { key: 'news', label: 'News trading', value: yesNo(r.newsTradingAllowed, r.newsRestriction) },
    { key: 'overnight', label: 'Overnight holding', value: yesNo(r.overnightAllowed) },
    { key: 'weekend', label: 'Weekend holding', value: yesNo(r.weekendHoldingAllowed) },
    { key: 'copy', label: 'Copy trading', value: yesNo(r.copyTradingAllowed) },
    ...r.additionalRules.map((a) => ({ key: `extra:${a.id}`, label: a.label, value: a.description ?? 'Applies' })),
  ];
}

// ───────────────────────────── Feed validation / merge ─────────────────────────────

const iso = z.string().min(10);
const nn = z.number().nonnegative().nullable();
const rulesSchema = z.object({
  profitTarget: nn,
  dailyLossLimit: nn,
  maxDrawdown: nn,
  drawdownType: z.enum(['static', 'trailing', 'eod_trailing']).nullable(),
  trailingLocksAtStart: z.boolean().nullable(),
  maxContracts: nn,
  consistencyRule: z.object({ maxDayPctOfProfit: z.number().min(0).max(100).nullable(), description: z.string() }).nullable(),
  minTradingDays: nn,
  maxTradingDays: nn,
  minProfitableDays: nn,
  payoutThreshold: nn,
  payoutRequirements: z.array(z.string()),
  payoutFrequency: z.string().nullable(),
  scalingRule: z.string().nullable(),
  positionLimits: z.string().nullable(),
  activationThreshold: z.string().nullable(),
  newsTradingAllowed: z.boolean().nullable(),
  newsRestriction: z.string().nullable(),
  overnightAllowed: z.boolean().nullable(),
  weekendHoldingAllowed: z.boolean().nullable(),
  copyTradingAllowed: z.boolean().nullable(),
  additionalRules: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })),
  // Typed calculations (added later — older feeds omit them: default unknown).
  trailingLockOffset: nn.default(null),
  maxDrawdownPct: z.number().min(0).max(100).nullable().default(null),
  drawdownLocksOnPayout: z.boolean().nullable().default(null),
  dailyLossMode: z.enum(['none', 'fixed', 'scaling']).nullable().default(null),
  dailyLossBreach: z.enum(['soft', 'hard']).nullable().default(null),
  dailyLossScaling: z.object({ pct: z.number().min(0).max(100), basis: z.enum(['peak_eod_profit', 'peak_eod_balance']), afterBalance: nn }).nullable().default(null),
  payout: z
    .object({ minRequest: nn, maxRequest: nn, maxRequestPctOfProfit: z.number().min(0).max(100).nullable(), cycleProfitGoal: nn, minProfitableDays: nn, minDayProfit: nn, maxPayouts: nn, bufferAboveStart: nn })
    .nullable()
    .default(null),
  inactivityRule: z.string().nullable().default(null),
});
const sourceSchema = z.object({ url: z.string().url(), title: z.string().optional(), retrievedAt: iso, method: z.enum(['page', 'search_excerpt']).optional() });
const versionSchema = z.object({
  ruleVersion: z.string().min(1),
  effectiveDate: iso,
  lastVerifiedAt: iso.nullable(),
  verification: z.object({
    status: z.enum(['verified', 'unverified']),
    sources: z.array(sourceSchema),
    verifiedBy: z.string().nullable(),
    notes: z.string().optional(),
  }),
  rules: rulesSchema,
  records: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        value: z.string(),
        field: z.string().optional(),
        status: z.enum(['verified', 'needs_review', 'unverified']),
        sources: z.array(sourceSchema),
        checkedAt: iso,
        note: z.string().optional(),
        when: z.record(z.string(), z.string()).optional(),
        structured: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});
const dbSchema = z.object({
  schemaVersion: z.number().int(),
  publishedAt: iso,
  source: z.enum(['seed', 'remote', 'merged']),
  firms: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), aliases: z.array(z.string()), logo: z.string().nullable(), website: z.string().nullable(), active: z.boolean() })),
  programs: z.array(
    z.object({
      id: z.string().min(1),
      firmId: z.string().min(1),
      name: z.string().min(1),
      family: z.string().min(1),
      stage: z.enum(['evaluation', 'funded', 'live']),
      accountSize: z.number().positive().nullable(),
      active: z.boolean(),
      line: z.string().min(1).optional(),
      options: z
        .array(z.object({ id: z.string().min(1), label: z.string().min(1), description: z.string().optional(), choices: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), description: z.string().optional() })).min(1), sources: z.array(sourceSchema) }))
        .optional(),
      versions: z.array(versionSchema),
    }),
  ),
});

export interface ParsedFirmRules {
  db: FirmRulesDatabase | null;
  errors: string[];
  /** Versions / rules marked verified without the evidence to back it — downgraded. */
  downgraded: string[];
}

const RULE_FIELDS = new Set(Object.keys(emptyRulesShape()));
function emptyRulesShape(): Record<keyof ProgramRules, true> {
  return {
    profitTarget: true, dailyLossLimit: true, maxDrawdown: true, drawdownType: true, trailingLocksAtStart: true, maxContracts: true, consistencyRule: true,
    minTradingDays: true, maxTradingDays: true, minProfitableDays: true, payoutThreshold: true, payoutRequirements: true, payoutFrequency: true, scalingRule: true,
    positionLimits: true, activationThreshold: true, newsTradingAllowed: true, newsRestriction: true, overnightAllowed: true, weekendHoldingAllowed: true,
    copyTradingAllowed: true, additionalRules: true, trailingLockOffset: true, maxDrawdownPct: true, drawdownLocksOnPayout: true, dailyLossMode: true,
    dailyLossBreach: true, dailyLossScaling: true, payout: true, inactivityRule: true,
  };
}

/**
 * Validate a rules feed (remote table, JSON file). A version claiming
 * `verified` without sources / reviewer / date is downgraded, never trusted.
 */
export function parseFirmRulesDatabase(input: unknown): ParsedFirmRules {
  const r = dbSchema.safeParse(input);
  if (!r.success) return { db: null, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), downgraded: [] };
  if (r.data.schemaVersion !== FIRM_RULES_SCHEMA_VERSION) return { db: null, errors: [`Unsupported schemaVersion ${r.data.schemaVersion}`], downgraded: [] };
  const errors: string[] = [];
  const firmIds = new Set(r.data.firms.map((f) => f.id));
  for (const p of r.data.programs) if (!firmIds.has(p.firmId)) errors.push(`${p.id}: unknown firm ${p.firmId}`);
  const downgraded: string[] = [];
  const programs = r.data.programs.map((p) => ({
    ...p,
    versions: p.versions.map((raw) => {
      let v = raw as ProgramRuleVersion;
      for (const rec of v.records ?? []) {
        if (rec.field && !RULE_FIELDS.has(rec.field)) errors.push(`${p.id}@${v.ruleVersion}: unknown field ${rec.field}`);
        for (const k of Object.keys(rec.structured ?? {})) if (!RULE_FIELDS.has(k)) errors.push(`${p.id}@${v.ruleVersion}#${rec.key}: unknown structured field ${k}`);
        for (const [o, c] of Object.entries(rec.when ?? {})) if (!p.options?.some((x) => x.id === o && x.choices.some((ch) => ch.id === c))) errors.push(`${p.id}@${v.ruleVersion}#${rec.key}: unknown option ${o}=${c}`);
      }
      // A rule claiming "verified" needs an official source with title and check date.
      if (v.records?.some((rec) => rec.status === 'verified' && !hasEvidence(rec))) {
        v = { ...v, records: v.records!.map((rec) => (rec.status === 'verified' && !hasEvidence(rec) ? (downgraded.push(`${p.id}@${v.ruleVersion}#${rec.key}`), { ...rec, status: 'needs_review' as const }) : rec)) };
      }
      if (v.verification.status === 'verified' && !isVerified(v)) {
        downgraded.push(`${p.id}@${v.ruleVersion}`);
        v = { ...v, verification: { ...v.verification, status: 'unverified' as const } };
      }
      return v;
    }),
  }));
  if (errors.length) return { db: null, errors, downgraded };
  return { db: { ...r.data, programs }, errors, downgraded };
}

/** Overlay a newer feed on the seed: firms/programs by id, rule versions by `ruleVersion`. */
export function mergeFirmRules(base: FirmRulesDatabase, overlay: FirmRulesDatabase | null): FirmRulesDatabase {
  if (!overlay) return base;
  const firms = new Map(base.firms.map((f) => [f.id, f]));
  for (const f of overlay.firms) firms.set(f.id, f);
  const programs = new Map(base.programs.map((p) => [p.id, p]));
  for (const p of overlay.programs) {
    const prev = programs.get(p.id);
    const versions = new Map((prev?.versions ?? []).map((v) => [v.ruleVersion, v]));
    for (const v of p.versions) versions.set(v.ruleVersion, v);
    programs.set(p.id, { ...p, versions: [...versions.values()] });
  }
  return {
    schemaVersion: FIRM_RULES_SCHEMA_VERSION,
    publishedAt: overlay.publishedAt > base.publishedAt ? overlay.publishedAt : base.publishedAt,
    source: 'merged',
    firms: [...firms.values()],
    programs: [...programs.values()],
  };
}

// ───────────────────────────── Configuration validation ─────────────────────────────

export interface ConfigIssue {
  field: 'program' | 'options' | 'size' | 'stage' | 'rules';
  message: string;
}

/**
 * Problems that would save a mismatched account: rules imported for a
 * different program / options / size, missing purchase options, or a size
 * that doesn't match the selected program. Empty = consistent.
 */
export function validateFirmConfiguration(db: FirmRulesDatabase, link: AccountFirmLink | null, form: { size: string }, onDate: string): ConfigIssue[] {
  if (!link?.programId) return [];
  const issues: ConfigIssue[] = [];
  const program = getProgram(db, link.programId);
  if (!program) return [{ field: 'program', message: 'The selected program is no longer in the rules database — choose it again or enter the rules manually.' }];
  if (link.firmId && program.firmId !== link.firmId) issues.push({ field: 'program', message: 'The selected program belongs to a different firm.' });
  if (link.stage && link.stage !== program.stage) issues.push({ field: 'stage', message: `Stage mismatch: the program is ${STAGE_LABEL[program.stage]} but ${STAGE_LABEL[link.stage]} was recorded.` });
  for (const o of missingOptions(program, link.options)) issues.push({ field: 'options', message: `Choose ${o.label} — it changes this account’s rules.` });
  const size = Number(String(form.size).replace(/[$,]/g, ''));
  if (program.accountSize && Number.isFinite(size) && size > 0 && size !== program.accountSize)
    issues.push({ field: 'size', message: `Account size $${size.toLocaleString('en-US')} doesn’t match the selected $${program.accountSize.toLocaleString('en-US')} program — pick the matching size.` });
  if (link.status === 'verified') {
    if (link.snapshot && link.snapshot.programId !== program.id) issues.push({ field: 'rules', message: 'The loaded rules belong to a different program — reload the rules for this selection.' });
    const imp = importProgramRules(program, link.purchasedOn ?? link.importedAt ?? onDate, link.options);
    if (imp.status === 'verified' && link.snapshot?.ruleVersion === imp.version.ruleVersion) {
      const stale = (Object.keys(link.imported) as FirmRuleField[]).filter((k) => k !== 'size' && imp.values[k] !== link.imported[k]);
      const extra = (Object.keys(imp.values) as FirmRuleField[]).filter((k) => k !== 'size' && link.imported[k] == null);
      if (stale.length || extra.length) issues.push({ field: 'rules', message: 'The loaded rules don’t match the selected options — reload the rules for this selection.' });
    }
  }
  return issues;
}
