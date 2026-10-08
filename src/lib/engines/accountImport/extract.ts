import type { DateField, ExtractedField, FieldKey, FieldMap, MoneyField, OcrBox, OcrLine, OcrPage, OcrWord, PageExtraction, SensitiveItem, TextField } from './types';

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

type LabelTarget = FieldKey | 'sensitive:account_id' | 'sensitive:name';

const LABELS: { target: LabelTarget; phrases: string[]; weight: number }[] = [
  // Balance (current)
  { target: 'balance', phrases: ['account balance', 'current balance', 'cash balance', 'net liquidation value', 'net liquidation', 'net liq', 'live balance'], weight: 1 },
  { target: 'balance', phrases: ['balance'], weight: 0.92 },
  { target: 'startingBalance', phrases: ['starting balance', 'start balance', 'initial balance', 'starting capital', 'beginning balance', 'opening balance'], weight: 1 },
  // Drawdown: four different things — never interchangeable.
  { target: 'drawdownThreshold', phrases: ['liquidation threshold', 'auto-liquidate threshold', 'auto liquidate threshold', 'auto-liquidation threshold', 'auto liquidation threshold', 'trailing threshold', 'drawdown threshold', 'max loss threshold', 'loss limit threshold', 'liquidation level', 'liquidation balance', 'drawdown level', 'drawdown balance', 'mll balance', 'mll level', 'loss limit level', 'max loss level', 'minimum balance', 'min balance', 'account threshold'], weight: 1 },
  { target: 'drawdownThreshold', phrases: ['threshold'], weight: 0.8 },
  { target: 'drawdownRemaining', phrases: ['remaining drawdown', 'drawdown remaining', 'drawdown left', 'available drawdown', 'drawdown available', 'distance to mll', 'distance to max loss', 'distance to liquidation', 'distance to threshold', 'distance to drawdown', 'room to max loss', 'max loss remaining', 'loss limit remaining', 'remaining loss allowance', 'remaining allowance'], weight: 1 },
  { target: 'drawdownRemaining', phrases: ['buffer'], weight: 0.65 },
  { target: 'currentDrawdown', phrases: ['current drawdown', 'drawdown used', 'used drawdown', 'drawdown utilized', 'open drawdown'], weight: 1 },
  { target: 'currentDrawdown', phrases: ['drawdown'], weight: 0.55 },
  { target: 'maxDrawdown', phrases: ['maximum loss limit', 'max loss limit', 'maximum drawdown', 'max drawdown', 'max trailing drawdown', 'trailing drawdown', 'eod drawdown', 'end of day drawdown', 'drawdown limit', 'max loss allowed'], weight: 1 },
  { target: 'maxDrawdown', phrases: ['mll', 'loss limit', 'max loss'], weight: 0.82 },
  { target: 'dailyLossLimit', phrases: ['daily loss limit', 'max daily loss', 'daily max loss', 'daily drawdown limit', 'daily loss', 'dll'], weight: 1 },
  { target: 'dailyPnl', phrases: ["today's p&l", 'todays p&l', 'today p&l', 'daily p&l', 'day p&l', "today's profit", 'daily profit'], weight: 1 },
  { target: 'netPnl', phrases: ['net p&l', 'total p&l', 'net profit', 'total profit', 'profit/loss', 'profit & loss', 'profit and loss', 'realized p&l', 'net pnl'], weight: 1 },
  { target: 'netPnl', phrases: ['p&l'], weight: 0.85 },
  { target: 'profitTarget', phrases: ['profit target', 'profit goal', 'target profit'], weight: 1 },
  { target: 'accountSize', phrases: ['account size', 'plan size', 'starting size', 'evaluation size'], weight: 1 },
  { target: 'program', phrases: ['plan', 'program', 'account type', 'product', 'plan name', 'account plan'], weight: 0.95 },
  { target: 'stage', phrases: ['stage', 'phase', 'account stage'], weight: 0.95 },
  { target: 'status', phrases: ['status', 'account status'], weight: 0.95 },
  { target: 'startDate', phrases: ['purchase date', 'start date', 'date purchased', 'activation date', 'created', 'started', 'opened'], weight: 0.95 },
  { target: 'statementDate', phrases: ['last updated', 'updated', 'as of', 'statement date'], weight: 0.95 },
  { target: 'sensitive:account_id', phrases: ['account id', 'account #', 'account number', 'account no', 'acct #', 'acct', 'account'], weight: 1 },
  { target: 'sensitive:name', phrases: ['account holder', 'trader name', 'full name', 'name'], weight: 1 },
];

const COMPILED = LABELS.flatMap((l) => l.phrases.map((p) => ({ target: l.target, phrase: p, weight: l.weight, words: p.split(' ').length })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

const MONEY = new Set<FieldKey>(['accountSize', 'balance', 'startingBalance', 'netPnl', 'dailyPnl', 'maxDrawdown', 'drawdownThreshold', 'currentDrawdown', 'drawdownRemaining', 'dailyLossLimit', 'profitTarget']);
const SIGNED = new Set<FieldKey>(['netPnl', 'dailyPnl']);
const DATES = new Set<FieldKey>(['startDate', 'statementDate']);

// ───────────────────────────── Tokens ─────────────────────────────

/** Lower-case label form of an OCR word ("P/L" / "PnL" → "p&l", trailing ":" removed). */
export function normWord(t: string): string {
  const w = t.toLowerCase().replace(/[:;|]+$/g, '').replace(/^[|]+/, '');
  if (w === 'pnl' || w === 'p/l' || w === 'p&amp;l' || w === 'p+l') return 'p&l';
  return w.replace(/’/g, "'");
}

/** Money from one OCR token. Accepts $1,234.56, -$500, (1,880.00), +1,240.50; O→0 inside digits. Null for ids, dates, text. */
export function parseMoney(raw: string, allowK = false): number | null {
  let t = raw.trim().replace(/[,.;:|]+$/, '').replace(/^usd/i, '').replace(/usd$/i, '');
  if (!t) return null;
  if (/[0-9]/.test(t)) t = t.replace(/(?<=[\d,])[oO](?=[\d,.]|$)/g, '0').replace(/^[oO](?=[\d,])/, '0');
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

function findLabels(line: OcrLine, li: number): LabelHit[] {
  const tokens = line.words.map((w) => normWord(w.text));
  const used = new Array(tokens.length).fill(false);
  const hits: LabelHit[] = [];
  for (const l of COMPILED) {
    const n = l.words;
    const parts = l.phrase.split(' ');
    for (let i = 0; i + n <= tokens.length; i++) {
      let ok = true;
      for (let k = 0; k < n; k++) if (used[i + k] || tokens[i + k] !== parts[k]) ok = false;
      if (!ok) continue;
      for (let k = 0; k < n; k++) used[i + k] = true;
      hits.push({ target: l.target, phrase: l.phrase, weight: l.weight, line: li, w0: i, w1: i + n, bbox: unionBox(line.words.slice(i, i + n)) });
    }
  }
  return hits.sort((a, b) => a.w0 - b.w0);
}

// ───────────────────────────── Page extraction ─────────────────────────────

export interface ExtractOptions {
  /** Firm names / aliases to recognise (from the rules database). */
  firms?: { id: string; name: string; aliases: string[] }[];
}

const CONNECTORS = new Set(['', '$', 'usd', ':', '-', '—', '=', '|']);

export function extractPage(page: OcrPage, pageIndex = 0, opts: ExtractOptions = {}): PageExtraction {
  const fields: FieldMap = {};
  const sensitive: SensitiveItem[] = [];
  const claimed = new Set<string>(); // `${line}:${word}`
  const wordCount = page.lines.reduce((n, l) => n + l.words.length, 0);
  const quality: PageExtraction['quality'] = wordCount < 6 || page.confidence < 60 ? 'poor' : page.confidence < 78 ? 'fair' : 'good';
  const qualityFactor = quality === 'poor' ? 0.6 : quality === 'fair' ? 0.88 : 1;

  const labels = page.lines.map((l, i) => findLabels(l, i));

  const put = (key: FieldKey, value: number | string, confidence: number, evidence: string) => {
    const c = Math.max(0, Math.min(1, confidence * qualityFactor));
    const prev = fields[key];
    if (!prev || prev.confidence < c) fields[key] = { key, value, confidence: Math.round(c * 100) / 100, source: 'ocr', evidence, page: pageIndex };
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
      let words = line.words.slice(h.w1, end).filter((w) => !CONNECTORS.has(normWord(w.text)));
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
      if (h.target === 'sensitive:name') {
        if (words.length) addSensitive('name', words.map((w) => w.text).join(' '), unionBox(words));
        return;
      }
      const key = h.target;
      if (!words.length) {
        pending.push(h);
        return;
      }
      if (MONEY.has(key)) {
        const v = parseMoney(words[0].text, key === 'accountSize');
        if (v == null) {
          pending.push(h);
          return;
        }
        claimed.add(`${li}:${startIdx}`);
        put(key, SIGNED.has(key) ? v : Math.abs(v), (words[0].confidence / 100) * h.weight, `“${redactText(line.text)}”`);
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
        } else if (key === 'program' && text.length >= 2 && /[a-z]/i.test(text)) put('program', text, conf, `“${redactText(line.text)}”`);
      }
    });
  });

  // Pass 2 — card / grid layouts: value in the same column on a nearby label-free line.
  const valueLines = page.lines.map((_, i) => labels[i].length === 0);
  for (const h of pending) {
    if (!MONEY.has(h.target as FieldKey)) continue;
    const key = h.target as MoneyField;
    const lh = Math.max(8, h.bbox.y1 - h.bbox.y0);
    const siblings = labels[h.line];
    let best: { li: number; wi: number; w: OcrWord; v: number; score: number; layout: number } | null = null;
    for (const dir of [1, -1]) {
      for (let step = 1; step <= 2; step++) {
        const li = h.line + dir * step;
        const line = page.lines[li];
        if (!line || !valueLines[li]) continue;
        const gap = dir === 1 ? line.bbox.y0 - h.bbox.y1 : h.bbox.y0 - line.bbox.y1;
        if (gap > Math.max(3.5 * lh, 70) || gap < -lh) continue;
        line.words.forEach((w, wi) => {
          if (claimed.has(`${li}:${wi}`)) return;
          const v = parseMoney(w.text, key === 'accountSize');
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
          if (!best || score > best.score) best = { li, wi, w, v, score, layout };
        });
      }
      if (best) break;
    }
    if (best) {
      const b = best as { li: number; wi: number; w: OcrWord; v: number; layout: number };
      claimed.add(`${b.li}:${b.wi}`);
      put(key, SIGNED.has(key) ? b.v : Math.abs(b.v), (b.w.confidence / 100) * h.weight * b.layout, `“${page.lines[h.line].words.slice(h.w0, h.w1).map((x) => x.text).join(' ')}” → ${b.w.text}`);
    }
  }

  // Unlabelled context: firm, program/size title line, stage, ids, emails.
  const full = page.lines.map((l) => l.text).join('\n');
  const fullLower = full.toLowerCase();
  for (const f of opts.firms ?? []) {
    const names = [f.name, ...f.aliases.filter((a) => a.length >= 5)];
    const hit = names.find((n) => new RegExp(`(^|[^a-z0-9])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(fullLower));
    if (hit) {
      const parts = hit.toLowerCase().split(' ');
      const words = page.lines.flatMap((l) => l.words).filter((w) => parts.includes(normWord(w.text)));
      const conf = words.length ? Math.min(...words.map((w) => w.confidence)) / 100 : 0.85;
      put('firm', f.name, conf * 0.97, `“${hit}” on the screenshot`);
      break;
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
  for (const [li, line] of page.lines.entries()) {
    if (labels[li].some((h) => MONEY.has(h.target as FieldKey))) continue;
    const sizeWord = line.words.find((w) => /^\$?\d{2,3}(\.\d)?[kK]$/.test(w.text.replace(/[,;:]+$/, '')));
    const stage = stageFrom(line.text);
    if (!sizeWord && !stage) continue;
    if (line.words.some((w) => parseMoney(w.text) != null && !/[kK]$/.test(w.text))) continue;
    const kept = line.words.filter((w) => !looksLikeAccountId(w.text) && !/^(account|id|#|\||status:?|active|acct)$/i.test(w.text.replace(/[:]+$/, '')));
    const cut = kept.findIndex((w, i) => i > 0 && /^(account|status)/i.test(w.text));
    const title = (cut > 0 ? kept.slice(0, cut) : kept).map((w) => w.text).join(' ').replace(/\s*\|\s*$/, '').trim();
    const conf = kept.length ? Math.min(...kept.map((w) => w.confidence)) / 100 : 0.5;
    if (sizeWord) put('accountSize', parseMoney(sizeWord.text.replace(/[,;:]+$/, ''), true)!, (sizeWord.confidence / 100) * 0.9, `“${redactText(line.text)}”`);
    if (stage) put('stage', stage, conf * 0.8, `“${redactText(line.text)}”`);
    if (title && /[a-z]{3}/i.test(title)) put('program', title, conf * 0.72, `“${redactText(line.text)}”`);
    break;
  }
  if (!fields.status) {
    const s = page.lines.find((l) => /\bstatus\b/i.test(l.text));
    if (s) {
      const v = statusFrom(s.text.replace(/.*status/i, ''));
      if (v) put('status', v, (s.confidence / 100) * 0.9, `“${redactText(s.text)}”`);
    }
  }

  return { page: pageIndex, fields, sensitive, quality, ocrConfidence: Math.round(page.confidence), wordCount };
}

export type { ExtractedField, TextField };
