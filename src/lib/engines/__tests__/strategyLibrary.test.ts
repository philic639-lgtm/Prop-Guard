import { CATEGORY_ORDER, STRATEGY_LIBRARY, getTemplate } from '@/data/strategyLibrary';
import { strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { makeTrade } from '@/test/fixtures';

import { findInstrument } from '../instrumentEngine';
import {
  compareTemplates,
  filterTemplates,
  performanceInsight,
  preTradeStatus,
  sourceTypeAfterEdit,
  strategyPerformance,
  strategySourceLabel,
  strategySourceType,
  UNASSIGNED,
} from '../strategyLibraryEngine';

const BANNED = /proven|profitable|guarantee|win rate|winrate|expected return/i;

describe('built-in strategy library', () => {
  it('ships at least 30 unique, complete templates', () => {
    expect(STRATEGY_LIBRARY.length).toBeGreaterThanOrEqual(30);
    expect(new Set(STRATEGY_LIBRARY.map((t) => t.id)).size).toBe(STRATEGY_LIBRARY.length);
    for (const t of STRATEGY_LIBRARY) {
      expect(t.rules.length).toBeGreaterThan(0);
      expect(t.checklist.length).toBeGreaterThan(1);
      expect(t.invalidationRules.length).toBeGreaterThan(0);
      expect(t.avoidConditions.length).toBeGreaterThan(0);
      expect(t.sessions.length).toBeGreaterThan(0);
      expect(t.defaultRiskReward).toBeGreaterThan(0);
      expect(t.isBuiltIn).toBe(true);
      expect(t.isBacktested).toBe(false);
      expect(t.performanceData).toBeNull();
      for (const sym of t.instruments) expect(findInstrument(sym)).toBeDefined();
    }
  });

  it('keeps the original template ids (saved strategies still link)', () => {
    for (const id of ['orb-15', 'vwap-pullback', 'breakout-retest', 'sr-reversal', 'orb-5', 'vwap-reclaim', 'vwap-rejection', 'opening-drive', 'trend-pullback', 'liquidity-sweep', 'momentum-continuation']) {
      expect(getTemplate(id)).toBeDefined();
    }
    expect(getTemplate('orb-15')!.shortName).toBe('15M ORB Retest');
  });

  it('covers every category and never makes performance claims', () => {
    expect(new Set(STRATEGY_LIBRARY.map((t) => t.category))).toEqual(new Set(CATEGORY_ORDER));
    for (const t of STRATEGY_LIBRARY) {
      const text = [t.name, t.description, t.setup, t.education, t.profitTarget, ...t.rules, ...t.checklist].join(' ');
      expect(text).not.toMatch(BANNED);
    }
  });
});

describe('visual examples', () => {
  it('every template has a 5-stage diagram with a consistent trade and a common-mistake chart', () => {
    for (const t of STRATEGY_LIBRARY) {
      const v = t.visual;
      expect(v).not.toBeNull();
      const d = v!.diagram;
      expect(d.stages.map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);
      for (const s of d.stages) expect(d.candles[s.candle]).toBeDefined();
      const { entry, stop, target, entryCandle } = d.trade;
      expect(d.candles[entryCandle]).toBeDefined();
      // Entry sits between stop and target, on the side the direction implies.
      if (v!.direction === 'long') expect(stop < entry && entry < target).toBe(true);
      else expect(target < entry && entry < stop).toBe(true);
      expect(Math.abs(target - entry) / Math.abs(entry - stop)).toBeCloseTo(t.defaultRiskReward, 5);
      // The illustrated move actually reaches the target after entry.
      const after = d.candles.slice(entryCandle + 1);
      expect(after.some((k) => (v!.direction === 'long' ? k.h >= target : k.l <= target))).toBe(true);
      expect(v!.mistake.chart.mistake).toBeDefined();
      expect(v!.whyItWorks.length).toBeGreaterThan(0);
      expect(v!.realExamples).toEqual([]);
      expect([v!.mistake.title, v!.mistake.explanation, ...d.stages.map((s) => s.detail)].join(' ')).not.toMatch(BANNED);
    }
  });
});

describe('library filters', () => {
  it('searches by name, tag or instrument', () => {
    expect(filterTemplates(STRATEGY_LIBRARY, { query: 'vwap' }).every((t) => /vwap/i.test(t.name + t.tags.join()))).toBe(true);
    expect(filterTemplates(STRATEGY_LIBRARY, { query: 'double bottom' }).map((t) => t.id)).toEqual(['double-top-bottom']);
  });

  it('filters by category chip, instrument, session, timeframe, condition, experience and R:R', () => {
    expect(filterTemplates(STRATEGY_LIBRARY, { chip: 'orb' })).toHaveLength(5);
    expect(filterTemplates(STRATEGY_LIBRARY, { chip: 'vwap' })).toHaveLength(4);
    const cl = filterTemplates(STRATEGY_LIBRARY, { instrument: 'CL' });
    expect(cl.length).toBeGreaterThan(5);
    expect(cl.every((t) => t.instruments.includes('CL'))).toBe(true);
    expect(filterTemplates(STRATEGY_LIBRARY, { chip: 'orb', instrument: 'CL' })).toHaveLength(0);
    expect(filterTemplates(STRATEGY_LIBRARY, { session: 'asia' }).every((t) => t.sessions.includes('asia'))).toBe(true);
    expect(filterTemplates(STRATEGY_LIBRARY, { timeframe: '1h' }).length).toBeGreaterThan(0);
    expect(filterTemplates(STRATEGY_LIBRARY, { condition: 'range', experience: 'Beginner' }).every((t) => t.marketConditions.includes('range') && t.experienceLevel === 'Beginner')).toBe(true);
    expect(filterTemplates(STRATEGY_LIBRARY, { riskReward: 3 }).every((t) => t.alignment === 'with_trend')).toBe(true);
    expect(filterTemplates(STRATEGY_LIBRARY, { chip: 'reversal' }).length).toBeGreaterThanOrEqual(8);
  });
});

describe('compare', () => {
  it('compares structure only — no win-rate or return rows', () => {
    const rows = compareTemplates([getTemplate('orb-15')!, getTemplate('vwap-pullback')!, getTemplate('trend-pullback')!]);
    expect(rows.map((r) => r.label)).toContain('Typical R:R');
    expect(rows.every((r) => r.values.length === 3)).toBe(true);
    expect(rows.map((r) => r.label).join(' ')).not.toMatch(BANNED);
  });
});

describe('source types', () => {
  it('labels built-ins honestly and marks edits as adapted', () => {
    const s = strategyFromTemplate(getTemplate('orb-15')!, ['ES']);
    expect(strategySourceType(s)).toBe('BUILT_IN');
    expect(strategySourceLabel(s)).toBe('Established Framework');
    expect(sourceTypeAfterEdit(s, { ...s, name: 'My ORB' })).toBe('BUILT_IN');
    expect(sourceTypeAfterEdit(s, { ...s, minRR: 3 })).toBe('AI_ADAPTED');
    expect(strategySourceLabel({ source: 'custom' })).toBe('Custom Strategy');
  });
});

describe('personal strategy performance', () => {
  const s1 = { ...strategyFromTemplate(getTemplate('orb-15')!, ['ES']), id: 's1', name: 'ORB' };
  const s2 = { ...strategyFromTemplate(getTemplate('vwap-pullback')!, ['ES']), id: 's2', name: 'VWAP' };
  const t = (id: string, strategyId: string | null, pnl: number, r: number) => makeTrade({ id, strategyId, pnl, realizedR: r, status: 'closed', closedAt: '2026-10-01T15:00:00.000Z' });

  it('is computed only from the trader’s own closed trades', () => {
    const trades = [t('a', 's1', 100, 2), t('b', 's1', -50, -1), t('c', 's2', -50, -1), t('d', null, 25, 0.5), makeTrade({ id: 'open', strategyId: 's1', status: 'open', pnl: null })];
    const rows = strategyPerformance(trades, [s1, s2]);
    const orb = rows.find((r) => r.strategyId === 's1')!;
    expect(orb).toMatchObject({ trades: 2, wins: 1, losses: 1, winRate: 0.5, avgR: 0.5, netR: 1, netPnl: 50, libraryId: 'orb-15' });
    expect(rows[rows.length - 1].key).toBe(UNASSIGNED);
    expect(rows[rows.length - 1].name).toBe('Strategy not assigned');
  });

  it('returns nothing (and no insight) without journaled trades', () => {
    expect(strategyPerformance([], [s1, s2])).toEqual([]);
    expect(performanceInsight([])).toBeNull();
  });

  it('only calls out strategies with enough trades', () => {
    const trades = [...Array.from({ length: 5 }, (_, i) => t(`w${i}`, 's1', 100, 2)), t('v', 's2', 100, 2)];
    const insight = performanceInsight(strategyPerformance(trades, [s1, s2]))!;
    expect(insight).toContain('ORB');
    expect(insight).not.toContain('VWAP');
  });
});

describe('pre-trade status', () => {
  const strategy = { ...strategyFromTemplate(getTemplate('breakout-retest')!, ['ES']), entryWindowStart: null, entryWindowEnd: null };
  const guard = { status: 'SAFE' as const, riskRemaining: 300, tradesRemaining: 2, cooldown: { active: false, endsAt: null, remainingMs: 0, totalMs: 0 } };
  const all = Object.fromEntries(strategy.checklist.map((c) => [c.id, true]));
  const now = new Date('2026-10-05T14:30:00.000Z');

  it('shows SETUP VALID only when every required rule is met', () => {
    expect(preTradeStatus({ strategy, answers: all, guard, now }).verdict).toBe('VALID');
    const partial = { ...all, [strategy.checklist[2].id]: null };
    const st = preTradeStatus({ strategy, answers: partial, guard, now });
    expect(st.verdict).toBe('WAIT');
    expect(st.missing).toContain(strategy.checklist[2].label);
  });

  it('shows SETUP INVALID when limits or invalidation say no trade', () => {
    expect(preTradeStatus({ strategy, answers: all, guard: { ...guard, status: 'STOP' as const }, now }).verdict).toBe('INVALID');
    expect(preTradeStatus({ strategy, answers: all, guard: { ...guard, tradesRemaining: 0 }, now }).verdict).toBe('INVALID');
    expect(preTradeStatus({ strategy, answers: all, guard, now, invalidated: true }).verdict).toBe('INVALID');
  });

  it('never implies the setup will work', () => {
    const st = preTradeStatus({ strategy, answers: all, guard, now });
    expect(st.reasons.join(' ')).toMatch(/does not predict/);
  });
});
