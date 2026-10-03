import type { SupabaseClient } from '@supabase/supabase-js';

import type { AppData } from '@/data/demo';
import { DEFAULT_PREFERENCES, DEFAULT_TRADING_RULES } from '@/data/demo';
import type { Account, DisciplineEvent, Strategy, Trade, TradingSession, UserPreferences } from '@/types/domain';

import {
  accountToRows,
  eventToRow,
  preferencesToRow,
  rowsToAccount,
  rowsToStrategy,
  rowsToTrade,
  rowToEvent,
  rowToSession,
  sessionToRow,
  strategyToRows,
  tradeToRows,
} from './mappers';

type Row = Record<string, unknown>;

/** How much trade history to pull on login. Older history is paged on demand. */
export const INITIAL_TRADE_LIMIT = 1000;

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export class SupabaseRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly userId: string,
  ) {}

  async loadAll(): Promise<Partial<AppData>> {
    const db = this.db;
    const [accounts, rules, strategies, items, sessions, trades, events, prefs, profile] = await Promise.all([
      db.from('accounts').select('*').order('created_at'),
      db.from('prop_rules').select('*'),
      db.from('strategies').select('*').order('created_at'),
      db.from('strategy_rules').select('*'),
      db.from('sessions').select('*').order('date', { ascending: false }).limit(400),
      db.from('trades').select('*').order('opened_at', { ascending: false }).limit(INITIAL_TRADE_LIMIT),
      db.from('discipline_events').select('*').order('occurred_at', { ascending: false }).limit(2000),
      db.from('user_preferences').select('*').maybeSingle(),
      db.from('profiles').select('*').maybeSingle(),
    ]);

    const tradeRows = check(trades) as Row[];
    const tradeIds = tradeRows.map((t) => String(t.id));
    const [checklists, journals] = tradeIds.length
      ? await Promise.all([
          db.from('trade_checklists').select('*').in('trade_id', tradeIds),
          db.from('journal_entries').select('*').in('trade_id', tradeIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

    const rulesByAccount = new Map((check(rules) as Row[]).map((r) => [String(r.account_id), r]));
    const itemsByStrategy = groupBy(check(items) as Row[], 'strategy_id');
    const checklistByTrade = groupBy(check(checklists) as Row[], 'trade_id');
    const journalByTrade = new Map((check(journals) as Row[]).map((j) => [String(j.trade_id), j]));
    const p = check(prefs) as Row | null;
    const prof = check(profile) as Row | null;

    const preferences: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      displayName: String(prof?.display_name ?? ''),
      email: String(prof?.email ?? ''),
      timezone: String(p?.timezone ?? DEFAULT_PREFERENCES.timezone),
      defaultInstrument: (p?.default_instrument as UserPreferences['defaultInstrument']) ?? 'MES',
      markets: (p?.markets as UserPreferences['markets']) ?? DEFAULT_PREFERENCES.markets,
      tradingType: (p?.trading_type as UserPreferences['tradingType']) ?? 'prop',
      propFirm: String(p?.prop_firm ?? ''),
      notifications: { ...DEFAULT_PREFERENCES.notifications, ...((p?.notifications as object) ?? {}) },
      onboarded: p?.onboarded === true,
    };

    return {
      accounts: (check(accounts) as Row[]).map((a) => rowsToAccount(a, rulesByAccount.get(String(a.id)))),
      strategies: (check(strategies) as Row[]).map((s) => rowsToStrategy(s, itemsByStrategy.get(String(s.id)) ?? [])),
      sessions: (check(sessions) as Row[]).map(rowToSession),
      trades: tradeRows.map((t) => rowsToTrade(t, checklistByTrade.get(String(t.id)) ?? [], journalByTrade.get(String(t.id)))),
      events: (check(events) as Row[]).map(rowToEvent),
      preferences,
      tradingRules: { ...DEFAULT_TRADING_RULES, ...((p?.trading_rules as object) ?? {}) },
      activeAccountId: (p?.active_account_id as string | null) ?? null,
      activeStrategyId: (p?.active_strategy_id as string | null) ?? null,
    };
  }

  /** Paged history for long journals (cursor = opened_at of the last loaded trade). */
  async fetchTradesBefore(cursorIso: string, limit = 50): Promise<Trade[]> {
    const rows = check(
      await this.db.from('trades').select('*').lt('opened_at', cursorIso).order('opened_at', { ascending: false }).limit(limit),
    ) as Row[];
    return rows.map((r) => rowsToTrade(r, [], undefined));
  }

  async upsertAccount(a: Account) {
    const { account, rules } = accountToRows(a, this.userId);
    check(await this.db.from('accounts').upsert(account));
    check(await this.db.from('prop_rules').upsert(rules));
  }

  async upsertStrategy(s: Strategy) {
    const { strategy, checklist } = strategyToRows(s, this.userId);
    check(await this.db.from('strategies').upsert(strategy));
    check(await this.db.from('strategy_rules').delete().eq('strategy_id', s.id));
    if (checklist.length) check(await this.db.from('strategy_rules').insert(checklist));
  }

  async upsertSession(s: TradingSession) {
    check(await this.db.from('sessions').upsert(sessionToRow(s, this.userId)));
  }

  async upsertTrade(t: Trade) {
    const { trade, checklist, journal } = tradeToRows(t, this.userId);
    check(await this.db.from('trades').upsert(trade));
    if (checklist.length) check(await this.db.from('trade_checklists').upsert(checklist));
    check(await this.db.from('journal_entries').upsert(journal));
  }

  async insertEvent(e: DisciplineEvent) {
    check(await this.db.from('discipline_events').upsert(eventToRow(e, this.userId)));
  }

  async savePreferences(state: Pick<AppData, 'preferences' | 'tradingRules' | 'activeAccountId' | 'activeStrategyId'>) {
    check(
      await this.db
        .from('user_preferences')
        .upsert(preferencesToRow(state.preferences, state.tradingRules, state.activeAccountId, state.activeStrategyId, this.userId)),
    );
    check(await this.db.from('profiles').update({ display_name: state.preferences.displayName }).eq('id', this.userId));
  }

  async remove(table: 'accounts' | 'strategies' | 'trades', id: string) {
    check(await this.db.from(table).delete().eq('id', id));
  }
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r[key]);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return map;
}
