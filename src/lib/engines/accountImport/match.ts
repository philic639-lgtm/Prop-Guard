import type { FirmRulesDatabase, PropFirm, PropFirmProgram } from '@/data/propFirms/types';
import type { Account } from '@/types/domain';

import { findFirm, getProgram, importProgramRules } from '../firmRulesEngine';
import type { Extraction, FieldKey } from './types';

/**
 * Match an extraction to the rules database and the trader's accounts.
 *
 * Suggests firm → program → size → stage, compares screenshot numbers with
 * the program's VERIFIED rules (verified rules always win — a difference is
 * reported, never applied), flags conflicts with the account being updated,
 * and detects duplicates so an import never creates a second copy of an
 * existing account.
 */

export interface ProgramSuggestion {
  programId: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface RuleComparison {
  field: 'maxDrawdown' | 'dailyLossLimit' | 'profitTarget';
  label: string;
  screenshot: number | null;
  verified: number | null;
  status: 'match' | 'differs' | 'screenshot_only' | 'verified_only';
}

export interface ImportConflict {
  field: FieldKey | 'account' | 'program';
  severity: 'warning' | 'conflict';
  message: string;
}

export interface ImportMatch {
  firm: { id: string; name: string } | null;
  program: ProgramSuggestion | null;
  /** Other plausible programs (when the screenshot is ambiguous). */
  alternatives: ProgramSuggestion[];
  size: number | null;
  stage: 'evaluation' | 'funded' | 'live' | null;
  /** Purchase options inferred from the screenshot (e.g. Lucid DLL on when a daily loss limit is shown). */
  options: Record<string, string>;
  ruleComparisons: RuleComparison[];
  /**
   * Verified rules for the matched program on `ruleDate` (the purchase date on
   * the screenshot, else today — the same date the account form uses).
   */
  rulesStatus: 'verified' | 'not_verified' | 'needs_options' | 'no_program';
  rulesNote: string | null;
  ruleDate: string;
  conflicts: ImportConflict[];
  /** An existing account this import belongs to. Creating a new account is blocked for `same_account_number`. */
  duplicate: { accountId: string; name: string; reason: 'same_account_number' | 'same_configuration' } | null;
}

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const val = (x: Extraction, k: FieldKey) => x.fields[k]?.value;
const numVal = (x: Extraction, k: FieldKey) => {
  const v = val(x, k);
  return typeof v === 'number' ? v : null;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Account size from the screenshot: stated size, else a round starting balance. */
export function detectedSize(x: Extraction): number | null {
  const s = numVal(x, 'accountSize');
  if (s && s >= 5000) return s;
  const start = numVal(x, 'startingBalance');
  return start && start >= 10000 && start <= 500000 && start % 5000 === 0 ? start : null;
}

function scoreProgram(p: PropFirmProgram, text: string, size: number | null, stage: string | null): ProgramSuggestion {
  let score = 0;
  const reasons: string[] = [];
  if (size != null && p.accountSize === size) {
    score += 3;
    reasons.push(`Size ${money(size)}`);
  } else if (size != null && p.accountSize != null) score -= 3;
  if (stage && p.stage === stage) {
    score += 2;
    reasons.push(`Stage: ${stage}`);
  } else if (stage) score -= 2;
  const line = p.line ? norm(p.line) : null;
  if (line && text.includes(line)) {
    score += 4;
    reasons.push(`“${p.line}” on the screenshot`);
  } else {
    const fam = norm(p.family).split(' ').filter((w) => w.length > 3 && !['evaluation', 'funded', 'account', 'standard'].includes(w));
    const hits = fam.filter((w) => text.includes(w));
    if (hits.length && hits.length === fam.length) {
      score += 3;
      reasons.push(`“${p.family}” on the screenshot`);
    } else if (hits.length) score += 1;
  }
  return { programId: p.id, name: p.name, score, reasons };
}

export function matchImport(
  x: Extraction,
  ctx: { db: FirmRulesDatabase; accounts: Account[]; target?: Account | null; today: string; mode: 'new' | 'update' },
): ImportMatch {
  const conflicts: ImportConflict[] = [];
  const firmName = typeof val(x, 'firm') === 'string' ? (val(x, 'firm') as string) : null;
  const firm: PropFirm | null = firmName ? findFirm(ctx.db, firmName) : null;
  const size = detectedSize(x);
  const stage = (val(x, 'stage') as ImportMatch['stage']) ?? null;
  const text = norm([val(x, 'program'), firmName].filter(Boolean).join(' '));

  // Program suggestion.
  let program: ProgramSuggestion | null = null;
  let alternatives: ProgramSuggestion[] = [];
  if (firm) {
    const scored = ctx.db.programs
      .filter((p) => p.firmId === firm.id && p.active)
      .map((p) => scoreProgram(p, text, size, stage))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score) && scored[0].score >= 5) program = scored[0];
    alternatives = scored.filter((s) => s !== program).slice(0, 3);
  }

  // Purchase options the screenshot can tell us (only DLL on/off today).
  const options: Record<string, string> = {};
  const prog = program ? getProgram(ctx.db, program.programId) : null;
  const dllOption = prog?.options?.find((o) => o.id === 'dll');
  if (dllOption && numVal(x, 'dailyLossLimit') != null) options.dll = 'on';

  // Screenshot vs VERIFIED rules — verified rules are never overwritten.
  const ruleComparisons: RuleComparison[] = [];
  const start = val(x, 'startDate');
  const ruleDate = typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start) && start <= ctx.today ? start : ctx.today;
  let rulesStatus: ImportMatch['rulesStatus'] = 'no_program';
  let rulesNote: string | null = null;
  if (prog) {
    const imp = importProgramRules(prog, ruleDate, options);
    rulesStatus = imp.status === 'verified' ? 'verified' : imp.status === 'needs_options' ? 'needs_options' : 'not_verified';
    if (imp.status === 'needs_options') rulesNote = `${imp.reason} Pick it on the account form.`;
    if (imp.status === 'unverified') {
      const from = [...prog.versions].filter((v) => v.verification.status === 'verified').map((v) => v.effectiveDate).sort()[0];
      rulesNote = `No verified ${prog.name} rules are on file for a purchase date of ${ruleDate}${from ? ` (verified rules start ${from.slice(0, 10)})` : ''}. Rule values are not loaded automatically — enter them or save the screenshot values as unverified.`;
    }
    if (imp.status === 'verified') {
      const fields: [RuleComparison['field'], string, keyof typeof imp.values][] = [
        ['maxDrawdown', 'Max drawdown', 'maxDrawdown'],
        ['dailyLossLimit', 'Daily loss limit', 'dailyLossLimit'],
        ['profitTarget', 'Profit target', 'profitTarget'],
      ];
      for (const [field, label, k] of fields) {
        const v = imp.values[k];
        const verified = v != null && v !== '' ? Number(v) : null;
        const shot = numVal(x, field);
        if (verified == null && shot == null) continue;
        const status: RuleComparison['status'] = verified == null ? 'screenshot_only' : shot == null ? 'verified_only' : Math.abs(verified - shot) <= 1 ? 'match' : 'differs';
        ruleComparisons.push({ field, label, screenshot: shot, verified, status });
        if (status === 'differs')
          conflicts.push({ field, severity: 'warning', message: `${label}: screenshot shows ${money(shot!)}, verified ${prog.name} rules say ${money(verified!)}. The verified rule is kept — check the program and purchase options.` });
      }
    }
  }

  // Duplicates.
  let duplicate: ImportMatch['duplicate'] = null;
  if (x.fingerprint) {
    const same = ctx.accounts.find((a) => a.importState?.fingerprint === x.fingerprint);
    if (same) duplicate = { accountId: same.id, name: same.name, reason: 'same_account_number' };
  }
  if (!duplicate && ctx.mode === 'new' && program) {
    const same = ctx.accounts.find((a) => a.status === 'active' && a.firmLink?.programId === program!.programId && (!x.fingerprint || !a.importState?.fingerprint));
    if (same) duplicate = { accountId: same.id, name: same.name, reason: 'same_configuration' };
  }

  // Conflicts with the account being updated.
  const t = ctx.target;
  if (t) {
    if (x.fingerprint && t.importState?.fingerprint && t.importState.fingerprint !== x.fingerprint)
      conflicts.push({ field: 'account', severity: 'conflict', message: `This screenshot shows a different account number than the one previously imported for ${t.name}.` });
    if (duplicate && duplicate.reason === 'same_account_number' && duplicate.accountId !== t.id)
      conflicts.push({ field: 'account', severity: 'conflict', message: `This account number was imported for “${duplicate.name}”, not ${t.name}.` });
    if (firm && t.firm && !norm(t.firm).includes(norm(firm.name).split(' ')[0]) && !norm(firm.name).includes(norm(t.firm).split(' ')[0]))
      conflicts.push({ field: 'firm', severity: 'conflict', message: `Screenshot is from ${firm.name}; this account is with ${t.firm}.` });
    if (size != null && t.size && Math.abs(size - t.size) > 1)
      conflicts.push({ field: 'accountSize', severity: 'conflict', message: `Screenshot shows a ${money(size)} account; this account is ${money(t.size)}.` });
    if (stage && t.firmLink?.stage && t.firmLink.stage !== stage)
      conflicts.push({ field: 'stage', severity: 'conflict', message: `Screenshot shows the ${stage} stage; this account is set up as ${t.firmLink.stage}.` });
    if (program && t.firmLink?.programId && t.firmLink.programId !== program.programId && !conflicts.some((c) => c.field === 'accountSize' || c.field === 'stage'))
      conflicts.push({ field: 'program', severity: 'warning', message: `Screenshot looks like ${program.name}; this account is set up as ${t.firmLink.programName ?? t.firmLink.programId}.` });
  } else if (duplicate) {
    conflicts.push({
      field: 'account',
      severity: duplicate.reason === 'same_account_number' ? 'conflict' : 'warning',
      message:
        duplicate.reason === 'same_account_number'
          ? `This account is already in Prop Guard as “${duplicate.name}”. The import will update it instead of creating a duplicate.`
          : `You already have an active ${program?.name ?? 'account'} (“${duplicate.name}”). Update it, or confirm this is a different account.`,
    });
  }

  return { firm: firm ? { id: firm.id, name: firm.name } : null, program, alternatives, size, stage, options, ruleComparisons, rulesStatus, rulesNote, ruleDate, conflicts, duplicate };
}
