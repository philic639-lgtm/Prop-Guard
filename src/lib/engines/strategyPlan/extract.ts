import { FIELD_LABELS, type PlanBranch, type PlanField, type PlanFieldKey, type PlanFields, type PlanRelevance, type PlanValues, type StrategyPlan } from './types';
import { formatClock, minutesOf, parseClock } from './time';

/**
 * Description → plan. Reads ONLY what the trader wrote (informal phrasing and common typos
 * included): a value is either found in their words (with those words as evidence), marked
 * "needs clarification" when it can be read more than one way, or left missing. Nothing is
 * taken from a template, an example or a default.
 */

// ───────────────────────────── Text ─────────────────────────────

const TYPOS: [RegExp, string][] = [
  [/\bcandel(s)?\b/g, 'candle$1'],
  [/\bcandl\b/g, 'candle'],
  [/\buntill?\b/g, 'until'],
  [/\bun?til\b/g, 'until'],
  [/\blookin\b/g, 'looking'],
  [/\bwaitin\b/g, 'waiting'],
  [/\bstartin\b/g, 'starting'],
  [/\bfollowin\b/g, 'following'],
  [/\bdirection(?:s)?\b/g, 'direction'],
  [/\bopening range breakout\b/g, 'orb'],
  [/\btill?\b/g, 'until'],
  [/\bop+en+ing\b/g, 'opening'],
  [/\bstop-?loss\b/g, 'stop loss'],
  [/\bminuet(s)?\b/g, 'minute$1'],
  [/\bmins?\b/g, 'minute'],
  [/\bcontarct(s)?\b/g, 'contract$1'],
  [/\btake-?profit\b/g, 'take profit'],
  [/\bdirecton\b/g, 'direction'],
  [/\bdailey\b/g, 'daily'],
  [/\btrade's\b/g, 'trades'],
  [/\bstrat\b/g, 'strategy'],
];

/** Lower case, unified punctuation, typos fixed — for matching only (evidence keeps the trader's words). */
export function normalizeText(t: string): string {
  let n = t.toLowerCase().replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/a\.m\./g, 'am').replace(/p\.m\./g, 'pm');
  for (const [re, to] of TYPOS) n = n.replace(re, to);
  return n;
}

interface Sentence {
  text: string;
  n: string;
}

/** Sentences of the description (no regex lookbehind: Safari < 16.4 cannot parse it). */
export function sentencesOf(text: string): Sentence[] {
  const prepared = text.replace(/a\.m\./gi, 'am').replace(/p\.m\./gi, 'pm');
  const out: Sentence[] = [];
  let cur = '';
  for (let i = 0; i < prepared.length; i++) {
    const c = prepared[i];
    cur += c;
    const end = c === '\n' || ((c === '.' || c === '!' || c === '?' || c === ';') && (i + 1 >= prepared.length || /\s/.test(prepared[i + 1])));
    if (end) {
      if (cur.trim()) out.push({ text: cur.trim().replace(/[.;]$/, ''), n: normalizeText(cur.trim().replace(/[.;]$/, '')) });
      cur = '';
    }
  }
  if (cur.trim()) out.push({ text: cur.trim(), n: normalizeText(cur.trim()) });
  return out;
}

// Informal times too: "9:30", "9.30am", "930am", and bare "945" / "950" (3–4 digits) as typed in a hurry.
const TIME = String.raw`(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|\d{3,4}(?:\s*(?:am|pm))?(?![\d%$]))`;
const TZ = String.raw`(?:\s*(?:est|edt|et|ny|eastern|new york time))?`;
const RANGE = new RegExp(`${TIME}${TZ}\\s*(?:-|to|until|through|and)\\s*${TIME}${TZ}`);
const SINGLE = new RegExp(`${TIME}${TZ}`, 'g');
const WORD_NUM: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const num = (w: string) => (WORD_NUM[w] ?? Number(w.replace(/,/g, '')));

function rangeIn(n: string): { start: string; end: string; index: number; raw: string } | null {
  const m = RANGE.exec(n);
  if (!m) return null;
  const start = parseClock(m[1]);
  const end = parseClock(m[2]);
  if (!start || !end || minutesOf(end) <= minutesOf(start)) return null;
  return { start, end, index: m.index, raw: m[0] };
}

// ───────────────────────────── Fields ─────────────────────────────

const RELEVANCE: Record<PlanFieldKey, PlanRelevance> = {
  instrument: 'required',
  timezone: 'required',
  openingRange: 'required',
  lookStart: 'optional',
  evaluationWindow: 'required',
  entryCutoff: 'recommended',
  executionTimeframe: 'required',
  entryTrigger: 'required',
  stop: 'required',
  target: 'required',
  sizing: 'required',
  maxTrades: 'recommended',
  maxLosses: 'recommended',
  dailyLossLimit: 'recommended',
  filters: 'optional',
};

export function emptyField<K extends PlanFieldKey>(key: K, relevance: PlanRelevance = RELEVANCE[key]): PlanField<K> {
  return { key, label: FIELD_LABELS[key], value: null, display: null, status: 'missing', source: null, relevance };
}

function stated<K extends PlanFieldKey>(key: K, value: PlanValues[K], display: string, evidence: string, opts: { unclear?: string; note?: string } = {}): PlanField<K> {
  return {
    ...emptyField(key),
    value,
    display,
    status: opts.unclear ? 'needs_clarification' : 'supplied',
    source: 'description',
    evidence,
    ...(opts.unclear || opts.note ? { note: opts.unclear ?? opts.note } : {}),
  };
}

const SYMBOLS_UPPER = /\b(ES|NQ|YM|CL|GC|SI|NG|ZB|ZN|6E)\b/g;
const SYMBOLS_ANY = /\b(mnq|mes|mym|m2k|mcl|mgc|rty|spy|qqq|spx|ndx|nas100|us100|us30|us500)\b/gi;
const MARKET_NAMES = /\b(nasdaq|s&p|s and p|dow|russell|crude oil|crude|gold|silver|e-?minis?|micros?|indices|index futures|futures)\b/;
const FILTER_WORDS = /\b(volume|order ?flow|delta|footprint|vwap|tape|dom|ema|moving average|rsi|macd|atr)\b/g;
const TRIGGER_WORDS = /\b(break(?:s|out)?\s+(?:of|above|below|through|out)|breaks?\s+(?:the\s+)?(?:high|low)|closes?\s+(?:above|below|outside|beyond|back)|candle close|retest|pull ?back|limit order|market order|stop order|engulfing|reclaim|crosses)\b/;
const ENTRY_VERB = /\b(enter|entry|entries|buy|sell|go long|go short|get in|long|short)\b/;
const AMBIGUOUS_DIRECTION = /\b(follow|following|in|take|trade)\s+(?:the |its |that |this |a )?(?:move'?s?\s+)?direction\b|\btake (?:a|the) move\b|\bfollow (?:it|the move|that)\b/;
const EXPLICIT_DIRECTION = /\b(long|short|buy|sell|above (?:the )?(?:orb |range )?high|below (?:the )?(?:orb |range )?low|fade|reverse|opposite|breakout direction|direction of the break)\b/;

export interface ExtractOptions {
  now?: string;
}

export function extractPlan(text: string, opts: ExtractOptions = {}): StrategyPlan {
  const now = opts.now ?? new Date().toISOString();
  const sentences = sentencesOf(text);
  const all = normalizeText(text);
  const f = Object.fromEntries((Object.keys(RELEVANCE) as PlanFieldKey[]).map((k) => [k, emptyField(k)])) as PlanFields;
  const branches: PlanBranch[] = [];
  const consumed = new Set<string>(); // "sentence#time" already used for another field

  // Opening range: a time span tied to a high / low / range / candle — or "first N minutes".
  for (const s of sentences) {
    if (f.openingRange.status !== 'missing') break;
    const r = rangeIn(s.n);
    if (r && /\b(high|low|range|orb|candle|opening)\b/.test(s.n) && !/^\s*(if|when|once)\b/.test(s.n)) {
      const minutes = minutesOf(r.end) - minutesOf(r.start);
      f.openingRange = stated('openingRange', { start: r.start, end: r.end, minutes }, `${formatClock(r.start)}–${formatClock(r.end)} (${minutes} minutes)`, s.text);
      consumed.add(`${s.n}#${r.start}`).add(`${s.n}#${r.end}`);
      continue;
    }
    const m = /\bfirst (\d{1,3}) ?-?minutes?\b/.exec(s.n) ?? /\b(\d{1,3}) ?-?minute (?:opening range|orb|range)\b/.exec(s.n) ?? /\b(\d{1,3}) ?m(?:in)? orb\b/.exec(s.n);
    if (m && /\b(range|orb|high|low|open|opening)\b/.test(s.n)) {
      const minutes = +m[1];
      const end = `${String(Math.floor((570 + minutes) / 60)).padStart(2, '0')}:${String((570 + minutes) % 60).padStart(2, '0')}`;
      f.openingRange = stated('openingRange', { start: '09:30', end, minutes }, `9:30 AM–${formatClock(end)} (${minutes} minutes)`, s.text, { note: 'Starts at the 9:30 New York open.' });
    }
  }
  const usesOpeningRange = f.openingRange.status !== 'missing' || /\b(orb|opening range)\b/.test(all);
  if (usesOpeningRange && f.openingRange.status === 'missing') {
    const s = sentences.find((x) => /\b(orb|opening range)\b/.test(x.n));
    f.openingRange = { ...emptyField('openingRange'), status: 'needs_clarification', note: 'You mention an opening range but not which minutes it covers.', ...(s ? { evidence: s.text } : {}) };
  }

  // When to start looking ("wait until 9:50 to start looking"): a START time — never a cutoff.
  for (const s of sentences) {
    if (f.lookStart.status !== 'missing') break;
    const m = new RegExp(`\\b(?:wait(?:ing)?\\s+until|start(?:s|ing)?\\s+(?:looking|to look|trading)\\s+(?:at|from|after)?|begin(?:s|ning)?\\s+(?:looking|trading)\\s+(?:at|from|after)?|look(?:ing)?\\s+for\\s+(?:a |an )?(?:move|entry|entries|trade|setup)s?\\s+(?:after|from|at)|no\\s+(?:entries|trades)\\s+before|after)\\s+${TIME}`).exec(s.n);
    const t = m && parseClock(m[1]);
    if (t && !consumed.has(`${s.n}#${t}`)) {
      f.lookStart = stated('lookStart', t, formatClock(t), s.text);
      consumed.add(`${s.n}#${t}`);
    }
  }

  // Last entry time — only when the words say so ("no trades after 10:30", "done by 11"); "wait until" is a start.
  for (const s of sentences) {
    if (f.entryCutoff.status !== 'missing') break;
    const m =
      new RegExp(`\\b(?:no\\s+(?:new\\s+)?(?:trades|entries|entry)\\s+after|last\\s+(?:entry|trade)\\s+(?:at|by)?|(?:stop|done|finished)\\s+(?:trading|looking)?\\s*(?:at|by)|(?:trade|trading|look|looking|entries|enter)\\s+(?:only\\s+)?until|cut-?off\\s+(?:at|is)?)\\s*${TIME}`).exec(s.n);
    const t = m && parseClock(m[1]);
    if (t) {
      f.entryCutoff = stated('entryCutoff', t, formatClock(t), s.text);
      continue;
    }
    // "I enter between 9:45 and 10:15" — an entry window: start + cutoff.
    const r = rangeIn(s.n);
    if (r && /\b(enter|entries|entry|trade|trading)\b/.test(s.n) && /\bbetween\b/.test(s.n) && !/^\s*(if|when|once)\b/.test(s.n)) {
      if (f.lookStart.status === 'missing') f.lookStart = stated('lookStart', r.start, formatClock(r.start), s.text);
      f.entryCutoff = stated('entryCutoff', r.end, formatClock(r.end), s.text);
    }
  }

  // Conditional branches ("If price is outside the ORB by 9:50–9:55, I follow the direction outside the ORB").
  for (const s of sentences) {
    // "If …, I …" at the start, or a mid-sentence "… then if it breaks above the high i go long".
    const m =
      /^\s*(?:and\s+|but\s+|then\s+)?(if|when|once)\s+(.+?)(?:,\s*|\s+then\s+)(.+)$/.exec(s.n) ?? /\b(if)\s+(.+?)(?:,\s*|\s+then\s+|\s+(?=i\s))(.+)$/.exec(s.n);
    if (!m) continue;
    const condition = m[2].trim();
    const action = m[3].trim();
    const kind: PlanBranch['kind'] = /\b(inside|within|back in)\b/.test(condition)
      ? 'inside_range'
      : /\b(outside|above|below|beyond|break(?:s|ing)?\s+(?:out|above|below))\b/.test(condition) && /\b(orb|range|high|low)\b/.test(condition)
        ? 'outside_range'
        : 'other';
    const ambiguous = AMBIGUOUS_DIRECTION.test(action) && !EXPLICIT_DIRECTION.test(action);
    const where = kind === 'outside_range' ? 'price is outside the range' : kind === 'inside_range' ? 'price is still inside the range' : 'this condition is met';
    branches.push({
      id: `b${branches.length + 1}`,
      kind,
      condition: cap(clean(s.text, m[2])),
      action: cap(clean(s.text, m[3])),
      evidence: s.text,
      directionRule: ambiguous ? null : cap(clean(s.text, m[3])),
      status: ambiguous ? 'needs_clarification' : 'supplied',
      source: 'description',
      ...(ambiguous ? { note: `“${clean(s.text, m[3])}” — which direction is that when ${where}?` } : {}),
    });
    // A window inside the condition ("by 9:50–9:55") — its meaning is not certain.
    const r = rangeIn(s.n);
    if (r && f.evaluationWindow.status === 'missing') {
      f.evaluationWindow = stated('evaluationWindow', { start: r.start, end: r.end, meaning: null }, `${formatClock(r.start)}–${formatClock(r.end)}`, s.text, {
        unclear: `Is ${formatClock(r.start)}–${formatClock(r.end)} when you check where price is (entries may come later), or the only time you will enter?`,
      });
    }
  }

  // Instrument.
  const symbols = [...new Set([...(text.match(SYMBOLS_UPPER) ?? []), ...(text.match(SYMBOLS_ANY) ?? []).map((x) => x.toUpperCase())])];
  const symbolSentence = (sym: string) => sentences.find((s) => s.text.toUpperCase().includes(sym))?.text ?? sym;
  if (symbols.length) f.instrument = stated('instrument', symbols, symbols.join(', '), symbolSentence(symbols[0]));
  else {
    const s = sentences.find((x) => MARKET_NAMES.test(x.n));
    if (s) {
      const name = MARKET_NAMES.exec(s.n)![1];
      f.instrument = stated('instrument', [], name, s.text, { unclear: `“${name}” — which contract exactly (e.g. NQ or MNQ, ES or MES)?` });
    }
  }

  // Execution chart timeframe — never the opening-range length or a "9:45 candle".
  for (const s of sentences) {
    const m =
      /\b(\d{1,2})\s?-?\s?(?:m|minute|minutes)\b\s*(?:chart|charts|candles?|bars?|timeframe|time frame|tf)\b/.exec(s.n) ??
      /\bon (?:the |a )?(\d{1,2})\s?-?\s?(?:m|minute)\b(?!\s*(?:orb|opening range|range))/.exec(s.n) ??
      /\b(1|2|3|5|10|15|30)m\b(?!\s*(?:orb|opening range|range))/.exec(s.n);
    if (m && !/\bfirst\s+\d/.test(s.n.slice(Math.max(0, m.index - 8), m.index + 2))) {
      f.executionTimeframe = stated('executionTimeframe', `${m[1]}m`, `${m[1]}-minute chart`, s.text);
      break;
    }
    const h = /\b(1h|4h|hourly|daily)\s*(?:chart|candles?|timeframe)?\b/.exec(s.n);
    if (h && /\b(chart|candles?|timeframe)\b/.test(s.n)) {
      f.executionTimeframe = stated('executionTimeframe', h[1], `${h[1]} chart`, s.text);
      break;
    }
  }

  // Entry trigger: an entry word AND a concrete trigger. "Take a move" / "follow the direction" is not one.
  const trig = sentences.find((s) => ENTRY_VERB.test(s.n) && TRIGGER_WORDS.test(s.n));
  if (trig) f.entryTrigger = stated('entryTrigger', trig.text, trig.text, trig.text);
  else if (branches.length) f.entryTrigger = { ...f.entryTrigger, note: 'Your description says when you look for a move and which side, but not what exactly gets you into the trade.' };

  // Stop / target / sizing — only when stated.
  const stopS = sentences.find((s) => /\b(stop loss|stop|sl)\b/.test(s.n) && !/\bstop\s+(?:trading|looking|for the day|after|if|when|once)\b/.test(s.n));
  if (stopS) f.stop = stated('stop', stopS.text, stopS.text, stopS.text);
  const tgtS = sentences.find((s) => /\b(target|take profit|tp|profit target|take profits?|exit at)\b|\b\d+(?:\.\d+)?\s*r\b|\b1:\d/.test(s.n) && !/\bprofit target remaining\b/.test(s.n));
  if (tgtS) f.target = stated('target', tgtS.text, tgtS.text, tgtS.text);
  const sizeS = sentences.find((s) => /\b\d+\s*(contracts?|micros?|minis?|lots?|shares)\b|\brisk(?:ing)?\s*\$\s?\d|\$\s?\d[\d,]*\s*(?:risk|per trade)|\d+(?:\.\d+)?\s*%\s*(?:risk|of (?:my )?account)/.test(s.n));
  if (sizeS) f.sizing = stated('sizing', sizeS.text, sizeS.text, sizeS.text);

  // Daily limits — three different rules, never merged.
  for (const s of sentences) {
    const mt = /\b(?:max(?:imum)?|only|up to|no more than|at most)\s+(\d+|one|two|three|four|five)\s+trades?\b/.exec(s.n) ?? /\b(one|two|three|1|2|3)\s+trades?\s+(?:a|per)\s+day\b/.exec(s.n);
    if (mt && f.maxTrades.status === 'missing') f.maxTrades = stated('maxTrades', num(mt[1]), `${num(mt[1])} per day`, s.text);
    const ml =
      /\bstop\s+(?:trading\s+)?(?:for the day\s+)?after\s+(\d+|one|two|three|a)\s+(?:full\s+)?(?:loss(?:es)?|losing trades?|losers?|stop-?outs?|full stops?)\b/.exec(s.n) ??
      /\b(\d+|one|two|three)\s+(?:full\s+)?(?:loss(?:es)?|losers?)\s+(?:and|then)\s+(?:i'?m\s+)?(?:done|stop|out)\b/.exec(s.n);
    if (ml && f.maxLosses.status === 'missing') f.maxLosses = stated('maxLosses', num(ml[1]), `Stop after ${num(ml[1])} losing trade${num(ml[1]) > 1 ? 's' : ''}`, s.text);
    const dl =
      /\b(?:daily\s+(?:loss(?:\s+limit)?|stop|max\s+loss)|max(?:imum)?\s+(?:daily\s+)?loss(?:\s+per\s+day)?|stop\s+(?:trading\s+)?(?:if|when|once)\s+(?:i'?m\s+)?down)\s*(?:of|is|at|:)?\s*\$\s?([\d,]+)/.exec(s.n) ??
      /\$\s?([\d,]+)\s*(?:daily\s+(?:loss|stop)|a day max|max loss per day)/.exec(s.n);
    if (dl && f.dailyLossLimit.status === 'missing') f.dailyLossLimit = stated('dailyLossLimit', num(dl[1]), `$${num(dl[1]).toLocaleString('en-US')}`, s.text);
  }

  // Optional filters — only what the trader uses; never a requirement.
  const filters = [...new Set(all.match(FILTER_WORDS) ?? [])];
  if (filters.length) f.filters = stated('filters', filters, filters.join(', '), sentences.find((s) => FILTER_WORDS.test(s.n))?.text ?? filters.join(', '));

  // Times are New York local time; "EST" is read as New York time and shown for confirmation.
  const anyTime = sentences.some((s) => SINGLE.test(s.n));
  SINGLE.lastIndex = 0;
  const tz = /\b(est|edt|et|eastern|new york|ny time|nyc)\b/.exec(all);
  if (anyTime) {
    f.timezone = {
      ...emptyField('timezone'),
      value: { zone: 'America/New_York', written: tz ? tz[1].toUpperCase() : null },
      display: 'New York local time (EDT in summer, EST in winter)',
      status: tz && tz[1] !== 'est' ? 'supplied' : 'needs_clarification',
      source: 'description',
      ...(tz ? { evidence: sentences.find((s) => s.n.includes(tz[1]))?.text } : {}),
      note: tz?.[1] === 'est' ? 'You wrote EST — read as New York local time (9:30 = the open, EDT during daylight saving). Confirm.' : tz ? undefined : 'No time zone written — read as New York local time. Confirm.',
    };
  }

  // Relevance for THIS plan: range / timing items only when the plan uses them.
  if (!usesOpeningRange) f.openingRange.relevance = 'optional';
  if (f.evaluationWindow.status === 'missing') f.evaluationWindow.relevance = 'optional';
  if (!anyTime) {
    f.timezone.relevance = 'optional';
    f.entryCutoff.relevance = 'optional';
  }

  return { version: 1, originalText: text, usesOpeningRange, fields: f, branches, decisions: {}, createdAt: now, updatedAt: now };
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The trader's own words for a normalized fragment (same position in the original sentence when possible). */
function clean(original: string, fragmentNormalized: string): string {
  const n = normalizeText(original);
  const i = n.indexOf(fragmentNormalized);
  return i >= 0 && n.length === original.length ? original.slice(i, i + fragmentNormalized.length).trim() : fragmentNormalized.trim();
}
