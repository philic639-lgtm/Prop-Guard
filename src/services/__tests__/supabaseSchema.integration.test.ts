/**
 * Database integration test (opt-in): pushes a full dataset through the real
 * SupabaseRepository — in the same order the app uses on first sign-in — into a
 * Postgres database that has every migration in `supabase/migrations` applied, reads it
 * back, and checks row-level security between two users.
 *
 *   PG_TEST_URL=postgres://postgres@/db?host=/tmp&port=5499 npx jest supabaseSchema
 *
 * The database needs the Supabase basics the migrations expect (auth.users, auth.uid(),
 * anon / authenticated / service_role roles with Supabase's default grants). Skipped when
 * PG_TEST_URL is not set, so `npm run check` never needs a database.
 */
import { createDemoData, DEFAULT_TRADING_RULES, type AppData } from '@/data/demo';
import { BUILT_IN_TEMPLATES } from '@/data/strategies/catalog';
import type { SetupForm } from '@/features/setupCheck/controller';
import { buildJournalSave } from '@/features/setupCheck/journalSave';
import { toSetupCheck } from '@/features/setupCheck/toSetupCheck';
import { strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { defaultFollower, newCopyGroup } from '@/lib/engines/accountCopierEngine';
import { DEFAULT_COPY_SETTINGS } from '@/lib/engines/copyTradeEngine';
import { runSetupCheck, type ClientSetupInput } from '@/lib/engines/setupCheck';
import { localTrustedContext } from '@/services/setupCheck/localContext';
import { strategyRecordOf } from '@/services/setupCheck/strategyRecord';
import { SupabaseRepository } from '@/services/supabase/repository';
import { pushAllOps } from '@/services/syncService';
import { pgClient, runSql } from '@/test/pgClient';
import type { CopyTrade, SourceTrader } from '@/types/copyTrade';
import type { PracticeAttempt, PracticeLesson } from '@/types/practice';

const URL = process.env.PG_TEST_URL;
const d = URL ? describe : describe.skip;

const USER_A = '0a0a0a0a-0000-4000-8000-00000000000a';
const USER_B = '0b0b0b0b-0000-4000-8000-00000000000b';
const NOW = new Date('2026-10-06T15:00:00Z');
const AT = NOW.toISOString();
const id = (n: number) => `00000000-0000-4000-9999-${String(n).padStart(12, '0')}`;

/** Demo data plus one of every record type the demo leaves empty. */
function fullDataset(): AppData {
  const data = createDemoData(NOW);
  const account = data.accounts[0];
  const icc = { ...strategyFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'icc')!), id: id(1) };
  data.strategies.push(icc);

  const form: SetupForm = {
    strategyId: icc.id, accountId: account.id, instrument: 'ES', side: 'LONG', entry: 5000, stop: 4998, target: 5005.5, target2: 5010,
    quantity: 1, costs: 2, slippage: 2.5, reserve: 0, noDailyLimitConfirmed: false, liveAccountConfirmed: false, timeframe: '5m', notes: 'Waited for the close.',
  };
  const client: ClientSetupInput = {
    ...form, strategyId: icc.id, manual: [{ ruleId: 'icc_stop_structural', status: 'PASS' }], firmConfirmations: [],
    icc: { htfBias: 'BULLISH', indication: 'CONFIRMED', displacement: 'STRONG', correction: 'CONFIRMED', continuation: 'CONFIRMED', momentum: 'STRONG', room: 'CLEAR' },
  };
  const personal = { ...account, kind: 'personal' as const, rules: { ...account.rules, maxContracts: null } };
  const trusted = { ...localTrustedContext({ record: strategyRecordOf(icc), instrument: 'ES', account: personal, trades: [], tradingRules: DEFAULT_TRADING_RULES, now: NOW }), visionEvidence: [], analysisMode: 'UNAVAILABLE' as const };
  const r = runSetupCheck(client, trusted);
  const check = toSetupCheck({ id: id(2), now: AT, evaluation: r.evaluation, evaluatedBy: 'device', form, strategyName: icc.name, strategyVersion: icc.updatedAt, analysisId: null, analysisKey: 'k', screenshotUri: null, icc: r.icc });
  const saved = buildJournalSave({ check, decision: r.decision, account: personal, pendingId: id(3), now: NOW });
  data.setupChecks.push(saved.setupCheck);
  if (saved.pendingTrade) data.pendingTrades.push(saved.pendingTrade);

  const trader: SourceTrader = {
    id: id(4), name: 'Alpha', platform: 'discord', assetClass: 'futures', instruments: ['MNQ'], style: 'ORB', notes: '', trustRating: 4,
    isActive: true, archived: false, settings: { ...DEFAULT_COPY_SETTINGS, fixedRisk: 160 }, createdAt: AT, updatedAt: AT,
  };
  const copy: CopyTrade = {
    id: id(5), sourceTraderId: trader.id, sourceTraderName: trader.name, accountId: account.id, instrument: 'MNQ', direction: 'long', entry: 20_000,
    stop: 19_980, target: 20_040, sourceContracts: 10, sourceInstrument: 'MNQ', at: AT, setup: 'ORB', notes: '', conviction: 'A', mode: 'simulated',
    screenshotUri: null, contracts: 4, translation: { verdict: 'safe', instrument: 'MNQ', contracts: 4, riskDollars: 160, dailyRiskRemaining: 600, reasons: [] },
    tradeId: null, outcome: null, lesson: '', createdAt: AT, updatedAt: AT,
  };
  data.sourceTraders.push(trader);
  data.copyTrades.push(copy);
  data.copyGroups.push({ ...newCopyGroup(id(6), AT), masterAccountId: account.id, followers: [{ ...defaultFollower(data.accounts[1].id), multiplier: 2 }] });

  const attempt: PracticeAttempt = {
    id: id(7), userId: USER_A, scenarioId: 'sample-x', instrument: 'ES', strategyId: 'orb-15', strategyName: '15M ORB Retest', timestamp: AT,
    mode: 'smart', session: 'morning', direction: 'long', decision: 'long', idealDecision: 'long', correct: true, entry: 6029.25, stop: 6025.75,
    target: 6036.25, riskReward: 2, score: 92, grade: 'A+', result: 'win', mistakes: [], setupCharacteristics: { retestNumber: 1, trendAligned: true },
  };
  const lesson: PracticeLesson = {
    id: id(8), attemptId: attempt.id, scenarioId: 'sample-x', strategyId: 'orb-15', strategyName: '15M ORB Retest', instrument: 'ES', score: 92, grade: 'A+',
    lesson: 'Wait for the first retest.', createdAt: AT,
  };
  data.practiceAttempts.push(attempt);
  data.practiceLessons.push(lesson);
  return data;
}

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Same instant, any ISO spelling (PostgREST returns `+00:00`, the app writes `Z`). */
// An optional field the app leaves undefined comes back as SQL null; both mean "not set".
const norm = (v: unknown): unknown =>
  v === null ? undefined : typeof v === 'string' && TS.test(v) ? new Date(v).toISOString() : Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v;
const byId = <T extends { id: string }>(xs: T[] | undefined) => norm([...(xs ?? [])].sort((a, b) => a.id.localeCompare(b.id)));

d('Supabase schema × repository (Postgres integration)', () => {
  const url = URL!;
  const data = fullDataset();
  const repoA = new SupabaseRepository(pgClient(url, USER_A) as never, USER_A);
  const repoB = new SupabaseRepository(pgClient(url, USER_B) as never, USER_B);

  beforeAll(() => {
    // Fresh users each run; deleting them cascades to every row they own.
    runSql(url, `delete from auth.users where id in ('${USER_A}', '${USER_B}'); insert into auth.users (id, email) values ('${USER_A}', 'a@test.local'), ('${USER_B}', 'b@test.local')`, null);
  });

  it('uploads a full dataset in the app’s own order with no schema or policy errors', async () => {
    for (const op of pushAllOps(data)) {
      await expect(op.run(repoA)).resolves.toBeUndefined();
    }
  });

  it('reads back what was written (accounts, strategies, trades, journal, pending, setup checks, copy trade, practice)', async () => {
    const back = await repoA.loadAll();
    // accounts / strategies updated_at is owned by the database trigger (the server versions Setup Check evidence by it).
    const noStamp = <T extends { updatedAt?: string }>(xs: T[] | undefined) => (xs ?? []).map((x) => ({ ...x, updatedAt: '' }));
    expect(byId(noStamp(back.accounts))).toEqual(byId(noStamp(data.accounts)));
    expect(back.accounts?.every((a) => TS.test(a.updatedAt ?? ''))).toBe(true);
    expect(byId(noStamp(back.strategies))).toEqual(byId(noStamp(data.strategies)));
    expect(byId(back.trades)).toEqual(byId(data.trades));
    expect(byId(back.pendingTrades)).toEqual(byId(data.pendingTrades));
    expect(byId(back.setupChecks)).toEqual(byId(data.setupChecks));
    expect(byId(back.sourceTraders)).toEqual(byId(data.sourceTraders));
    expect(byId(back.copyTrades)).toEqual(byId(data.copyTrades));
    expect(byId(back.copyGroups)).toEqual(byId(data.copyGroups));
    expect(byId(back.practiceAttempts)).toEqual(byId(data.practiceAttempts));
    expect(byId(back.practiceLessons)).toEqual(byId(data.practiceLessons));
    expect(byId(back.sessions)).toEqual(byId(data.sessions));
    expect(byId(back.events)).toEqual(byId(data.events));
    expect(byId(back.plans)).toEqual(byId(data.plans));
    expect(back.tradingRules).toEqual(data.tradingRules);
    expect(back.activeAccountId).toBe(data.activeAccountId);
    expect(back.preferences?.displayName).toBe(data.preferences.displayName);
  });

  it('row-level security: another signed-in user sees none of it and cannot overwrite it', async () => {
    const other = await repoB.loadAll();
    for (const k of ['accounts', 'strategies', 'trades', 'pendingTrades', 'setupChecks', 'sourceTraders', 'copyTrades', 'copyGroups', 'practiceAttempts', 'sessions', 'events', 'plans'] as const) {
      expect([k, (other[k] as unknown[]).length]).toEqual([k, 0]);
    }
    await expect(repoB.upsertAccount({ ...data.accounts[0], name: 'Hijacked' })).rejects.toThrow(/row-level security|violates/);
    await repoB.remove('trades', data.trades[0].id); // silently matches nothing under RLS
    expect((await repoA.loadAll()).trades).toHaveLength(data.trades.length);
  });

  it('account ownership: rows can only point at the same user’s accounts', () => {
    const a = data.accounts[0].id;
    const t = data.trades[0];
    // User B cannot attach a trade (or a snapshot) to user A's account, even with B's own user id.
    expect(() =>
      runSql(url, `insert into public.trades (id, user_id, account_id, instrument, direction, entry_price, stop_price, original_stop_price, contracts, risk_dollars, status, opened_at) values (gen_random_uuid(), '${USER_B}', '${a}', 'ES', 'long', 5000, 4998, 4998, 1, 100, 'closed', now())`, USER_B),
    ).toThrow(/does not belong/);
    expect(() => runSql(url, `insert into public.screenshots (user_id, account_id, kind, redacted, storage_path) values ('${USER_B}', '${a}', 'account', true, '${USER_B}/accounts/${a}/x.jpg')`, USER_B)).toThrow(/does not belong/);
    // Moving A's own trade onto B's account id is refused too.
    expect(() => runSql(url, `update public.trades set account_id = '${a}', user_id = '${USER_B}' where id = '${t.id}'`, null)).toThrow(/does not belong/);
    // The owner links a redacted account snapshot to the account and its update record.
    runSql(url, `insert into public.screenshots (user_id, account_id, kind, redacted, record_id, dashboard_date, storage_path) values ('${USER_A}', '${a}', 'account', true, 'rec-1', '2026-10-13', '${USER_A}/accounts/${a}/rec-1-1.jpg')`, USER_A);
    expect(runSql(url, `select count(*) from public.screenshots where account_id = '${a}' and kind = 'account'`, USER_A)).toBe('1');
    expect(runSql(url, `select count(*) from public.screenshots where account_id = '${a}'`, USER_B)).toBe('0');
  });

  it('another user cannot change or delete the owner’s rows (accounts, trades, journal)', () => {
    const a = data.accounts[0].id;
    const t = data.trades[0].id;
    for (const sql of [`update public.accounts set balance = 1 where id = '${a}'`, `delete from public.accounts where id = '${a}'`, `update public.trades set pnl = 0 where id = '${t}'`, `delete from public.trades where id = '${t}'`])
      runSql(url, sql, USER_B); // RLS: matches no row
    expect(runSql(url, `select balance::float8::text from public.accounts where id = '${a}'`, USER_A)).toBe(String(data.accounts[0].balance));
    expect(runSql(url, `select count(*) from public.trades where id = '${t}'`, USER_A)).toBe('1');
  });

  it('private screenshot storage: each user reads and writes only their own folder', () => {
    runSql(url, `insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false) on conflict do nothing`, null);
    runSql(url, `insert into storage.objects (bucket_id, name) values ('screenshots', '${USER_A}/accounts/x/ref.jpg')`, USER_A);
    expect(() => runSql(url, `insert into storage.objects (bucket_id, name) values ('screenshots', '${USER_A}/accounts/x/evil.jpg')`, USER_B)).toThrow(/row-level security/);
    expect(runSql(url, `select count(*) from storage.objects where name like '${USER_A}/%'`, USER_B)).toBe('0');
    runSql(url, `delete from storage.objects where name like '${USER_A}/%'`, USER_B);
    expect(runSql(url, `select count(*) from storage.objects where name like '${USER_A}/%'`, USER_A)).toBe('1');
    expect(runSql(url, `set local role anon; select count(*) from storage.objects where bucket_id = 'screenshots'`, null)).toBe('0');
    runSql(url, `delete from storage.objects where name like '${USER_A}/%'`, USER_A);
  });

  it('signed-out (anon) clients read only public reference data', () => {
    const asAnon = (sql: string) => runSql(url, `set local role anon; ${sql}`, null);
    expect(asAnon('select count(*) from public.accounts')).toBe('0');
    expect(asAnon('select count(*) from public.trades')).toBe('0');
    expect(() => asAnon("insert into public.subscription_status (user_id, plan) values ('" + USER_A + "', 'pro')")).toThrow();
    // Clients can never grant themselves Pro.
    expect(() => runSql(url, `insert into public.subscription_status (user_id, plan) values ('${USER_A}', 'pro')`, USER_A)).toThrow();
  });
});
