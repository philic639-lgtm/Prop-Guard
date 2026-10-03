import { env, isDemoMode } from '@/config/env';
import { ENTITLEMENT_ID, PLANS, planHasFeature, type Feature, type PlanId } from '@/config/plans';

/**
 * Billing abstraction. RevenueCat is the intended provider:
 *   1. npx expo install react-native-purchases
 *   2. Set EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY (public SDK keys only)
 *   3. Implement RevenueCatBilling below (configure, getOfferings, purchase, restore)
 * Until then a development provider is used so billing never blocks local work.
 */
export interface Offering {
  id: string;
  title: string;
  priceLabel: string;
  period: 'month' | 'year';
}

export interface BillingProvider {
  readonly name: string;
  getPlan(): Promise<PlanId>;
  getOfferings(): Promise<Offering[]>;
  purchase(offeringId: string): Promise<{ ok: boolean; plan: PlanId; error?: string }>;
  restore(): Promise<PlanId>;
}

class DevelopmentBilling implements BillingProvider {
  readonly name = 'Development';
  private plan: PlanId = env.devUnlockPro ? 'pro' : 'free';

  async getPlan() {
    return this.plan;
  }

  async getOfferings(): Promise<Offering[]> {
    return [{ id: 'pro_monthly', title: PLANS.pro.name, priceLabel: PLANS.pro.fallbackPriceLabel ?? '', period: 'month' }];
  }

  async purchase(_offeringId?: string): Promise<{ ok: boolean; plan: PlanId; error?: string }> {
    this.plan = 'pro';
    return { ok: true, plan: this.plan };
  }

  async restore() {
    return this.plan;
  }

  /** Development-only toggle so both tiers can be previewed. */
  setPlan(plan: PlanId) {
    this.plan = plan;
  }
}

export const billing = new DevelopmentBilling();

export const subscriptionService = {
  provider: billing as BillingProvider,
  isDevelopment: true,
  entitlementId: ENTITLEMENT_ID,
  isDemoMode,
  can(plan: PlanId, feature: Feature) {
    return planHasFeature(plan, feature);
  },
};
