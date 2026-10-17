import type { FirmRulesDatabase } from '@/data/propFirms/types';
import { accountToForm, formToAccount, ruleValuesOf, type AccountFormValues } from '@/features/accounts/accountSchema';
import type { Account, DrawdownType } from '@/types/domain';

import { applyImport, type ApplyResult, type ConfirmedImport } from '@/lib/engines/accountImport';
import { calcAfterOverrides, detectOverrides, findFirm, getProgram, importProgramRules, linkFor, validateFirmConfiguration, type ConfigIssue } from '@/lib/engines/firmRulesEngine';

/**
 * Save a NEW account straight from a confirmed screenshot import — the same
 * steps the account form runs, so verified prop-firm rules, the firm link
 * (snapshot + overrides), typed calculations and the import history are
 * identical to an account created through the form:
 *
 *   matched program → its VERIFIED rules (for the purchase date + options)
 *   + account settings the program leaves open (e.g. LucidFlex's DLL), from
 *     the screenshot when the trader kept them (`confirmed.ruleUpdates`)
 *   → formToAccount → calcAfterOverrides → applyImport (balance, observed
 *     floor, high-water mark, history).
 *
 * Nothing is invented: the size and balance must come from the screenshot or
 * the trader; a missing balance is an error, never the account size.
 */
export interface CreateFromImportInput {
  db: FirmRulesDatabase;
  id: string;
  name: string;
  firmName: string | null;
  /** Matched program (null = no program / trader chose not to load its rules). */
  programId: string | null;
  options: Record<string, string>;
  /** Purchase date for the rule version (screenshot date, else today). */
  ruleDate: string;
  confirmed: ConfirmedImport;
  now: Date;
}

export type CreateFromImportResult = { ok: true; result: ApplyResult; ruleSource: 'verified' | 'screenshot' | 'none' } | { ok: false; issues: ConfigIssue[] };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function createAccountFromImport(input: CreateFromImportInput): CreateFromImportResult {
  const { db, confirmed: c } = input;
  const program = input.programId ? getProgram(db, input.programId) : null;
  const firm = program ? (db.firms.find((f) => f.id === program.firmId) ?? null) : findFirm(db, input.firmName);
  const size = program?.accountSize ?? num(c.values.accountSize);
  const balance = num(c.values.balance);
  const issues: ConfigIssue[] = [];
  if (!input.name.trim()) issues.push({ field: 'program', message: 'Name the account.' });
  if (size == null || size <= 0) issues.push({ field: 'size', message: 'Enter the account size.' });
  if (balance == null || balance <= 0) issues.push({ field: 'size', message: 'Enter the current balance shown on your dashboard.' });
  if (issues.length) return { ok: false, issues };

  const now = input.now.toISOString();
  const imp = program ? importProgramRules(program, input.ruleDate, input.options) : null;
  const form: AccountFormValues = {
    ...accountToForm(null),
    name: input.name.trim().slice(0, 60),
    firm: (firm?.name ?? input.firmName ?? '').slice(0, 60),
    kind: 'prop',
    size: String(size),
    balance: String(balance),
  };
  if (imp?.status === 'verified') Object.assign(form, imp.values);
  // Account settings the program leaves open (or every rule, without verified rules) — from the screenshot.
  for (const [k, v] of Object.entries(c.ruleUpdates) as [keyof ConfirmedImport['ruleUpdates'], number][]) {
    if (imp?.status === 'verified' && String(imp.values[k] ?? '').trim() !== '') continue; // a verified rule wins
    if (v > 0) form[k] = String(v);
  }
  const dd = c.values.drawdownType;
  if (imp?.status !== 'verified' && (dd === 'eod_trailing' || dd === 'trailing' || dd === 'static')) form.drawdownType = dd as DrawdownType;

  const link = firm || form.firm ? linkFor(firm, program, imp, now, input.options) : null;
  const firmLink = link ? { ...link, purchasedOn: input.ruleDate, overrides: detectOverrides(link.imported, ruleValuesOf(form)) } : undefined;
  const problems = validateFirmConfiguration(db, firmLink ?? null, { size: form.size }, now);
  if (problems.length) return { ok: false, issues: problems };

  const account: Account = formToAccount(form, null, input.id, undefined, firmLink);
  const calc = firmLink?.status === 'verified' ? calcAfterOverrides(firmLink.calc, firmLink.overrides, form.dailyLossLimit) : undefined;
  if (calc) account.rules.calc = calc;
  else delete account.rules.calc;
  // Rule values are already on the account; the import only sets balance / floor / history.
  const result = applyImport(account, { ...c, ruleUpdates: {} }, `${input.id}:import`);
  // No verified program and no drawdown type on the screenshot: the form's default type is NOT a fact.
  const typeStated = imp?.status === 'verified' || dd === 'eod_trailing' || dd === 'trailing' || dd === 'static';
  if (!typeStated && result.account.importState) result.account.importState.unconfirmed = [...new Set([...(result.account.importState.unconfirmed ?? []), 'drawdownType' as const])];
  return { ok: true, result, ruleSource: imp?.status === 'verified' ? 'verified' : Object.keys(c.ruleUpdates).length ? 'screenshot' : 'none' };
}
