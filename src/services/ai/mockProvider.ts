import { localSessionReview } from '@/lib/engines/sessionEngine';
import { DEFAULT_TRADING_RULES } from '@/data/demo';
import { GRADE_LABEL } from '@/lib/engines/strategyEngine';

import type { AIProvider } from './provider';
import { matchStrategies } from './strategyMatcher';
import type {
  DailyCoach,
  DailyCoachInput,
  ScreenshotExtraction,
  ScreenshotInput,
  SessionReviewInput,
  SetupAnalysis,
  SetupAnalysisInput,
  StrategyFinderAnswers,
  StrategyRecommendation,
} from './types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * On-device provider used when no AI backend is configured. It produces
 * useful, rule-based language from the deterministic engines so the app is
 * fully usable without any API key.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'Prop Guard Local';

  async analyzeTradeSetup(input: SetupAnalysisInput): Promise<SetupAnalysis> {
    await delay(450);
    const { evaluation: ev, strategy, context } = input;
    const passed = ev.passed.length;
    const total = passed + ev.failed.length;
    let summary: string;
    switch (ev.grade) {
      case 'A_PLUS':
        summary = `Every item on your ${strategy.name} checklist is satisfied and risk is inside your limits. This is the setup you planned for — execute it exactly as written.`;
        break;
      case 'VALID':
        summary = `${passed} of ${total} checks pass. The setup matches your ${strategy.name} rules; review the cautions before entering.`;
        break;
      case 'CAUTION':
        summary = `Only ${ev.matchPct}% of your ${strategy.name} criteria are met. Your plan says to wait for full confirmation.`;
        break;
      case 'RULE_VIOLATION':
        summary = 'This trade breaks one or more of your own rules. Prop Guard recommends modifying the trade or passing.';
        break;
      default:
        summary = 'Prop Guard recommends not taking this trade. Protecting the account is the priority.';
    }
    const reminders: string[] = [];
    if (context.tradesRemaining <= 1) reminders.push('This would be your last allowed trade today.');
    if (context.consecutiveLosses > 0) reminders.push('You are coming off a loss — size and patience matter most now.');
    if (strategy.invalidationRules) reminders.push(`Invalidation: ${strategy.invalidationRules}`);
    return {
      headline: GRADE_LABEL[ev.grade],
      summary,
      cautions: [...ev.violations, ...ev.cautions].slice(0, 6),
      reminders: reminders.slice(0, 4),
      source: 'local',
    };
  }

  async analyzeScreenshot(_input: ScreenshotInput): Promise<ScreenshotExtraction> {
    await delay(900);
    // Without a vision model we cannot read the chart. Return an honest empty
    // extraction so the user enters / confirms every value manually.
    return {
      instrument: null,
      direction: null,
      entry: null,
      stop: null,
      target: null,
      levels: [],
      detected: { orb: false, vwap: false, supportResistance: false },
      confidence: 'low',
      notes:
        'On-device mode cannot read chart values. Enter the trade details below — your screenshot will be attached to the trade. Enable AI (EXPO_PUBLIC_AI_MODE=remote) for automatic extraction.',
      source: 'local',
    };
  }

  async generateSessionReview(input: SessionReviewInput) {
    await delay(500);
    const review = localSessionReview(
      {
        netPnl: input.netPnl,
        trades: input.trades.length,
        wins: input.trades.filter((t) => (t.pnl ?? 0) > 0).length,
        losses: input.trades.filter((t) => (t.pnl ?? 0) < 0).length,
        winRate: input.winRate,
        avgR: null,
        rulesFollowedPct: input.rulesFollowedPct,
        violations: input.violations.map((v, i) => ({
          id: String(i),
          type: v.type as never,
          category: 'risk',
          accountId: null,
          tradeId: null,
          sessionId: null,
          detail: v.detail,
          at: '',
        })),
        cooldownGaps: input.cooldownGaps,
      },
      { ...DEFAULT_TRADING_RULES, ...input.rules },
    );
    const { generatedAt: _g, ...rest } = review;
    return rest;
  }

  async recommendStrategies(answers: StrategyFinderAnswers): Promise<StrategyRecommendation[]> {
    await delay(800);
    return matchStrategies(answers);
  }

  async generateDailyCoach(input: DailyCoachInput): Promise<DailyCoach> {
    const risk = `$${Math.round(input.riskRemaining)}`;
    if (input.guardStatus === 'STOP') {
      return {
        message: `You've reached a daily limit. Today's job is done — protecting the account is a win.`,
        bestAction: 'End the session and complete your journal.',
        source: 'local',
      };
    }
    if (input.cooldownActive) {
      return {
        message: `Cooldown in progress after a loss. Step away from the chart and reset. Risk remaining: ${risk}.`,
        bestAction: 'Wait out the cooldown. No new trades until it ends.',
        source: 'local',
      };
    }
    if (input.tradesTaken === 0) {
      return {
        message: `No trades yet today. Your ${input.strategyName ?? 'strategy'} window is the only one that matters. Risk available: ${risk}.`,
        bestAction: 'Complete the pre-trade checklist before any entry.',
        source: 'local',
      };
    }
    const match = input.lastSetupMatchPct;
    const matchLine = match != null && match < 80 ? ` Your last entry matched only ${match}% of your checklist.` : '';
    return {
      message: `You've taken ${input.tradesTaken} of ${input.maxTrades} trades today.${matchLine} Risk remaining: ${risk}.`,
      bestAction:
        input.consecutiveLosses > 0 || (match != null && match < 80)
          ? 'Wait for an A-quality setup or end the session.'
          : 'Stay patient. Only take setups that pass every check.',
      source: 'local',
    };
  }
}
