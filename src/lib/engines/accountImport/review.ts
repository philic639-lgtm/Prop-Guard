import type { ImportMatch } from './match';
import { DRAWDOWN_TYPE_LABEL, LOW_CONFIDENCE, type AmbiguousReading, type ExtractedField, type FieldKey, type FieldMap, type ImportCheck } from './types';

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
  /** Values found next to a label but not assigned (e.g. a loss next to "Profit target"). */
  ambiguous?: AmbiguousReading[];
  /** Drawdown methodology from the VERIFIED program rules (new) or the account (update). */
  verifiedDrawdownType?: 'eod_trailing' | 'trailing' | 'static' | null;
  /** Update: the account's current floor from its saved, confirmed configuration. */
  accountFloor?: number | null;
  /** No screenshot could be read and nothing was entered. */
  extractionFailed?: boolean;
}

/** Status of a summary card. Only `verified` is ever shown as verified (green); OCR readings never are. */
export type CardStatus = 'verified' | 'extracted' | 'calculated' | 'entered' | 'confirmed' | 'missing' | 'conflict' | 'review';
export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  verified: 'Verified',
  extracted: 'Extracted — needs confirmation',
  calculated: 'Calculated from verified inputs',
  entered: 'Entered by you',
  confirmed: 'Confirmed by you',
  missing: 'Missing',
  conflict: 'Conflicting information',
  review: 'Needs review',
};

export interface SummaryCard {
  key: 'balance' | 'drawdownRemaining' | 'dailyLossLimit' | 'profitTarget';
  label: string;
  value: number | null;
  status: CardStatus;
  /** Overrides the default status label (e.g. "Calculated from screenshot values"). */
  statusLabel: string;
  note?: string;
  /** The trader may type a value (never verified rules). */
  editable: boolean;
  /** Counted in "N fields need review". */
  needsReview: boolean;
  choices?: { value: number; screenshot: number }[];
  /** The underlying field to confirm with "Looks right". */
  confirmKey?: FieldKey;
}

export interface DetailRow {
  key: string;
  label: string;
  value: string;
  note?: string;
}

/** Remaining drawdown and how it was (or could not be) determined. */
export interface DrawdownState {
  status: 'available' | 'unavailable' | 'breached';
  remaining: number | null;
  threshold: number | null;
  basis: 'screenshot' | 'calculated' | 'account' | 'verified_static' | null;
  note: string;
}

export type ReviewState = 'ready' | 'needs_review' | 'missing_info' | 'failed';
export const REVIEW_STATE_LABEL: Record<ReviewState, string> = { ready: 'Ready to confirm', needs_review: 'Needs review', missing_info: 'Missing information', failed: 'Extraction failed' };

export const ADDITIONAL_INFO_REQUIRED = 'Additional account information required';
/** Blocker shown while a lower screenshot threshold needs the trader to confirm a reset. */
export const RESET_BLOCKER = 'Confirm the reset or correct the liquidation threshold.';

export interface ReviewModel {
  /** Header status. */
  state: ReviewState;
  /** "2 fields need review: Profit Target and Remaining Drawdown." (null when nothing does). */
  notice: string | null;
  /** The four summary cards: balance, remaining drawdown, daily loss limit, profit target. */
  summary: SummaryCard[];
  /** "Additional Account Details". */
  details: DetailRow[];
  drawdown: DrawdownState;
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

/**
 * Rows the trader must still act on that none of the four summary cards shows (e.g. an
 * uncertain total P&L after a corrected balance) — rendered inline with Edit / Confirm,
 * so every blocker can be resolved on the review card itself.
 */
export function rowsNeedingInput(model: Pick<ReviewModel, 'rows' | 'summary'>): ReviewRow[] {
  const onCards = new Set<string>(model.summary.map((c) => c.key));
  return model.rows.filter((r) => !onCards.has(r.key) && r.status !== 'ok' && (r.required || r.status === 'uncertain' || r.status === 'conflict'));
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
  for (const c of input.checks.filter((x) => x.status === 'conflict' && !x.id.startsWith('conflict:') && x.id !== 'different-accounts')) issues.push({ id: `c:${c.id}`, message: c.message, kind: 'ack' });

  // What still blocks saving.
  if (mode === 'new' && !input.name.trim()) blockers.push('Name the account.');
  for (const r of rows) {
    if (r.required && (r.status === 'missing' || typeof r.value !== 'number' || r.value <= 0)) blockers.push(`Enter the ${r.label.toLowerCase()}.`);
    else if (r.status === 'conflict') blockers.push(`Pick the correct ${r.label.toLowerCase()} — your screenshots disagree.`);
    else if (r.status === 'uncertain') blockers.push(`Check the ${r.label.toLowerCase()} — the reading is uncertain.`);
  }
  for (const o of input.missingOptions) blockers.push(`Choose the ${o.label} option.`);
  for (const i of issues) if (!input.acks[i.id]) blockers.push(i.kind === 'reset' ? RESET_BLOCKER : 'Resolve the item marked “Needs your attention”.');

  // Different accounts in one import: never saved together.
  if (input.checks.some((c) => c.id === 'different-accounts')) blockers.push('Remove the screenshots of the other account — import one account at a time.');

  const drawdown = drawdownState(input, bal, thr);
  const summary = summaryCards(input, rows, drawdown);
  const details = detailRows(input, rows, drawdown);
  const review = summary.filter((c) => c.needsReview).map((c) => c.label);
  const notice = review.length ? `${review.length} field${review.length > 1 ? 's' : ''} need${review.length > 1 ? '' : 's'} review: ${review.length > 1 ? `${review.slice(0, -1).join(', ')} and ${review[review.length - 1]}` : review[0]}.` : null;
  const uniqueBlockers = [...new Set(blockers)];
  const hasData = Object.values(fields).some((f) => f && f.source !== 'derived');
  const requiredMissing = rows.some((r) => r.required && r.status === 'missing') || input.missingOptions.length > 0;
  const state: ReviewState =
    input.extractionFailed && !hasData ? 'failed' : requiredMissing ? 'missing_info' : uniqueBlockers.length || review.length ? 'needs_review' : 'ready';

  return { state, notice, summary, details, drawdown, rows, issues, blockers: uniqueBlockers, saveableRules, rejected };
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Remaining drawdown, in this order — never from the account size or the plan name:
 * 1. balance − liquidation threshold, both read / entered for this account;
 * 2. a remaining amount read on the screenshot;
 * 3. update: balance − the account's saved floor;
 * 4. STATIC drawdown (verified rule): threshold = read starting balance − verified allowance;
 * otherwise unavailable — "Additional account information required".
 * Trailing drawdowns need the current threshold (it depends on the high-water mark).
 */
function drawdownState(input: ReviewInput, bal: number | null, thr: number | null): DrawdownState {
  const f = input.fields;
  const out = (status: DrawdownState['status'], remaining: number | null, threshold: number | null, basis: DrawdownState['basis'], note: string): DrawdownState => ({ status, remaining: remaining == null ? null : Math.round(remaining * 100) / 100, threshold, basis, note });
  const breachedOr = (rem: number, threshold: number | null, basis: DrawdownState['basis'], note: string) =>
    rem < 0 ? out('breached', rem, threshold, basis, 'The balance is below the liquidation threshold — the account may be breached, or a value is misread. Check both.') : out('available', rem, threshold, basis, note);
  if (bal != null && thr != null) return breachedOr(bal - thr, thr, 'calculated', `Balance ${usd(bal)} − liquidation threshold ${usd(thr)}.`);
  const remRead = f.drawdownRemaining && f.drawdownRemaining.source !== 'derived' && typeof f.drawdownRemaining.value === 'number' ? f.drawdownRemaining.value : null;
  if (remRead != null) return breachedOr(remRead, null, 'screenshot', 'Read on your screenshot.');
  if (bal != null && input.accountFloor != null) return breachedOr(bal - input.accountFloor, input.accountFloor, 'account', `Balance − your account’s saved floor ${usd(input.accountFloor)}.`);
  const start = f.startingBalance && f.startingBalance.source !== 'derived' && typeof f.startingBalance.value === 'number' ? f.startingBalance.value : null;
  const allowance = input.verifiedRules.maxDrawdown;
  if (input.verifiedDrawdownType === 'static' && bal != null && start != null && allowance != null)
    return breachedOr(bal - (start - allowance), start - allowance, 'verified_static', `Static drawdown (verified rule): threshold = starting balance ${usd(start)} − ${usd(allowance)}.`);
  const why =
    bal == null
      ? 'Enter the current balance first.'
      : input.verifiedDrawdownType === 'eod_trailing' || input.verifiedDrawdownType === 'trailing'
        ? 'Your plan’s drawdown trails your highest balance, so the threshold cannot be worked out from the balance alone. Add a screenshot showing the liquidation threshold (MLL / NLL), or enter it.'
        : 'Add a screenshot that shows the liquidation threshold (MLL / NLL / minimum balance), or enter it.';
  return out('unavailable', null, null, null, `${ADDITIONAL_INFO_REQUIRED}. ${why}`);
}

function cardFromRow(r: ReviewRow | undefined, key: SummaryCard['key'], label: string): SummaryCard {
  if (!r || r.value == null || r.status === 'missing')
    return { key, label, value: null, status: 'missing', statusLabel: CARD_STATUS_LABEL.missing, editable: true, needsReview: !!r?.required, ...(r?.required ? { note: 'Required — enter it from your dashboard.' } : {}) };
  const value = typeof r.value === 'number' ? r.value : null;
  if (r.status === 'conflict')
    return { key, label, value, status: 'conflict', statusLabel: CARD_STATUS_LABEL.conflict, editable: true, needsReview: true, note: 'Your screenshots disagree — pick the right value.', choices: (r.choices ?? []).filter((c): c is { value: number; screenshot: number } => typeof c.value === 'number') };
  if (r.status === 'uncertain') return { key, label, value, status: 'review', statusLabel: 'Needs review — unclear reading', editable: true, needsReview: true, confirmKey: r.key, note: 'Compare with your dashboard, then tap “Looks right” or edit.' };
  const status: CardStatus = r.source === 'verified_rule' ? 'verified' : r.source === 'edited' ? 'entered' : r.source === 'calculated' ? 'calculated' : 'extracted';
  return { key, label, value, status, statusLabel: status === 'extracted' && r.screenshot ? `Extracted — needs confirmation (screenshot ${r.screenshot})` : CARD_STATUS_LABEL[status], editable: status !== 'verified', needsReview: false, ...(r.note && status === 'verified' && r.note.startsWith('Your screenshot') ? { note: r.note } : {}) };
}

function summaryCards(input: ReviewInput, rows: ReviewRow[], dd: DrawdownState): SummaryCard[] {
  const row = (k: FieldKey) => rows.find((r) => r.key === k);
  const amb = (k: FieldKey) => (input.ambiguous ?? []).filter((a) => a.key === k);
  const balance = cardFromRow(row('balance'), 'balance', 'Current Balance');
  if (input.confirmedFields.has('balance') && balance.status === 'extracted') Object.assign(balance, { status: 'confirmed', statusLabel: CARD_STATUS_LABEL.confirmed });

  const thrRow = row('drawdownThreshold');
  const fromVerified = dd.basis === 'verified_static' || (dd.basis === 'calculated' && thrRow?.source === 'edited' && (row('balance')?.source === 'edited' || input.confirmedFields.has('balance')));
  const remaining: SummaryCard =
    dd.status === 'unavailable'
      ? { key: 'drawdownRemaining', label: 'Remaining Drawdown', value: null, status: 'missing', statusLabel: ADDITIONAL_INFO_REQUIRED, editable: false, needsReview: true, note: dd.note.replace(`${ADDITIONAL_INFO_REQUIRED}. `, '') }
      : {
          key: 'drawdownRemaining',
          label: 'Remaining Drawdown',
          value: dd.remaining,
          status: dd.status === 'breached' || thrRow?.status === 'conflict' ? 'conflict' : thrRow?.status === 'uncertain' ? 'review' : dd.basis === 'screenshot' ? 'extracted' : 'calculated',
          statusLabel:
            dd.status === 'breached'
              ? 'Check values — below threshold'
              : thrRow?.status === 'conflict'
                ? CARD_STATUS_LABEL.conflict
                : thrRow?.status === 'uncertain'
                  ? 'Needs review — unclear threshold'
                  : dd.basis === 'screenshot'
                    ? CARD_STATUS_LABEL.extracted
                    : dd.basis === 'account'
                      ? 'Calculated from your saved account'
                      : fromVerified
                        ? CARD_STATUS_LABEL.calculated
                        : 'Calculated from extracted values',
          editable: false,
          needsReview: dd.status === 'breached' || thrRow?.status === 'conflict' || thrRow?.status === 'uncertain',
          note: dd.note,
          ...(thrRow?.status === 'uncertain' ? { confirmKey: 'drawdownThreshold' as FieldKey } : {}),
        };

  const ruleCard = (k: 'dailyLossLimit' | 'profitTarget', label: string, missingNote: string): SummaryCard => {
    const r = row(k);
    const c = cardFromRow(r, k, label);
    const a = amb(k);
    if (c.status === 'missing') {
      if (a.length) return { ...c, status: 'review', statusLabel: 'Missing — unclear value nearby', needsReview: true, note: a[0].reason };
      return { ...c, note: missingNote };
    }
    if (input.confirmedFields.has(k) && c.status === 'extracted') return { ...c, status: 'confirmed', statusLabel: CARD_STATUS_LABEL.confirmed };
    return c;
  };
  return [
    balance,
    remaining,
    ruleCard('dailyLossLimit', 'Daily Loss Limit', 'Not shown — add it if your plan has one.'),
    ruleCard('profitTarget', 'Profit Target', 'Not shown — add it if your plan has one.'),
  ];
}

function detailRows(input: ReviewInput, rows: ReviewRow[], dd: DrawdownState): DetailRow[] {
  const f = input.fields;
  const out: DetailRow[] = [];
  const val = (k: FieldKey) => (f[k] && typeof f[k]!.value === 'number' ? (f[k]!.value as number) : null);
  const tag = (k: FieldKey) => (f[k]?.source === 'derived' ? 'Calculated' : f[k]?.source === 'user' || input.edited.has(k) ? 'Entered by you' : f[k] ? `Extracted (screenshot ${f[k]!.page + 1})` : undefined);
  const money = (k: FieldKey, label: string, missing = 'Not shown') => {
    const v = val(k);
    out.push({ key: k, label, value: v == null ? missing : usd(v), ...(v != null ? { note: tag(k) } : {}) });
  };
  money('startingBalance', 'Starting balance');
  money('netPnl', 'Net P&L');
  money('dailyPnl', 'Today’s P&L');
  const type = (typeof f.drawdownType?.value === 'string' ? f.drawdownType.value : null) as keyof typeof DRAWDOWN_TYPE_LABEL | null;
  const verifiedType = input.verifiedDrawdownType ?? null;
  out.push({
    key: 'drawdownType',
    label: 'Drawdown methodology',
    value: verifiedType ? DRAWDOWN_TYPE_LABEL[verifiedType] : type && DRAWDOWN_TYPE_LABEL[type] ? DRAWDOWN_TYPE_LABEL[type] : 'Not shown',
    ...(verifiedType ? { note: type && type !== verifiedType ? `Verified firm rule (screenshot says ${DRAWDOWN_TYPE_LABEL[type] ?? type})` : 'Verified firm rule' } : type ? { note: tag('drawdownType') } : {}),
  });
  const thr = dd.threshold ?? val('drawdownThreshold');
  out.push({ key: 'drawdownThreshold', label: 'Failure threshold (liquidation balance)', value: thr == null ? 'Not shown' : usd(thr), ...(thr != null ? { note: dd.basis === 'account' ? 'Your saved account' : dd.basis === 'verified_static' ? 'Calculated from verified rule' : tag('drawdownThreshold') } : {}) });
  const maxRow = rows.find((r) => r.key === 'maxDrawdown');
  const allowance = typeof maxRow?.value === 'number' ? maxRow.value : null;
  out.push({ key: 'maxDrawdown', label: 'Max drawdown allowance', value: allowance == null ? 'Not shown' : usd(allowance), ...(maxRow ? { note: maxRow.source === 'verified_rule' ? 'Verified firm rule' : tag('maxDrawdown') } : {}) });
  // Drawdown used: read, or allowance − remaining only when the remaining is known and within the allowance.
  const usedRead = val('currentDrawdown');
  const used = usedRead ?? (allowance != null && dd.remaining != null && dd.status === 'available' && dd.remaining <= allowance ? allowance - dd.remaining : null);
  out.push({ key: 'currentDrawdown', label: 'Drawdown used', value: used == null ? 'Not available' : usd(used), note: used == null ? 'Needs the allowance and the remaining drawdown' : usedRead != null ? tag('currentDrawdown') : 'Calculated: allowance − remaining (meaningful only while the threshold has not stopped trailing)' });
  // Remaining daily loss: only from today's P&L on the screenshot.
  const dll = rows.find((r) => r.key === 'dailyLossLimit');
  const today = val('dailyPnl');
  if (typeof dll?.value === 'number' && today != null)
    out.push({ key: 'dailyLossRemaining', label: 'Daily loss remaining', value: usd(Math.max(0, dll.value + Math.min(0, today))), note: 'Daily loss limit − today’s loss shown (open positions may not be included)' });
  return out;
}
