import { z } from 'zod';

import {
  FIRM_RULES_SCHEMA_VERSION,
  type FirmRulesDatabase,
  type ProgramRules,
  type ProgramRuleVersion,
  type ProgramStage,
  type PropFirm,
  type PropFirmProgram,
} from '@/data/propFirms/types';
import type { AccountFirmLink, DrawdownType, FirmRuleField, FirmRuleValues } from '@/types/domain';

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

export const STAGE_LABEL: Record<ProgramStage, string> = { evaluation: 'Evaluation', funded: 'Funded', live: 'Live' };
const STAGE_ORDER: ProgramStage[] = ['evaluation', 'funded', 'live'];

/** Active programs of a firm: evaluation → funded → live, then by family and size. */
export function programsForFirm(db: FirmRulesDatabase, firmId: string): PropFirmProgram[] {
  return db.programs
    .filter((p) => p.firmId === firmId && p.active)
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.family.localeCompare(b.family) || (a.accountSize ?? Infinity) - (b.accountSize ?? Infinity));
}

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
  put('dailyLossLimit', rules.dailyLossLimit);
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

export type FirmRuleImport =
  | { status: 'verified'; version: ProgramRuleVersion; values: FirmRuleValues; additionalRules: ProgramRules['additionalRules'] }
  | { status: 'unverified'; version: ProgramRuleVersion | null; reason: string };

/** What selecting `program` imports. Unverified data is reported, never applied. */
export function importProgramRules(program: PropFirmProgram, onDate: string): FirmRuleImport {
  const version = activeRuleVersion(program, onDate);
  if (!version) return { status: 'unverified', version: null, reason: 'No verified rules are on file for this program yet.' };
  if (!isVerified(version)) return { status: 'unverified', version, reason: 'The rules on file for this program have not been verified against the firm’s official terms.' };
  const values = rulesToValues(version.rules);
  if (program.accountSize) values.size = String(program.accountSize);
  return { status: 'verified', version, values, additionalRules: version.rules.additionalRules };
}

/** The account's link to the database after selecting a program. */
export function linkFor(firm: PropFirm | null, program: PropFirmProgram | null, imp: FirmRuleImport | null, now: string): AccountFirmLink {
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
  };
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

const money = (n: number | null) => (n == null ? null : `$${n.toLocaleString('en-US')}`);
const yesNo = (b: boolean | null, extra?: string | null) => (b == null ? null : `${b ? 'Allowed' : 'Not allowed'}${extra ? ` — ${extra}` : ''}`);
const DD_LABEL: Record<DrawdownType, string> = { static: 'Static', trailing: 'Intraday trailing', eod_trailing: 'End-of-day trailing' };

/** Every rule of a version as display lines; `value: null` = not stated / not verified. */
export function ruleLines(r: ProgramRules): RuleLine[] {
  return [
    { key: 'profitTarget', label: 'Profit target', value: money(r.profitTarget) },
    { key: 'dailyLossLimit', label: 'Daily loss limit', value: money(r.dailyLossLimit) },
    { key: 'maxDrawdown', label: 'Maximum drawdown / loss limit', value: money(r.maxDrawdown) },
    { key: 'drawdownType', label: 'Drawdown type', value: r.drawdownType ? `${DD_LABEL[r.drawdownType]}${r.trailingLocksAtStart ? ' (stops trailing at starting balance)' : ''}` : null },
    { key: 'maxContracts', label: 'Maximum contracts', value: r.maxContracts == null ? null : String(r.maxContracts) },
    { key: 'consistency', label: 'Consistency rule', value: r.consistencyRule ? `${r.consistencyRule.maxDayPctOfProfit != null ? `${r.consistencyRule.maxDayPctOfProfit}% max in one day — ` : ''}${r.consistencyRule.description}` : null },
    { key: 'minTradingDays', label: 'Minimum trading days', value: r.minTradingDays == null ? null : String(r.minTradingDays) },
    { key: 'maxTradingDays', label: 'Maximum trading days', value: r.maxTradingDays == null ? null : String(r.maxTradingDays) },
    { key: 'minProfitableDays', label: 'Minimum profitable days', value: r.minProfitableDays == null ? null : String(r.minProfitableDays) },
    { key: 'payoutThreshold', label: 'Payout threshold', value: money(r.payoutThreshold) },
    { key: 'payoutFrequency', label: 'Payout frequency', value: r.payoutFrequency },
    { key: 'payoutRequirements', label: 'Payout eligibility', value: r.payoutRequirements.length ? r.payoutRequirements.join('; ') : null },
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
});
const versionSchema = z.object({
  ruleVersion: z.string().min(1),
  effectiveDate: iso,
  lastVerifiedAt: iso.nullable(),
  verification: z.object({
    status: z.enum(['verified', 'unverified']),
    sources: z.array(z.object({ url: z.string().url(), title: z.string().optional(), retrievedAt: iso })),
    verifiedBy: z.string().nullable(),
    notes: z.string().optional(),
  }),
  rules: rulesSchema,
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
      versions: z.array(versionSchema),
    }),
  ),
});

export interface ParsedFirmRules {
  db: FirmRulesDatabase | null;
  errors: string[];
  /** Versions marked verified without the evidence to back it — downgraded to unverified. */
  downgraded: string[];
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
    versions: p.versions.map((v) => {
      if (v.verification.status === 'verified' && !isVerified(v)) {
        downgraded.push(`${p.id}@${v.ruleVersion}`);
        return { ...v, verification: { ...v.verification, status: 'unverified' as const } };
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
