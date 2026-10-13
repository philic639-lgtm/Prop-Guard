import { resolveLevels } from './reconcile';
import { FIELD_LABEL, type AmbiguousReading, type DateField, type ExtractedField, type FieldKey, type FieldMap, type MoneyField, type OcrBox, type OcrLine, type OcrPage, type OcrWord, type PageExtraction, type SensitiveItem, type TextField } from './types';

/**
 * Label- and layout-aware extraction from one OCR page.
 *
 * A value is only taken when it sits next to a recognised label: on the same
 * line ("Balance  $50,812.25"), or in the same column directly below/above a
 * label in a card or grid layout ("Account Balance" over "$51,240.50"). Loose
 * numbers without a label are ignored. Labels are matched longest-first so
 * "Daily Loss Limit" is never read as "Loss Limit", "Starting Balance" never
 * as "Balance", and "MLL Balance" (a threshold) never as the account balance.
 */

// ───────────────────────────── Labels ─────────────────────────────

/** `ignore`: look-alike numbers that must never fill a field (their value is claimed and dropped). */
type LabelTarget = FieldKey | 'sensitive:account_id' | 'sensitive:name' | 'ignore';

const LABELS: { target: LabelTarget; phrases: string[]; weight: number }[] = [
  // Balance (current)
  { target: 'balance', phrases: ['account balance', 'current balance', 'cash balance', 'net liquidation value', 'net liquidation', 'net liq', 'live balance'], weight: 1 },
  { target: 'balance', phrases: ['balance'], weight: 0.92 },
  { target: 'startingBalance', phrases: ['starting balance', 'start balance', 'initial balance', 'starting capital', 'beginning balance', 'opening balance'], weight: 1 },
  // Drawdown: four different things — never interchangeable.
  { target: 'drawdownThreshold', phrases: ['liquidation threshold', 'auto-liquidate threshold', 'auto liquidate threshold', 'auto-liquidation threshold', 'auto liquidation threshold', 'trailing threshold', 'drawdown threshold', 'max loss threshold', 'loss limit threshold', 'liquidation level', 'liquidation balance', 'drawdown level', 'drawdown balance', 'mll balance', 'mll level', 'current mll', 'trailing mll', 'nll', 'net liquidation level', 'liquidation value level', 'loss limit level', 'max loss level', 'minimum balance', 'min balance', 'account threshold'], weight: 1 },
  { target: 'drawdownThreshold', phrases: ['threshold'], weight: 0.8 },
  { target: 'drawdownRemaining', phrases: ['remaining drawdown', 'drawdown remaining', 'drawdown left', 'available drawdown', 'drawdown available', 'distance to mll', 'distance to max loss', 'distance to liquidation', 'distance to threshold', 'distance to drawdown', 'room to max loss', 'max loss remaining', 'loss limit remaining', 'remaining loss allowance', 'remaining allowance'], weight: 1 },
  { target: 'drawdownRemaining', phrases: ['buffer'], weight: 0.65 },
  { target: 'currentDrawdown', phrases: ['current drawdown', 'drawdown used', 'used drawdown', 'drawdown utilized', 'open drawdown'], weight: 1 },
  { target: 'currentDrawdown', phrases: ['drawdown'], weight: 0.55 },
  { target: 'maxDrawdown', phrases: ['maximum loss limit', 'max loss limit', 'maximum drawdown', 'max drawdown', 'max trailing drawdown', 'trailing drawdown', 'eod drawdown', 'end of day drawdown', 'drawdown limit', 'max loss allowed'], weight: 1 },
  { target: 'maxDrawdown', phrases: ['mll', 'loss limit', 'max loss'], weight: 0.82 },
  { target: 'dailyLossLimit', phrases: ['daily loss limit', 'max daily loss', 'daily max loss', 'daily drawdown limit', 'daily loss', 'dll'], weight: 1 },
  { target: 'dailyPnl', phrases: ["today's p&l", 'todays p&l', 'today p&l', 'daily p&l', 'day p&l', "today's profit", 'daily profit'], weight: 1 },
  { target: 'netPnl', phrases: ['net p&l', 'total p&l', 'net profit', 'total profit', 'profit/loss', 'profit & loss', 'profit and loss', 'net pnl'], weight: 1 },
  // Platforms differ on whether "realized" is today or lifetime: readable, but always "verify".
  { target: 'netPnl', phrases: ['realized p&l'], weight: 0.8 },
  { target: 'netPnl', phrases: ['p&l'], weight: 0.85 },
  { target: 'profitTarget', phrases: ['profit target', 'profit goal', 'target profit'], weight: 1 },
  { target: 'profitTargetBalance', phrases: ['target balance', 'profit target balance', 'passing balance', 'pass balance'], weight: 1 },
  { target: 'tradingDays', phrases: ['trading days', 'days traded', 'traded days', 'days trading'], weight: 1 },
  { target: 'accountSize', phrases: ['account size', 'plan size', 'starting size', 'evaluation size'], weight: 1 },
  { target: 'program', phrases: ['plan', 'program', 'account type', 'product', 'plan name', 'account plan'], weight: 0.95 },
  { target: 'firm', phrases: ['prop firm', 'firm', 'firm name', 'provider', 'company'], weight: 0.9 },
  { target: 'stage', phrases: ['stage', 'phase', 'account stage'], weight: 0.95 },
  { target: 'status', phrases: ['status', 'account status'], weight: 0.95 },
  { target: 'startDate', phrases: ['purchase date', 'start date', 'date purchased', 'purchased on', 'purchased', 'activation date', 'activated', 'created', 'started', 'opened'], weight: 0.95 },
  { target: 'statementDate', phrases: ['last updated', 'updated', 'as of', 'statement date'], weight: 0.95 },
  // Look-alikes: not balance / P&L / target / drawdown values.
  {
    target: 'ignore',
    phrases: [
      'unrealized p&l', 'unrealized', 'open p&l', 'floating p&l', 'open profit', 'open position p&l',
      'buying power', 'available funds', 'available margin', 'excess liquidity', 'margin used', 'initial margin', 'maintenance margin', 'equity', 'net equity',
      'profit target remaining', 'remaining profit target', 'remaining target', 'target remaining', 'to target', 'distance to target', 'profit remaining', 'profit needed', 'needed to pass',
      'high water mark', 'highest balance', 'peak balance', 'max balance', 'highest eod balance', 'trailing high',
      // Rules shown next to progress ("Min trading days 5") are not the days traded.
      'minimum trading days', 'min trading days', 'required trading days', 'min. trading days', 'trading days required',
      'win rate', 'avg win', 'avg loss', 'average win', 'average loss', 'largest win', 'largest loss', 'commissions', 'fees', 'total trades', 'trades', 'contracts traded', 'volume',
    ],
    weight: 1,
  },
  { target: 'sensitive:account_id', phrases: ['account id', 'account #', 'account number', 'account no', 'acct #', 'acct', 'account'], weight: 1 },
  { target: 'sensitive:name', phrases: ['account holder', 'trader name', 'full name', 'name'], weight: 1 },
];

const COMPILED = LABELS.flatMap((l) => l.phrases.map((p) => ({ target: l.target, phrase: p, weight: l.weight, words: p.split(' ').length })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

const MONEY = new Set<FieldKey>(['accountSize', 'balance', 'startingBalance', 'netPnl', 'dailyPnl', 'maxDrawdown', 'drawdownThreshold', 'currentDrawdown', 'drawdownRemaining', 'dailyLossLimit', 'profitTarget', 'profitTargetBalance']);
const COUNT = new Set<FieldKey>(['tradingDays']);
/** A count token: "5", or "5/10" (days traded of days required). */
const parseCount = (raw: string): number | null => {
  const m = /^(\d{1,4})(?:\/\d{1,4})?$/.exec(raw.trim().replace(/[,;:.]+$/, ''));
  return m ? Number(m[1]) : null;
};
/**
 * Signs. P&L and remaining drawdown keep their sign (a negative remaining
 * drawdown is a breached account). Loss limits and drawdown used are often
 * printed as "−$600": kept as the amount, but marked for confirmation.
 * Every other money field is never negative — a negative reading next to its
 * label (e.g. "−$66.00" under "Profit target") is a different figure, so it
 * is NOT assigned: it becomes an ambiguous reading for the trader.
 */
const SIGNED = new Set<FieldKey>(['netPnl', 'dailyPnl', 'drawdownRemaining']);
const LOSS_AMOUNT = new Set<FieldKey>(['maxDrawdown', 'dailyLossLimit', 'currentDrawdown']);
/** Fields whose card can show "progress / limit" ("−$66 / $1,250"): the LIMIT is the value. */
const LIMIT_PAIR = new Set<FieldKey>(['profitTarget', 'profitTargetBalance', 'maxDrawdown', 'dailyLossLimit']);
const NEGATIVE_LOSS_CONFIDENCE = 0.62;
const DATES = new Set<FieldKey>(['startDate', 'statementDate']);

// ───────────────────────────── Tokens ─────────────────────────────

/** Lower-case label form of an OCR word ("P/L" / "PnL" → "p&l", trailing ":" removed). */
export function normWord(t: string): string {
  const w = t.toLowerCase().replace(/[:;|]+$/g, '').replace(/^[|]+/, '');
  // OCR often reads the "&" in P&L as "A", "8", "%", "$" or drops it.
  if (w === 'pnl' || w === 'p/l' || w === 'p&amp;l' || w === 'p+l' || /^p[&a8%$]?l$/.test(w)) return 'p&l';
  return w.replace(/’/g, "'");
}

/** Money from one OCR token. Accepts $1,234.56, -$500, (1,880.00), +1,240.50; O→0 inside digits. Null for ids, dates, text. */
export function parseMoney(raw: string, allowK = false): number | null {
  let t = raw.trim().replace(/[,.;:|]+$/, '').replace(/^usd/i, '').replace(/usd$/i, '');
  if (!t) return null;
  // No regex lookbehind anywhere in app code: Safari before iOS 16.4 rejects the whole bundle.
  if (/[0-9]/.test(t)) t = t.replace(/([\d,])[oO](?=[\d,.]|$)/g, (_, d: string) => `${d}0`).replace(/^[oO](?=[\d,])/, '0');
  const k = allowK ? /^\$?(\d{1,3}(?:\.\d)?)\s?[kK]$/.exec(t) : null;
  if (k) return Math.round(Number(k[1]) * 1000);
  const m = /^([+\-−])?\(?([+\-−])?\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[3].replace(/,/g, '') + (m[4] ?? ''));
  if (!Number.isFinite(n)) return null;
  const neg = (m[1] && m[1] !== '+') || (m[2] && m[2] !== '+') || (t.startsWith('(') && t.endsWith(')'));
  return neg ? -n : n;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** ISO date from 1–3 tokens: 09/15/2026, 2026-09-15, Sep 15, 2026. US month-first for slashes. */
export function parseDate(tokens: string[]): { iso: string; used: number } | null {
  const t0 = (tokens[0] ?? '').replace(/[,.]$/, '');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t0);
  if (m) return valid(+m[1], +m[2], +m[3], 1);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t0);
  if (m) return valid(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2], 1);
  const mi = MONTHS.indexOf(t0.slice(0, 3).toLowerCase());
  if (mi >= 0 && tokens.length >= 3) {
    const d = parseInt(tokens[1], 10);
    const y = parseInt(tokens[2], 10);
    if (d && y > 1999) return valid(y, mi + 1, d, 3);
  }
  return null;
  function valid(y: number, mo: number, d: number, used: number) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    return { iso: `${y}-${pad(mo)}-${pad(d)}`, used };
  }
}

const STAGE_WORDS: [RegExp, 'evaluation' | 'funded' | 'live'][] = [
  [/\b(live funded|live account|live)\b/, 'live'],
  [/\b(evaluation|eval|combine|challenge|assessment|qualifier)\b/, 'evaluation'],
  [/\b(funded|express funded|xfa|performance account|master account|sim funded)\b/, 'funded'],
];
export function stageFrom(text: string): 'evaluation' | 'funded' | 'live' | null {
  const t = text.toLowerCase();
  for (const [re, s] of STAGE_WORDS) if (re.test(t)) return s;
  return null;
}
const STATUS_WORDS = ['active', 'passed', 'failed', 'breached', 'liquidated', 'inactive', 'closed', 'pending', 'disabled', 'suspended', 'funded'];
export function statusFrom(text: string): string | null {
  const w = text.toLowerCase().split(/[^a-z]+/).find((x) => STATUS_WORDS.includes(x));
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : null;
}

/** Account-number-like token: digits + letters/hyphens, not money, size or date. */
export function looksLikeAccountId(t: string): boolean {
  const s = t.replace(/[,;:|]+$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{5,}$/.test(s)) return false;
  if ((s.match(/\d/g) ?? []).length < 4) return false;
  if (parseMoney(s, true) != null) return false;
  // Dates ("2026-10-13", "10-13-2026") are never account numbers.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s) || /^\d{1,2}-\d{1,2}-\d{2,4}$/.test(s)) return false;
  return /-/.test(s) || /[A-Za-z]/.test(s);
}

/** Non-reversible fingerprint (two FNV-1a passes) — lets us spot duplicates without storing the number. */
export function fingerprintOf(id: string): string {
  const text = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x811c9dc5) ^ (b >>> 13);
  }
  return `acct:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

export const maskId = (id: string) => {
  const alnum = id.replace(/[^A-Za-z0-9]/g, '');
  return `••••${alnum.slice(-4)}`;
};

/** Line text safe to show/store as evidence: account numbers and emails masked. */
export function redactText(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(w.replace(/[,;]+$/, '')) ? '[email]' : looksLikeAccountId(w) ? maskId(w) : w))
    .join(' ');
}

const unionBox = (ws: OcrWord[]): OcrBox => ({
  x0: Math.min(...ws.map((w) => w.bbox.x0)),
  y0: Math.min(...ws.map((w) => w.bbox.y0)),
  x1: Math.max(...ws.map((w) => w.bbox.x1)),
  y1: Math.max(...ws.map((w) => w.bbox.y1)),
});

// ───────────────────────────── Label spans ─────────────────────────────

interface LabelHit {
  target: LabelTarget;
  phrase: string;
  weight: number;
  line: number;
  w0: number;
  w1: number; // exclusive
  bbox: OcrBox;
}

/** One edit (insert / delete / substitute) apart — "Profi" ~ "profit", "Daly" ~ "daily". */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * A label word read with one OCR slip still counts, but only inside a
 * multi-word label where another word matched exactly (never a lone word:
 * "trader" must not become "trades"), and only for words of 4+ letters.
 */
const fuzzyWord = (token: string, part: string) => part.length >= 4 && /^[a-z']+$/.test(token) && token[0] === part[0] && oneEditApart(token, part);

/** Column headers of trade / order tables: their "P&L" or "Balance" columns are not account values. */
const TABLE_WORDS = new Set(['date', 'time', 'symbol', 'instrument', 'contract', 'side', 'qty', 'quantity', 'entry', 'exit', 'price', 'fill', 'b/s', 'buy/sell', 'direction', 'duration', 'commission', 'opened', 'closed']);
export function isTableHeader(line: OcrLine): boolean {
  return line.words.filter((w) => TABLE_WORDS.has(normWord(w.text))).length >= 3;
}
/** A row of such a table: a date or a futures contract symbol (MNQZ6, ESZ26). */
const ROW_TOKEN = /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|M?[A-Z]{1,3}[FGHJKMNQUVXZ]\d{1,2})$/;
const isTableRow = (line: OcrLine) => line.words.some((w) => ROW_TOKEN.test(w.text.replace(/[,;]+$/, '')));

function findLabels(line: OcrLine, li: number): LabelHit[] {
  if (isTableHeader(line)) return [];
  const tokens = line.words.map((w) => normWord(w.text));
  const used = new Array(tokens.length).fill(false);
  const hits: LabelHit[] = [];
  // Longest phrase first, slips allowed inside it: "Daly Loss Limit" must not be read as "Loss Limit".
  for (const l of COMPILED) {
    const n = l.words;
    const parts = l.phrase.split(' ');
    for (let i = 0; i + n <= tokens.length; i++) {
      let ok = true;
      let exact = 0;
      for (let k = 0; k < n && ok; k++) {
        if (used[i + k]) ok = false;
        else if (tokens[i + k] === parts[k]) exact++;
        else if (n < 2 || !fuzzyWord(tokens[i + k], parts[k])) ok = false;
      }
      if (!ok || exact === 0) continue;
      for (let k = 0; k < n; k++) used[i + k] = true;
      // A slip in the label makes the reading "check this", never high confidence.
      hits.push({ target: l.target, phrase: l.phrase, weight: exact < n ? l.weight * 0.88 : l.weight, line: li, w0: i, w1: i + n, bbox: unionBox(line.words.slice(i, i + n)) });
    }
  }
  return hits.sort((a, b) => a.w0 - b.w0);
}

// ───────────────────────────── Page extraction ─────────────────────────────

export interface ExtractOptions {
  /** Firm names / aliases to recognise (from the rules database). */
  firms?: { id: string; name: string; aliases: string[] }[];
}

/** Sidebar / menu words OCR merges into neighbouring lines. */
const NAV_WORDS = new Set(['dashboard', 'accounts', 'payouts', 'billing', 'settings', 'home', 'overview', 'help', 'center', 'support', 'menu', 'profile', 'logout']);
const CONNECTORS = new Set(['', '$', 'usd', ':', '-', '—', '=', '|']);
/** Separators and "ⓘ" info icons, which OCR reads as "(©", "@", "(0", "®"… */
const isFiller = (t: string) => CONNECTORS.has(normWord(t)) || /^[(\[{]?[©@®ⓘ*][)\]}]?$/.test(t) || /^[(\[{][0oOi]?[)\]}]?$/.test(t);

/**
 * The money value for `key` starting at `words[i]`, with its sign policy and
 * "progress / limit" pairs ("−$66.00 / $1,250.00", "$400 of $600"): for a
 * limit field the LIMIT is the value and the progress part is reported as
 * ambiguous. `used` = word indices consumed.
 */
type MoneyRead = { value: number; factor: number; used: number[]; ambiguous?: { value: number; reason: string } } | { rejected: { value: number; reason: string }; used: number[] } | null;
function readMoney(key: FieldKey, words: OcrWord[], i: number, label: string): MoneyRead {
  const w = words[i];
  if (!w) return null;
  let first = parseMoney(w.text, key === 'accountSize');
  let limit: number | null = null;
  let used = [i];
  const glued = /^(.+?)\/(.+)$/.exec(w.text);
  if (first == null && glued && LIMIT_PAIR.has(key)) {
    first = parseMoney(glued[1]);
    limit = parseMoney(glued[2]);
  } else if (first != null && LIMIT_PAIR.has(key) && words[i + 1] && /^(\/|of)$/i.test(words[i + 1].text) && words[i + 2]) {
    limit = parseMoney(words[i + 2].text);
    if (limit != null) used = [i, i + 1, i + 2];
  }
  if (first == null) return null;
  if (limit != null && limit > 0) {
    return { value: limit, factor: 0.95, used, ambiguous: { value: first, reason: `Progress shown with ${label} (${fmtMoney(first)} of ${fmtMoney(limit)}) — not used as the ${label}.` } };
  }
  if (first >= 0 || SIGNED.has(key)) return { value: first, factor: 1, used };
  if (LOSS_AMOUNT.has(key)) return { value: Math.abs(first), factor: NEGATIVE_LOSS_CONFIDENCE, used };
  return { rejected: { value: first, reason: `${fmtMoney(first)} is a negative amount (a loss) next to “${label}” — it cannot be the ${label}. Not used.` }, used };
}
const fmtMoney = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function extractPage(page: OcrPage, pageIndex = 0, opts: ExtractOptions = {}): PageExtraction {
  const fields: FieldMap = {};
  const sensitive: SensitiveItem[] = [];
  const claimed = new Set<string>(); // `${line}:${word}`
  const wordCount = page.lines.reduce((n, l) => n + l.words.length, 0);
  const quality: PageExtraction['quality'] = wordCount < 6 || page.confidence < 60 ? 'poor' : page.confidence < 78 ? 'fair' : 'good';
  const qualityFactor = quality === 'poor' ? 0.6 : quality === 'fair' ? 0.88 : 1;

  const labels = page.lines.map((l, i) => findLabels(l, i));

  // Every reading is kept; several DIFFERENT readings of one field on a page are an ambiguity, not a choice.
  const cands: Partial<Record<FieldKey, ExtractedField[]>> = {};
  const ambiguous: AmbiguousReading[] = [];
  const labelText = (h: LabelHit) => page.lines[h.line].words.slice(h.w0, h.w1).map((x) => x.text).join(' ');
  const put = (key: FieldKey, value: number | string, confidence: number, evidence: string) => {
    const c = Math.max(0, Math.min(1, confidence * qualityFactor));
    (cands[key] ??= []).push({ key, value, confidence: Math.round(c * 100) / 100, source: 'ocr', evidence, page: pageIndex });
  };
  const addSensitive = (kind: SensitiveItem['kind'], raw: string, bbox: OcrBox | null) => {
    const clean = raw.replace(/[,;:|]+$/, '');
    if (sensitive.some((s) => s.kind === kind && s.masked === maskId(clean))) return;
    sensitive.push({
      kind,
      masked: kind === 'email' ? clean.replace(/^(.).*(@.*)$/, '$1•••$2') : kind === 'name' ? `${clean.charAt(0)}•••` : maskId(clean),
      page: pageIndex,
      bbox,
      fingerprint: kind === 'account_id' ? fingerprintOf(clean) : null,
    });
  };

  // Pass 1 — same-line values.
  const pending: LabelHit[] = [];
  page.lines.forEach((line, li) => {
    const hits = labels[li];
    hits.forEach((h, hi) => {
      const end = hi + 1 < hits.length ? hits[hi + 1].w0 : line.words.length;
      let words = line.words.slice(h.w1, end).filter((w) => !isFiller(w.text));
      // "$ 51,240.50" → join a lone "$".
      const startIdx = line.words.findIndex((w) => w === words[0]);
      if (h.target === 'sensitive:account_id') {
        const id = words.find((w) => looksLikeAccountId(w.text));
        if (id) {
          addSensitive('account_id', id.text, id.bbox);
          claimed.add(`${li}:${line.words.indexOf(id)}`);
        }
        return;
      }
      if (h.target === 'ignore') {
        const v = words[0] && (parseMoney(words[0].text) != null || /^[+-]?\$?[\d,.]+%$/.test(words[0].text));
        if (v) claimed.add(`${li}:${startIdx}`);
        else pending.push(h);
        return;
      }
      if (h.target === 'sensitive:name') {
        if (words.length) addSensitive('name', words.map((w) => w.text).join(' '), unionBox(words));
        return;
      }
      const key = h.target;
      if (!words.length) {
        pending.push(h);
        return;
      }
      if (COUNT.has(key)) {
        const v = parseCount(words[0].text);
        if (v == null) {
          pending.push(h);
          return;
        }
        claimed.add(`${li}:${startIdx}`);
        put(key, v, (words[0].confidence / 100) * h.weight, `“${redactText(line.text)}”`);
      } else if (MONEY.has(key)) {
        const r = readMoney(key, words, 0, FIELD_LABEL[key].replace(/ \(.*\)$/, '').toLowerCase());
        if (r == null) {
          pending.push(h);
          return;
        }
        for (const u of r.used) claimed.add(`${li}:${line.words.indexOf(words[u])}`);
        if ('rejected' in r) {
          ambiguous.push({ key, value: r.rejected.value, reason: r.rejected.reason, evidence: `“${redactText(line.text)}”`, page: pageIndex });
          return;
        }
        if (r.ambiguous) ambiguous.push({ key, ...r.ambiguous, evidence: `“${redactText(line.text)}”`, page: pageIndex });
        put(key, r.value, (words[0].confidence / 100) * h.weight * r.factor, `“${redactText(line.text)}”`);
      } else if (DATES.has(key)) {
        const d = parseDate(words.map((w) => w.text));
        if (d) put(key as DateField, d.iso, (Math.min(...words.slice(0, d.used).map((w) => w.confidence)) / 100) * h.weight, `“${redactText(line.text)}”`);
      } else {
        words = words.filter((w) => !looksLikeAccountId(w.text));
        const text = words.map((w) => w.text).join(' ').trim();
        const conf = (Math.min(...words.map((w) => w.confidence)) / 100) * h.weight;
        if (key === 'stage') {
          const s = stageFrom(text);
          if (s) put('stage', s, conf, `“${redactText(line.text)}”`);
        } else if (key === 'status') {
          const s = statusFrom(text);
          if (s) put('status', s, conf, `“${redactText(line.text)}”`);
        } else if ((key === 'program' || key === 'firm') && text.length >= 2 && /[a-z]/i.test(text)) put(key, text, conf, `“${redactText(line.text)}”`);
      }
    });
  });

  // Pass 2 — card / grid layouts: value in the same column on a nearby label-free line.
  const valueLines = page.lines.map((l, i) => labels[i].length === 0 && !isTableHeader(l) && !isTableRow(l));
  for (const h of pending) {
    if (!MONEY.has(h.target as FieldKey) && !COUNT.has(h.target as FieldKey) && h.target !== 'ignore') continue;
    const key = h.target as MoneyField | 'tradingDays' | 'ignore';
    const parseFor = (t: string) => (key === 'tradingDays' ? parseCount(t) : parseMoney(t, key === 'accountSize'));
    const lh = Math.max(8, h.bbox.y1 - h.bbox.y0);
    const siblings = labels[h.line];
    let best: { li: number; wi: number; w: OcrWord; v: number; score: number; layout: number; used: number[]; factor: number; amb?: { value: number; reason: string } } | null = null;
    let refused: { value: number; reason: string; evidence: string } | null = null;
    const lbl = key === 'ignore' || key === 'tradingDays' ? '' : FIELD_LABEL[key].replace(/ \(.*\)$/, '').toLowerCase();
    for (const dir of [1, -1]) {
      for (let step = 1; step <= 2; step++) {
        const li = h.line + dir * step;
        const line = page.lines[li];
        if (!line || !valueLines[li]) continue;
        const gap = dir === 1 ? line.bbox.y0 - h.bbox.y1 : h.bbox.y0 - line.bbox.y1;
        if (gap > Math.max(3.5 * lh, 70) || gap < -lh) continue;
        line.words.forEach((w, wi) => {
          if (claimed.has(`${li}:${wi}`)) return;
          // The limit half of a "progress / limit" pair is reached through its first half.
          if (wi >= 2 && /^(\/|of)$/i.test(line.words[wi - 1].text) && parseMoney(line.words[wi - 2].text) != null && MONEY.has(key as FieldKey) && key !== 'ignore') return;
          let v = parseFor(w.text) ?? (key === 'ignore' && /^[+-]?[\d,.]+%$/.test(w.text) ? 0 : null);
          let used = [wi];
          let factor = 1;
          let amb: { value: number; reason: string } | undefined;
          if (key !== 'ignore' && key !== 'tradingDays') {
            const r = readMoney(key, line.words, wi, lbl);
            if (r == null) return;
            if ('rejected' in r) {
              // Not this label's value — leave it for its own label ("Total P&L").
              refused ??= { ...r.rejected, evidence: `“${labelText(h)}” → ${w.text}` };
              return;
            }
            ({ value: v, used, factor } = r);
            amb = r.ambiguous;
          }
          if (v == null) return;
          // The value belongs to the label in this row it overlaps most.
          const overlapWith = (b: OcrBox) => Math.max(0, Math.min(b.x1, w.bbox.x1) - Math.max(b.x0, w.bbox.x0));
          const mine = overlapWith(h.bbox);
          const leftAligned = Math.abs(w.bbox.x0 - h.bbox.x0) < Math.max(24, (h.bbox.x1 - h.bbox.x0) * 0.35);
          if (mine <= 0 && !leftAligned) return;
          const rival = siblings.some((o) => o !== h && overlapWith(o.bbox) > mine);
          if (rival) return;
          const score = (mine > 0 ? 1 : 0.6) - step * 0.05;
          const layout = (dir === 1 ? 0.95 : 0.85) - (step - 1) * 0.07;
          if (!best || score > best.score) best = { li, wi, w, v, score, layout, used, factor, amb };
        });
      }
      if (best) break;
    }
    if (best) {
      const b = best as { li: number; wi: number; w: OcrWord; v: number; layout: number; used: number[]; factor: number; amb?: { value: number; reason: string } };
      for (const u of b.used) claimed.add(`${b.li}:${u}`);
      const ev = `“${labelText(h)}” → ${b.used.map((u) => page.lines[b.li].words[u].text).join(' ')}`;
      if (b.amb && key !== 'ignore') ambiguous.push({ key: key as FieldKey, ...b.amb, evidence: ev, page: pageIndex });
      if (key !== 'ignore') put(key, b.v, (b.w.confidence / 100) * h.weight * b.layout * b.factor, ev);
    } else if (refused && key !== 'ignore') {
      const r = refused as { value: number; reason: string; evidence: string };
      ambiguous.push({ key: key as FieldKey, value: r.value, reason: r.reason, evidence: r.evidence, page: pageIndex });
    }
  }

  // Unlabelled context: firm, program/size title line, stage, ids, emails.
  const full = page.lines.map((l) => l.text).join('\n');
  const fullLower = full.toLowerCase();
  const allWords = page.lines.flatMap((l) => l.words);
  let firmFound = false;
  for (const f of opts.firms ?? []) {
    // Whole name / alias as words ("Lucid Trading", "Apex"); short acronyms (ETF, TPT) are too ambiguous.
    const names = [f.name, ...f.aliases.filter((a) => a.length >= 4)];
    const hit = names.find((n) => new RegExp(`(^|[^a-z0-9])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(fullLower));
    if (hit) {
      const parts = hit.toLowerCase().split(' ');
      const words = allWords.filter((w) => parts.includes(normWord(w.text)) && !looksLikeAccountId(w.text));
      if (!words.length && parts.length === 1) continue; // only inside an account number ("APEX-284-11902")
      const conf = words.length ? Math.min(...words.map((w) => w.confidence)) / 100 : 0.85;
      put('firm', f.name, conf * 0.97, `“${hit}” on the screenshot`);
      firmFound = true;
      break;
    }
  }
  if (!firmFound) {
    // A word that starts with the firm's name: "LucidFlex", "TopstepX", "lucidtrading.com", "MyFundedFutures".
    const compact = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
    outer: for (const f of opts.firms ?? []) {
      for (const n of [f.name, ...f.aliases].map(compact).filter((n) => n.length >= 5)) {
        // Web addresses may carry it mid-word ("dashboard.lucidtrading.com").
        const w = allWords.find((x) => !looksLikeAccountId(x.text) && (compact(x.text).startsWith(n) || (/[a-z]\.[a-z]/i.test(x.text) && compact(x.text).includes(n))));
        if (w) {
          put('firm', f.name, (w.confidence / 100) * 0.85, `“${redactText(w.text)}” on the screenshot`);
          break outer;
        }
      }
    }
  }
  page.lines.forEach((line, li) => {
    line.words.forEach((w, wi) => {
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(w.text.replace(/[,;]+$/, ''))) addSensitive('email', w.text, w.bbox);
      // Unlabelled ids only on readable pages (blurry text produces id-like garbage).
      else if (quality !== 'poor' && !claimed.has(`${li}:${wi}`) && looksLikeAccountId(w.text)) addSensitive('account_id', w.text, w.bbox);
    });
  });
  // Title line: holds a plan size ("50K") and/or a stage word, and no money value.
  // Several lines can (breadcrumbs, menus): take the most title-like one.
  let title: { line: OcrLine; sizeWord: OcrWord | undefined; stage: ReturnType<typeof stageFrom>; score: number } | null = null;
  for (const [li, line] of page.lines.entries()) {
    if (labels[li].some((h) => MONEY.has(h.target as FieldKey)) || isTableRow(line) || isTableHeader(line)) continue;
    const sizeWord = line.words.find((w) => /^\$?\d{2,3}(\.\d)?[kK]$/.test(w.text.replace(/[,;:]+$/, '')));
    const stage = stageFrom(line.text);
    if (!sizeWord && !stage) continue;
    // A menu item ("Funded Accounts") is not a title.
    if (!sizeWord && line.words.every((w) => stageFrom(w.text) || NAV_WORDS.has(normWord(w.text)))) continue;
    if (line.words.some((w) => parseMoney(w.text) != null && !/[kK]$/.test(w.text))) continue;
    const crumbs = /[>›»]|@/.test(line.text) ? 1.5 : 0;
    const score = (sizeWord ? 1 : 0) + (stage ? 1 : 0) - crumbs - Math.max(0, line.words.length - 7) * 0.2;
    if (!title || score > title.score) title = { line, sizeWord, stage, score };
  }
  if (title) {
    const { line, sizeWord, stage } = title;
    const kept = line.words.filter((w) => !looksLikeAccountId(w.text) && !/^(account|id|#|\||status:?|active|acct)$/i.test(w.text.replace(/[:]+$/, '')));
    const cut = kept.findIndex((w, i) => i > 0 && /^(account|status)/i.test(w.text));
    let words = cut > 0 ? kept.slice(0, cut) : kept;
    // Menu words merged in from a sidebar, and stray OCR specks ("a", "|") at the start.
    // …and 1–2 letter fragments of a logo or icon ("RE LucidPro 50K") — a plan name never starts with one.
    while (words.length > 1 && (NAV_WORDS.has(normWord(words[0].text)) || !/[a-z0-9]{2}/i.test(words[0].text) || /^[a-z]{1,2}$/i.test(words[0].text))) words = words.slice(1);
    const name = words.map((w) => w.text).join(' ').replace(/\s*\|\s*$/, '').trim();
    const conf = words.length ? Math.min(...words.map((w) => w.confidence)) / 100 : 0.5;
    if (sizeWord) put('accountSize', parseMoney(sizeWord.text.replace(/[,;:]+$/, ''), true)!, (sizeWord.confidence / 100) * 0.9, `“${redactText(line.text)}”`);
    if (stage) put('stage', stage, conf * 0.8, `“${redactText(line.text)}”`);
    // A bare stage word ("Funded") is the stage, not a program name.
    const named = words.some((w) => /[a-z]{3}/i.test(w.text) && !stageFrom(w.text));
    if (name && named) put('program', name, conf * 0.72, `“${redactText(line.text)}”`);
  }
  if (!cands.status) {
    const s = page.lines.find((l) => /\bstatus\b/i.test(l.text));
    const v = s ? statusFrom(s.text.replace(/.*status/i, '')) : null;
    if (s && v) put('status', v, (s.confidence / 100) * 0.9, `“${redactText(s.text)}”`);
    else {
      // A status badge without a label ("Active") on the account's own line or alone — "check this".
      // "Funded" / "Pending" are left out: they are stages or order states as often as statuses.
      const BADGE = /^\(?(active|passed|failed|breached|liquidated|inactive|closed|suspended|disabled)[.)]?$/i;
      const found = new Set<string>();
      let first: { v: string; line: OcrLine } | null = null;
      for (const line of page.lines) {
        if (isTableRow(line) || isTableHeader(line)) continue;
        const own = line.words.some((w) => looksLikeAccountId(w.text)) || line.words.length <= 3;
        const b = own ? line.words.find((w) => BADGE.test(w.text)) : undefined;
        if (!b) continue;
        const val = statusFrom(b.text)!;
        found.add(val);
        first ??= { v: val, line };
      }
      if (first && found.size === 1) put('status', first.v, (first.line.confidence / 100) * 0.75, `“${redactText(first.line.text)}”`);
    }
  }
  if (!cands.stage) {
    // Stage word on a short line ("Evaluation Account"), unless menus show several stages.
    const seen = new Map<string, OcrLine>();
    for (const line of page.lines) {
      if (line.words.length > 6 || isTableRow(line) || isTableHeader(line)) continue;
      // Plural menu items ("Evaluations") count too, so a menu listing several stages is recognised.
      const st = stageFrom(line.text.replace(/\b([a-z]+)s\b/gi, '$1'));
      if (st && !seen.has(st)) seen.set(st, line);
    }
    if (seen.size === 1) {
      const [[st, line]] = [...seen];
      put('stage', st, (line.confidence / 100) * 0.7, `“${redactText(line.text)}”`);
    }
  }

  for (const [key, list] of Object.entries(cands) as [FieldKey, ExtractedField[]][]) {
    const sorted = [...list].sort((a, b) => b.confidence - a.confidence);
    const best = { ...sorted[0] };
    const same = (a: number | string, b: number | string) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.5 : String(a).toLowerCase() === String(b).toLowerCase());
    const contained = (a: number | string, b: number | string) => typeof a === 'string' && typeof b === 'string' && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));
    const others: ExtractedField[] = [];
    for (const f of sorted.slice(1)) if (!same(f.value, best.value) && !(key === 'program' && contained(f.value, best.value)) && !others.some((o) => same(o.value, f.value))) others.push(f);
    if (others.length) {
      // e.g. two account balances on one screenshot: the trader must pick.
      best.alternatives = others.map((f) => ({ value: f.value, confidence: f.confidence, page: f.page }));
      best.confidence = Math.min(best.confidence, 0.5);
    }
    fields[key] = best;
  }

  // Dashboard date: a date WITH a time on a header line ("… - Oct 10, 2026 4:05 PM") — the moment shown.
  if (!fields.statementDate) {
    for (const line of page.lines) {
      if (isTableRow(line) || isTableHeader(line)) continue;
      const ws = line.words.map((w) => w.text);
      for (let i = 0; i < ws.length; i++) {
        const d = parseDate(ws.slice(i, i + 3));
        if (!d) continue;
        const after = ws.slice(i + d.used, i + d.used + 2).join(' ');
        if (!/^(at\s)?\d{1,2}:\d{2}(\s?[ap]m)?/i.test(after)) continue;
        fields.statementDate = { key: 'statementDate', value: d.iso, confidence: Math.round((line.confidence / 100) * 0.8 * qualityFactor * 100) / 100, source: 'ocr', evidence: `“${redactText(line.text)}”`, page: pageIndex };
        break;
      }
      if (fields.statementDate) break;
    }
  }

  // Drawdown type stated on the page ("EOD Trailing", "End of day drawdown", "Static drawdown").
  if (!fields.drawdownType) {
    for (const line of page.lines) {
      if (isTableRow(line) || isTableHeader(line)) continue;
      const t = line.text.toLowerCase();
      const type = /\b(eod|end[ -]of[ -]day)\b/.test(t) && /(trail|drawdown|mll|max loss|loss limit)/.test(t)
        ? 'eod_trailing'
        : /\b(intraday|real[ -]?time)\b.*trail/.test(t)
          ? 'trailing'
          : /\bstatic\b.*(drawdown|mll|max loss|loss limit)|(drawdown|mll|max loss)[^a-z]*\bstatic\b/.test(t)
            ? 'static'
            : null;
      if (type) {
        fields.drawdownType = { key: 'drawdownType', value: type, confidence: Math.round((line.confidence / 100) * 0.9 * qualityFactor * 100) / 100, source: 'ocr', evidence: `“${redactText(line.text)}”`, page: pageIndex };
        break;
      }
    }
  }

  const labelsFound = labels.flat().filter((h) => h.target !== 'ignore' && !h.target.startsWith('sensitive:')).length;
  // A refused reading that another label claimed later ("−$66" → Total P&L) is no longer ambiguous.
  const stillAmbiguous = ambiguous.filter((a) => !Object.values(fields).some((f) => f && f.key !== a.key && typeof f.value === 'number' && Math.abs(f.value - a.value) < 0.005 && a.value < 0 && !LIMIT_PAIR.has(f.key)));
  return { page: pageIndex, fields: resolveLevels(fields), ...(stillAmbiguous.length ? { ambiguous: stillAmbiguous } : {}), sensitive, quality, ocrConfidence: Math.round(page.confidence), wordCount, labelsFound };
}

export type { ExtractedField, TextField };
