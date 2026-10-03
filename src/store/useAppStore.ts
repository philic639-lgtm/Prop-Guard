import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { createDemoData, DEFAULT_PREFERENCES, DEFAULT_TRADING_RULES, EMPTY_DATA, type AppData } from '@/data/demo';
import { realizedPnl, realizedR } from '@/lib/engines/riskEngine';
import { syncService } from '@/services/syncService';
import type {
  Account,
  DisciplineEvent,
  Emotion,
  NotificationPrefs,
  SessionReview,
  Strategy,
  Trade,
  TradingRules,
  TradingSession,
  UserPreferences,
} from '@/types/domain';
import { dayKey } from '@/utils/dates';
import { uuid } from '@/utils/id';

import type { AppMode, AuthUser, PreTradeDraft } from './types';

export interface AppState extends AppData {
  mode: AppMode;
  user: AuthUser | null;
  hydrated: boolean;
  draft: PreTradeDraft | null;

  // lifecycle
  setHydrated: () => void;
  loadDemo: () => void;
  startFresh: (mode: AppMode) => void;
  replaceData: (data: Partial<AppData>) => void;
  setUser: (user: AuthUser | null) => void;
  signOutLocal: () => void;

  // selection
  setActiveAccount: (id: string) => void;
  setActiveStrategy: (id: string | null) => void;

  // accounts & rules
  upsertAccount: (account: Account) => void;
  deleteAccount: (id: string) => void;
  setTradingRules: (rules: TradingRules) => void;
  setPreferences: (prefs: Partial<UserPreferences>) => void;
  setNotificationPref: (key: keyof NotificationPrefs, value: boolean) => void;

  // strategies
  upsertStrategy: (strategy: Strategy) => void;
  deleteStrategy: (id: string) => void;

  // trading
  setDraft: (draft: PreTradeDraft | null) => void;
  patchDraft: (patch: Partial<PreTradeDraft>) => void;
  ensureSession: () => TradingSession | null;
  endSession: (sessionId: string, review: SessionReview | null) => void;
  setSessionReview: (sessionId: string, review: SessionReview) => void;
  openTrade: (trade: Trade) => void;
  updateTrade: (id: string, patch: Partial<Trade>) => void;
  closeTrade: (id: string, exitPrice: number, at?: Date) => Trade | null;
  cancelTrade: (id: string) => void;
  journalTrade: (id: string, entry: { notes: string; emotion: Emotion | null; setupRating: number | null }) => void;
  deleteTrade: (id: string) => void;

  // discipline
  recordEvent: (event: Omit<DisciplineEvent, 'id' | 'at'> & { at?: string }) => void;
}

const nowIso = () => new Date().toISOString();

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...EMPTY_DATA,
      mode: 'demo',
      user: null,
      hydrated: false,
      draft: null,

      setHydrated: () => set({ hydrated: true }),

      loadDemo: () => set({ ...createDemoData(), mode: 'demo', draft: null }),

      startFresh: (mode) =>
        set({
          ...EMPTY_DATA,
          tradingRules: DEFAULT_TRADING_RULES,
          preferences: { ...DEFAULT_PREFERENCES, email: get().user?.email ?? '' },
          mode,
          draft: null,
        }),

      replaceData: (data) => set({ ...data }),

      setUser: (user) => set({ user, mode: user ? 'cloud' : get().mode }),

      signOutLocal: () => set({ ...EMPTY_DATA, user: null, mode: 'demo', draft: null }),

      setActiveAccount: (id) => {
        set({ activeAccountId: id });
        syncService.savePreferences(get());
      },
      setActiveStrategy: (id) => {
        set({ activeStrategyId: id });
        syncService.savePreferences(get());
      },

      upsertAccount: (account) => {
        set((s) => {
          const exists = s.accounts.some((a) => a.id === account.id);
          return {
            accounts: exists ? s.accounts.map((a) => (a.id === account.id ? account : a)) : [...s.accounts, account],
            activeAccountId: s.activeAccountId ?? account.id,
          };
        });
        syncService.upsertAccount(account);
      },

      deleteAccount: (id) => {
        set((s) => {
          const accounts = s.accounts.filter((a) => a.id !== id);
          return {
            accounts,
            activeAccountId: s.activeAccountId === id ? (accounts[0]?.id ?? null) : s.activeAccountId,
          };
        });
        syncService.remove('accounts', id);
      },

      setTradingRules: (rules) => {
        set({ tradingRules: rules });
        syncService.savePreferences(get());
      },

      setPreferences: (prefs) => {
        set((s) => ({ preferences: { ...s.preferences, ...prefs } }));
        syncService.savePreferences(get());
      },

      setNotificationPref: (key, value) => {
        set((s) => ({
          preferences: { ...s.preferences, notifications: { ...s.preferences.notifications, [key]: value } },
        }));
        syncService.savePreferences(get());
      },

      upsertStrategy: (strategy) => {
        set((s) => {
          const exists = s.strategies.some((x) => x.id === strategy.id);
          return {
            strategies: exists ? s.strategies.map((x) => (x.id === strategy.id ? strategy : x)) : [...s.strategies, strategy],
            activeStrategyId: s.activeStrategyId ?? strategy.id,
          };
        });
        syncService.upsertStrategy(strategy);
      },

      deleteStrategy: (id) => {
        set((s) => ({
          strategies: s.strategies.filter((x) => x.id !== id),
          activeStrategyId: s.activeStrategyId === id ? (s.strategies.find((x) => x.id !== id)?.id ?? null) : s.activeStrategyId,
        }));
        syncService.remove('strategies', id);
      },

      setDraft: (draft) => set({ draft }),
      patchDraft: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),

      ensureSession: () => {
        const { activeAccountId, activeStrategyId, sessions } = get();
        if (!activeAccountId) return null;
        const today = dayKey(new Date());
        const existing = sessions.find((x) => x.accountId === activeAccountId && x.date === today && x.status === 'active');
        if (existing) return existing;
        const session: TradingSession = {
          id: uuid(),
          accountId: activeAccountId,
          strategyId: activeStrategyId,
          date: today,
          startedAt: nowIso(),
          endedAt: null,
          status: 'active',
          review: null,
        };
        set({ sessions: [...sessions, session] });
        syncService.upsertSession(session);
        return session;
      },

      endSession: (sessionId, review) => {
        let updated: TradingSession | undefined;
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== sessionId) return x;
            updated = { ...x, status: 'ended', endedAt: nowIso(), review: review ?? x.review };
            return updated;
          }),
        }));
        if (updated) syncService.upsertSession(updated);
      },

      setSessionReview: (sessionId, review) => {
        let updated: TradingSession | undefined;
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== sessionId) return x;
            updated = { ...x, review };
            return updated;
          }),
        }));
        if (updated) syncService.upsertSession(updated);
      },

      openTrade: (trade) => {
        set((s) => ({ trades: [...s.trades, trade] }));
        syncService.upsertTrade(trade);
      },

      updateTrade: (id, patch) => {
        let updated: Trade | undefined;
        set((s) => ({
          trades: s.trades.map((t) => {
            if (t.id !== id) return t;
            updated = { ...t, ...patch };
            return updated;
          }),
        }));
        if (updated) syncService.upsertTrade(updated);
      },

      closeTrade: (id, exitPrice, at = new Date()) => {
        const trade = get().trades.find((t) => t.id === id);
        if (!trade || trade.status !== 'open') return null;
        const pnl = realizedPnl(trade.instrument, trade.direction, trade.entryPrice, exitPrice, trade.contracts);
        const pts = trade.direction === 'long' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
        const closed: Trade = {
          ...trade,
          exitPrice,
          pnl,
          points: Math.round(pts * 100) / 100,
          realizedR: realizedR(pnl, trade.riskDollars),
          status: 'closed',
          closedAt: at.toISOString(),
        };
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? closed : t)),
          accounts: s.accounts.map((a) => {
            if (a.id !== trade.accountId) return a;
            const balance = Math.round((a.balance + pnl) * 100) / 100;
            return { ...a, balance, highWaterMark: Math.max(a.highWaterMark, balance) };
          }),
        }));
        syncService.upsertTrade(closed);
        const account = get().accounts.find((a) => a.id === trade.accountId);
        if (account) syncService.upsertAccount(account);
        return closed;
      },

      cancelTrade: (id) => get().updateTrade(id, { status: 'cancelled', closedAt: nowIso() }),

      journalTrade: (id, entry) => {
        const trade = get().trades.find((t) => t.id === id);
        if (!trade) return;
        const firstTime = !trade.journaled;
        get().updateTrade(id, { ...entry, journaled: true });
        if (firstTime) {
          get().recordEvent({
            type: 'JOURNAL_COMPLETED',
            category: 'journal',
            accountId: trade.accountId,
            tradeId: trade.id,
            sessionId: trade.sessionId,
            detail: 'Journal completed',
          });
        }
      },

      deleteTrade: (id) => {
        set((s) => ({ trades: s.trades.filter((t) => t.id !== id), events: s.events.filter((e) => e.tradeId !== id) }));
        syncService.remove('trades', id);
      },

      recordEvent: (event) => {
        const full: DisciplineEvent = { ...event, id: uuid(), at: event.at ?? nowIso() };
        set((s) => ({ events: [...s.events, full] }));
        syncService.insertEvent(full);
      },
    }),
    {
      name: 'prop-guard-store',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        accounts: s.accounts,
        strategies: s.strategies,
        trades: s.trades,
        sessions: s.sessions,
        events: s.events,
        tradingRules: s.tradingRules,
        preferences: s.preferences,
        activeAccountId: s.activeAccountId,
        activeStrategyId: s.activeStrategyId,
        mode: s.mode,
        user: s.user,
        draft: s.draft,
      }),
      // Always mark hydrated — even if storage failed — so the app never hangs on launch.
      onRehydrateStorage: () => () => {
        useAppStore.setState({ hydrated: true });
      },
    },
  ),
);
