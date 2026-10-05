import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import type { FirmRulesDatabase } from '@/data/propFirms/types';
import { mergeFirmRules } from '@/lib/engines/firmRulesEngine';
import { remoteFirmRulesProvider, type FirmRulesProvider } from '@/services/firmRules';

const REFRESH_MS = 12 * 60 * 60 * 1000;

interface FirmRulesState {
  /** Seed merged with the last remote feed — what the app reads. */
  db: FirmRulesDatabase;
  remote: FirmRulesDatabase | null;
  fetchedAt: string | null;
  error: string | null;
  /** Fetch the central rules feed (at most every 12h unless forced). */
  refresh: (opts?: { force?: boolean; provider?: FirmRulesProvider | null }) => Promise<void>;
}

/** The prop-firm rules database: bundled seed + cached central updates. */
export const useFirmRules = create<FirmRulesState>()(
  persist(
    (set, get) => ({
      db: FIRM_RULES_SEED,
      remote: null,
      fetchedAt: null,
      error: null,
      refresh: async ({ force, provider } = {}) => {
        const source = provider === undefined ? remoteFirmRulesProvider() : provider;
        if (!source) return;
        const last = get().fetchedAt;
        if (!force && last && Date.now() - Date.parse(last) < REFRESH_MS) return;
        try {
          const remote = await source.load();
          set({ remote, db: mergeFirmRules(FIRM_RULES_SEED, remote), fetchedAt: new Date().toISOString(), error: null });
        } catch (e) {
          // Keep the cached database; the trader can always enter rules manually.
          set({ error: (e as Error).message });
        }
      },
    }),
    {
      name: 'propguard-firm-rules',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ remote: s.remote, fetchedAt: s.fetchedAt }),
      // The seed always comes from the app bundle; only the remote overlay is cached.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<FirmRulesState>;
        const remote = p.remote ?? null;
        return { ...current, remote, fetchedAt: p.fetchedAt ?? null, db: mergeFirmRules(FIRM_RULES_SEED, remote) };
      },
    },
  ),
);
