/**
 * "Teach Prop Guard your plan" — the canonical plan built from the trader's own words.
 * Regression: the 9:30–9:45 opening-range description below was read as "range length
 * missing", "window ends 9:50", candle-close rules nobody stated, and lost its two branches.
 */
import { rowsToStrategy, strategyToRows } from '@/services/supabase/mappers';

import {
  answerPlan,
  confirmedPlan,
  decideSuggestion,
  extractPlan,
  planOf,
  planQuestions,
  planReadiness,
  planSuggestions,
  planTestability,
  planToStrategy,
  rebasePlan,
  scorePlan,
  sessionInstant,
  syncedStrategy,
  understoodLines,
  type StrategyPlan,
} from '../strategyPlan';

const ORB =
  'I draw out the high and low of 9:30 am EST–9:45 candle. Then I wait until 9:50 to start looking for a move. If price is outside the ORB by 9:50–9:55, I follow the direction outside the ORB. If it’s inside the ORB, I take a move following its direction inside the ORB.';
const NOW = '2026-10-20T12:00:00Z';
const plan = () => extractPlan(ORB, { now: NOW });

describe('the 9:30–9:45 opening-range description', () => {
  it('reads the opening range as 9:30–9:45, 15 minutes — not missing', () => {
    const p = plan();
    expect(p.fields.openingRange).toMatchObject({ status: 'supplied', source: 'description', value: { start: '09:30', end: '09:45', minutes: 15 } });
    expect(p.fields.openingRange.evidence).toMatch(/high and low of 9:30 am EST–9:45 candle/);
    expect(planQuestions(p).some((q) => q.id === 'openingRange')).toBe(false);
  });

  it('9:50 is when looking STARTS; the entry cutoff is unknown (9:55 is not assumed to be it)', () => {
    const p = plan();
    expect(p.fields.lookStart).toMatchObject({ status: 'supplied', value: '09:50' });
    expect(p.fields.entryCutoff).toMatchObject({ status: 'missing', value: null });
    expect(p.fields.evaluationWindow).toMatchObject({ status: 'needs_clarification', value: { start: '09:50', end: '09:55', meaning: null } });
    expect(understoodLines(p).map((l) => l.text)).toContain('Last entry time: not stated (not assumed).');
    expect(planQuestions(p).find((q) => q.id === 'evaluationWindow')?.choices.map((c) => c.id)).toEqual(['check', 'entry']);
  });

  it('keeps BOTH branches (outside and inside the range), each with its direction to clarify', () => {
    const p = plan();
    expect(p.branches.map((b) => [b.kind, b.status])).toEqual([
      ['outside_range', 'needs_clarification'],
      ['inside_range', 'needs_clarification'],
    ]);
    expect(p.branches[0].condition).toBe('Price is outside the ORB by 9:50–9:55');
    expect(p.branches[1].action).toMatch(/following its direction inside the ORB/);
    expect(planQuestions(p).filter((q) => q.id.startsWith('branch:'))).toHaveLength(2);
  });

  it('separates the range duration from the execution chart timeframe', () => {
    const p = plan();
    expect(p.fields.executionTimeframe).toMatchObject({ status: 'missing', value: null });
    expect(planQuestions(p).find((q) => q.id === 'executionTimeframe')?.question).toMatch(/Separate from your 15-minute opening range/);
  });

  it('invents no candle-close or retest requirement — they are optional suggestions, inactive until accepted', () => {
    const p = plan();
    expect(p.fields.entryTrigger.status).toBe('missing');
    expect(JSON.stringify(confirmedPlan(p))).not.toMatch(/close|retest/i);
    const s = planSuggestions(p);
    expect(s.map((x) => [x.id, x.status])).toEqual([
      ['candle_close', 'pending'],
      ['retest', 'pending'],
      ['wide_range', 'pending'],
    ]);
    expect(s.every((x) => /hypothes/i.test(x.hypothesis))).toBe(true);
  });

  it('invents no instrument, stop, target, sizing or daily limits', () => {
    const f = plan().fields;
    for (const k of ['instrument', 'stop', 'target', 'sizing', 'maxTrades', 'maxLosses', 'dailyLossLimit'] as const) expect([k, f[k].status, f[k].value]).toEqual([k, 'missing', null]);
    const strategy = planToStrategy(plan(), { id: 's1', now: NOW });
    expect(strategy).toMatchObject({ markets: [], timeframe: '', stopMethod: '', targetMethod: '', minRR: 0, maxTrades: 0, entryWindowStart: null, entryWindowEnd: null });
  });

  it('reads EST as New York local time, shown for confirmation; daylight saving handled', () => {
    const p = plan();
    expect(p.fields.timezone).toMatchObject({ status: 'needs_clarification', value: { zone: 'America/New_York', written: 'EST' } });
    expect(sessionInstant('2026-07-01', '09:30').toISOString()).toBe('2026-07-01T13:30:00.000Z');
    expect(sessionInstant('2026-01-15', '09:30').toISOString()).toBe('2026-01-15T14:30:00.000Z');
  });

  it('asks only open questions, a few at a time is up to the screen; saved settings are offered, never applied', () => {
    const p = plan();
    const q = planQuestions(p, { markets: ['MNQ'], maxTradesPerDay: 2, maxConsecutiveLosses: 1, dailyStop: 400 });
    expect(q.map((x) => x.id).slice(0, 4)).toEqual(['instrument', 'branch:b1', 'branch:b2', 'evaluationWindow']);
    expect(q.find((x) => x.id === 'instrument')!.choices[0]).toMatchObject({ label: 'MNQ (your usual market)', fromSaved: true });
    expect(q.find((x) => x.id === 'maxTrades')!.choices[0]).toMatchObject({ fromSaved: true, apply: { number: 2, source: 'saved_settings' } });
    // Offering is not applying.
    expect(p.fields.maxTrades.status).toBe('missing');
    // Three separate limits, three separate questions.
    expect(['maxTrades', 'maxLosses', 'dailyLossLimit'].every((id) => q.some((x) => x.id === id))).toBe(true);
    // Optional filters: "not used" is an answer and costs nothing.
    expect(q.find((x) => x.id === 'filters')).toMatchObject({ optional: true });
  });
});

describe('answers update every view; nothing goes stale', () => {
  it('a missing-rule warning disappears once it is answered', () => {
    let p = plan();
    expect(understoodLines(p).find((l) => l.key === 'not_given')!.text).toMatch(/instrument/);
    p = answerPlan(p, 'instrument', { text: 'MNQ' }, NOW);
    expect(p.fields.instrument).toMatchObject({ status: 'supplied', source: 'answer', value: ['MNQ'] });
    expect(understoodLines(p).find((l) => l.key === 'not_given')!.text).not.toMatch(/instrument/);
    expect(planQuestions(p).some((q) => q.id === 'instrument')).toBe(false);
    expect(planReadiness(p).unresolved).not.toContain('Instrument');
  });

  it('“stop after one full loss” is not “one trade per day”', () => {
    const p = extractPlan('I trade MNQ on the 5 minute chart. Stop after one full loss for the day.', { now: NOW });
    expect(p.fields.maxLosses).toMatchObject({ status: 'supplied', value: 1 });
    expect(p.fields.maxTrades.status).toBe('missing');
  });

  it('the check window answer: entry window sets the cutoff; check window does not', () => {
    const entry = answerPlan(plan(), 'evaluationWindow', { meaning: 'entry_window' }, NOW);
    expect(entry.fields.entryCutoff).toMatchObject({ value: '09:55', source: 'answer' });
    const check = answerPlan(plan(), 'evaluationWindow', { meaning: 'check_window' }, NOW);
    expect(check.fields.entryCutoff.status).toBe('missing');
  });

  it('suggestions stay out of the plan until accepted; acceptance is recorded', () => {
    let p = plan();
    expect(planToStrategy(p, { id: 'x', now: NOW }).confirmationRules).toBe('');
    p = decideSuggestion(p, 'candle_close', 'accepted', NOW);
    expect(p.decisions.candle_close).toEqual({ status: 'accepted', at: NOW });
    expect(confirmedPlan(p).find((l) => l.key === 'suggestion:candle_close')).toMatchObject({ status: 'accepted', sourceLabel: 'Suggestion you accepted' });
    expect(planToStrategy(p, { id: 'x', now: NOW }).confirmationRules).toMatch(/candle closes/);
    p = decideSuggestion(p, 'candle_close', 'rejected', NOW);
    expect(confirmedPlan(p).some((l) => l.key === 'suggestion:candle_close')).toBe(false);
  });
});

describe('score', () => {
  it('is deterministic, explains its deductions, and moves only with confirmed changes', () => {
    const a = scorePlan(plan());
    expect(scorePlan(plan())).toEqual(a);
    expect(a.deductions.find((d) => d.key === 'instrument')).toMatchObject({ earned: 0, possible: 10, reason: 'Not in your description' });
    expect(a.lines.find((d) => d.key === 'openingRange')).toMatchObject({ earned: 10 });
    // Accepting an optional idea or answering an optional filter question does not change the definition score.
    expect(scorePlan(decideSuggestion(plan(), 'retest', 'accepted', NOW)).score).toBe(a.score);
    expect(scorePlan(answerPlan(plan(), 'filters', { notUsed: true }, NOW)).score).toBe(a.score);
    const answered = answerPlan(plan(), 'instrument', { text: 'NQ' }, NOW);
    expect(scorePlan(answered).score).toBeGreaterThan(a.score);
  });
});

describe('saving and reopening', () => {
  it('a draft round-trips through the cloud row with every answer, decision and rule source; no defaults appear', () => {
    let p: StrategyPlan = plan();
    p = answerPlan(p, 'instrument', { text: 'MNQ', source: 'saved_settings' }, NOW);
    p = answerPlan(p, 'branch:b1', { text: 'Trade the side price broke out of' }, NOW);
    p = decideSuggestion(p, 'retest', 'rejected', NOW);
    const s = planToStrategy(p, { id: 'plan-1', now: NOW });
    expect(planReadiness(p).status).toBe('draft');
    expect(s.notes).toMatch(/^DRAFT/);
    const rows = strategyToRows(s, '00000000-0000-4000-8000-000000000001');
    // The database columns require > 0; the plan keeps "not set".
    expect(rows.strategy).toMatchObject({ min_rr: 1, max_trades: 1 });
    const back = rowsToStrategy({ ...rows.strategy, updated_at: NOW }, rows.checklist);
    expect({ minRR: back.minRR, maxTrades: back.maxTrades }).toEqual({ minRR: 0, maxTrades: 0 });
    const reopened = planOf(back)!;
    expect(reopened.fields.instrument).toMatchObject({ value: ['MNQ'], source: 'saved_settings' });
    expect(reopened.branches[0]).toMatchObject({ status: 'supplied', directionRule: 'Trade the side price broke out of', source: 'answer' });
    expect(reopened.decisions.retest.status).toBe('rejected');
    expect(reopened.originalText).toBe(ORB);
  });

  it('editing the description keeps the trader’s answers and decisions', () => {
    let p = answerPlan(plan(), 'instrument', { text: 'NQ' }, NOW);
    p = decideSuggestion(p, 'candle_close', 'accepted', NOW);
    const next = rebasePlan(extractPlan(`${ORB} Stop at the other side of the range.`, { now: NOW }), p);
    expect(next.fields.instrument.value).toEqual(['NQ']);
    expect(next.fields.stop.status).toBe('supplied');
    expect(next.decisions.candle_close.status).toBe('accepted');
  });
});

describe('other strategies and informal writing', () => {
  it('a complete pullback plan: every rule found with its evidence, nothing left to ask but optional items', () => {
    const p = extractPlan(
      'I trade NQ on the 5 minute chart between 9:45 and 11:00 ET. I buy when price pulls back to VWAP and a candle closes above it. Stop 20 points below entry, target 2R. Max 2 trades a day, stop after 1 loss. Daily loss $500. Risk $200 per trade.',
      { now: NOW },
    );
    expect(p.fields.instrument.value).toEqual(['NQ']);
    expect(p.fields.executionTimeframe.value).toBe('5m');
    expect(p.fields.lookStart.value).toBe('09:45');
    expect(p.fields.entryCutoff.value).toBe('11:00');
    expect(p.fields.entryTrigger.status).toBe('supplied');
    expect(p.fields.stop.status).toBe('supplied');
    expect(p.fields.target.status).toBe('supplied');
    expect(p.fields.sizing.status).toBe('supplied');
    expect(p.fields.maxTrades.value).toBe(2);
    expect(p.fields.maxLosses.value).toBe(1);
    expect(p.fields.dailyLossLimit.value).toBe(500);
    expect(p.fields.filters.value).toEqual(['vwap']);
    expect(p.usesOpeningRange).toBe(false);
    expect(planReadiness(p).status).toBe('complete');
    expect(planToStrategy(p, { id: 'n', now: NOW })).toMatchObject({ markets: ['NQ'], minRR: 2, maxTrades: 2, entryWindowStart: '09:45', entryWindowEnd: '11:00' });
    expect(planQuestions(p).every((q) => q.optional)).toBe(true);
  });

  it('typos and informal phrasing: "untill", "candel", "first 15 mins orb"', () => {
    const p = extractPlan('i mark the first 15 mins orb. wait untill 9:50 then if it breaks above the high i go long on the 1m candel close', { now: NOW });
    expect(p.fields.openingRange.value).toEqual({ start: '09:30', end: '09:45', minutes: 15 });
    expect(p.fields.lookStart.value).toBe('09:50');
    expect(p.fields.executionTimeframe.value).toBe('1m');
    expect(p.branches[0]).toMatchObject({ kind: 'outside_range', status: 'supplied' });
  });

  it('automated testing is unavailable without precise rules and verified data; manual practice always is', () => {
    const t = planTestability(plan(), 0);
    expect(t.manual.available).toBe(true);
    expect(t.automated.available).toBe(false);
    expect(t.automated.reasons.join(' ')).toMatch(/Verified historical data is not connected/);
  });
});

describe('the same description typed loosely (typos, no colons, no capitals)', () => {
  const LOOSE =
    'i draw out the high and low of 930am est - 945 candel. then i wait untill 950 to start lookin for a move. if price is outside the orb by 950-955 i follow the direction outside the orb. if its inside the orb, i take a move following its direction inside the orb';
  it('reads the same plan: 15-minute range, start 9:50, both branches, nothing invented', () => {
    const p = extractPlan(LOOSE, { now: NOW });
    expect(p.fields.openingRange).toMatchObject({ status: 'supplied', value: { start: '09:30', end: '09:45', minutes: 15 } });
    expect(p.fields.lookStart.value).toBe('09:50');
    expect(p.fields.evaluationWindow.value).toMatchObject({ start: '09:50', end: '09:55', meaning: null });
    expect(p.fields.entryCutoff.status).toBe('missing');
    expect(p.fields.executionTimeframe.status).toBe('missing');
    expect(p.branches.map((b) => [b.kind, b.status])).toEqual([
      ['outside_range', 'needs_clarification'],
      ['inside_range', 'needs_clarification'],
    ]);
    expect(understoodLines(p).find((l) => l.key === 'openingRange')!.text).toMatch(/^Opening range: high and low of 9:30.*9:45/);
    expect(understoodLines(p).map((l) => l.text).join(' ')).not.toMatch(/minutes are not stated|length not stated/);
    expect(JSON.stringify(confirmedPlan(p))).not.toMatch(/close|retest/i);
  });
});

describe('rule labels', () => {
  it('every line carries Trader supplied / Needs clarification / Trader accepted — no percentages', () => {
    let p = plan();
    const tags = Object.fromEntries(understoodLines(p).map((l) => [l.key, l.tag]));
    expect(tags).toMatchObject({ openingRange: 'trader_supplied', lookStart: 'trader_supplied', 'branch:b1': 'needs_clarification', timezone: 'needs_clarification' });
    p = decideSuggestion(p, 'retest', 'accepted', NOW);
    expect(confirmedPlan(p).find((l) => l.key === 'suggestion:retest')!.tag).toBe('trader_accepted');
    expect(JSON.stringify(confirmedPlan(p))).not.toMatch(/%/);
  });
});

describe('editing the description flags carried answers for review', () => {
  it('a carried answer needs re-confirmation; “keep it” restores it', () => {
    let p = answerPlan(plan(), 'instrument', { text: 'MNQ' }, NOW);
    p = answerPlan(p, 'branch:b1', { text: 'Trade the side price broke out of' }, NOW);
    const before = scorePlan(p).score;
    const next = rebasePlan(extractPlan(ORB.replace('9:50 to start', '9:52 to start'), { now: NOW }), p);
    expect(next.fields.instrument).toMatchObject({ value: ['MNQ'], status: 'needs_clarification', review: true });
    expect(next.branches[0]).toMatchObject({ directionRule: 'Trade the side price broke out of', status: 'needs_clarification', review: true });
    const q = planQuestions(next);
    expect(q[0].title).toMatch(/Check your answer/);
    expect(planReadiness(next).unresolved).toContain('Instrument');
    expect(scorePlan(next).score).toBeLessThan(before);
    let kept = answerPlan(next, 'instrument', { keep: true }, NOW);
    kept = answerPlan(kept, 'branch:b1', { keep: true }, NOW);
    expect(kept.fields.instrument).toMatchObject({ value: ['MNQ'], status: 'supplied' });
    expect(kept.fields.instrument.review).toBeFalsy();
    expect(kept.branches[0]).toMatchObject({ status: 'supplied' });
    expect(planQuestions(kept).some((x) => /Check your answer/.test(x.title))).toBe(false);
  });
});

describe('resolving a rule updates every derived view and the saved strategy', () => {
  it('questions, missing-rule list, warnings, score, readiness, testability and the saved record move together', () => {
    let p = plan();
    const saved = planToStrategy(p, { id: 'plan-9', now: NOW });
    const views = (x: StrategyPlan) => ({ q: planQuestions(x).length, unresolved: planReadiness(x).unresolved.length, score: scorePlan(x).score, reasons: planTestability(x, 0).automated.reasons.join(' ') });
    const a = views(p);
    p = answerPlan(p, 'executionTimeframe', { text: '1m' }, '2026-10-20T12:01:00Z');
    const b = views(p);
    expect(b.q).toBe(a.q - 1);
    expect(b.unresolved).toBe(a.unresolved - 1);
    expect(b.score).toBeGreaterThan(a.score);
    expect(a.reasons).toMatch(/execution chart timeframe/);
    expect(b.reasons).not.toMatch(/execution chart timeframe/);
    const synced = syncedStrategy(saved, p, '2026-10-20T12:01:00Z')!;
    expect(synced).toMatchObject({ id: 'plan-9', timeframe: '1m', createdAt: saved.createdAt });
    expect(planOf(synced)!.fields.executionTimeframe.value).toBe('1m');
    // Already up to date → no write.
    expect(syncedStrategy(synced, p, NOW)).toBeNull();
    expect(syncedStrategy(undefined, p, NOW)).toBeNull();
  });
});
