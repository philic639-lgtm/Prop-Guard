import type { ChecklistItem, InstrumentSymbol, Strategy } from '@/types/domain';
import { formatClock, parseClock } from '@/utils/dates';

import { allInstruments } from './instrumentEngine';

/**
 * Deterministic natural-language → measurable rules converter.
 * Used on-device and as the fallback/validator for the AI parser.
 * It never invents rules: anything it cannot measure becomes a yes/no
 * checklist condition using the trader's own words.
 */
export interface ParsedStrategy {
  name: string;
  instrument: InstrumentSymbol | null;
  entryWindowStart: string | null;
  entryWindowEnd: string | null;
  biasRequirement: string;
  requiresBiasAlignment: boolean;
  stopMaxPoints: number | null;
  minRR: number | null;
  maxTrades: number | null;
  conditions: string[];
  /** Fragments of the description that were turned into generic conditions. */
  unparsed: string[];
}

export type ReviewRuleKind = 'window' | 'condition' | 'stop' | 'rr' | 'maxTrades' | 'bias';

export interface ReviewRule {
  id: string;
  kind: ReviewRuleKind;
  label: string;
  /** Checklist item id when kind === 'condition'. */
  itemId?: string;
  deletable: boolean;
}

/** Ticker regex from the instrument registry, longest first so MNQ wins over NQ. */
function instrumentRegex(): RegExp {
  const tickers = allInstruments()
    .map((s) => s.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`(?:^|[^A-Za-z0-9])(${tickers.join('|')})(?![A-Za-z0-9])`);
}

function toClock(h: number, m: number): string {
  // Futures day traders write "9:45" meaning AM and "1:30" meaning PM.
  const hour = h < 7 ? h + 12 : h;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutesClock(clock: string, minutes: number): string {
  const total = (parseClock(clock)! + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+|,\s*(?:then|and then)\s+|\.\s*$/i)
    .map((s) => s.trim().replace(/[.;]+$/, ''))
    .filter(Boolean);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseStrategyText(input: string): ParsedStrategy {
  const text = input.trim();
  const conditions: string[] = [];
  const matched = new Set<string>();
  const mark = (s: string) => matched.add(s);

  const result: ParsedStrategy = {
    name: 'My Strategy',
    instrument: null,
    entryWindowStart: null,
    entryWindowEnd: null,
    biasRequirement: '',
    requiresBiasAlignment: false,
    stopMaxPoints: null,
    minRR: null,
    maxTrades: null,
    conditions,
    unparsed: [],
  };
  if (!text) return result;

  const inst = instrumentRegex().exec(text);
  if (inst) result.instrument = inst[1];

  // Opening range
  const orb = /(\d+)\s*-?\s*(?:min(?:ute)?s?|m)\s*(?:ORB|opening range(?: breakout)?)/i.exec(text);
  const hasOrb = !!orb || /\bORB\b|opening range/i.test(text);
  const retest = /re-?test/i.test(text);
  if (hasOrb) {
    const mins = orb ? Number(orb[1]) : 15;
    conditions.push(`Identify ${mins} minute opening range`);
    result.name = `${mins}M ORB${retest ? ' Retest' : ''}`;
  } else if (/vwap/i.test(text)) {
    result.name = /pull ?back/i.test(text) ? 'VWAP Pullback' : 'VWAP Strategy';
    conditions.push('Price reaction at VWAP confirmed');
  } else if (/breakout/i.test(text)) {
    result.name = retest ? 'Breakout + Retest' : 'Breakout';
  }

  // Time window
  const after = /(?:after|from|starting(?: at)?)\s+(\d{1,2}):(\d{2})/i.exec(text);
  const until = /(?:until|till|before|by|to|-)\s*(\d{1,2}):(\d{2})/i.exec(after ? text.slice(after.index + after[0].length) : '');
  if (after) {
    result.entryWindowStart = toClock(Number(after[1]), Number(after[2]));
    result.entryWindowEnd = until ? toClock(Number(until[1]), Number(until[2])) : addMinutesClock(result.entryWindowStart, 75);
  }

  // Bias
  const bias = /(1\s?h(?:our)?|hourly|4\s?h|daily|higher[- ]time ?frame|htf)\s*(?:trend|bias|direction)/i.exec(text);
  if (bias) {
    result.biasRequirement = `${bias[1].toUpperCase().replace(/\s/g, '')} trend`;
    result.requiresBiasAlignment = true;
  }

  // Confirmation candle
  const close = /(\d+)\s*-?\s*(?:min(?:ute)?|m)\s*candle\s*(?:to\s*|must\s*|needs? to\s*)?close\s*(outside|above|below|beyond)\s*(?:the\s*)?([A-Za-z]+)?/i.exec(text);
  if (close) {
    const where = close[3] ? ` ${close[3].toUpperCase() === 'ORB' ? 'ORB' : close[3].toLowerCase()}` : hasOrb ? ' ORB' : ' level';
    conditions.push(`Wait for ${close[1]} minute close ${close[2].toLowerCase()}${where}`);
  }

  if (retest) conditions.push('Wait for retest');
  if (/(?:level|retest|it)\s*(?:holds|hold|is held)|holds the level/i.test(text)) conditions.push('Retest must hold');
  if (/momentum/i.test(text)) conditions.push('Momentum confirmation required');
  if (/volume/i.test(text)) conditions.push('Volume confirms the move');

  // Stop
  const stop =
    /(\d+(?:\.\d+)?)\s*(?:-\s*)?(?:point|pt)s?\s*stop/i.exec(text) ?? /stop(?:\s*loss)?[^0-9]{0,15}(\d+(?:\.\d+)?)\s*(?:points|point|pts|pt)/i.exec(text);
  if (stop) result.stopMaxPoints = Number(stop[1]);

  // Reward:risk
  const rr = /1\s*[:/]\s*(\d+(?:\.\d+)?)/.exec(text) ?? /(\d+(?:\.\d+)?)\s*R\b(?!\s*:)/.exec(text);
  if (rr) result.minRR = Number(rr[1]);

  // Trade limit
  const trades = /max(?:imum)?\s*(?:of\s*)?(\d+)\s*trades?/i.exec(text) ?? /(\d+)\s*trades?\s*(?:per|a)\s*day/i.exec(text);
  if (trades) result.maxTrades = Number(trades[1]);

  // Anything else with rule-like language becomes a condition in the trader's words.
  const known = /ORB|opening range|after \d|candle|re-?test|hold|momentum|stop|1\s*[:/]|R:R|risk|reward|trades? (?:per|a) day|max(?:imum)? \d|vwap|volume|trend|bias|\b(?:I trade|trade a|trade the)\b/i;
  for (const s of sentences(text)) {
    if (known.test(s)) {
      mark(s);
      continue;
    }
    if (/\b(wait|need|must|only|require|enter when|confirm|no trades?|avoid|never)\b/i.test(s) && s.length <= 120) {
      conditions.push(capitalize(s));
      result.unparsed.push(s);
    }
  }

  result.conditions = [...new Set(conditions)];
  return result;
}

/** Turn a parsed description into a full Strategy (caller supplies id/timestamps). */
export function strategyFromParsed(p: ParsedStrategy, base: Strategy, description: string): Strategy {
  const checklist: ChecklistItem[] = p.conditions.map((label, i) => ({ id: `nl_${i}_${label.length}`, label, kind: 'yesno', required: true }));
  return {
    ...base,
    name: p.name,
    markets: p.instrument ? [p.instrument] : base.markets,
    entryWindowStart: p.entryWindowStart,
    entryWindowEnd: p.entryWindowEnd,
    biasRequirement: p.biasRequirement,
    requiresBiasAlignment: p.requiresBiasAlignment,
    entryTrigger: p.conditions.find((c) => /close|break/i.test(c)) ?? base.entryTrigger,
    retestRules: p.conditions.find((c) => /retest/i.test(c)) ?? base.retestRules,
    stopMethod: p.stopMaxPoints ? `Max ${p.stopMaxPoints} points` : base.stopMethod,
    typicalStopMin: null,
    typicalStopMax: p.stopMaxPoints,
    targetMethod: p.minRR ? `Minimum ${p.minRR}R` : base.targetMethod,
    minRR: p.minRR ?? base.minRR,
    maxTrades: p.maxTrades ?? base.maxTrades,
    notes: description.trim(),
    checklist,
  };
}

/** Numbered, human-readable rule list for review screens and the dashboard plan card. */
export function strategyRules(s: Strategy): ReviewRule[] {
  const rules: ReviewRule[] = [];
  if (s.entryWindowStart && s.entryWindowEnd) {
    rules.push({
      id: 'window',
      kind: 'window',
      label: `Trade between ${formatClock(s.entryWindowStart)} and ${formatClock(s.entryWindowEnd)} ET`,
      deletable: true,
    });
  }
  if (s.requiresBiasAlignment) {
    rules.push({ id: 'bias', kind: 'bias', label: `Trade only with the ${s.biasRequirement || 'higher-timeframe'} bias`, deletable: true });
  }
  for (const c of s.checklist.filter((i) => i.kind === 'yesno')) {
    rules.push({ id: `c_${c.id}`, kind: 'condition', label: c.label, itemId: c.id, deletable: true });
  }
  if (s.typicalStopMax != null) rules.push({ id: 'stop', kind: 'stop', label: `Stop loss ${s.typicalStopMax} points max`, deletable: true });
  rules.push({ id: 'rr', kind: 'rr', label: `Minimum 1:${s.minRR} risk/reward`, deletable: false });
  rules.push({ id: 'maxTrades', kind: 'maxTrades', label: `Maximum ${s.maxTrades} trade${s.maxTrades === 1 ? '' : 's'} per day`, deletable: false });
  return rules;
}

export const STRATEGY_EXAMPLE =
  'I trade a 15 minute ORB on ES. I wait until after 9:45. I need a 5 minute candle to close outside the ORB, then wait for a retest. I enter when the level holds and momentum returns in the breakout direction. 5 point stop, minimum 1:2 R:R, max 2 trades per day.';
