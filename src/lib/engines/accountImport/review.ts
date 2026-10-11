import type { ImportMatch } from './match';
import { LOW_CONFIDENCE, type ExtractedField, type FieldKey, type FieldMap, type ImportCheck } from './types';

/**
 * The trader-facing review: a few essential rows, each with WHERE its value
 * comes from — the screenshot, a verified firm rule, a calculation, or the
 * trader — and what still needs the trader before "Confirm & Save Account".
 *
 * Financial safety rules enforced here (and tested):
 * - The balance is only ever read or entered. Never derived from total P&L
 *   or from the account size.
 * - A liquidation / minimum balance (NLL, MLL level) is never a max loss
 *   allowance: an allowance reading that is balance-sized, or that cannot be
 *   checked against a balance or size, is not saved as one.
 * - Remaining drawdown = balance − liquidation threshold, only when BOTH were
 *   read (or entered) for this account; otherwise it is not shown.
 * - Uncertain or conflicting readings of essential values must be confirmed
 *   or corrected; verified rules are never replaced by a screenshot reading.
 */

export type ReviewSource = 'screenshot' | 'verified_rule' | 'calculated' | 'edited' | 'account';
export type ReviewStatus = 'ok' | 'uncertain' | 'conflict' | 'missing';

export interface ReviewRow {
  key: FieldKey;
  label: string;
  value: number | string | null;
  source: ReviewSource | null;
  status: ReviewStatus;
  required: boolean;
  /** Short plain-language note (never extraction internals). */
  note?: string;
  /** Screenshot (1-based) the value was read on. */
  screenshot?: number;
  /** Disagreeing readings to pick from (with their screenshot). */
  choices?: { value: number | string; screenshot: number }[];
}

export interface ReviewIssue {
  id: string;
  message: string;
  /** `reset`: the trader may confirm an account reset (a lower floor). */
  kind: 'ack' | 'reset';
}

export interface ReviewInput {
  mode: 'new' | 'update';
  fields: FieldMap;
  checks: ImportCheck[];
  match: ImportMatch;
  /** Verified rules applied to the account (new: the matched program's; update: the account's locked ones). */
  verifiedRules: Partial<Record<'maxDrawdown' | 'dailyLossLimit' | 'profitTarget', number>>;
  /** Rule fields the account already holds from a verified program (update) — never replaced. */
  locked: Set<string>;
  /** Fields the trader typed. */
  edited: Set<FieldKey>;
  /** Uncertain fields the trader marked as correct ("Looks right"). */
  confirmedFields: Set<FieldKey>;
  /** Acknowledged issues by id. */
  acks: Record<string, boolean>;
  /** Purchase options still to choose (verified rules cannot load until chosen). */
  missingOptions: { id: string; label: string }[];
  /** New account: the name the trader gave (or the suggested one). */
  name: string;
  /** Account size from the matched program, when one is loaded. */
  programSize: number | null;
  programName: string | null;
}

export interface ReviewModel {
  rows: ReviewRow[];
  issues: ReviewIssue[];
  /** Why "Confirm & Save Account" is disabled (empty = ready, apart from the final confirmation). */
  blockers: string[];
  /** Rule values from the screenshot that may be saved (not verified-stated, plausible, confirmed). */
  saveableRules: Partial<Record<'maxDrawdown' | 'dailyLossLimit' | 'profitTarget', number>>;
  /** Allowance readings that were NOT kept, with the reason (shown in "More details"). */
  rejected: { key: FieldKey; value: number; reason: string }[];
}

const num = (f: ExtractedField | undefined) => (f && typeof f.value === 'number' && Number.isFinite(f.value) ? f.value : null);
const RULE_LABEL = { maxDrawdown: 'Max loss allowance', dailyLossLimit: 'Daily loss limit', profitTarget: 'Profit target' } as const;

function sourceOf(f: ExtractedField, edited: boolean): ReviewSource {
  if (edited || f.source === 'user') return 'edited';
  return f.source === 'derived' ? 'calculated' : 'screenshot';
}

export function buildReview(input: ReviewInput): ReviewModel {
  const { fields, mode, edited, confirmedFields } = input;
  const rows: ReviewRow[] = [];
  const blockers: string[] = [];
  const rejected: ReviewModel['rejected'] = [];

  const fromField = (key: FieldKey, label: string, required: boolean, note?: string): ReviewRow => {
    const f = fields[key];
    if (!f) return { key, label, value: null, source: null, status: 'missing', required, ...(note ? { note } : {}) };
    const isEdited = edited.has(key) || f.source === 'user';
    const choices = !isEdited && f.alternatives?.length ? [{ value: f.value, screenshot: f.page + 1 }, ...f.alternatives.map((a) => ({ value: a.value, screenshot: a.page + 1 }))] : undefined;
    const uncertain = !isEdited && f.source !== 'derived' && f.confidence < LOW_CONFIDENCE && !confirmedFields.has(key);
    return {
      key,
      label,
      value: f.value,
      source: sourceOf(f, isEdited),
      status: choices ? 'conflict' : uncertain ? 'uncertain' : 'ok',
      required,
      ...(f.page >= 0 && !isEdited && f.source !== 'derived' ? { screenshot: f.page + 1 } : {}),
      ...(choices ? { choices } : {}),
      ...(note ? { note } : {}),
    };
  };

  // Account size (new accounts): the matched program's size, else read / entered.
  if (mode === 'new') {
    if (input.programSize != null) rows.push({ key: 'accountSize', label: 'Account size', value: input.programSize, source: 'verified_rule', status: 'ok', required: true, note: `${input.programName ?? 'Program'} size` });
    else rows.push(fromField('accountSize', 'Account size', true));
  }

  // Balance: read or entered — never calculated.
  const balanceRow = fromField('balance', 'Current balance', true);
  if (balanceRow.source === 'calculated') {
    balanceRow.value = null;
    balanceRow.source = null;
    balanceRow.status = 'missing';
  }
  rows.push(balanceRow);

  // Total P&L: shown only when on the screenshot; never stands in for the balance.
  if (fields.netPnl && fields.netPnl.source !== 'derived') rows.push(fromField('netPnl', 'Total P&L', false, 'Profit or loss so far — not the balance.'));

  // Liquidation threshold (NLL / MLL level / minimum balance).
  rows.push(fromField('drawdownThreshold', 'Liquidation threshold', false, 'The balance where the account fails (NLL / MLL).'));

  // Remaining buffer: only from a read/entered balance and a read/entered threshold.
  const bal = balanceRow.status !== 'missing' ? num(fields.balance) : null;
  const thrField = fields.drawdownThreshold;
  const thr = thrField && thrField.source !== 'derived' ? num(thrField) : null;
  if (bal != null && thr != null) {
    rows.push({ key: 'drawdownRemaining', label: 'Remaining before liquidation', value: Math.round((bal - thr) * 100) / 100, source: 'calculated', status: bal - thr < 0 ? 'uncertain' : 'ok', required: false, note: 'Balance − liquidation threshold' });
  }

  // Rules: a verified rule wins; a screenshot value only where none is stated.
  const ref = bal ?? (input.programSize != null ? input.programSize : num(fields.accountSize));
  const saveableRules: ReviewModel['saveableRules'] = {};
  for (const k of ['maxDrawdown', 'dailyLossLimit', 'profitTarget'] as const) {
    const verified = input.verifiedRules[k];
    const f = fields[k];
    if (verified != null) {
      const shot = num(f);
      rows.push({
        key: k,
        label: RULE_LABEL[k],
        value: verified,
        source: 'verified_rule',
        status: 'ok',
        required: false,
        ...(shot != null && Math.abs(shot - verified) > 1 ? { note: `Your screenshot shows ${shot.toLocaleString('en-US')} — the verified rule is kept. Check the program.` } : {}),
      });
      continue;
    }
    if (!f) continue;
    const v = num(f);
    // An allowance must be an amount well below the balance — a liquidation / minimum BALANCE never is.
    if (k === 'maxDrawdown' && v != null && (ref == null || v >= ref * 0.5)) {
      rejected.push({ key: k, value: v, reason: ref == null ? 'Cannot tell whether this is an allowance or a balance level without a balance or account size — not saved as max loss.' : 'Balance-sized — a liquidation / minimum balance, not a max loss allowance. Not saved as max loss.' });
      continue;
    }
    const row = fromField(k, RULE_LABEL[k], false, input.locked.has(k) ? 'The account’s verified rule is kept.' : 'From your screenshot (account setting)');
    if (input.locked.has(k)) continue; // update: verified account rule stays, nothing to save
    rows.push(row);
    if (v != null && v > 0 && row.status === 'ok') saveableRules[k] = v;
  }

  // Issues that need the trader (account mismatch, a lower floor, arithmetic that does not add up).
  const issues: ReviewIssue[] = [];
  for (const c of input.match.conflicts.filter((x) => x.severity === 'conflict'))
    issues.push({ id: `m:${c.field}:${c.message}`, message: c.message, kind: c.field === 'drawdownThreshold' ? 'reset' : 'ack' });
  for (const c of input.checks.filter((x) => x.status === 'conflict' && !x.id.startsWith('conflict:'))) issues.push({ id: `c:${c.id}`, message: c.message, kind: 'ack' });

  // What still blocks saving.
  if (mode === 'new' && !input.name.trim()) blockers.push('Name the account.');
  for (const r of rows) {
    if (r.required && (r.status === 'missing' || typeof r.value !== 'number' || r.value <= 0)) blockers.push(`Enter the ${r.label.toLowerCase()}.`);
    else if (r.status === 'conflict') blockers.push(`Pick the correct ${r.label.toLowerCase()} — your screenshots disagree.`);
    else if (r.status === 'uncertain') blockers.push(`Check the ${r.label.toLowerCase()} — the reading is uncertain.`);
  }
  for (const o of input.missingOptions) blockers.push(`Choose the ${o.label} option.`);
  for (const i of issues) if (!input.acks[i.id]) blockers.push(i.kind === 'reset' ? 'Confirm the reset or correct the liquidation threshold.' : 'Resolve the item marked “Needs your attention”.');

  return { rows, issues, blockers: [...new Set(blockers)], saveableRules, rejected };
}
