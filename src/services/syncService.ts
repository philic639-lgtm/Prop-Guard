import type { AppData } from '@/data/demo';
import type { Account, DisciplineEvent, PendingTrade, PracticeRun, SetupCheck, Strategy, Trade, TradePlan, TradingSession } from '@/types/domain';
import type { CopyGroup, CopyTrade, SourceTrader } from '@/types/copyTrade';
import type { PracticeAttempt, PracticeLesson } from '@/types/practice';

import { supabase } from './supabase/client';
import { SupabaseRepository, type RemovableTable } from './supabase/repository';

/**
 * Offline-first write-through sync. The local store is always the source of
 * truth for the UI; when a user is signed in, every mutation is queued and
 * replayed against Supabase in order. Failed operations stay queued and are
 * retried on the next flush (e.g. when the app returns to the foreground).
 */
type Op = { label: string; run: (repo: SupabaseRepository) => Promise<void> };

/**
 * Every write needed to upload a full local dataset, in dependency order (parents before
 * the rows that reference them). Exported so the database integration test replays the
 * exact sequence the app uses.
 */
export function pushAllOps(data: AppData): Op[] {
  const ops: Op[] = [];
  const add = (label: string, run: Op['run']) => ops.push({ label, run });
  data.accounts.forEach((a) => add('account', (r) => r.upsertAccount(a)));
  data.strategies.forEach((s) => add('strategy', (r) => r.upsertStrategy(s)));
  data.sessions.forEach((s) => add('session', (r) => r.upsertSession(s)));
  data.trades.forEach((t) => add('trade', (r) => r.upsertTrade(t)));
  data.events.forEach((e) => add('event', (r) => r.insertEvent(e)));
  data.plans.forEach((p) => add('plan', (r) => r.upsertPlan(p)));
  data.practiceRuns.forEach((p) => add('practice', (r) => r.insertPracticeRun(p)));
  data.practiceAttempts.forEach((a) => add('practice attempt', (r) => r.upsertPracticeAttempt(a)));
  data.practiceLessons.forEach((l) => add('practice lesson', (r) => r.upsertPracticeLesson(l)));
  (data.setupChecks ?? []).forEach((c) => add('setup check', (r) => r.upsertSetupCheck(c)));
  (data.sourceTraders ?? []).forEach((t) => add('source trader', (r) => r.upsertSourceTrader(t)));
  (data.copyTrades ?? []).forEach((c) => add('copy trade', (r) => r.upsertCopyTrade(c)));
  (data.copyGroups ?? []).forEach((g) => add('copy group', (r) => r.upsertCopyGroup(g)));
  data.pendingTrades.forEach((p) => add('pending trade', (r) => r.upsertPendingTrade(p)));
  add('preferences', (r) =>
    r.savePreferences({ preferences: data.preferences, tradingRules: data.tradingRules, activeAccountId: data.activeAccountId, activeStrategyId: data.activeStrategyId }),
  );
  return ops;
}

class SyncService {
  private repo: SupabaseRepository | null = null;
  private userId: string | null = null;
  private queue: Op[] = [];
  private running = false;
  lastError: string | null = null;

  get enabled() {
    return this.repo !== null;
  }

  attach(userId: string) {
    if (!supabase) return;
    // Writes queued for another user must never be replayed into this user's account.
    if (this.userId && this.userId !== userId) this.queue = [];
    this.userId = userId;
    this.repo = new SupabaseRepository(supabase, userId);
    void this.flush();
  }

  detach() {
    this.repo = null;
    this.userId = null;
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
  upsertPracticeAttempt = (a: PracticeAttempt) => this.enqueue('practice attempt', (r) => r.upsertPracticeAttempt(a));
  upsertPracticeLesson = (l: PracticeLesson) => this.enqueue('practice lesson', (r) => r.upsertPracticeLesson(l));
  upsertSetupCheck = (c: SetupCheck) => this.enqueue('setup check', (r) => r.upsertSetupCheck(c));
  upsertSourceTrader = (t: SourceTrader) => this.enqueue('source trader', (r) => r.upsertSourceTrader(t));
  upsertCopyTrade = (c: CopyTrade) => this.enqueue('copy trade', (r) => r.upsertCopyTrade(c));
  upsertCopyGroup = (g: CopyGroup) => this.enqueue('copy group', (r) => r.upsertCopyGroup(g));
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
  remove = (table: RemovableTable, id: string) => this.enqueue(`delete ${table}`, (r) => r.remove(table, id));

  /** Push a full local dataset (used after onboarding a new cloud account). */
  pushAll(data: AppData) {
    for (const op of pushAllOps(data)) this.enqueue(op.label, op.run);
  }
}

export const syncService = new SyncService();
