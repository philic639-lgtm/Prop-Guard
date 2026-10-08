import {
  emptyPayoutRules,
  emptyProgramRules,
  type FirmRuleRecord,
  type ProgramOption,
  type ProgramRuleVersion,
  type ProgramRules,
  type PropFirmProgram,
  type RuleRecordStatus,
  type RuleSource,
} from '../types';

/**
 * Lucid Trading — LucidPro and LucidFlex (evaluation + simulated funded),
 * researched from Lucid's OWN pages only (support.lucidtrading.com,
 * lucidtrading.com product pages). No blogs, forums or comparison sites.
 *
 * Method (recorded on every source): the pages could not be opened directly
 * from the research environment (DNS blocked), so each value was taken from
 * the official page's text as returned by searches restricted to Lucid's
 * domains and cross-checked across separate searches. Values that conflict
 * between Lucid pages, or that appeared in only one excerpt, are
 * NEEDS_REVIEW and are never auto-applied. Re-verify by opening the pages
 * (`method: 'page'`) — the rule monitor flags source changes for review.
 *
 * Purchase option: "Daily Loss Limit: On / Off" (chosen at checkout, applies
 * to the evaluation AND the funded account, cannot be changed later). Rules
 * that depend on it carry `when: { dll: 'on' | 'off' }`.
 *
 * Not covered (rules not researched — traders enter them manually):
 * LucidDirect, LucidDaily, LucidMaxx, LucidBlack and Lucid live accounts.
 */

export const LUCID_CHECKED = '2026-10-08';
const VERIFIED_BY = 'Prop Guard rules research — official Lucid Trading pages (search excerpts, cross-checked)';

const art = (path: string, title: string): RuleSource => ({ url: `https://support.lucidtrading.com/en/articles/${path}`, title, retrievedAt: LUCID_CHECKED, method: 'search_excerpt' });
const product = (slug: string, title: string): RuleSource => ({ url: `https://lucidtrading.com/product/${slug}/`, title, retrievedAt: LUCID_CHECKED, method: 'search_excerpt' });

export const LUCID_SOURCES = {
  proEval: art('12890029-lucidpro-evaluation-account', 'LucidPro Evaluation Account'),
  proFunded: art('12890069-lucidpro-funded-account', 'LucidPro Funded Account'),
  proDrawdown: art('12890136-lucidpro-drawdown', 'LucidPro Drawdown'),
  proDll: art('12890122-lucidpro-daily-loss-limit', 'LucidPro Daily Loss Limit'),
  proCustom: art('16226068-lucidpro-customization', 'LucidPro Customization'),
  proPayouts: art('12890092-lucidpro-payouts', 'LucidPro Payouts'),
  proConsistency: art('12890109-lucidpro-consistency-percentage', 'LucidPro Consistency Percentage'),
  pro50: product('lucidtest-50k', 'LucidPro 50K Rithmic'),
  pro100: product('lucidtest-100k', 'LucidPro EVAL 100K'),
  pro150: product('lucidtest-150k', 'LucidPro 150K Rithmic'),
  flexEval: art('12945790-lucidflex-evaluation-account', 'LucidFlex Evaluation Account'),
  flexFunded: art('12945795-lucidflex-funded-account', 'LucidFlex Funded Account'),
  flexDrawdown: art('12945815-lucidflex-drawdown', 'LucidFlex Drawdown'),
  flexCustom: art('16226050-lucidflex-customization', 'LucidFlex Customization'),
  flexPayouts: art('12945796-lucidflex-payouts', 'LucidFlex Payouts'),
  flexConsistency: art('12945805-lucidflex-consistency-percentage', 'LucidFlex Consistency Percentage'),
  flexScaling: art('12945808-lucidflex-scaling-plan', 'LucidFlex Scaling Plan'),
  flexLiveLegacy: art('13424914-lucidflex-live-legacy', 'LucidFlex Live (Legacy)'),
  newLive: art('16558826-new-live-structure', 'New Live Structure'),
};
const S = LUCID_SOURCES;

type Size = 25_000 | 50_000 | 100_000 | 150_000;
const SIZES: Size[] = [25_000, 50_000, 100_000, 150_000];
const K = (s: Size) => `${s / 1000}K`;
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

/** Per-size values as stated on Lucid's pages (null = not stated / conflicting). */
const BY_SIZE: Record<Size, { target: number; mll: number; maxMinis: number; proFixedDll: number | null; proCycleGoal: number; flexMinDayProfit: number }> = {
  25_000: { target: 1_250, mll: 1_000, maxMinis: 2, proFixedDll: null, proCycleGoal: 250, flexMinDayProfit: 100 },
  50_000: { target: 3_000, mll: 2_000, maxMinis: 4, proFixedDll: 1_200, proCycleGoal: 500, flexMinDayProfit: 150 },
  100_000: { target: 6_000, mll: 3_000, maxMinis: 6, proFixedDll: 1_800, proCycleGoal: 750, flexMinDayProfit: 200 },
  150_000: { target: 9_000, mll: 4_500, maxMinis: 10, proFixedDll: 2_700, proCycleGoal: 1_000, flexMinDayProfit: 250 },
};
const PRO_PRODUCT: Partial<Record<Size, RuleSource>> = { 50_000: S.pro50, 100_000: S.pro100, 150_000: S.pro150 };
/** Initial Trail Balance: the drawdown floor stops trailing at starting balance + $100. */
const LOCK_OFFSET = 100;
const itb = (size: Size) => size + BY_SIZE[size].mll + LOCK_OFFSET;

function rec(key: string, label: string, value: string, sources: RuleSource[], opts: { field?: keyof ProgramRules; status?: RuleRecordStatus; note?: string; when?: Record<string, string>; structured?: Partial<ProgramRules> } = {}): FirmRuleRecord {
  return {
    key,
    label,
    value,
    status: opts.status ?? 'verified',
    sources: sources.filter(Boolean),
    checkedAt: LUCID_CHECKED,
    ...(opts.field ? { field: opts.field } : {}),
    ...(opts.note ? { note: opts.note } : {}),
    ...(opts.when ? { when: opts.when } : {}),
    ...(opts.structured ? { structured: opts.structured } : {}),
  };
}

const dllOption = (line: 'LucidPro' | 'LucidFlex'): ProgramOption => ({
  id: 'dll',
  label: 'Daily Loss Limit',
  description: 'Chosen at checkout. Applies to the evaluation AND the funded account and cannot be changed later.',
  choices: [
    { id: 'on', label: 'On', description: 'Daily Loss Limit enforced (lower evaluation price)' },
    { id: 'off', label: 'Off', description: 'No Daily Loss Limit in evaluation or funded (higher price)' },
  ],
  sources: [line === 'LucidPro' ? S.proCustom : S.flexCustom],
});

function version(ruleVersion: string, effectiveDate: string, rules: ProgramRules, records: FirmRuleRecord[], notes: string): ProgramRuleVersion {
  const sources = [...new Map(records.filter((r) => r.status === 'verified').flatMap((r) => r.sources).map((s) => [s.url, s])).values()];
  return {
    ruleVersion,
    effectiveDate,
    lastVerifiedAt: `${LUCID_CHECKED}T00:00:00.000Z`,
    verification: { status: 'verified', sources, verifiedBy: VERIFIED_BY, notes },
    rules,
    records,
  };
}

// ───────────────────────────── shared records ─────────────────────────────

function drawdownRecords(size: Size, line: 'LucidPro' | 'LucidFlex'): FirmRuleRecord[] {
  const v = BY_SIZE[size];
  const dd = line === 'LucidPro' ? S.proDrawdown : S.flexDrawdown;
  return [
    rec('accountSize', 'Account size', `${usd(size)} (simulated)`, [line === 'LucidPro' ? S.proEval : S.flexEval]),
    rec('maxLossLimit', 'Max Loss Limit (MLL)', `${usd(v.mll)} below the starting balance`, [dd, line === 'LucidPro' ? S.proFunded : S.flexFunded], { field: 'maxDrawdown' }),
    rec('drawdownMethod', 'Drawdown calculation', 'End-of-day (EOD) trailing: at the end of each session the MLL follows the highest closing balance. Touching the MLL breaches the account.', [dd], { field: 'drawdownType' }),
    rec('drawdownLock', 'Drawdown lock', `Once the account closes above the Initial Trail Balance (${usd(itb(size))}) the MLL locks at ${usd(size + LOCK_OFFSET)} (starting balance + $100) and no longer moves.`, [dd, S.proDrawdown, S.flexDrawdown].filter((x, i, a) => a.indexOf(x) === i), { field: 'trailingLockOffset', structured: { trailingLocksAtStart: false } }),
    rec('maxContracts', 'Maximum position size', `${v.maxMinis} minis or ${v.maxMinis * 10} micros`, [line === 'LucidPro' ? S.proEval : S.flexEval, line === 'LucidPro' ? S.proFunded : S.flexFunded], {
      field: 'maxContracts',
      structured: { positionLimits: `${v.maxMinis} minis or ${v.maxMinis * 10} micros` },
    }),
  ];
}

function dllRecords(size: Size, line: 'LucidPro' | 'LucidFlex', stage: 'evaluation' | 'funded'): FirmRuleRecord[] {
  const custom = line === 'LucidPro' ? S.proCustom : S.flexCustom;
  const out: FirmRuleRecord[] = [
    rec('dailyLossOff', 'Daily Loss Limit (Off)', 'None — with the DLL Off option no Daily Loss Limit applies in the evaluation or the funded account.', [custom], { when: { dll: 'off' }, field: 'dailyLossMode', structured: { dailyLossMode: 'none', dailyLossLimit: null, dailyLossBreach: null } }),
  ];
  if (line === 'LucidPro') {
    const fixed = BY_SIZE[size].proFixedDll;
    if (fixed != null)
      out.push(
        rec(
          'dailyLossOn',
          'Daily Loss Limit (On)',
          `${usd(fixed)} fixed${stage === 'funded' ? ` while the balance is below the Initial Trail Balance (${usd(itb(size))})` : ''}. Soft breach: trading is locked until the next session; the account is not lost unless the MLL is hit.`,
          [S.proDll, S.proEval, ...(PRO_PRODUCT[size] ? [PRO_PRODUCT[size]!] : [])],
          { when: { dll: 'on' }, field: 'dailyLossLimit', structured: { dailyLossMode: 'fixed', dailyLossLimit: fixed, dailyLossBreach: 'soft' } },
        ),
      );
    else
      out.push(
        rec('dailyLossOn', 'Daily Loss Limit (On)', 'Lucid’s pages disagree for the 25K account: one table lists a $600 DLL, the DLL article lists none.', [S.proDll, S.proFunded], {
          when: { dll: 'on' },
          status: 'needs_review',
          note: 'Conflicting official values ($600 vs none). Not applied — enter the DLL from your account dashboard.',
        }),
      );
    if (stage === 'funded')
      out.push(
        rec('dailyLossScaling', 'LucidScale DLL (On)', 'After the account closes above the Initial Trail Balance the fixed DLL is replaced by a scaling DLL of 60% of the peak end-of-day value; it never decreases.', [S.proDll, S.proFunded], {
          when: { dll: 'on' },
          status: 'needs_review',
          note: 'The DLL article says 60% of peak end-of-day PROFIT; the funded overview says 60% of peak end-of-day BALANCE. Prop Guard keeps the fixed DLL (the stricter value) until this is confirmed.',
        }),
      );
  } else {
    out.push(
      rec('dailyLossOn', 'Daily Loss Limit (On)', 'Optional at checkout; Lucid’s LucidFlex pages do not state the dollar amounts (product pages for 100K / 150K list $1,800 / $2,700, the 25K page lists none).', [custom, S.flexEval], {
        when: { dll: 'on' },
        status: 'needs_review',
        note: 'Amounts not stated in the LucidFlex help articles. Not applied — enter the DLL shown in your account.',
      }),
    );
  }
  return out;
}

// ───────────────────────────── LucidPro ─────────────────────────────

function proEvaluation(size: Size): PropFirmProgram {
  const v = BY_SIZE[size];
  const records = [
    ...drawdownRecords(size, 'LucidPro'),
    rec('profitTarget', 'Profit target', usd(v.target), [S.proEval, ...(PRO_PRODUCT[size] ? [PRO_PRODUCT[size]!] : [])], { field: 'profitTarget' }),
    rec('consistency', 'Consistency rule', 'None during the evaluation (the 40% rule applies to funded payouts).', [S.proEval, ...(PRO_PRODUCT[size] ? [PRO_PRODUCT[size]!] : [])], { field: 'consistencyRule' }),
    ...dllRecords(size, 'LucidPro', 'evaluation'),
  ];
  const rules: ProgramRules = {
    ...emptyProgramRules(),
    profitTarget: v.target,
    maxDrawdown: v.mll,
    drawdownType: 'eod_trailing',
    trailingLocksAtStart: false,
    trailingLockOffset: LOCK_OFFSET,
    maxContracts: v.maxMinis,
    positionLimits: `${v.maxMinis} minis or ${v.maxMinis * 10} micros`,
    consistencyRule: { maxDayPctOfProfit: null, description: 'No consistency rule during the evaluation.' },
  };
  return {
    id: `lucid:pro-eval:${size / 1000}k`,
    firmId: 'lucid',
    name: `LucidPro ${K(size)} Evaluation`,
    family: 'LucidPro Evaluation',
    line: 'LucidPro',
    stage: 'evaluation',
    accountSize: size,
    active: true,
    options: [dllOption('LucidPro')],
    versions: [version(LUCID_CHECKED, LUCID_CHECKED, rules, records, 'Effective date = date checked (Lucid does not publish one per rule).')],
  };
}

function proFunded(size: Size): PropFirmProgram {
  const v = BY_SIZE[size];
  const common = [
    ...drawdownRecords(size, 'LucidPro'),
    ...dllRecords(size, 'LucidPro', 'funded'),
    rec('payoutGoal', 'Payout cycle profit goal', `${usd(v.proCycleGoal)} profit in each payout cycle (resets after every payout).`, [S.proPayouts], { field: 'payout' }),
    rec('payoutMin', 'Minimum payout request', '$500', [S.proPayouts], {
      field: 'payoutRequirements',
      structured: { payoutRequirements: [`${usd(v.proCycleGoal)} profit per cycle`, 'Largest day ≤ 40% of cycle profit', `Balance above ${usd(itb(size))} (buffer)`, 'Minimum request $500'] },
    }),
    rec('payoutBuffer', 'Payout buffer', `Payouts can’t come from the buffer: the balance must stay above ${usd(itb(size))} (starting balance + Max Loss Limit + $100).`, [S.proPayouts]),
    rec('payoutCaps', 'Maximum payout per request', 'Caps depend on size and payout number (e.g. 50K: $2,000 first payout, $2,500 later).', [S.proPayouts], { status: 'needs_review', note: 'Only part of the cap table appeared in Lucid’s excerpts. Check the LucidPro Payouts article.' }),
    rec('contractScaling', 'Contract scaling', 'Lucid’s funded overview mentions both a scaling plan and immediate access to max size; the steps were not stated.', [S.proFunded], { status: 'needs_review', note: 'Scaling steps not published in the excerpts reviewed.' }),
  ];
  const payout = { ...emptyPayoutRules(), cycleProfitGoal: v.proCycleGoal, minRequest: 500, bufferAboveStart: v.mll + LOCK_OFFSET };
  const base: ProgramRules = {
    ...emptyProgramRules(),
    maxDrawdown: v.mll,
    drawdownType: 'eod_trailing',
    trailingLocksAtStart: false,
    trailingLockOffset: LOCK_OFFSET,
    maxContracts: v.maxMinis,
    positionLimits: `${v.maxMinis} minis or ${v.maxMinis * 10} micros`,
    payout,
    payoutRequirements: [`${usd(v.proCycleGoal)} profit per cycle`, 'Largest day ≤ 40% of cycle profit', `Balance above ${usd(itb(size))} (buffer)`, 'Minimum request $500'],
  };
  const current = version(
    '2025-11-28',
    '2025-11-28',
    { ...base, consistencyRule: { maxDayPctOfProfit: 40, description: 'Largest single day ≤ 40% of profit in the payout cycle (payout eligibility; resets after each payout; not in live).' } },
    [...common, rec('consistency', 'Consistency (payouts)', '40% — largest single-day profit ÷ cycle profit must be ≤ 40% to request a payout. Accounts bought or reset from 11/28/2025 3:00 PM ET.', [S.proPayouts, S.proConsistency], { field: 'consistencyRule' })],
    'Current terms: accounts bought or reset from 2025-11-28 3:00 PM ET. Other values: date checked.',
  );
  // Older terms: only what Lucid states for them is recorded — nothing is copied from the current version.
  const legacy = version(
    'legacy-pre-2025-11-28',
    '2000-01-01',
    { ...emptyProgramRules(), consistencyRule: { maxDayPctOfProfit: 35, description: 'Largest single day ≤ 35% of cycle profit (accounts bought or reset before 11/28/2025 3:00 PM ET).' } },
    [rec('consistency', 'Consistency (payouts, legacy)', '35% — accounts bought or reset before 11/28/2025 3:00 PM ET keep the older threshold.', [S.proPayouts], { field: 'consistencyRule' })],
    'Legacy terms for accounts bought or reset before 2025-11-28 3:00 PM ET. Lucid does not publish when these terms started (effective date is a placeholder for "before"). Only the consistency threshold is stated for these accounts — every other rule must be entered from your agreement.',
  );
  return {
    id: `lucid:pro-funded:${size / 1000}k`,
    firmId: 'lucid',
    name: `LucidPro ${K(size)} Funded`,
    family: 'LucidPro Funded',
    line: 'LucidPro',
    stage: 'funded',
    accountSize: size,
    active: true,
    options: [dllOption('LucidPro')],
    versions: [current, legacy],
  };
}

// ───────────────────────────── LucidFlex ─────────────────────────────

function flexEvaluation(size: Size): PropFirmProgram {
  const v = BY_SIZE[size];
  const records = [
    ...drawdownRecords(size, 'LucidFlex'),
    rec('profitTarget', 'Profit target', usd(v.target), [S.flexEval], { field: 'profitTarget' }),
    rec('consistency', 'Consistency rule', '50% — largest single-day profit ÷ total profit must be ≤ 50% to move to funded.', [S.flexEval, S.flexConsistency], { field: 'consistencyRule' }),
    rec('passing', 'Passing', 'Reach the profit target with consistency ≤ 50% and never touch the MLL; the funded account is issued within 5–30 minutes.', [S.flexEval], { field: 'activationThreshold' }),
    rec('scaling', 'Contract scaling', 'No scaling limits in the evaluation — full max size from the first trade.', [S.flexEval], { field: 'scalingRule' }),
    ...dllRecords(size, 'LucidFlex', 'evaluation'),
  ];
  const rules: ProgramRules = {
    ...emptyProgramRules(),
    profitTarget: v.target,
    maxDrawdown: v.mll,
    drawdownType: 'eod_trailing',
    trailingLocksAtStart: false,
    trailingLockOffset: LOCK_OFFSET,
    maxContracts: v.maxMinis,
    positionLimits: `${v.maxMinis} minis or ${v.maxMinis * 10} micros`,
    consistencyRule: { maxDayPctOfProfit: 50, description: 'Largest day ≤ 50% of total profit to pass.' },
    activationThreshold: 'Profit target reached with consistency ≤ 50% and no MLL breach → funded within 5–30 minutes',
    scalingRule: 'No scaling limits in the evaluation',
  };
  return {
    id: `lucid:flex-eval:${size / 1000}k`,
    firmId: 'lucid',
    name: `LucidFlex ${K(size)} Evaluation`,
    family: 'LucidFlex Evaluation',
    line: 'LucidFlex',
    stage: 'evaluation',
    accountSize: size,
    active: true,
    options: [dllOption('LucidFlex')],
    versions: [version(LUCID_CHECKED, LUCID_CHECKED, rules, records, 'Effective date = date checked (Lucid does not publish one per rule).')],
  };
}

function flexFunded(size: Size): PropFirmProgram {
  const v = BY_SIZE[size];
  const common = [
    ...drawdownRecords(size, 'LucidFlex'),
    rec('drawdownOnPayout', 'Drawdown after a payout', `Requesting a payout moves the MLL to the Locked MLL Balance (${usd(size + LOCK_OFFSET)}).`, [S.flexDrawdown], { field: 'drawdownLocksOnPayout' }),
    rec('consistency', 'Consistency rule', 'None in the funded account.', [S.flexFunded], { field: 'consistencyRule' }),
    rec('payoutDays', 'Payout: profitable days', `5 separate days in the cycle with at least ${usd(v.flexMinDayProfit)} profit each (resets after every payout); net cycle profit must be positive.`, [S.flexPayouts], { field: 'payout', structured: { minProfitableDays: 5 } }),
    rec('payoutMin', 'Minimum payout request', '$500', [S.flexPayouts], {
      field: 'payoutRequirements',
      structured: { payoutRequirements: [`5 days with ≥ ${usd(v.flexMinDayProfit)} profit`, 'Positive net cycle profit', 'Minimum request $500', 'Up to 5 payouts, then live'] },
    }),
    rec('payoutBuffer', 'Payout buffer', 'None', [S.flexFunded]),
    rec('payoutCaps', 'Maximum payout per request', '50% of profit, capped by account size (25K $1,000 · 50K $2,000 · 100K $2,500 · 150K $3,000).', [S.flexPayouts], { status: 'needs_review', note: 'The cap table appeared in one excerpt only; another described the limit as 50% of balance.' }),
    rec('scaling', 'Contract scaling (funded)', 'LucidFlex funded accounts have a scaling plan up to the max size; the steps were not stated in the excerpts.', [S.flexScaling, S.flexFunded], { status: 'needs_review', note: 'Scaling steps not confirmed.' }),
    ...dllRecords(size, 'LucidFlex', 'funded'),
  ];
  const base = (maxPayouts: number): ProgramRules => ({
    ...emptyProgramRules(),
    maxDrawdown: v.mll,
    drawdownType: 'eod_trailing',
    trailingLocksAtStart: false,
    trailingLockOffset: LOCK_OFFSET,
    drawdownLocksOnPayout: true,
    maxContracts: v.maxMinis,
    positionLimits: `${v.maxMinis} minis or ${v.maxMinis * 10} micros`,
    consistencyRule: { maxDayPctOfProfit: null, description: 'No consistency rule in the funded account.' },
    minProfitableDays: 5,
    payout: { ...emptyPayoutRules(), minRequest: 500, minProfitableDays: 5, minDayProfit: v.flexMinDayProfit, maxPayouts },
    payoutRequirements: [`5 days with ≥ ${usd(v.flexMinDayProfit)} profit`, 'Positive net cycle profit', 'Minimum request $500', `Up to ${maxPayouts} payouts, then live`],
  });
  const current = version('2026-02-28', '2026-02-28', base(5), [...common, rec('maxPayouts', 'Payouts before live', 'Up to 5 payouts per LucidFlex account, then the account moves to live.', [S.flexPayouts], { field: 'payout' })], 'Current terms: accounts bought or reset after 2026-02-27. Other values: date checked.');
  const legacy = version(
    'legacy-pre-2026-02-28',
    '2000-01-01',
    { ...emptyProgramRules(), payout: { ...emptyPayoutRules(), maxPayouts: 6 } },
    [rec('maxPayouts', 'Payouts before live (legacy)', 'Accounts bought or reset on 2/27/2026 and earlier move to live after the sixth LucidFlex payout (or earlier at Lucid’s discretion).', [S.flexLiveLegacy], { field: 'payout' })],
    'Legacy terms for accounts bought or reset on or before 2026-02-27. Lucid does not publish when these terms started (effective date is a placeholder for "before"). Only the payout count is stated — every other rule must be entered from your agreement.',
  );
  return {
    id: `lucid:flex-funded:${size / 1000}k`,
    firmId: 'lucid',
    name: `LucidFlex ${K(size)} Funded`,
    family: 'LucidFlex Funded',
    line: 'LucidFlex',
    stage: 'funded',
    accountSize: size,
    active: true,
    options: [dllOption('LucidFlex')],
    versions: [current, legacy],
  };
}

export const LUCID_PROGRAMS: PropFirmProgram[] = [...SIZES.map(proEvaluation), ...SIZES.map(proFunded), ...SIZES.map(flexEvaluation), ...SIZES.map(flexFunded)];
