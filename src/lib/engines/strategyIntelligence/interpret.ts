import { allInstruments } from '../instrumentEngine';

import { CONCEPTS, CUSTOM_STYLE, type ConceptContext } from './concepts';
import type { DetectedStyle, RuleProvenance, RuleSection, StrategyRule, TradingWindow } from './types';
import { findVagueTerms } from './vagueness';

/**
 * STAGE 1 — INTERPRET.
 * Extracts only what the description says. Nothing is filled from a template:
 * a missing stop stays missing, a missing window stays missing.
 */

export interface Interpretation {
  originalText: string;
  instruments: string[];
  instrumentProvenance: RuleProvenance | null;
  session: string;
  sessionProvenance: RuleProvenance | null;
  window: TradingWindow;
  timeframes: string[];
  direction: 'long' | 'short' | 'both' | null;
  directionProvenance: RuleProvenance | null;
  styles: DetectedStyle[];
  rules: StrategyRule[];
  maxTrades: number | null;
  stopPoints: number | null;
  minRR: number | null;
  context: ConceptContext;
  /** Fragments that are part of the description but were not classified as rules. */
  narrative: string[];
}

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, single: 1 };
const toNum = (s: string) => NUM_WORDS[s.toLowerCase()] ?? Number(s);

const NAMED_MARKETS: [RegExp, string][] = [
  [/\b(s&p|spx|spy|spoos?|es mini)\b/i, 'ES'],
  [/\b(nasdaq|ndx|qqq)\b/i, 'NQ'],
  [/\b(dow|djia)\b/i, 'YM'],
  [/\b(russell)\b/i, 'RTY'],
  [/\b(gold)\b/i, 'GC'],
  [/\b(crude|oil)\b/i, 'CL'],
];

function instrumentsIn(text: string): { list: string[]; provenance: RuleProvenance | null } {
  const tickers = allInstruments()
    .map((s) => s.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?:^|[^A-Za-z0-9])(${tickers.join('|')})(?![A-Za-z0-9])`, 'g');
  const found: string[] = [];
  for (const m of text.matchAll(re)) if (!found.includes(m[1])) found.push(m[1]);
  if (found.length) return { list: found, provenance: 'trader' };
  const named = NAMED_MARKETS.filter(([r]) => r.test(text)).map(([, s]) => s);
  return named.length ? { list: [...new Set(named)], provenance: 'inferred' } : { list: [], provenance: null };
}

function clock(h: number, m: number, ampm?: string): string {
  let hour = h;
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  } else if (hour < 7) hour += 12; // "1:30" in a day-trading plan means PM
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;

function windowIn(text: string): TradingWindow {
  const range = new RegExp(String.raw`(?:between|from)\s+${TIME}\s*(?:and|to|until|till|-|–)\s*${TIME}`, 'i').exec(text);
  if (range && (range[2] || range[3] || range[5] || range[6])) {
    return { start: clock(+range[1], +(range[2] ?? 0), range[3]), end: clock(+range[4], +(range[5] ?? 0), range[6]), provenance: 'trader', quote: range[0] };
  }
  const startM = new RegExp(String.raw`(?:after|from|starting(?: at)?|not before|once it'?s)\s+${TIME}`, 'i').exec(text);
  const endM = new RegExp(String.raw`(?:until|till|before|by|no later than|stop trading (?:at|by))\s+${TIME}`, 'i').exec(text);
  const valid = (m: RegExpExecArray | null) => !!m && (!!m[2] || !!m[3]);
  const start = valid(startM) ? clock(+startM![1], +(startM![2] ?? 0), startM![3]) : null;
  const end = valid(endM) ? clock(+endM![1], +(endM![2] ?? 0), endM![3]) : null;
  if (start || end) {
    const quote = [start ? startM![0] : null, end ? endM![0] : null].filter(Boolean).join(' … ');
    return { start, end, provenance: 'trader', quote };
  }
  if (/first hour/i.test(text)) return { start: '09:30', end: '10:30', provenance: 'inferred', quote: 'first hour' };
  if (/first (30|thirty) minutes/i.test(text)) return { start: '09:30', end: '10:00', provenance: 'inferred', quote: 'first 30 minutes' };
  return { start: null, end: null, provenance: null };
}

function sessionIn(text: string, window: TradingWindow, styles: string[]): { session: string; provenance: RuleProvenance | null } {
  if (/new york|\bNY\b|\bRTH\b|regular (trading )?hours|cash (open|session)|us session/i.test(text)) return { session: 'New York', provenance: 'trader' };
  if (/london/i.test(text)) return { session: 'London', provenance: 'trader' };
  if (/\basia(n)?\b|tokyo/i.test(text)) return { session: 'Asia', provenance: 'trader' };
  if (/overnight|globex|\bETH\b/i.test(text)) return { session: 'Overnight (Globex)', provenance: 'trader' };
  const rthWindow = window.start != null && window.start >= '09:30' && window.start < '16:00';
  if (rthWindow || /\b(the )?open\b|opening/i.test(text) || styles.includes('orb') || styles.includes('opening_drive')) return { session: 'New York', provenance: 'inferred' };
  return { session: '', provenance: null };
}

function timeframesIn(text: string): string[] {
  const out: string[] = [];
  const add = (t: string) => !out.includes(t) && out.push(t);
  for (const m of text.matchAll(/(\d+)\s*-?\s*(?:min(?:ute)?s?|m)\b(?!\s*-?\s*(?:ORB|opening range|range|or\b))/gi)) {
    // "after 15 minutes" is a duration, not a chart.
    const before = text.slice(Math.max(0, m.index! - 12), m.index!);
    if (/(after|first|wait|for|within)\s*$/i.test(before) && !/candle|chart|bar|close/i.test(text.slice(m.index!, m.index! + m[0].length + 14))) continue;
    add(`${m[1]}m`);
  }
  for (const m of text.matchAll(/\b(\d+)\s*-?\s*(?:h|hr|hour)\b(?!\s*(?:trend|bias))/gi)) add(`${m[1]}h`);
  if (/\bhourly (chart|trend|bias|structure)/i.test(text)) add('1h');
  for (const m of text.matchAll(/\b(1|4)\s?h\s*(?:trend|bias|chart)/gi)) add(`${m[1]}h`);
  if (/\bdaily (chart|candle|close|trend|bias|structure)/i.test(text)) add('1D');
  if (/\btick chart|\d+\s*tick\b/i.test(text)) add('tick');
  return out;
}

function directionIn(text: string): { direction: Interpretation['direction']; provenance: RuleProvenance | null } {
  const long = /\b(buy|buys|buying|long|longs|calls)\b|go long/i.test(text);
  // "sell-off" / "sellers" describe the market, not the trader's direction.
  const short = /\b(?:sell|sells|selling)\b(?!\s*-?\s*offs?\b)|\b(?:short|shorts|shorting|puts)\b|go short/i.test(text);
  const onlyLong = /only (long|buy)/i.test(text);
  const onlyShort = /only (short|sell)/i.test(text);
  if (onlyLong) return { direction: 'long', provenance: 'trader' };
  if (onlyShort) return { direction: 'short', provenance: 'trader' };
  if (long && short) return { direction: 'both', provenance: 'trader' };
  if (long) return { direction: 'long', provenance: 'trader' };
  if (short) return { direction: 'short', provenance: 'trader' };
  if (/\bfade|both (directions|ways|sides)|either direction/i.test(text)) return { direction: 'both', provenance: 'inferred' };
  // Where the trade happens implies its side: sellers absorbed at support → long.
  if (/sellers? (?:get |are |being )?absorbed|absorb(?:s|ing)? (?:the )?sell|\bat support\b|bounce off support/i.test(text)) return { direction: 'long', provenance: 'inferred' };
  if (/buyers? (?:get |are |being )?absorbed|absorb(?:s|ing)? (?:the )?buy|\bat resistance\b|reject(?:ion)? (?:at|from) resistance/i.test(text)) return { direction: 'short', provenance: 'inferred' };
  if (/break ?out|\bORB\b|opening range|trends?\b|follow|one direction|either way|whichever (?:way|direction)|\bscalp/i.test(text)) return { direction: 'both', provenance: 'inferred' };
  return { direction: null, provenance: null };
}

function detectStyles(text: string): DetectedStyle[] {
  const styles: DetectedStyle[] = [];
  for (const c of CONCEPTS) {
    const evidence: string[] = [];
    for (const p of c.patterns) {
      const m = p.exec(text);
      if (m) evidence.push(m[0].trim());
    }
    if (!evidence.length) continue;
    styles.push({ id: c.id, label: c.label, confidence: Math.min(1, 0.45 + 0.12 * evidence.length + c.specificity * 0.05), evidence: [...new Set(evidence)] });
  }
  // A breakout inside an ORB plan is part of the ORB, not a separate idea.
  styles.sort((a, b) => b.confidence - a.confidence || (CONCEPTS.find((c) => c.id === b.id)!.specificity - CONCEPTS.find((c) => c.id === a.id)!.specificity));
  if (!styles.length) styles.push({ id: CUSTOM_STYLE.id, label: CUSTOM_STYLE.label, confidence: 0.5, evidence: [] });
  return styles;
}

// ───────────────────────────── Fragments → rules ─────────────────────────────

const AND_SPLIT = /\s+(?=and\s+(?:then\s+|I\s+|it\s+|price\s+|wait|enter|buy|sell|short|go\s|take|place|put|use|exit|move|quickly|look|only|never|don'?t|no\s|confirm|retest|close|closes|stop|target|max|risk|momentum|volume|aggressive|the\s+(?:candle|market|price|level)))/i;
const CONNECTOR_SPLIT = /\s+(?=(?:then|but|when|whenever|once|after|if|unless|until|as soon as)\b)|\s+(?=with an? \d+(?:\.\d+)?\s*-?\s*(?:point|pt|tick|handle)s?\s+stop)/i;

export function fragmentsOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+|\n+/)
    .flatMap((s) => s.split(/,\s*/))
    .flatMap((s) => s.split(AND_SPLIT))
    .flatMap((s) => s.split(CONNECTOR_SPLIT))
    .map((s) => s.trim().replace(/[.!?;,]+$/, ''))
    .filter((s) => s.length > 1)
    // "enter | when X" — a bare action verb belongs to the condition that follows it.
    .reduce<string[]>((out, f) => {
      const prev = out[out.length - 1];
      if (prev && /^(?:and\s+)?(?:i\s+)?(?:enter|buy|sell|short|go long|go short|get in|fade|join|take it|take the trade)$/i.test(prev)) out[out.length - 1] = `${prev} ${f}`;
      else out.push(f);
      return out;
    }, []);
}

const TIME_ONLY = new RegExp(String.raw`^(?:and |then )?(?:only )?(?:after|from|starting(?: at)?|between|until|till|before|by|to|not before|no later than)?\s*${TIME}(?:\s*(?:and|to|-|–)\s*${TIME})?\s*(?:et|est|edt|ny time)?$`, 'i');

const SECTION_CUES: [RuleSection, RegExp][] = [
  ['maxTrades', /\b(max(?:imum)?|at most|only|up to|no more than)\s+(?:of\s+)?(\d+|one|two|three|four|five)\s+trades?\b|\b(\d+|one|two|three)\s+trades?\s+(?:per|a|each)\s+(?:day|session)\b|one and done/i],
  ['noTrade', /\b(?:don'?t|do not|never|no|avoid|skip|stay (?:out|flat)|sit out|not)\b[^.]*\b(?:trade|trades|trading|enter|entries|take|chop|news|fomc|cpi)\b|\bavoid\b|\bskip\b/i],
  ['management', /break ?even|\bBE\b|\btrail(?:ing)?\b|\bpartials?\b|scale (?:out|in)|move (?:my |the )?stop|take (?:some|half) off|\brunner\b/i],
  ['stop', /\bstop(?:s|\s*loss|-loss)?\b(?!\s*(?:hunt|run|trading))|\bSL\b/i],
  ['target', /\btarget|\bprofit\b|take[- ]profit|\bTP\b|profit target|\bexit\b|\d+(?:\.\d+)?\s*R\b|1\s*:\s*\d|\d\s*:\s*1|\bR:R\b|risk.?(?:to.?)?reward/i],
  ['invalidation', /invalid|(?:setup|trade) (?:is )?(?:void|off|cancel)|\bcancel\b|\babort\b|no longer valid|\bscratch\b/i],
  ['risk', /\brisk(?:ing)?\b[^:]*?(?:\$|\d+\s*%|percent|contracts?)|\$\s?\d+|\b\d+(?:\.\d+)?\s*%(?! of the)|\bcontracts?\b|position siz|lot size|\bsize\b/i],
  ['volume', /\b(?:volume|rvol|delta)\b[^.]*\b(?:above|below|greater|higher|lower|spike|increas\w*|at least|more than|exceeds?)\b|(?:high|low|above[- ]average|below[- ]average|heavy|light|rising|increasing|big) volume|volume (?:spike|surge|confirms?|expansion)/i],
  ['volatility', /\b(?:atr|volatil\w*|vix)\b|range is (?:wide|narrow|small|large)|(?:wide|narrow) range|quiet (?:market|day|session)/i],
  ['bias', /\bbias\b|higher[- ]?time ?frame|\bHTF\b|daily (?:trend|chart)|\b(?:1|4)\s?h(?:our)? (?:trend|chart)|only (?:long|short|buy|sell)|with the (?:trend|bias)|trend direction|above (?:the )?(?:200|50)|weekly/i],
  ['confirmation', /confirm|candle close|\bclose[sd]?\b|\bclosing\b|re-?test|\bholds?\b|reclaim|engulf|rejection|\bwick\b|weaken|\bstall|exhaust|divergence/i],
  ['entry', /\b(?:enter|entry|entries|buy|buys|buying|sell|selling|short|shorting|long|fade|fades|fading|go long|go short|get in|join|take (?:the|a) trade|limit order|market order)\b/i],
  ['context', /\btrend(?:s|ing)?\b|sell-?off|selloff|\brally\b|\bdump|\bpump|\bchop|range[- ]bound|\bgap\b|\bnews\b|volatil|footprint|\bwatch\b|\bcharts?\b|\btrade (?:a|the|an)\b/i],
];

/** A clause that starts with the trader's action is the entry, whatever else it mentions. */
const ENTRY_LEAD = /^(?:and\s+|then\s+)*(?:i\s+)?(?:enter|buy|sell|short|go long|go short|join|fade|get in|take (?:the|a) trade)\b(?!\s*-?\s*off)/i;
const EARLY: RuleSection[] = ['maxTrades', 'noTrade', 'management', 'stop', 'target', 'invalidation'];

export function classifyFragment(f: string): RuleSection | null {
  if (TIME_ONLY.test(f)) return 'window';
  for (const [section, re] of SECTION_CUES) {
    if (!EARLY.includes(section)) break;
    if (re.test(f)) return section;
  }
  if (ENTRY_LEAD.test(f)) return 'entry';
  for (const [section, re] of SECTION_CUES) if (re.test(f)) return section;
  // Events at levels / patterns default to the setup.
  if (/\b(?:sweep|break|pull ?back|touch|test|tag|absorb|level|high|low|vwap|ema|sma|ma|range|zone|support|resistance|stretched|extended|structure|gap)/i.test(f)) return 'setup';
  // Conditions in the trader's own words are kept as setup rules rather than discarded.
  if (/\b(?:if|when|whenever|once|wait|push(?:es)?|moves?|candles?|bars?|price|first|momentum|there is|there's|starts?)\b/i.test(f) && f.split(/\s+/).length >= 3) return 'setup';
  return null;
}

/** Turn a trader fragment into an imperative rule in their own words. */
export function cleanRule(f: string): string {
  let s = f
    .trim()
    .replace(/^(?:and|then|but|so|also|plus)\s+/i, '')
    .replace(/^(?:i(?:'ll| will| usually| always| typically| like to| only| just| then| normally| generally| mostly)?|my plan is to|i'm looking to)\s+/i, '')
    .replace(/^(?:i\s+)/i, '')
    .replace(/^(?:when|whenever|once|as soon as|if|with|taking)\s+/i, '');
  s = s.replace(/^(\w)/, (m) => m.toUpperCase());
  return s;
}

const PRECISE = /\d|vwap|\bema\b|\bsma\b|previous day|prior day|yesterday|\bPDH\b|\bPDL\b|opening range|\bORB\b|close[sd]? (?:back )?(?:above|below|outside|inside|beyond|through)|re-?test|sweep|swing (?:high|low)|footprint|delta|imbalance|engulf/i;

export function isMeasurable(text: string, vague: string[], section: RuleSection, fullText = ''): boolean {
  if (vague.length) return false;
  if (section === 'window' || section === 'maxTrades' || section === 'timeframe') return true;
  // "Wait for a breakout" is defined when the plan says what closes beyond what.
  if (/break ?out|breaks?/i.test(text) && /\d+\s*-?\s*(?:min(?:ute)?|m)\s*(?:candle\s*)?close|candle close|close[sd]? (?:above|below|outside|beyond)/i.test(fullText)) return true;
  return PRECISE.test(text);
}

let seq = 0;
const rid = (p: string) => `${p}_${(seq++).toString(36)}`;

export function makeRule(section: RuleSection, text: string, provenance: RuleProvenance, quote: string | undefined, fullText: string, forceMeasurable?: boolean): StrategyRule {
  const vague = provenance === 'trader' ? findVagueTerms(quote ?? text, fullText).map((h) => h.match) : [];
  return {
    id: rid(section),
    section,
    text,
    provenance,
    quote,
    measurable: forceMeasurable ?? isMeasurable(text, vague, section, fullText),
    vagueTerms: vague,
  };
}

function levelIn(text: string): string | null {
  const m = /(previous|prior|yesterday'?s?)\s*day'?s?\s*(high|low)|yesterday'?s?\s*(high|low)|\b(PDH|PDL|ONH|ONL)\b|overnight (high|low)|opening range (high|low)|\bvwap\b/i.exec(text);
  if (!m) return null;
  if (m[4]) return m[4].toUpperCase() === 'PDH' ? "previous day's high" : m[4].toUpperCase() === 'PDL' ? "previous day's low" : m[4].toUpperCase() === 'ONH' ? 'overnight high' : 'overnight low';
  if (m[2]) return `previous day's ${m[2].toLowerCase()}`;
  if (m[3]) return `previous day's ${m[3].toLowerCase()}`;
  if (m[5]) return `overnight ${m[5].toLowerCase()}`;
  if (m[6]) return `opening range ${m[6].toLowerCase()}`;
  return 'VWAP';
}

export function interpretStrategy(input: string): Interpretation {
  const text = input.trim().replace(/\s+/g, ' ');
  const inst = instrumentsIn(text);
  const window = windowIn(text);
  const styles = detectStyles(text);
  const styleIds = styles.map((s) => s.id);
  const sess = sessionIn(text, window, styleIds);
  const dir = directionIn(text);
  const timeframes = timeframesIn(text);
  const orb = /(\d+)\s*-?\s*(?:min(?:ute)?s?|m)\s*-?\s*(?:ORB|opening range)/i.exec(text);
  const ema = /\b(\d+)\s*-?\s*(?:period\s*)?(ema|sma|ma)\b/i.exec(text) ?? /\b(ema|sma)\s*-?\s*(\d+)\b/i.exec(text);
  const emaPeriod = ema ? Number(/\d/.test(ema[1]) ? ema[1] : ema[2]) : null;
  const emaType = ema ? (/\d/.test(ema[1]) ? ema[2] : ema[1]).toUpperCase() : null;

  const context: ConceptContext = {
    text,
    direction: dir.direction,
    timeframe: timeframes.find((t) => t.endsWith('m')) ?? timeframes[0] ?? null,
    orbMinutes: orb ? Number(orb[1]) : null,
    emaPeriod,
    emaType,
    level: levelIn(text),
    concepts: styleIds,
    timeframes,
  };

  const rules: StrategyRule[] = [];
  const narrative: string[] = [];
  for (const f of fragmentsOf(text)) {
    const section = classifyFragment(f);
    if (section === 'window') continue; // captured structurally as the trading window
    const cleaned = cleanRule(f);
    if (!section) {
      narrative.push(f);
      continue;
    }
    // Pure instrument / style statements ("I trade ES") carry no rule.
    if (section === 'context' && /^(?:trade|trades)\s+(?:on\s+)?[A-Z0-9]{1,4}$/i.test(cleaned)) continue;
    rules.push(makeRule(section, cleaned, 'trader', f, text));
  }

  const maxM = /\b(?:max(?:imum)?|at most|up to|no more than|only)\s+(?:of\s+)?(\d+|one|two|three|four|five)\s+trades?\b/i.exec(text) ?? /\b(\d+|one|two|three)\s+trades?\s+(?:per|a|each)\s+(?:day|session)\b/i.exec(text);
  const oneAndDone = /one and done/i.test(text);
  const stopM =
    /(\d+(?:\.\d+)?)\s*-?\s*(?:point|pt|handle)s?\s*stop/i.exec(text) ?? /stop(?:\s*loss)?(?:\s*(?:of|at|is|=))?\s*(\d+(?:\.\d+)?)\s*(?:points?|pts?|handles?)/i.exec(text);
  const rrM = /\b1\s*[:/]\s*(\d+(?:\.\d+)?)\b/.exec(text) ?? /\b(\d+(?:\.\d+)?)\s*R\b(?!\s*:)/.exec(text) ?? /\b(\d+(?:\.\d+)?)\s*:\s*1\b/.exec(text);

  return {
    originalText: input,
    instruments: inst.list,
    instrumentProvenance: inst.provenance,
    session: sess.session,
    sessionProvenance: sess.provenance,
    window,
    timeframes,
    direction: dir.direction,
    directionProvenance: dir.provenance,
    styles,
    rules,
    maxTrades: maxM ? toNum(maxM[1]) : oneAndDone ? 1 : null,
    stopPoints: stopM ? Number(stopM[1]) : null,
    minRR: rrM ? Number(rrM[1]) : null,
    context,
    narrative,
  };
}
