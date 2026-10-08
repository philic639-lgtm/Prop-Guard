import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { accountToForm, formToAccount, ruleValuesOf, type AccountFormValues } from '@/features/accounts/accountSchema';
import { accountRiskState } from '@/services/setupCheck/localContext';
import type { Account, FirmRuleValues } from '@/types/domain';

import {
  calcAfterOverrides,
  detectOverrides,
  getFirm,
  getProgram,
  importProgramRules,
  linkFor,
  parseFirmRulesDatabase,
  programLines,
  searchFirms,
  validateFirmConfiguration,
} from '../firmRulesEngine';
import { applyCheck, dueSources, newSource, normalizePageText, pageHash, sourcesFromDatabase } from '../firmRulesMonitor';
import { drawdownFloor, evaluateAccount } from '../propRuleEngine';
import { NONBINDING_DAILY_LIMIT, propBuffers } from '../setupCheck';

const db = FIRM_RULES_SEED;
const TODAY = '2026-10-08';
const lucid = getFirm(db, 'lucid')!;
const prog = (id: string) => getProgram(db, id)!;
const load = (id: string, options: Record<string, string> = {}, onDate = TODAY) => importProgramRules(prog(id), onDate, options);
const verified = (id: string, options: Record<string, string> = {}, onDate = TODAY) => {
  const r = load(id, options, onDate);
  if (r.status !== 'verified') throw new Error(`${id}: ${r.status}`);
  return r;
};

/** An account exactly as the form would save it after loading a configuration. */
function accountFrom(id: string, options: Record<string, string>, over: Partial<Account> = {}): Account {
  const p = prog(id);
  const imp = verified(id, options);
  const form: AccountFormValues = { ...accountToForm(null), name: p.name, firm: 'Lucid Trading', profitTarget: '', maxDrawdown: '', dailyLossLimit: '', ...(imp.values as Partial<AccountFormValues>), balance: String(p.accountSize) };
  const link = linkFor(lucid, p, imp, `${TODAY}T12:00:00Z`, options);
  const a = formToAccount(form, null, 'acc', undefined, link);
  a.rules.calc = calcAfterOverrides(link.calc, [], form.dailyLossLimit);
  return { ...a, ...over };
}

describe('Prop firm directory', () => {
  it('finds firms by name / alias and only lists programs that were researched', () => {
    expect(searchFirms(db, 'luc')[0].id).toBe('lucid');
    expect(searchFirms(db, 'trade day')[0].id).toBe('tradeday');
    expect(searchFirms(db, 'mffu')[0].id).toBe('my-funded-futures');
    for (const id of ['apex', 'take-profit-trader', 'my-funded-futures', 'tradeday', 'earn2trade']) expect(programLines(db, id)).toEqual([]);
  });

  it('Lucid: Program → Stage → Size', () => {
    const lines = programLines(db, 'lucid');
    expect(lines.map((l) => l.line)).toEqual(['LucidPro', 'LucidFlex']);
    for (const l of lines) {
      expect(l.stages.map((f) => f.stage)).toEqual(['evaluation', 'funded']);
      for (const f of l.stages) expect(f.programs.map((p) => p.accountSize)).toEqual([25_000, 50_000, 100_000, 150_000]);
    }
    expect(prog('lucid:pro-eval:50k').options?.[0].choices.map((c) => c.id)).toEqual(['on', 'off']);
  });

  it('the seed validates: every verified rule has an official source, nothing is downgraded', () => {
    const parsed = parseFirmRulesDatabase(JSON.parse(JSON.stringify(db)));
    expect(parsed.errors).toEqual([]);
    expect(parsed.downgraded).toEqual([]);
    const lucidRecords = db.programs.filter((p) => p.firmId === 'lucid').flatMap((p) => p.versions.flatMap((v) => v.records ?? []));
    expect(lucidRecords.every((r) => r.sources.every((s) => /^https:\/\/(support\.)?lucidtrading\.com\//.test(s.url)))).toBe(true);
  });
});

describe('Lucid — LucidPro evaluation', () => {
  it('nothing loads until the Daily Loss Limit option is chosen', () => {
    const r = load('lucid:pro-eval:50k');
    expect(r.status).toBe('needs_options');
    if (r.status === 'needs_options') expect(r.missing.map((o) => o.id)).toEqual(['dll']);
  });

  it('50K, DLL On: target, EOD trailing MLL with +$100 lock, 4 minis, $1,200 soft DLL', () => {
    const r = verified('lucid:pro-eval:50k', { dll: 'on' });
    expect(r.values).toEqual({ size: '50000', profitTarget: '3000', maxDrawdown: '2000', drawdownType: 'eod_trailing', maxContracts: '4', dailyLossLimit: '1200', positionLimits: '4 minis or 40 micros' });
    expect(r.calc).toEqual({ trailingLockOffset: 100, dailyLossMode: 'fixed', dailyLossBreach: 'soft' });
    expect(r.unknown).toEqual([]);
  });

  it('50K, DLL Off: no daily loss limit — recorded as NONE, not unknown and not zero', () => {
    const r = verified('lucid:pro-eval:50k', { dll: 'off' });
    expect(r.values.dailyLossLimit).toBeUndefined();
    expect(r.calc.dailyLossMode).toBe('none');
    expect(r.unknown).not.toContain('Daily loss limit');
  });

  it('25K, DLL On: Lucid’s pages conflict ($600 vs none) → not applied, flagged', () => {
    const r = verified('lucid:pro-eval:25k', { dll: 'on' });
    expect(r.values.dailyLossLimit).toBeUndefined();
    expect(r.calc.dailyLossMode).toBeUndefined();
    expect(r.unknown).toContain('Daily loss limit');
    expect(r.withheld.map((w) => w.key)).toContain('dailyLossOn');
  });

  it('sizes never borrow from each other', () => {
    const t = { '25k': ['1250', '1000', '2'], '50k': ['3000', '2000', '4'], '100k': ['6000', '3000', '6'], '150k': ['9000', '4500', '10'] };
    for (const [k, [target, mll, minis]] of Object.entries(t)) {
      const v = verified(`lucid:pro-eval:${k}`, { dll: 'off' }).values;
      expect([v.profitTarget, v.maxDrawdown, v.maxContracts]).toEqual([target, mll, minis]);
    }
    expect(verified('lucid:pro-eval:150k', { dll: 'on' }).values.dailyLossLimit).toBe('2700');
  });
});

describe('Lucid — LucidPro funded', () => {
  it('100K, DLL On: fixed DLL kept (scaling formula conflicts), 40% payout consistency, typed payout rules', () => {
    const r = verified('lucid:pro-funded:100k', { dll: 'on' });
    expect(r.version.ruleVersion).toBe('2025-11-28');
    expect(r.values).toMatchObject({ maxDrawdown: '3000', drawdownType: 'eod_trailing', maxContracts: '6', dailyLossLimit: '1800', consistencyPct: '40' });
    expect(r.values.profitTarget).toBeUndefined();
    expect(r.calc.payout).toMatchObject({ cycleProfitGoal: 750, minRequest: 500, bufferAboveStart: 3100 });
    expect(r.withheld.map((w) => w.key)).toEqual(expect.arrayContaining(['dailyLossScaling', 'payoutCaps', 'contractScaling']));
  });

  it('historical terms: an account bought before 2025-11-28 loads ONLY the stated legacy rule (35%)', () => {
    const r = verified('lucid:pro-funded:50k', { dll: 'on' }, '2025-10-01');
    expect(r.version.ruleVersion).toBe('legacy-pre-2025-11-28');
    expect(r.values).toEqual({ size: '50000', consistencyPct: '35' });
    expect(r.unknown).toEqual(expect.arrayContaining(['Maximum drawdown', 'Drawdown method', 'Maximum contracts']));
  });
});

describe('Lucid — LucidFlex', () => {
  it('evaluation: 50% consistency, DLL On amounts not published → unknown; Off → none', () => {
    const on = verified('lucid:flex-eval:150k', { dll: 'on' });
    expect(on.values).toMatchObject({ profitTarget: '9000', maxDrawdown: '4500', maxContracts: '10', consistencyPct: '50' });
    expect(on.values.dailyLossLimit).toBeUndefined();
    expect(on.unknown).toContain('Daily loss limit');
    expect(verified('lucid:flex-eval:150k', { dll: 'off' }).calc.dailyLossMode).toBe('none');
  });

  it('funded: drawdown locks on payout, 5 profitable days, payout count by purchase date', () => {
    const r = verified('lucid:flex-funded:25k', { dll: 'off' });
    expect(r.calc).toMatchObject({ trailingLockOffset: 100, drawdownLocksOnPayout: true, dailyLossMode: 'none' });
    expect(r.calc.payout).toMatchObject({ minProfitableDays: 5, minDayProfit: 100, minRequest: 500, maxPayouts: 5 });
    expect(r.values.minProfitableDays).toBe('5');
    expect(r.values.consistencyPct).toBeUndefined(); // none in funded
    expect(verified('lucid:flex-funded:25k', { dll: 'off' }, '2026-01-15').calc.payout).toMatchObject({ maxPayouts: 6 });
  });
});

describe('Switching programs and saving — no mismatched configurations', () => {
  const link = (id: string, options: Record<string, string>) => linkFor(lucid, prog(id), load(id, options), `${TODAY}T12:00:00Z`, options);

  it('a consistent configuration validates', () => {
    expect(validateFirmConfiguration(db, link('lucid:pro-eval:50k', { dll: 'on' }), { size: '50000' }, TODAY)).toEqual([]);
  });

  it('size, option and stale-rule mismatches are blocked', () => {
    expect(validateFirmConfiguration(db, link('lucid:pro-eval:50k', { dll: 'on' }), { size: '100000' }, TODAY).map((i) => i.field)).toEqual(['size']);
    expect(validateFirmConfiguration(db, link('lucid:pro-eval:50k', {}), { size: '50000' }, TODAY).map((i) => i.field)).toEqual(['options']);
    const switched = { ...link('lucid:pro-eval:50k', { dll: 'on' }), options: { dll: 'off' } }; // option changed, DLL from "On" still imported
    expect(validateFirmConfiguration(db, switched, { size: '50000' }, TODAY).map((i) => i.field)).toEqual(['rules']);
    const otherProgram = { ...link('lucid:pro-eval:50k', { dll: 'on' }), programId: 'lucid:flex-eval:50k' };
    expect(validateFirmConfiguration(db, otherProgram, { size: '50000' }, TODAY).map((i) => i.field)).toContain('rules');
  });

  it('switching program re-imports only the new program’s rules', () => {
    const a = verified('lucid:pro-eval:50k', { dll: 'on' }).values;
    const b = verified('lucid:flex-funded:50k', { dll: 'on' }).values;
    expect(a.profitTarget).toBe('3000');
    expect(b.profitTarget).toBeUndefined();
    expect(b.dailyLossLimit).toBeUndefined(); // LucidFlex DLL amounts aren't published — never copied from LucidPro
  });

  it('overriding a rule drops the typed calculation that belonged to it', () => {
    const imp = verified('lucid:pro-eval:50k', { dll: 'on' });
    const edited: FirmRuleValues = { ...imp.values, maxDrawdown: '2500' };
    const overrides = detectOverrides(imp.values, edited);
    expect(overrides).toEqual(['maxDrawdown']);
    expect(calcAfterOverrides(imp.calc, overrides, edited.dailyLossLimit)).toEqual({ dailyLossMode: 'fixed', dailyLossBreach: 'soft' });
    expect(calcAfterOverrides(imp.calc, ['dailyLossLimit'], '')).toEqual({ trailingLockOffset: 100 });
  });
});

describe('Loaded rules → risk management', () => {
  it('EOD trailing floor stops at starting balance + $100 (Lucid lock)', () => {
    const a = accountFrom('lucid:pro-eval:50k', { dll: 'on' }, { balance: 52_800, highWaterMark: 53_000 });
    expect(drawdownFloor(a)).toBe(50_100); // 53,000 − 2,000 = 51,000 → locked at 50,100
    const young = accountFrom('lucid:pro-eval:50k', { dll: 'on' }, { balance: 50_900, highWaterMark: 51_000 });
    expect(drawdownFloor(young)).toBe(49_000);
  });

  it('DLL modes flow into the dashboard: fixed soft breach, or “none” for DLL Off', () => {
    const on = evaluateAccount(accountFrom('lucid:pro-eval:50k', { dll: 'on' }), [], new Date(`${TODAY}T15:00:00Z`));
    expect(on.rules.find((r) => r.id === 'daily_loss')).toMatchObject({ limit: '$1,200', status: 'ok' });
    const off = evaluateAccount(accountFrom('lucid:pro-eval:50k', { dll: 'off' }), [], new Date(`${TODAY}T15:00:00Z`));
    expect(off.rules.find((r) => r.id === 'daily_loss')).toMatchObject({ status: 'info', current: 'None' });
    expect(off.dataBasis).toMatch(/not live broker data/);
  });

  it('impending breach warning and soft-breach message', () => {
    const a = accountFrom('lucid:pro-eval:50k', { dll: 'on' });
    const trade = (pnl: number) => ({ id: `t${pnl}`, accountId: 'acc', status: 'closed', pnl, closedAt: `${TODAY}T14:00:00Z`, contracts: 1 }) as never;
    expect(evaluateAccount(a, [trade(-1_000)], new Date(`${TODAY}T15:00:00Z`)).rules.find((r) => r.id === 'daily_loss')).toMatchObject({ status: 'warning' });
    expect(evaluateAccount(a, [trade(-1_250)], new Date(`${TODAY}T15:00:00Z`)).rules.find((r) => r.id === 'daily_loss')!.message).toMatch(/soft breach/);
  });

  it('funded payout requirements are tracked from the journal — never claimed from live data', () => {
    const a = accountFrom('lucid:pro-funded:50k', { dll: 'on' }, { balance: 52_400 });
    const row = evaluateAccount(a, [], new Date(`${TODAY}T15:00:00Z`)).rules.find((r) => r.id === 'payout_eligibility')!;
    expect(row.current).toBe('Not yet'); // $300 above the $52,100 buffer < $500 minimum request
    expect(row.message).toMatch(/\$2,400 \/ \$500 cycle profit/);
    expect(row.message).toMatch(/confirm in your firm dashboard/);
  });

  it('Setup Check buffers use the same rules (lock offset, verified “no DLL”)', () => {
    const a = accountFrom('lucid:flex-eval:50k', { dll: 'off' }, { balance: 52_500, highWaterMark: 53_000 });
    const state = accountRiskState(a, [], new Date(`${TODAY}T15:00:00Z`));
    expect(state).toMatchObject({ trailingLockOffset: 100, dailyLossMode: 'none', liveData: false });
    const b = propBuffers(state, false);
    expect(b.drawdownBuffer).toBe(52_500 - 50_100);
    expect(b.dailyLossRemaining).toBe(NONBINDING_DAILY_LIMIT);
  });

  it('multiple accounts keep their own programs and rules', () => {
    const pro = accountFrom('lucid:pro-eval:100k', { dll: 'on' });
    const flex = accountFrom('lucid:flex-funded:25k', { dll: 'off' });
    expect([pro.rules.maxDrawdown, pro.rules.dailyLossLimit, pro.firmLink?.programId]).toEqual([3_000, 1_800, 'lucid:pro-eval:100k']);
    expect([flex.rules.maxDrawdown, flex.rules.dailyLossLimit, flex.rules.calc?.dailyLossMode, flex.firmLink?.programId]).toEqual([1_000, null, 'none', 'lucid:flex-funded:25k']);
    expect(ruleValuesOf(accountToForm(pro)).dailyLossLimit).toBe('1800');
  });
});

describe('Rule maintenance monitor', () => {
  const now = new Date('2026-10-12T06:17:00Z');
  const src = newSource({ url: 'https://support.lucidtrading.com/en/articles/12890029-lucidpro-evaluation-account', title: 'LucidPro Evaluation Account', firmId: 'lucid', programIds: ['lucid:pro-eval:50k'] });

  it('watches every official source the verified rules cite', () => {
    const urls = sourcesFromDatabase(db).map((s) => s.url);
    expect(urls).toEqual(expect.arrayContaining([src.url, 'https://support.lucidtrading.com/en/articles/16226068-lucidpro-customization']));
    expect(urls.some((u) => u.includes('topstep.com'))).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('only due sources are checked, capped per run', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...src, url: `${src.url}?${i}` }));
    expect(dueSources(many, now, 25)).toHaveLength(25);
    expect(dueSources([{ ...src, nextCheckAt: '2026-10-20T00:00:00Z' }], now)).toHaveLength(0);
  });

  it('first fetch = baseline; same text = unchanged; changed text = review (never auto-published)', () => {
    const page = '<html><script>x=1</script><h1>LucidPro</h1><p>Profit target $3,000</p><p>Updated 3 days ago</p></html>';
    const base = applyCheck(src, { status: 200, body: page, etag: 'a' }, now);
    expect(base).toMatchObject({ status: 'new', reviewNeeded: false });
    const same = applyCheck(base.source, { status: 200, body: page.replace('3 days ago', '2 hours ago').replace('x=1', 'x=2') }, now);
    expect(same).toMatchObject({ status: 'unchanged', reviewNeeded: false });
    expect(applyCheck(base.source, { status: 304 }, now)).toMatchObject({ status: 'unchanged', reviewNeeded: false });
    const changed = applyCheck(base.source, { status: 200, body: page.replace('$3,000', '$3,500') }, now);
    expect(changed).toMatchObject({ status: 'changed', reviewNeeded: true });
    expect(changed.source.nextCheckAt).toBe('2026-10-19T06:17:00.000Z');
  });

  it('blocked / unreachable sources back off and keep the verified data', () => {
    let s: typeof src = { ...src, contentHash: pageHash(normalizePageText('x')) };
    const waits: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = applyCheck(s, { status: i % 2 ? 0 : 403 }, now);
      waits.push(r.reason.match(/next try in (\d+) days/)![1]);
      expect(r.source.contentHash).toBe(s.contentHash);
      expect(r.reviewNeeded).toBe(i >= 2);
      s = r.source;
    }
    expect(waits).toEqual(['7', '14', '28', '30']);
  });
});
