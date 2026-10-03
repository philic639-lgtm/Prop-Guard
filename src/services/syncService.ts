import type { AppData } from '@/data/demo';
import type { Account, DisciplineEvent, PendingTrade, PracticeRun, Strategy, Trade, TradePlan, TradingSession } from '@/types/domain';

import { supabase } from './supabase/client';
import { SupabaseRepository } from './supabase/repository';

/**
 * Offline-first write-through sync. The local store is always the source of
 * truth for the UI; when a user is signed in, every mutation is queued and
 * replayed against Supabase in order. Failed operations stay queued and are
 * retried on the next flush (e.g. when the app returns to the foreground).
 */
type Op = { label: string; run: (repo: SupabaseRepository) => Promise<void> };

class SyncService {
  private repo: SupabaseRepository | null = null;
  private queue: Op[] = [];
  private running = false;
  lastError: string | null = null;

  get enabled() {
    return this.repo !== null;
  }

  attach(userId: string) {
    if (!supabase) return;
    this.repo = new SupabaseRepository(supabase, userId);
    void this.flush();
  }

  detach() {
    this.repo = null;
    this.queue = [];
  }

  repository() {
    return this.repo;
  }

  private enqueue(label: string, run: Op['run']) {
    if (!this.repo) return;
    this.queue.push({ label, run });
    void this.flush();
  }

  async flush() {
    if (this.running || !this.repo) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && this.repo) {
        const op = this.queue[0];
        try {
          await op.run(this.repo);
          this.queue.shift();
          this.lastError = null;
        } catch (e) {
          this.lastError = `${op.label}: ${(e as Error).message}`;
          console.warn('[sync] failed, will retry', this.lastError);
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }

  pending() {
    return this.queue.length;
  }

  upsertAccount = (a: Account) => this.enqueue('account', (r) => r.upsertAccount(a));
  upsertStrategy = (s: Strategy) => this.enqueue('strategy', (r) => r.upsertStrategy(s));
  upsertSession = (s: TradingSession) => this.enqueue('session', (r) => r.upsertSession(s));
  upsertTrade = (t: Trade) => this.enqueue('trade', (r) => r.upsertTrade(t));
  insertEvent = (e: DisciplineEvent) => this.enqueue('event', (r) => r.insertEvent(e));
  upsertPlan = (p: TradePlan) => this.enqueue('plan', (r) => r.upsertPlan(p));
  upsertPendingTrade = (p: PendingTrade) => this.enqueue('pending trade', (r) => r.upsertPendingTrade(p));
  insertPracticeRun = (p: PracticeRun) => this.enqueue('practice', (r) => r.insertPracticeRun(p));
  savePreferences = (s: Pick<AppData, 'preferences' | 'tradingRules' | 'activeAccountId' | 'activeStrategyId'>) =>
    this.enqueue('preferences', (r) =>
      r.savePreferences({
        preferences: s.preferences,
        tradingRules: s.tradingRules,
        activeAccountId: s.activeAccountId,
        activeStrategyId: s.activeStrategyId,
      }),
    );
  remove = (table: 'accounts' | 'strategies' | 'trades', id: string) => this.enqueue(`delete ${table}`, (r) => r.remove(table, id));

  /** Push a full local dataset (used after onboarding a new cloud account). */
  pushAll(data: AppData) {
    data.accounts.forEach(this.upsertAccount);
    data.strategies.forEach(this.upsertStrategy);
    data.sessions.forEach(this.upsertSession);
    data.trades.forEach(this.upsertTrade);
    data.events.forEach(this.insertEvent);
    data.plans.forEach(this.upsertPlan);
    data.practiceRuns.forEach(this.insertPracticeRun);
    data.pendingTrades.forEach(this.upsertPendingTrade);
    this.savePreferences(data);
  }
}

export const syncService = new SyncService();
