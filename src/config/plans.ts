/**
 * Subscription plans and feature entitlements. Pricing shown here is only a
 * fallback display string — real prices always come from the store via
 * RevenueCat offerings. Business logic must check FEATURES, never prices.
 */
export type PlanId = 'free' | 'pro';

export type Feature =
  | 'aiTradeChecker'
  | 'aiStrategyFinder'
  | 'screenshotAnalysis'
  | 'unlimitedAccounts'
  | 'advancedAnalytics'
  | 'disciplineScore'
  | 'aiCoach'
  | 'notifications'
  | 'unlimitedJournal'
  | 'customStrategies'
  | 'practiceMode';

export interface PlanConfig {
  id: PlanId;
  name: string;
  tagline: string;
  fallbackPriceLabel: string | null;
  features: Feature[];
  limits: {
    accounts: number;
    journalTrades: number;
    libraryTemplates: number;
    customStrategies: number;
  };
  highlights: string[];
}

export const ENTITLEMENT_ID = 'pro';

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'The essentials of disciplined risk.',
    fallbackPriceLabel: null,
    features: [],
    limits: { accounts: 1, journalTrades: 50, libraryTemplates: 3, customStrategies: 1 },
    highlights: ['Rule-based trade check', 'Risk calculator', 'Daily Guard', '1 trading account', 'Journal (latest 50 trades)', '3 strategy templates'],
  },
  pro: {
    id: 'pro',
    name: 'Prop Guard Pro',
    tagline: 'Your full-time AI risk manager.',
    fallbackPriceLabel: '$19.99 / month',
    features: [
      'aiTradeChecker',
      'aiStrategyFinder',
      'screenshotAnalysis',
      'unlimitedAccounts',
      'advancedAnalytics',
      'disciplineScore',
      'aiCoach',
      'notifications',
      'unlimitedJournal',
      'customStrategies',
      'practiceMode',
    ],
    limits: { accounts: Infinity, journalTrades: Infinity, libraryTemplates: Infinity, customStrategies: Infinity },
    highlights: [
      'Unlimited AI setup checks',
      'Advanced AI strategy builder',
      'Unlimited screenshot analysis',
      'AI trade journaling',
      'Performance insights by conditions met',
      'Multiple saved strategies',
      'Practice mode',
      'Advanced session summaries',
      'Discipline Score & AI Coach',
      'Unlimited accounts',
    ],
  },
};

export function planHasFeature(plan: PlanId, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}
