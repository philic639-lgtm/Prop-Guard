import { formatClock, parseClock } from './time';
import { FIELD_LABELS, SOURCE_LABEL, type PlanBranch, type RuleTag, type PlanField, type PlanFieldKey, type PlanFields, type PlanFieldSource, type PlanSuggestion, type PlanValues, type StrategyPlan } from './types';

/**
 * Follow-up questions, answers / edits, suggestions, the definition score and the three
 * views of the plan ("what we understood", "what needs clarification", "your confirmed plan").
 * All pure and deterministic: the same plan always gives the same questions and score.
 */

// ───────────────────────────── Saved settings ─────────────────────────────

/** Settings the trader already saved elsewhere — offered for reuse, never applied without confirmation. */
export interface SavedSettings {
  markets?: string[];
  maxTradesPerDay?: number | null;
  maxConsecutiveLosses?: number | null;
  dailyStop?: number | null;
  maxRiskPerTrade?: number | null;
}

// ───────────────────────────── Questions ─────────────────────────────

export interface QuestionChoice {
  id: string;
  label: string;
  /** Applied when chosen. */
  apply: Answer;
  /** "From your saved settings" — reused only because the trader picks it here. */
  fromSaved?: boolean;
}

export interface PlanQuestion {
  /** Field key, or `branch:<id>`. */
  id: string;
  title: string;
  question: string;
  why: string;
  choices: QuestionChoice[];
  /** Placeholder for the custom answer, when one is allowed. */
  custom?: { placeholder: string; numeric?: boolean; unit?: string };
  priority: number;
  optional: boolean;
}

/** A trader's answer: a typed value, or "not used" (optional items) / "none" (no cutoff). */
export interface Answer {
  text?: string;
  number?: number;
  notUsed?: boolean;
  /** Evaluation window meaning. */
  meaning?: 'check_window' | 'entry_window';
  source?: PlanFieldSource;
  /** Re-confirm an earlier answer flagged after the description changed. */
  keep?: boolean;
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const ifText = (c: string) => `If ${lowerFirst(c.replace(/^if\s+/i, ''))}`;
const open = (f: PlanField) => (f.status === 'missing' || f.status === 'needs_clarification') && f.relevance !== 'optional';

const BRANCH_CHOICES: Record<PlanBranch['kind'], { id: string; label: string }[]> = {
  outside_range: [
    { id: 'breakout', label: 'Trade the side price broke out of: above the high → long, below the low → short' },
    { id: 'fade', label: 'Fade it: trade back toward the range' },
  ],
  inside_range: [
    { id: 'move', label: 'The direction price moves after the check window (e.g. breaks the range high → long)' },
    { id: 'closer', label: 'Toward the side of the range price is closer to' },
    { id: 'skip', label: 'No trade on inside days' },
  ],
  other: [
    { id: 'long', label: 'Long' },
    { id: 'short', label: 'Short' },
  ],
};

/** Open questions, most important first. Only what is still unanswered. */
export function planQuestions(plan: StrategyPlan, saved: SavedSettings = {}): PlanQuestion[] {
  // Earlier answers kept after the description changed: re-confirm or change them first.
  const review: PlanQuestion[] = [
    ...(Object.values(plan.fields) as PlanField[])
      .filter((x) => x.review)
      .map((x) => ({
        id: x.key,
        title: `Check your answer: ${x.label}`,
        question: `Your description changed. Is this still right? “${x.display ?? ''}”`,
        why: 'Answers you gave before the edit are kept but not used until you confirm them.',
        choices: [{ id: 'keep', label: `Yes, keep it`, apply: { keep: true } }],
        custom: { placeholder: 'Or type the new rule' },
        priority: 0,
        optional: false,
      })),
    ...plan.branches
      .filter((b) => b.review)
      .map((b) => ({
        id: `branch:${b.id}`,
        title: 'Check your answer: direction',
        question: `Your description changed. When ${lowerFirst(b.condition)}, is this still right? “${b.directionRule ?? ''}”`,
        why: 'Answers you gave before the edit are kept but not used until you confirm them.',
        choices: [{ id: 'keep', label: 'Yes, keep it', apply: { keep: true } }, ...BRANCH_CHOICES[b.kind].map((c) => ({ id: c.id, label: c.label, apply: { text: c.label } }))],
        custom: { placeholder: 'Describe how you pick long or short' },
        priority: 0,
        optional: false,
      })),
  ];
  const reviewIds = new Set(review.map((r) => r.id));
  const f = plan.fields;
  const q: PlanQuestion[] = [];
  const ev = f.evaluationWindow.value;

  if (open(f.instrument))
    q.push({
      id: 'instrument',
      title: 'Instrument',
      question: f.instrument.note ?? 'Which instrument do you trade this on?',
      why: 'Point value, tick size and sizing depend on the contract.',
      choices: [
        ...(saved.markets ?? []).slice(0, 3).map((m) => ({ id: `saved:${m}`, label: `${m} (your usual market)`, apply: { text: m, source: 'saved_settings' as const }, fromSaved: true })),
        ...['NQ', 'MNQ', 'ES', 'MES'].filter((m) => !(saved.markets ?? []).includes(m)).slice(0, 4 - Math.min(3, (saved.markets ?? []).length)).map((m) => ({ id: m, label: m, apply: { text: m } })),
      ],
      custom: { placeholder: 'e.g. MNQ' },
      priority: 1,
      optional: false,
    });

  for (const b of plan.branches.filter((x) => x.status === 'needs_clarification'))
    q.push({
      id: `branch:${b.id}`,
      title: b.kind === 'outside_range' ? 'Direction when price is outside the range' : b.kind === 'inside_range' ? 'Direction when price is inside the range' : 'Direction',
      question: b.note ?? `What decides the direction when ${lowerFirst(b.condition)}?`,
      why: '“Following the direction” can be read more than one way — the plan has to say which side you take.',
      choices: BRANCH_CHOICES[b.kind].map((c) => ({ id: c.id, label: c.label, apply: { text: c.label } })),
      custom: { placeholder: 'Describe how you pick long or short' },
      priority: 2,
      optional: false,
    });

  if (f.evaluationWindow.status === 'needs_clarification' && ev)
    q.push({
      id: 'evaluationWindow',
      title: `What ${formatClock(ev.start)}–${formatClock(ev.end)} means`,
      question: f.evaluationWindow.note ?? 'What does this window mean?',
      why: 'It decides whether entries after it are allowed.',
      choices: [
        { id: 'check', label: `It is when I check where price is — I can still enter after ${formatClock(ev.end)}`, apply: { meaning: 'check_window' } },
        { id: 'entry', label: `It is my entry window — no new entries after ${formatClock(ev.end)}`, apply: { meaning: 'entry_window' } },
      ],
      priority: 3,
      optional: false,
    });

  if (open(f.entryTrigger))
    q.push({
      id: 'entryTrigger',
      title: 'Entry trigger',
      question: 'What exactly gets you into the trade?',
      why: f.entryTrigger.note ?? 'Without a precise trigger the same chart can be read differently on different days.',
      choices: [
        { id: 'break', label: 'Price trades through the range high / low', apply: { text: 'Enter when price trades through the range high (long) or low (short)' } },
        { id: 'close', label: 'A candle closes beyond the level on my execution chart', apply: { text: 'Enter after a candle closes beyond the range level on the execution chart' } },
        { id: 'retest', label: 'Price comes back to the level and holds', apply: { text: 'Enter when price retests the range level and holds' } },
      ],
      custom: { placeholder: 'Describe your entry' },
      priority: 4,
      optional: false,
    });

  if (open(f.executionTimeframe))
    q.push({
      id: 'executionTimeframe',
      title: 'Execution chart',
      question: f.openingRange.value ? `Which chart do you take entries on? (Separate from your ${f.openingRange.value.minutes}-minute opening range.)` : 'Which chart timeframe do you take entries on?',
      why: 'A 1-minute and a 5-minute chart give different signals.',
      choices: ['1m', '2m', '5m', '15m'].map((t) => ({ id: t, label: `${t.replace('m', '-minute')}`, apply: { text: t } })),
      custom: { placeholder: 'e.g. 3m' },
      priority: 5,
      optional: false,
    });

  if (open(f.entryCutoff) && f.entryCutoff.status === 'missing')
    q.push({
      id: 'entryCutoff',
      title: 'Last entry time',
      question: 'Until what time do you take new entries?',
      why: 'A cutoff stops late, lower-quality trades. Not stated in your description — it is not assumed.',
      choices: [
        { id: '1000', label: '10:00 AM', apply: { text: '10:00' } },
        { id: '1030', label: '10:30 AM', apply: { text: '10:30' } },
        { id: '1100', label: '11:00 AM', apply: { text: '11:00' } },
        { id: 'none', label: 'No fixed cutoff', apply: { text: 'none' } },
      ],
      custom: { placeholder: 'e.g. 10:15' },
      priority: 6,
      optional: false,
    });

  if (open(f.stop))
    q.push({
      id: 'stop',
      title: 'Stop',
      question: 'Where does your stop go?',
      why: 'The stop sets the risk of every trade.',
      choices: [
        { id: 'other', label: 'Other side of the opening range', apply: { text: 'Stop at the other side of the opening range' } },
        { id: 'candle', label: 'Beyond the entry candle', apply: { text: 'Stop beyond the entry candle' } },
      ],
      custom: { placeholder: 'e.g. 20 points, or below the range midpoint' },
      priority: 7,
      optional: false,
    });

  if (open(f.target))
    q.push({
      id: 'target',
      title: 'Target',
      question: 'Where do you take profit?',
      why: 'Without a target, results depend on in-the-moment decisions.',
      choices: [
        { id: '2r', label: '2R (twice the risk)', apply: { text: 'Take profit at 2R' } },
        { id: 'height', label: 'One range height from the breakout', apply: { text: 'Take profit one opening-range height from the breakout level' } },
      ],
      custom: { placeholder: 'e.g. 40 points' },
      priority: 8,
      optional: false,
    });

  if (open(f.sizing))
    q.push({
      id: 'sizing',
      title: 'Position size',
      question: 'How do you size each trade?',
      why: 'Sizing turns the stop into dollars at risk.',
      choices: [
        ...(saved.maxRiskPerTrade ? [{ id: 'saved', label: `Risk up to $${saved.maxRiskPerTrade} per trade (your saved setting)`, apply: { text: `Risk up to $${saved.maxRiskPerTrade} per trade`, source: 'saved_settings' as const }, fromSaved: true }] : []),
        { id: 'fixed', label: 'A fixed number of contracts', apply: { text: 'Fixed number of contracts' } },
      ],
      custom: { placeholder: 'e.g. 2 MNQ, or $200 risk' },
      priority: 9,
      optional: false,
    });

  if (open(f.maxTrades))
    q.push({
      id: 'maxTrades',
      title: 'Maximum trades per day',
      question: 'How many trades at most per day for this strategy?',
      why: 'Separate from how many LOSSES end your day.',
      choices: [
        ...(saved.maxTradesPerDay ? [{ id: 'saved', label: `${saved.maxTradesPerDay} (your account setting)`, apply: { number: saved.maxTradesPerDay, source: 'saved_settings' as const }, fromSaved: true }] : []),
        ...[1, 2, 3].filter((n) => n !== saved.maxTradesPerDay).map((n) => ({ id: String(n), label: String(n), apply: { number: n } })),
      ],
      custom: { placeholder: 'Number', numeric: true },
      priority: 10,
      optional: false,
    });

  if (open(f.maxLosses))
    q.push({
      id: 'maxLosses',
      title: 'Stop after losing trades',
      question: 'After how many losing trades (full stop-outs) do you stop for the day?',
      why: '“Stop after one full loss” does not limit you to one trade if the first one wins.',
      choices: [
        ...(saved.maxConsecutiveLosses ? [{ id: 'saved', label: `${saved.maxConsecutiveLosses} (your account setting)`, apply: { number: saved.maxConsecutiveLosses, source: 'saved_settings' as const }, fromSaved: true }] : []),
        ...[1, 2].filter((n) => n !== saved.maxConsecutiveLosses).map((n) => ({ id: String(n), label: `After ${n} loss${n > 1 ? 'es' : ''}`, apply: { number: n } })),
      ],
      custom: { placeholder: 'Number', numeric: true },
      priority: 11,
      optional: false,
    });

  if (open(f.dailyLossLimit))
    q.push({
      id: 'dailyLossLimit',
      title: 'Daily dollar-loss limit',
      question: 'How many dollars can you lose in a day before you stop?',
      why: 'A dollar cap, separate from trade and loss counts.',
      choices: saved.dailyStop ? [{ id: 'saved', label: `$${saved.dailyStop} (your saved daily stop)`, apply: { number: saved.dailyStop, source: 'saved_settings' as const }, fromSaved: true }] : [],
      custom: { placeholder: 'Dollars', numeric: true, unit: '$' },
      priority: 12,
      optional: false,
    });

  if (plan.fields.filters.status === 'missing')
    q.push({
      id: 'filters',
      title: 'Optional filters',
      question: 'Do you use volume, order flow or another filter? (Optional — fine if not.)',
      why: 'Only matters if your decisions depend on it.',
      choices: [
        { id: 'none', label: 'Not used', apply: { notUsed: true } },
        { id: 'volume', label: 'Volume', apply: { text: 'volume' } },
        { id: 'orderflow', label: 'Order flow', apply: { text: 'order flow' } },
      ],
      custom: { placeholder: 'Describe the filter' },
      priority: 20,
      optional: true,
    });

  if (f.timezone.status === 'needs_clarification')
    q.push({
      id: 'timezone',
      title: 'Time zone',
      question: f.timezone.note ?? 'Your times are read as New York local time. Correct?',
      why: '9:30 New York time is 9:30 EDT in summer and 9:30 EST in winter.',
      choices: [{ id: 'ny', label: 'Yes — New York local time', apply: { text: 'America/New_York' } }],
      priority: 13,
      optional: false,
    });

  return [...review, ...q.filter((x) => !reviewIds.has(x.id)).sort((a, b) => a.priority - b.priority)];
}

// ───────────────────────────── Answers & edits ─────────────────────────────

const at = (now?: string) => now ?? new Date().toISOString();

function setField<K extends PlanFieldKey>(fields: PlanFields, key: K, value: PlanValues[K] | null, display: string | null, source: PlanFieldSource, now: string, status: PlanField['status'] = 'supplied'): PlanFields {
  const prev = fields[key];
  return { ...fields, [key]: { ...prev, value, display, status, source, updatedAt: now, note: undefined, review: undefined } } as PlanFields;
}

/** Apply an answer or an edit. Dependent views (questions, score, checklist) are derived, so nothing goes stale. */
export function answerPlan(plan: StrategyPlan, id: string, a: Answer, now?: string): StrategyPlan {
  const t = at(now);
  const src: PlanFieldSource = a.source ?? 'answer';
  let fields = plan.fields;
  let branches = plan.branches;

  if (id.startsWith('branch:')) {
    const bid = id.slice(7);
    branches = branches.map((b) =>
      b.id !== bid ? b : a.keep && b.directionRule ? { ...b, status: 'supplied', review: undefined, note: undefined } : a.text ? { ...b, directionRule: a.text, status: 'supplied', source: src, note: undefined, review: undefined } : b,
    );
    return { ...plan, branches, updatedAt: t };
  }
  const key = id as PlanFieldKey;
  if (a.keep) {
    const x = fields[key];
    if (!x.review) return plan;
    return { ...plan, fields: { ...fields, [key]: { ...x, status: x.display === 'Not used' ? 'not_used' : 'supplied', review: undefined, note: undefined, updatedAt: t } } as PlanFields, updatedAt: t };
  }
  const text = a.text?.trim() ?? '';
  switch (key) {
    case 'instrument': {
      const syms = text.toUpperCase().split(/[\s,/]+/).filter(Boolean);
      if (syms.length) fields = setField(fields, 'instrument', syms, syms.join(', '), src, t);
      break;
    }
    case 'timezone':
      fields = setField(fields, 'timezone', { zone: 'America/New_York', written: plan.fields.timezone.value?.written ?? null }, 'New York local time (EDT in summer, EST in winter)', src, t);
      break;
    case 'evaluationWindow': {
      const ev = plan.fields.evaluationWindow.value;
      if (!ev || !a.meaning) break;
      fields = setField(fields, 'evaluationWindow', { ...ev, meaning: a.meaning }, `${formatClock(ev.start)}–${formatClock(ev.end)}: ${a.meaning === 'entry_window' ? 'entry window' : 'when you check where price is'}`, src, t);
      // An entry window also sets the cutoff (from the trader's own answer).
      if (a.meaning === 'entry_window') fields = setField(fields, 'entryCutoff', ev.end, formatClock(ev.end), src, t);
      break;
    }
    case 'entryCutoff': {
      if (text.toLowerCase() === 'none') fields = setField(fields, 'entryCutoff', 'none', 'No fixed cutoff', src, t);
      else {
        const c = parseClock(text);
        if (c) fields = setField(fields, 'entryCutoff', c, formatClock(c), src, t);
      }
      break;
    }
    case 'lookStart': {
      const c = parseClock(text);
      if (c) fields = setField(fields, 'lookStart', c, formatClock(c), src, t);
      break;
    }
    case 'openingRange': {
      const m = /(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)/i.exec(text);
      const s = m && parseClock(m[1]);
      const e = m && parseClock(m[2]);
      if (s && e) {
        const minutes = (+e.slice(0, 2) * 60 + +e.slice(3)) - (+s.slice(0, 2) * 60 + +s.slice(3));
        if (minutes > 0) fields = setField(fields, 'openingRange', { start: s, end: e, minutes }, `${formatClock(s)}–${formatClock(e)} (${minutes} minutes)`, src, t);
      }
      break;
    }
    case 'executionTimeframe': {
      const m = /(\d{1,3})\s*(?:m|min|minute)?/i.exec(text);
      if (m) fields = setField(fields, 'executionTimeframe', `${m[1]}m`, `${m[1]}-minute chart`, src, t);
      break;
    }
    case 'maxTrades':
    case 'maxLosses':
    case 'dailyLossLimit': {
      const n = a.number ?? Number(text.replace(/[$,\s]/g, ''));
      if (Number.isFinite(n) && n > 0) {
        const display = key === 'maxTrades' ? `${n} per day` : key === 'maxLosses' ? `Stop after ${n} losing trade${n > 1 ? 's' : ''}` : `$${n.toLocaleString('en-US')}`;
        fields = setField(fields, key, n, display, src, t);
      }
      break;
    }
    case 'filters':
      if (a.notUsed) fields = setField(fields, 'filters', [], 'Not used', src, t, 'not_used');
      else if (text) fields = setField(fields, 'filters', text.split(/\s*,\s*/), text, src, t);
      break;
    default:
      if (text) fields = setField(fields, key, text as never, text, src, t);
  }
  return { ...plan, fields, updatedAt: t };
}

// ───────────────────────────── Suggestions ─────────────────────────────

/** Optional refinements to TEST. Inactive (not in the plan, not scored) until the trader accepts one. */
export function planSuggestions(plan: StrategyPlan): PlanSuggestion[] {
  const trig = (plan.fields.entryTrigger.display ?? '').toLowerCase();
  const out: Omit<PlanSuggestion, 'status' | 'decidedAt'>[] = [];
  if (!/close/.test(trig))
    out.push({
      id: 'candle_close',
      title: 'Candle-close confirmation (optional)',
      rule: 'Only enter after a candle closes beyond the level on your execution chart',
      hypothesis: 'Hypothesis to test, not a rule you stated: waiting for a close may filter some false breaks but enters later. Practice both and compare.',
    });
  if (!/retest|pull ?back/.test(trig))
    out.push({
      id: 'retest',
      title: 'Retest entry (optional)',
      rule: 'Enter when price returns to the range level and holds',
      hypothesis: 'Hypothesis to test: a retest can give a tighter stop but some moves never come back.',
    });
  if (plan.usesOpeningRange)
    out.push({
      id: 'wide_range',
      title: 'Skip unusually wide ranges (optional)',
      rule: 'Skip the day when the opening range is wider than your maximum stop',
      hypothesis: 'Hypothesis to test: a very wide range may not fit your stop and size.',
    });
  return out.map((s) => ({ ...s, status: plan.decisions[s.id]?.status ?? 'pending', ...(plan.decisions[s.id] ? { decidedAt: plan.decisions[s.id].at } : {}) }));
}

export function decideSuggestion(plan: StrategyPlan, id: string, status: 'accepted' | 'rejected' | 'pending', now?: string): StrategyPlan {
  const decisions = { ...plan.decisions };
  if (status === 'pending') delete decisions[id];
  else decisions[id] = { status, at: at(now) };
  return { ...plan, decisions, updatedAt: at(now) };
}

// ───────────────────────────── Score ─────────────────────────────

export interface ScoreLine {
  key: string;
  label: string;
  earned: number;
  possible: number;
  reason: string;
}

export interface PlanScore {
  /** 0–100: how completely and clearly the rules are defined. Says nothing about profitability. */
  score: number;
  lines: ScoreLine[];
  /** Lines that lost points, biggest first. */
  deductions: ScoreLine[];
}

export const SCORE_RUBRIC =
  'Each rule this plan needs is worth points: required rules 10, recommended rules 5. Defined (by you, your answer, a saved setting you confirmed, or a suggestion you accepted) earns full points; needs clarification earns half; missing earns none. Optional tools you do not use cost nothing. Each unclear branch costs 5 of 10. The score measures how clearly the plan is written — not whether it makes money.';

export function scorePlan(plan: StrategyPlan): PlanScore {
  const lines: ScoreLine[] = [];
  for (const f of Object.values(plan.fields) as PlanField[]) {
    if (f.relevance === 'optional') continue;
    const possible = f.relevance === 'required' ? 10 : 5;
    const earned = f.status === 'supplied' || f.status === 'accepted' || f.status === 'not_used' ? possible : f.status === 'needs_clarification' ? possible / 2 : 0;
    lines.push({ key: f.key, label: f.label, earned, possible, reason: earned === possible ? 'Defined' : f.status === 'needs_clarification' ? `Needs clarification${f.note ? ` — ${f.note}` : ''}` : 'Not in your description' });
  }
  for (const b of plan.branches) {
    const earned = b.status === 'supplied' ? 10 : 5;
    lines.push({ key: `branch:${b.id}`, label: `Branch: ${b.condition}`, earned, possible: 10, reason: earned === 10 ? 'Direction defined' : 'Direction needs clarification' });
  }
  const possible = lines.reduce((n, l) => n + l.possible, 0);
  const earned = lines.reduce((n, l) => n + l.earned, 0);
  return {
    score: possible ? Math.round((earned / possible) * 100) : 0,
    lines,
    deductions: lines.filter((l) => l.earned < l.possible).sort((a, b) => b.possible - b.earned - (a.possible - a.earned)),
  };
}

// ───────────────────────────── Views ─────────────────────────────

export interface PlanLine {
  key: string;
  text: string;
  status: PlanField['status'] | 'accepted';
  sourceLabel: string | null;
  evidence?: string;
  /** Trader supplied / Needs clarification / App suggestion / Trader accepted. */
  tag: RuleTag;
}

/** The rule label for a status. */
export const tagOf = (status: PlanLine['status']): RuleTag => (status === 'accepted' ? 'trader_accepted' : status === 'supplied' || status === 'not_used' ? 'trader_supplied' : 'needs_clarification');

/** "What we understood": a short, editable summary in plain language. */
export function understoodLines(plan: StrategyPlan): PlanLine[] {
  const f = plan.fields;
  const out: Omit<PlanLine, 'tag'>[] = [];
  const line = (key: PlanFieldKey, text: string) => out.push({ key, text, status: f[key].status, sourceLabel: f[key].source ? SOURCE_LABEL[f[key].source!] : null, evidence: f[key].evidence });
  if (f.openingRange.value) line('openingRange', `Opening range: high and low of ${f.openingRange.display}.`);
  else if (f.openingRange.status === 'needs_clarification') line('openingRange', 'Opening range: mentioned, but its minutes are not stated.');
  if (f.lookStart.value) line('lookStart', `Start looking for entries at ${f.lookStart.display}.`);
  if (f.evaluationWindow.value) line('evaluationWindow', `Price is checked around ${formatClock(f.evaluationWindow.value.start)}–${formatClock(f.evaluationWindow.value.end)}${f.evaluationWindow.value.meaning ? ` (${f.evaluationWindow.value.meaning === 'entry_window' ? 'entry window' : 'check window — entries may come later'})` : ' — meaning to confirm'}.`);
  if (f.entryCutoff.value) line('entryCutoff', f.entryCutoff.value === 'none' ? 'No fixed last entry time.' : `Last entry: ${f.entryCutoff.display}.`);
  else if (f.entryCutoff.relevance !== 'optional') out.push({ key: 'entryCutoff', text: 'Last entry time: not stated (not assumed).', status: 'missing', sourceLabel: null });
  for (const b of plan.branches)
    out.push({ key: `branch:${b.id}`, text: `${ifText(b.condition)} → ${b.directionRule ?? b.action}${b.status === 'needs_clarification' ? ' (direction to clarify)' : ''}.`, status: b.status, sourceLabel: SOURCE_LABEL[b.source], evidence: b.evidence });
  if (f.timezone.value) line('timezone', `Times read as ${f.timezone.display}.`);
  for (const k of ['instrument', 'executionTimeframe', 'entryTrigger', 'stop', 'target', 'sizing', 'maxTrades', 'maxLosses', 'dailyLossLimit'] as const)
    if (f[k].value != null && f[k].status !== 'missing') line(k, `${FIELD_LABELS[k]}: ${f[k].display}.`);
  const notGiven = (['instrument', 'executionTimeframe', 'entryTrigger', 'stop', 'target', 'sizing', 'maxTrades', 'maxLosses', 'dailyLossLimit'] as const).filter((k) => f[k].status === 'missing').map((k) => FIELD_LABELS[k].toLowerCase());
  if (notGiven.length) out.push({ key: 'not_given', text: `Not in your description: ${notGiven.join(', ')}.`, status: 'missing', sourceLabel: null });
  return out.map((l) => ({ ...l, tag: tagOf(l.status) }));
}

/** "Your confirmed plan": only defined rules and accepted suggestions, each with its source. */
export function confirmedPlan(plan: StrategyPlan): PlanLine[] {
  const f = plan.fields;
  const out: Omit<PlanLine, 'tag'>[] = [];
  const add = (key: PlanFieldKey, text: string) => {
    const x = f[key];
    if (x.status === 'supplied' || x.status === 'accepted') out.push({ key, text, status: x.status, sourceLabel: x.source ? SOURCE_LABEL[x.source] : null, evidence: x.evidence });
  };
  if (f.instrument.value?.length) add('instrument', `Instrument: ${f.instrument.display}`);
  if (f.timezone.value) add('timezone', `Times in ${f.timezone.display}`);
  if (f.openingRange.value) add('openingRange', `Mark the high and low of ${f.openingRange.display}`);
  if (f.lookStart.value) add('lookStart', `Start looking for entries at ${f.lookStart.display}`);
  if (f.evaluationWindow.value?.meaning) add('evaluationWindow', `${f.evaluationWindow.display}`);
  if (f.entryCutoff.value) add('entryCutoff', f.entryCutoff.value === 'none' ? 'No fixed last entry time' : `No new entries after ${f.entryCutoff.display}`);
  for (const b of plan.branches) if (b.status === 'supplied') out.push({ key: `branch:${b.id}`, text: `${ifText(b.condition)}: ${b.directionRule}`, status: 'supplied', sourceLabel: SOURCE_LABEL[b.source], evidence: b.evidence });
  for (const k of ['executionTimeframe', 'entryTrigger', 'stop', 'target', 'sizing', 'maxTrades', 'maxLosses', 'dailyLossLimit', 'filters'] as const) if (f[k].display) add(k, `${FIELD_LABELS[k]}: ${f[k].display}`);
  if (f.filters.status === 'not_used') out.push({ key: 'filters', text: 'Optional filters: not used', status: 'not_used', sourceLabel: SOURCE_LABEL.answer });
  for (const s of planSuggestions(plan).filter((x) => x.status === 'accepted')) out.push({ key: `suggestion:${s.id}`, text: s.rule, status: 'accepted', sourceLabel: SOURCE_LABEL.suggestion });
  return out.map((l) => ({ ...l, tag: tagOf(l.status) }));
}

// ───────────────────────────── Readiness ─────────────────────────────

export interface PlanReadiness {
  /** draft — saved, clearly labelled, until every required rule is defined. */
  status: 'draft' | 'complete';
  unresolved: string[];
}

export function planReadiness(plan: StrategyPlan): PlanReadiness {
  const unresolved = [
    ...(Object.values(plan.fields) as PlanField[]).filter((f) => f.relevance === 'required' && (f.status === 'missing' || f.status === 'needs_clarification')).map((f) => f.label),
    ...plan.branches.filter((b) => b.status === 'needs_clarification').map((b) => (b.kind === 'outside_range' ? 'Direction outside the range' : b.kind === 'inside_range' ? 'Direction inside the range' : 'Direction')),
  ];
  return { status: unresolved.length ? 'draft' : 'complete', unresolved };
}

export interface PlanTestability {
  /** Manual historical practice: always possible — the trader decides on each chart. */
  manual: { available: true; note: string };
  /** Automated testing: precise rules AND verified historical data, or the reasons it is unavailable. */
  automated: { available: boolean; reasons: string[] };
}

/** `verifiedScenarios`: verified historical scenarios available for this plan's instrument. */
export function planTestability(plan: StrategyPlan, verifiedScenarios: number, minimum = 30): PlanTestability {
  const reasons: string[] = [];
  const need = ['instrument', 'executionTimeframe', 'entryTrigger', 'stop', 'target'] as const;
  const vague = need.filter((k) => plan.fields[k].status !== 'supplied' && plan.fields[k].status !== 'accepted').map((k) => FIELD_LABELS[k].toLowerCase());
  if (vague.length) reasons.push(`Rules not precise enough yet: ${vague.join(', ')}.`);
  if (plan.branches.some((b) => b.status === 'needs_clarification')) reasons.push('The direction rule is not defined yet.');
  if (verifiedScenarios < minimum) reasons.push(`Verified historical data is not connected (${verifiedScenarios} of ${minimum} verified sessions available). No automated results are shown without it.`);
  return {
    manual: { available: true, note: 'Practice manually: you decide on each chart. Charts labelled SAMPLE or SIMULATED are practice material, not real market history.' },
    automated: { available: reasons.length === 0, reasons },
  };
}

/** Edit any line of the summary: the open question for it when there is one, else a free edit of the field. */
export function editQuestion(plan: StrategyPlan, id: string, saved: SavedSettings = {}): PlanQuestion | null {
  const open = planQuestions(plan, saved).find((q) => q.id === id);
  if (open) return open;
  if (id.startsWith('branch:')) {
    const b = plan.branches.find((x) => `branch:${x.id}` === id);
    if (!b) return null;
    return { id, title: 'Direction', question: `What do you do when ${lowerFirst(b.condition)}?`, why: 'Your words are kept; this replaces how the direction reads.', choices: BRANCH_CHOICES[b.kind].map((c) => ({ id: c.id, label: c.label, apply: { text: c.label } })), custom: { placeholder: b.directionRule ?? b.action }, priority: 0, optional: false };
  }
  const key = id as PlanFieldKey;
  const f = plan.fields[key];
  if (!f) return null;
  const numeric = key === 'maxTrades' || key === 'maxLosses' || key === 'dailyLossLimit';
  const hint: Partial<Record<PlanFieldKey, string>> = { openingRange: 'e.g. 9:30–9:45', lookStart: 'e.g. 9:50', entryCutoff: 'e.g. 10:30, or "none"', executionTimeframe: 'e.g. 5m' };
  return { id, title: `Edit: ${f.label}`, question: f.display ? `Currently: ${f.display}` : `Add ${f.label.toLowerCase()}`, why: 'Your change replaces this rule everywhere — summary, checklist, score and saved plan.', choices: [], custom: { placeholder: hint[key] ?? 'Type the rule', numeric, ...(key === 'dailyLossLimit' ? { unit: '$' } : {}) }, priority: 0, optional: f.relevance === 'optional' };
}

/**
 * The trader edited the DESCRIPTION: re-read it, and keep their answers, confirmed saved settings,
 * accepted ideas and branch directions for anything the new text still leaves open.
 */
export function rebasePlan(next: StrategyPlan, prev: StrategyPlan): StrategyPlan {
  const fields = { ...next.fields } as PlanFields;
  for (const k of Object.keys(prev.fields) as PlanFieldKey[]) {
    const old = prev.fields[k];
    // Kept, but flagged: the trader confirms it still applies to the edited description.
    if (old.source && old.source !== 'description' && old.value != null && (fields[k].status === 'missing' || fields[k].status === 'needs_clarification'))
      (fields as Record<string, PlanField>)[k] = { ...old, status: 'needs_clarification', review: true, note: 'Your description changed — check this answer still applies.' };
  }
  const branches = next.branches.map((b) => {
    const was = prev.branches.find((x) => x.kind === b.kind && x.source !== 'description' && x.directionRule);
    return b.status === 'needs_clarification' && was ? { ...b, directionRule: was.directionRule, status: 'needs_clarification' as const, source: was.source, review: true, note: 'Your description changed — check this answer still applies.' } : b;
  });
  return { ...next, fields, branches, decisions: { ...prev.decisions }, createdAt: prev.createdAt };
}
