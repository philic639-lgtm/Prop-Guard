import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { emptyProgramRules, type FirmRulesDatabase, type ProgramRuleVersion, type PropFirmProgram } from '@/data/propFirms/types';
import { accountToForm, formToAccount, ruleValuesOf } from '@/features/accounts/accountSchema';
import { useFirmRules } from '@/features/accounts/useFirmRules';
import { publishFirmRules } from '@/services/firmRules/publish';
import { dbToRows, rowsToDb } from '@/services/firmRules/rows';
import { rowsToAccount, accountToRows } from '@/services/supabase/mappers';

import {
  activeRuleVersion,
  detectOverrides,
  findFirm,
  importProgramRules,
  isVerified,
  linkFor,
  mergeFirmRules,
  parseFirmRulesDatabase,
  programsForFirm,
  ruleLines,
  searchFirms,
} from '../firmRulesEngine';

const NOW = '2026-10-05T12:00:00.000Z';

/**
 * TEST-ONLY fictional firm. Its numbers are made up to exercise the import
 * path and must never be copied into the seed.
 */
const verifiedVersion = (over: Partial<ProgramRuleVersion> = {}): ProgramRuleVersion => ({
  ruleVersion: '2026-09',
  effectiveDate: '2026-09-01',
  lastVerifiedAt: '2026-09-20T10:00:00.000Z',
  verification: { status: 'verified', sources: [{ url: 'https://example.com/rules', title: 'Example rules', retrievedAt: '2026-09-20' }], verifiedBy: 'rules-team' },
  rules: {
    ...emptyProgramRules(),
    profitTarget: 3000,
    dailyLossLimit: 1000,
    maxDrawdown: 2000,
    drawdownType: 'eod_trailing',
    maxContracts: 5,
    consistencyRule: { maxDayPctOfProfit: 50, description: 'evaluation only' },
    minTradingDays: 2,
    newsTradingAllowed: false,
    newsRestriction: 'flat 2 minutes around tier-1 data',
    payoutRequirements: ['5 winning days'],
    additionalRules: [{ id: 'no-hedging', label: 'No hedging across accounts' }],
  },
  ...over,
});

const exampleProgram = (versions: ProgramRuleVersion[]): PropFirmProgram => ({
  id: 'example:eval:50k',
  firmId: 'example',
  name: '50K Evaluation',
  family: 'Evaluation',
  stage: 'evaluation',
  accountSize: 50_000,
  active: true,
  versions,
});

const exampleDb = (versions: ProgramRuleVersion[]): FirmRulesDatabase => ({
  schemaVersion: 1,
  publishedAt: '2026-10-01T00:00:00.000Z',
  source: 'remote',
  firms: [{ id: 'example', name: 'Example Funding', aliases: [], logo: null, website: null, active: true }],
  programs: [exampleProgram(versions)],
});

describe('firm rules — seed', () => {
  it('lists the ten supported futures prop firms', () => {
    const names = FIRM_RULES_SEED.firms.map((f) => f.name);
    for (const n of ['Topstep', 'Apex Trader Funding', 'Lucid Trading', 'Take Profit Trader', 'My Funded Futures', 'Tradeify', 'Bulenox', 'Earn2Trade', 'Elite Trader Funding', 'TickTickTrader']) expect(names).toContain(n);
    expect(parseFirmRulesDatabase(FIRM_RULES_SEED).db).not.toBeNull();
  });

  it('never ships unverified firm rules: every seeded rule version carries verification evidence', () => {
    for (const p of FIRM_RULES_SEED.programs) for (const v of p.versions) expect(isVerified(v)).toBe(true);
  });

  it('stores Topstep by program, size and stage — not one universal ruleset', () => {
    const programs = programsForFirm(FIRM_RULES_SEED, 'topstep');
    expect(programs.filter((p) => p.stage === 'evaluation').map((p) => p.name)).toEqual(['50K Trading Combine', '100K Trading Combine', '150K Trading Combine']);
    expect(programs.some((p) => p.stage === 'funded')).toBe(true);
    expect(new Set(programs.map((p) => p.id)).size).toBe(programs.length);
  });

  it('a program without verified rules imports nothing', () => {
    const p = { ...programsForFirm(FIRM_RULES_SEED, 'topstep')[0], versions: [] };
    const imp = importProgramRules(p, NOW);
    expect(imp.status).toBe('unverified');
    expect(linkFor(FIRM_RULES_SEED.firms[0], p, imp, NOW)).toMatchObject({ status: 'unverified', imported: {}, lastVerifiedAt: null });
    // Firms without researched programs list none (traders enter rules manually).
    expect(programsForFirm(FIRM_RULES_SEED, 'apex')).toEqual([]);
  });
});

describe('firm rules — search', () => {
  const first = (q: string) => searchFirms(FIRM_RULES_SEED, q)[0]?.name;
  it('autocompletes from partial names, aliases and initials', () => {
    expect(first('top')).toBe('Topstep');
    expect(first('ap')).toBe('Apex Trader Funding');
    expect(first('luc')).toBe('Lucid Trading');
    expect(first('mffu')).toBe('My Funded Futures');
    expect(first('tpt')).toBe('Take Profit Trader');
    expect(first('earn')).toBe('Earn2Trade');
    expect(searchFirms(FIRM_RULES_SEED, 'zzzz')).toEqual([]);
  });

  it('restores a firm from a stored name or alias', () => {
    expect(findFirm(FIRM_RULES_SEED, 'apex')?.id).toBe('apex');
    expect(findFirm(FIRM_RULES_SEED, 'My Local Prop Shop')).toBeNull();
  });
});

describe('firm rules — versions and import', () => {
  it('imports every stated value of a verified version, including the account size', () => {
    const imp = importProgramRules(exampleProgram([verifiedVersion()]), NOW);
    expect(imp.status).toBe('verified');
    if (imp.status !== 'verified') return;
    expect(imp.values).toMatchObject({ size: '50000', profitTarget: '3000', dailyLossLimit: '1000', maxDrawdown: '2000', drawdownType: 'eod_trailing', maxContracts: '5', consistencyPct: '50', minTradingDays: '2', newsTrading: 'not_allowed', payoutRequirements: '5 winning days' });
    // Unknown values are left for the trader — never defaulted.
    expect(imp.values.maxTradingDays).toBeUndefined();
    expect(imp.values.overnight).toBeUndefined();
    expect(imp.additionalRules[0].label).toMatch(/hedging/);
  });

  it('uses the version in force on the date, not a future one', () => {
    const future = verifiedVersion({ ruleVersion: '2027-01', effectiveDate: '2027-01-01', rules: { ...verifiedVersion().rules, profitTarget: 9999 } });
    const p = exampleProgram([future, verifiedVersion()]);
    expect(activeRuleVersion(p, NOW)?.ruleVersion).toBe('2026-09');
    expect(activeRuleVersion(p, '2027-02-01')?.ruleVersion).toBe('2027-01');
  });

  it('a newer unverified version blocks the import instead of silently falling back to old rules', () => {
    const newer = verifiedVersion({ ruleVersion: '2026-10', effectiveDate: '2026-10-01', verification: { status: 'unverified', sources: [], verifiedBy: null } });
    expect(importProgramRules(exampleProgram([verifiedVersion(), newer]), NOW).status).toBe('unverified');
  });

  it('detects edited imported values as custom overrides', () => {
    const imported = { profitTarget: '3000', maxDrawdown: '2000', drawdownType: 'eod_trailing' } as const;
    expect(detectOverrides(imported, { profitTarget: '3,000', maxDrawdown: '2500', drawdownType: 'eod_trailing' })).toEqual(['maxDrawdown']);
  });

  it('review lines show every rule, unknown ones as null', () => {
    const lines = ruleLines(verifiedVersion().rules);
    expect(lines.find((l) => l.key === 'news')?.value).toMatch(/Not allowed — flat 2 minutes/);
    expect(lines.find((l) => l.key === 'overnight')?.value).toBeNull();
    expect(lines.some((l) => l.label.includes('hedging'))).toBe(true);
  });
});

describe('firm rules — central feed', () => {
  it('downgrades a "verified" version without evidence and rejects malformed feeds', () => {
    const noEvidence = verifiedVersion({ verification: { status: 'verified', sources: [], verifiedBy: null } });
    const parsed = parseFirmRulesDatabase(exampleDb([noEvidence]));
    expect(parsed.downgraded).toEqual(['example:eval:50k@2026-09']);
    expect(importProgramRules(parsed.db!.programs[0], NOW).status).toBe('unverified');
    expect(parseFirmRulesDatabase({ ...exampleDb([]), schemaVersion: 99 }).db).toBeNull();
    expect(parseFirmRulesDatabase({ ...exampleDb([]), programs: [{ ...exampleProgram([]), firmId: 'ghost' }] }).db).toBeNull();
  });

  it('merges a remote update over the seed by program and rule version', () => {
    const newer = verifiedVersion({ ruleVersion: '2026-10-20', effectiveDate: '2026-10-20' });
    const remote: FirmRulesDatabase = { ...exampleDb([]), firms: [], programs: [{ ...programsForFirm(FIRM_RULES_SEED, 'topstep')[0], versions: [newer] }] };
    const merged = mergeFirmRules(FIRM_RULES_SEED, remote);
    expect(merged.firms).toHaveLength(FIRM_RULES_SEED.firms.length);
    const p = merged.programs.find((x) => x.id === remote.programs[0].id)!;
    expect(p.versions.map((v) => v.ruleVersion).sort()).toEqual(['2026-10-05', '2026-10-20']);
    expect(activeRuleVersion(p, '2026-10-25')?.ruleVersion).toBe('2026-10-20');
    // The seed itself is untouched.
    expect(FIRM_RULES_SEED.programs.find((x) => x.id === p.id)!.versions).toHaveLength(1);
  });

  it('table rows round-trip through the same shape the app reads', () => {
    const db = exampleDb([verifiedVersion()]);
    const rows = dbToRows(db);
    const back = parseFirmRulesDatabase(rowsToDb(rows.firms, rows.programs, rows.versions, db.publishedAt));
    expect(back.db?.programs[0].versions[0]).toEqual(verifiedVersion());
  });

  it('the publisher validates first (dry run without a client)', async () => {
    const report = await publishFirmRules(exampleDb([verifiedVersion({ verification: { status: 'verified', sources: [], verifiedBy: null } })]), null);
    expect(report).toMatchObject({ firms: 1, programs: 1, versions: 1, downgraded: ['example:eval:50k@2026-09'] });
    await expect(publishFirmRules({ nope: true }, null)).rejects.toThrow(/Invalid firm rules database/);
  });

  it('the app store merges a provider feed and keeps the cache when the feed fails', async () => {
    await useFirmRules.getState().refresh({ force: true, provider: { id: 'fake', load: async () => exampleDb([verifiedVersion()]) } });
    expect(searchFirms(useFirmRules.getState().db, 'exam')[0]?.name).toBe('Example Funding');
    expect(useFirmRules.getState().db.firms.length).toBe(FIRM_RULES_SEED.firms.length + 1);
    await useFirmRules.getState().refresh({ force: true, provider: { id: 'down', load: async () => Promise.reject(new Error('offline')) } });
    expect(useFirmRules.getState().error).toBe('offline');
    expect(searchFirms(useFirmRules.getState().db, 'exam')).toHaveLength(1);
  });
});

describe('firm rules — accounts', () => {
  it('saves the firm link, overrides and extra terms, and keeps them through the database mappers', () => {
    const program = exampleProgram([verifiedVersion()]);
    const imp = importProgramRules(program, NOW);
    const link = linkFor({ id: 'example', name: 'Example Funding', aliases: [], logo: null, website: null, active: true }, program, imp, NOW);
    const form = { ...accountToForm(null), name: 'Example 50K', firm: 'Example Funding', ...(imp.status === 'verified' ? imp.values : {}), balance: '50000', maxDrawdown: '1800', payoutFrequency: 'weekly' };
    const account = formToAccount(form as ReturnType<typeof accountToForm>, null, 'acc-1', undefined, { ...link, overrides: detectOverrides(link.imported, ruleValuesOf(form as ReturnType<typeof accountToForm>)) });
    expect(account.rules).toMatchObject({ profitTarget: 3000, maxDrawdown: 1800, maxContracts: 5, drawdownType: 'eod_trailing' });
    expect(account.rules.terms).toMatchObject({ newsTrading: 'not_allowed', payoutFrequency: 'weekly', payoutRequirements: '5 winning days' });
    expect(account.firmLink).toMatchObject({ status: 'verified', programId: 'example:eval:50k', ruleVersion: '2026-09', lastVerifiedAt: '2026-09-20T10:00:00.000Z', overrides: ['maxDrawdown'] });
    const rows = accountToRows(account, 'user-1');
    const back = rowsToAccount(rows.account, rows.rules);
    expect(back.firmLink).toEqual(account.firmLink);
    expect(back.rules.terms).toEqual(account.rules.terms);
    expect(accountToForm(back).newsTrading).toBe('not_allowed');
  });

  it('accounts created before firm rules still load (no link, no terms)', () => {
    const plain = formToAccount(accountToForm(null), null, 'acc-2');
    expect(plain.firmLink).toBeUndefined();
    expect(plain.rules.terms).toBeUndefined();
  });
});
