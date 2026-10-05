import { TOPSTEP_PROGRAMS } from '@/data/propFirms/firms/topstep';
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import type { FirmRulesDatabase, ProgramRuleVersion } from '@/data/propFirms/types';
import { accountToForm, formToAccount, ruleValuesOf } from '@/features/accounts/accountSchema';
import { accountToRows, rowsToAccount } from '@/services/supabase/mappers';

import {
  activeRuleVersion,
  detectOverrides,
  importProgramRules,
  linkFor,
  mergeFirmRules,
  newerRulesAvailable,
  parseFirmRulesDatabase,
  programFamilies,
  ruleSourceRows,
  searchFirms,
  sizesForFamily,
} from '../firmRulesEngine';

const NOW = '2026-10-05T12:00:00.000Z';
const topstep = FIRM_RULES_SEED.firms.find((f) => f.id === 'topstep')!;
const families = programFamilies(FIRM_RULES_SEED, 'topstep');
const family = (name: string) => families.find((f) => f.family === name)!;
const program = (name: string, size: number) => sizesForFamily(family(name)).find((x) => x.size === size)!.program;
const imported = (name: string, size: number) => {
  const imp = importProgramRules(program(name, size), NOW);
  if (imp.status !== 'verified') throw new Error(`${name} ${size} not verified`);
  return imp;
};

describe('Topstep — firm rules database', () => {
  it('1. Topstep appears in firm autocomplete', () => {
    expect(searchFirms(FIRM_RULES_SEED, 'top')[0]?.name).toBe('Topstep');
    expect(searchFirms(FIRM_RULES_SEED, 'TopstepX')[0]?.id).toBe('topstep');
  });

  it('2. selecting Topstep loads its programs, by stage', () => {
    expect(families.map((f) => [f.stage, f.family])).toEqual([
      ['evaluation', 'Trading Combine'],
      ['funded', 'Express Funded Account — Standard'],
      ['funded', 'Express Funded Account — Consistency'],
      ['live', 'Live Funded Account'],
    ]);
  });

  it('3. selecting a program loads only that program’s account sizes', () => {
    for (const f of families) {
      const sizes = sizesForFamily(f);
      expect(sizes.map((s) => s.size)).toEqual([50_000, 100_000, 150_000]);
      expect(sizes.every((s) => s.program.family === f.family && s.program.stage === f.stage)).toBe(true);
    }
  });

  it('4. selecting an account size loads that size’s verified rules', () => {
    const tc = (size: number) => imported('Trading Combine', size).values;
    expect(tc(50_000)).toMatchObject({ size: '50000', profitTarget: '3000', maxDrawdown: '2000', drawdownType: 'eod_trailing', maxContracts: '5', consistencyPct: '55', minTradingDays: '2', overnight: 'not_allowed', weekendHolding: 'not_allowed', newsTrading: 'allowed' });
    expect(tc(100_000)).toMatchObject({ profitTarget: '6000', maxDrawdown: '3000', maxContracts: '10' });
    expect(tc(150_000)).toMatchObject({ profitTarget: '9000', maxDrawdown: '4500', maxContracts: '15' });
    expect(imported('Express Funded Account — Standard', 50_000).values).toMatchObject({ maxDrawdown: '2000', minProfitableDays: '5' });
    expect(imported('Express Funded Account — Consistency', 100_000).values).toMatchObject({ maxDrawdown: '3000', consistencyPct: '40', minTradingDays: '3' });
    expect(imported('Live Funded Account', 150_000).values).toMatchObject({ dailyLossLimit: '4500', minProfitableDays: '5' });
  });

  it('NEEDS_REVIEW rules are shown but never filled in', () => {
    const tc = imported('Trading Combine', 50_000);
    expect(tc.withheld.map((r) => r.key)).toEqual(expect.arrayContaining(['dailyLossLimit', 'copyTrading', 'consistencyBasis']));
    expect(tc.values.dailyLossLimit).toBeUndefined();
    expect(tc.values.copyTrading).toBeUndefined();
    for (const r of tc.withheld) expect(r.note).toBeTruthy();
  });

  it('5. programs cannot inherit rules from another Topstep program', () => {
    const xfa = imported('Express Funded Account — Standard', 50_000).values;
    expect(xfa.profitTarget).toBeUndefined(); // Trading Combine only
    expect(xfa.consistencyPct).toBeUndefined(); // Consistency path only
    const live = imported('Live Funded Account', 50_000).values;
    expect(live.maxDrawdown).toBeUndefined(); // Live uses a $1,000 balance floor, not the XFA MLL
    expect(imported('Trading Combine', 100_000).values.maxDrawdown).not.toBe(imported('Trading Combine', 50_000).values.maxDrawdown);
    // Every program × size is its own entry with its own version and records (no shared objects).
    const ids = TOPSTEP_PROGRAMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(12);
    const versions = TOPSTEP_PROGRAMS.map((p) => p.versions[0]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(new Set(versions.map((v) => v.records)).size).toBe(versions.length);
    // A program never reads another program's versions.
    const tc50 = program('Trading Combine', 50_000);
    expect(activeRuleVersion({ ...tc50, versions: [] }, NOW)).toBeNull();
  });

  it('6. VERIFIED rules require official source metadata', () => {
    for (const p of TOPSTEP_PROGRAMS) {
      for (const r of p.versions[0].records!) {
        if (r.status !== 'verified') continue;
        expect(r.sources.length).toBeGreaterThan(0);
        for (const s of r.sources) {
          expect(s.url).toMatch(/^https:\/\/(www\.topstep\.com|help\.topstep\.com)\//);
          expect(s.title).toBeTruthy();
          expect(s.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        expect(r.checkedAt).toBeTruthy();
      }
    }
    // Every row handed to the UI / snapshot carries program, size and stage.
    for (const row of ruleSourceRows(program('Trading Combine', 50_000), program('Trading Combine', 50_000).versions[0])) {
      expect(row).toMatchObject({ program: '50K Trading Combine', accountSize: 50_000, stage: 'evaluation' });
    }
    // A "verified" rule without a source is downgraded by the feed validator — and then not applied.
    const p = program('Trading Combine', 50_000);
    const v = p.versions[0];
    const stripped: ProgramRuleVersion = { ...v, records: v.records!.map((r) => (r.key === 'profitTarget' ? { ...r, sources: [] } : r)) };
    const db: FirmRulesDatabase = { ...FIRM_RULES_SEED, programs: [{ ...p, versions: [stripped] }] };
    const parsed = parseFirmRulesDatabase(db);
    expect(parsed.downgraded).toContain(`${p.id}@${v.ruleVersion}#profitTarget`);
    const imp = importProgramRules(parsed.db!.programs[0], NOW);
    expect(imp.status).toBe('verified');
    expect(imp.status === 'verified' ? imp.values.profitTarget : 'n/a').toBeUndefined();
    // The whole seed validates without downgrades.
    expect(parseFirmRulesDatabase(FIRM_RULES_SEED).downgraded).toEqual([]);
  });

  it('7. account snapshots survive future master-rule updates', () => {
    const p = program('Trading Combine', 50_000);
    const imp = importProgramRules(p, NOW);
    const link = linkFor(topstep, p, imp, NOW);
    expect(link.snapshot?.rules.find((r) => r.key === 'profitTarget')?.value).toBe('$3,000');
    const form = { ...accountToForm(null), name: 'Topstep 50K', firm: 'Topstep', ...(imp.status === 'verified' ? imp.values : {}), balance: '50000', dailyLossLimit: '' } as ReturnType<typeof accountToForm>;
    const account = formToAccount(form, null, 'acc-ts', undefined, { ...link, overrides: detectOverrides(link.imported, ruleValuesOf(form)) });
    const saved = rowsToAccount(accountToRows(account, 'u1').account, accountToRows(account, 'u1').rules);

    // Topstep later changes the 50K profit target — published centrally.
    const v = p.versions[0];
    const changed: ProgramRuleVersion = {
      ...v,
      ruleVersion: '2027-01-01',
      effectiveDate: '2027-01-01',
      rules: { ...v.rules, profitTarget: 3_500 },
      records: v.records!.map((r) => (r.key === 'profitTarget' ? { ...r, value: '$3,500' } : r)),
    };
    const master = mergeFirmRules(FIRM_RULES_SEED, { ...FIRM_RULES_SEED, source: 'remote', firms: [], programs: [{ ...p, versions: [changed] }] });
    const later = '2027-02-01T00:00:00.000Z';
    const updated = importProgramRules(master.programs.find((x) => x.id === p.id)!, later);
    expect(updated.status === 'verified' && updated.values.profitTarget).toBe('3500');

    // The saved account keeps its own rules and its snapshot…
    expect(saved.rules.profitTarget).toBe(3_000);
    expect(saved.firmLink?.snapshot?.ruleVersion).toBe('2026-10-05');
    expect(saved.firmLink?.snapshot?.rules.find((r) => r.key === 'profitTarget')?.value).toBe('$3,000');
    expect(saved.firmLink?.snapshot?.rules.find((r) => r.key === 'profitTarget')?.sources[0].url).toMatch(/help\.topstep\.com/);
    // …and is only told that newer rules exist.
    expect(newerRulesAvailable(master, saved.firmLink!, later)?.ruleVersion).toBe('2027-01-01');
    expect(newerRulesAvailable(FIRM_RULES_SEED, saved.firmLink!, NOW)).toBeNull();
  });
});
