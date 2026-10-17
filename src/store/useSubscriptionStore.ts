import { create } from 'zustand';

import { planHasFeature, type Feature, type PlanId } from '@/config/plans';
import { billing } from '@/services/subscriptionService';

interface SubscriptionState {
  plan: PlanId;
  loading: boolean;
  refresh: () => Promise<void>;
  purchase: (offeringId: string) => Promise<{ ok: boolean; error?: string }>;
  restore: () => Promise<void>;
  /** Development-only: preview the Free tier. */
  setDevPlan: (plan: PlanId) => void;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  plan: 'free',
  loading: true,
  refresh: async () => {
    const plan = await billing.getPlan();
    set({ plan, loading: false });
  },
  purchase: async (id) => {
    const r = await billing.purchase(id);
    set({ plan: r.plan });
    return { ok: r.ok, error: r.error };
  },
  restore: async () => set({ plan: await billing.restore() }),
  setDevPlan: (plan) => {
    billing.setPlan(plan);
    set({ plan });
  },
}));

export function useEntitlement(feature: Feature): boolean {
  const plan = useSubscriptionStore((s) => s.plan);
  return planHasFeature(plan, feature);
}
