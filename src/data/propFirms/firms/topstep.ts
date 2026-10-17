import {
  emptyProgramRules,
  type FirmRuleRecord,
  type ProgramRuleVersion,
  type ProgramRules,
  type PropFirmProgram,
  type RuleRecordStatus,
  type RuleSource,
} from '../types';

/**
 * Topstep — rules researched from Topstep's OWN pages only (topstep.com,
 * help.topstep.com). No blogs, forums or comparison sites.
 *
 * Method (recorded on every source): the pages could not be opened directly
 * from the research environment (network policy), so each value was taken
 * from the official page's text as returned by a search restricted to
 * Topstep's domains, and cross-checked across several searches. A value that
 * differed between searches, or whose page attribution was unclear, is
 * NEEDS_REVIEW and is never auto-applied. Re-verify by opening the pages
 * (`method: 'page'`) when access is available.
 *
 * Each program × size is its own entry with its own records — no program or
 * size inherits another's rules.
 */

export const TOPSTEP_CHECKED = '2026-10-05';
const RULE_VERSION = '2026-10-05';
const VERIFIED_BY = 'Prop Guard rules research — official Topstep pages (search excerpts, cross-checked)';

const src = (path: string, title: string): RuleSource => ({
  url: path.startsWith('http') ? path : `https://help.topstep.com/en/articles/${path}`,
  title,
  retrievedAt: TOPSTEP_CHECKED,
  method: 'search_excerpt',
});

const S = {
  overview: src('8284099-topstep-program-overview', 'Topstep Program Overview'),
  tcParams: src('8284197-trading-combine-parameters', 'Trading Combine® Parameters'),
  mll: src('8284204-what-is-the-maximum-loss-limit', 'What is the Maximum Loss Limit?'),
  dll: src('10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account', 'Daily Loss Limit in the Trading Combine and Express Funded Account'),
  consistency: src('8284208-consistency-at-topstep', 'Consistency at Topstep'),
  xfaParams: src('8284215-express-funded-account-parameters', 'Express Funded Account™ Parameters'),
  xfaRules: src('https://www.topstep.com/express-funded-account-rules', 'Topstep Express Funded Account Rules'),
  xfaActivation: src('8284217-express-funded-account-activation', 'Express Funded Account™ Activation'),
  scaling: src('8284223-what-is-the-scaling-plan', 'What is the Scaling Plan?'),
  payout: src('8284233-topstep-payout-policy', 'Topstep Payout Policy'),
  lfaParams: src('10657969-live-funded-account-parameters', 'Live Funded Account Parameters'),
  lfaRules: src('https://www.topstep.com/live-funded-account-rules', 'Live Funded Account Rules'),
  dlre: src('11748475-dynamic-live-risk-expansion', 'Dynamic Live Risk Expansion'),
  hours: src('8284206-when-and-what-products-can-i-trade', 'When and What Products Can I Trade?'),
  econ: src('8284211-economic-releases', 'Economic Releases'),
  prohibitedStrategies: src('10305426-prohibited-trading-strategies-at-topstep', 'Prohibited Trading Strategies at Topstep'),
  prohibitedConduct: src('10296582-prohibited-conduct', 'Prohibited Conduct'),
  hedging: src('13747047-understanding-hedging', 'Understanding Hedging'),
  api: src('11187768-topstepx-api-access', 'TopstepX™ API Access'),
  topstepx: src('14434175-topstepx', 'TopstepX™'),
  terms: src('https://www.topstep.com/terms-of-use', 'Terms of use'),
  reset: src('8284128-what-is-a-reset', 'What is a Reset?'),
  noActivationFee: src('https://www.topstep.com/no-activation-fee', 'No Activation Fee. Trade Your Way'),
  back2funded: src('12060405-back2funded-rules-guidelines-and-how-it-works', 'Back2Funded: Rules, Guidelines, and How It Works'),
};

type Size = 50_000 | 100_000 | 150_000;
const SIZES: Size[] = [50_000, 100_000, 150_000];
const K = (s: Size) => `${s / 1000}K`;
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

/** Per-size values as stated on Topstep's pages. */
const BY_SIZE: Record<Size, { target: number; mll: number; maxMinis: number; optionalDll: number; liveDll: number; standardPrice: number; nafPrice: number; back2funded: number }> = {
  50_000: { target: 3_000, mll: 2_000, maxMinis: 5, optionalDll: 1_000, liveDll: 2_000, standardPrice: 49, nafPrice: 95, back2funded: 599 },
  100_000: { target: 6_000, mll: 3_000, maxMinis: 10, optionalDll: 2_000, liveDll: 3_000, standardPrice: 99, nafPrice: 149, back2funded: 699 },
  150_000: { target: 9_000, mll: 4_500, maxMinis: 15, optionalDll: 3_000, liveDll: 4_500, standardPrice: 199, nafPrice: 229, back2funded: 829 },
};

function rec(key: string, label: string, value: string, sources: RuleSource[], opts: { field?: keyof ProgramRules; status?: RuleRecordStatus; note?: string } = {}): FirmRuleRecord {
  return { key, label, value, status: opts.status ?? 'verified', sources, checkedAt: TOPSTEP_CHECKED, ...(opts.field ? { field: opts.field } : {}), ...(opts.note ? { note: opts.note } : {}) };
}

const DLL_CONFLICT =
  'Two searches of Topstep’s Daily Loss Limit pages state the optional DLL as $1,000 / $2,000 / $3,000 (50K / 100K / 150K); another excerpt listed $2,000 / $3,000 / $4,500, which matches the Live Funded Account starting DLL. Not applied until the page is checked directly.';

/** Conduct rules that Topstep applies to every account type (recorded per program — never inherited). */
function conductRecords(): FirmRuleRecord[] {
  return [
    rec('tradingHours', 'Trading hours', 'Markets open Sunday 5:00 PM CT. All positions must be closed by 3:10 PM CT every weekday; trading resumes at 5:00 PM CT. Live Cattle / Lean Hogs: 8:30 AM – 1:05 PM CT.', [S.hours]),
    rec('overnight', 'Overnight holding', 'Not allowed — day trading only; positions cannot be held from one session to the next. Topstep begins flattening at 3:08 PM CT, but being flat by 3:10 PM CT is the trader’s responsibility.', [S.hours], { field: 'overnightAllowed' }),
    rec('weekend', 'Weekend holding', 'Not allowed — Friday close 3:10 PM CT, closed until Sunday 5:00 PM CT.', [S.hours], { field: 'weekendHoldingAllowed' }),
    rec(
      'news',
      'News trading',
      'Allowed — no requirement to flatten for economic releases. Prohibited: trading your full Maximum Position Size directly into a scheduled major release. Around CPI, new opening orders in equity-index products (ES, RTY, YM, NQ, NKD) are restricted in SIM (no new mini openings 5 min before to 5 min after; micros limited by account size). Trades affected by releases get no exceptions or Reset credits.',
      [S.econ],
      { field: 'newsTradingAllowed' },
    ),
    rec('products', 'Permitted products', 'CME Group futures listed by Topstep (CME equity, FX, NYMEX energy & metals, COMEX metals, CBOT grains, equity and interest-rate futures, incl. micros). Not allowed: stocks, options, spot forex, spot crypto, CFDs.', [S.hours]),
    rec('hedging', 'Hedging', 'Prohibited — opposite positions across accounts (even brief or unintentional). First detection: warning with a short window to un-hedge; repeated: positions liquidated and a Temporary Hedging Violation for the rest of the day.', [S.hedging, S.prohibitedConduct]),
    rec('vpsVpn', 'VPS / VPN / remote servers', 'Prohibited — trading must originate from your personal device; VPNs, proxies, TOR, VPS and remote servers can lead to suspension or removal.', [S.prohibitedConduct, S.api]),
    rec('automation', 'Automated trading', 'Allowed with conditions via the TopstepX / ProjectX API: platform rules apply, no high-frequency trading, no algorithms exploiting simulator fills; Topstep does not support or make exceptions for automation errors.', [S.api, S.prohibitedStrategies]),
    rec(
      'copyTrading',
      'Trade copier',
      'Reported as allowed (TopstepX includes a trade copier), subject to the hedging and conduct rules.',
      [S.topstepx],
      { field: 'copyTradingAllowed', status: 'needs_review', note: 'Found in a single search whose excerpt may come from a Topstep blog post rather than the Help Center policy. Not applied until confirmed on the TopstepX / Prohibited Conduct pages.' },
    ),
    rec('accountSharing', 'Account sharing / trading for others', 'Prohibited — no sharing logins, trading on behalf of others or single-account rule workarounds.', [S.prohibitedConduct, S.terms]),
    rec('prohibitedConduct', 'Prohibited conduct consequences', 'Warning, deletion of the trading day, account reset, permanent closure, or delay/denial of a payout.', [S.prohibitedConduct]),
  ];
}

const additional = (ids: [string, string][]) => ids.map(([id, label]) => ({ id, label }));

function version(records: FirmRuleRecord[], rules: ProgramRules): ProgramRuleVersion {
  const sources = [...new Map(records.filter((r) => r.status === 'verified').flatMap((r) => r.sources).map((s) => [s.url, s])).values()];
  // Extra rules are applied only when their own record is verified.
  for (const a of rules.additionalRules) if (!records.some((r) => r.key === `extra:${a.id}`)) records.push(rec(`extra:${a.id}`, a.label, a.label, [EXTRA_SOURCE[a.id]]));
  return {
    ruleVersion: RULE_VERSION,
    effectiveDate: TOPSTEP_CHECKED,
    lastVerifiedAt: `${TOPSTEP_CHECKED}T00:00:00.000Z`,
    verification: {
      status: 'verified',
      sources,
      verifiedBy: VERIFIED_BY,
      notes: 'Effective date = date checked (Topstep does not publish an effective date per rule). Values from official Topstep pages via search excerpts; NEEDS_REVIEW rules are shown but never applied.',
    },
    rules,
    records,
  };
}

const EXTRA_SOURCE: Record<string, RuleSource> = {
  'flat-by-close': S.hours,
  'no-hedging': S.hedging,
  'no-vps-vpn': S.prohibitedConduct,
  'no-full-size-news': S.econ,
  'xfa-inactivity': S.xfaParams,
  'lfa-floor': S.lfaRules,
};

const SHARED_EXTRAS = additional([
  ['flat-by-close', 'Flat by 3:10 PM CT every weekday (no overnight or weekend positions)'],
  ['no-hedging', 'No opposite positions across accounts (hedging)'],
  ['no-vps-vpn', 'Trade from your own device — no VPS, VPN or remote servers'],
  ['no-full-size-news', 'Do not trade full max position size into a scheduled major news release'],
]);

// ───────────────────────────── Trading Combine ─────────────────────────────

function tradingCombine(size: Size): PropFirmProgram {
  const v = BY_SIZE[size];
  const records = [
    rec('accountSize', 'Account size', `${usd(size)} (simulated)`, [S.overview, S.tcParams]),
    rec('profitTarget', 'Profit target', usd(v.target), [S.tcParams, S.overview], { field: 'profitTarget' }),
    rec('maxLossLimit', 'Maximum Loss Limit', `${usd(v.mll)} below the starting balance`, [S.mll], { field: 'maxDrawdown' }),
    rec('drawdownMethod', 'Drawdown calculation', 'Trailing, end-of-day: the limit rises with your highest end-of-day balance and never moves down. Monitored in real time including unrealized P&L — touching it liquidates the account.', [S.mll], { field: 'drawdownType' }),
    rec('drawdownLock', 'Drawdown lock point', 'Locks permanently once it reaches the starting balance.', [S.mll], { field: 'trailingLocksAtStart' }),
    rec('dailyLossLimit', 'Daily Loss Limit (optional)', `Optional; if added: ${usd(v.optionalDll)}. Hitting it liquidates and pauses trading until the next session (not a rule violation).`, [S.dll], { status: 'needs_review', note: DLL_CONFLICT }),
    rec('maxContracts', 'Maximum position size', `${v.maxMinis} minis or ${v.maxMinis * 10} micros open at one time (1 mini = 10 micros)`, [S.tcParams], { field: 'maxContracts' }),
    rec('consistency', 'Consistency target', '55% — your best day may be at most 55% of total profit (Best Day ÷ Total Profit). Hard line, no rounding; losses do not reset the best day.', [S.consistency, S.tcParams], { field: 'consistencyRule' }),
    rec(
      'consistencyBasis',
      'Consistency — what 55% is measured against',
      'Topstep pages describe it both as “55% of your total profit” and “55% of your Profit Target”.',
      [S.consistency, S.tcParams],
      { status: 'needs_review', note: 'Wording differs between Topstep excerpts (total profit vs Profit Target). Prop Guard tracks the Best Day ÷ Total Profit formula that Topstep states; confirm on the page.' },
    ),
    rec('minTradingDays', 'Minimum trading days', '2 — the Combine cannot be passed in one day', [S.tcParams, S.consistency], { field: 'minTradingDays' }),
    rec('passing', 'Passing / activation', 'Reach the Profit Target, meet the Consistency Target and never touch the Maximum Loss Limit → Express Funded Account. Standard path: $149 activation fee per XFA; No Activation Fee path: no activation fee.', [S.tcParams, S.xfaActivation, S.noActivationFee], { field: 'activationThreshold' }),
    rec('subscription', 'Subscription price', `Monthly: ${usd(v.standardPrice)} (Standard path) or ${usd(v.nafPrice)} (No Activation Fee path)`, [S.noActivationFee, S.xfaActivation]),
    rec('reset', 'Reset rules', `After a Maximum Loss Limit breach: Reset for ${usd(v.standardPrice)} (Standard) / ${usd(v.nafPrice)} (No Activation Fee); max 2 Resets per account per calendar day; each Reset adds 30 days to the rebill date; monthly rebills add 1 Reset credit. Active subscriptions only.`, [S.reset]),
    rec('marketData', 'Market data', 'Level 1 (top of book) data included', [S.tcParams]),
    ...conductRecords(),
  ];
  const rules: ProgramRules = {
    ...emptyProgramRules(),
    profitTarget: v.target,
    maxDrawdown: v.mll,
    drawdownType: 'eod_trailing',
    trailingLocksAtStart: true,
    maxContracts: v.maxMinis,
    consistencyRule: { maxDayPctOfProfit: 55, description: 'Best day ÷ total profit must be ≤ 55% to pass (hard line).' },
    minTradingDays: 2,
    positionLimits: `${v.maxMinis} minis or ${v.maxMinis * 10} micros at one time (10:1)`,
    activationThreshold: 'Hit the Profit Target with best day ≤ 55% of total profit and never touch the MLL → Express Funded Account (Standard path: $149 activation fee; No Activation Fee path: none)',
    newsTradingAllowed: true,
    newsRestriction: 'no full max size into scheduled major releases; CPI opening-order restrictions on equity-index products',
    overnightAllowed: false,
    weekendHoldingAllowed: false,
    additionalRules: SHARED_EXTRAS,
  };
  return { id: `topstep:trading-combine:${size / 1000}k`, firmId: 'topstep', name: `${K(size)} Trading Combine`, family: 'Trading Combine', stage: 'evaluation', accountSize: size, active: true, versions: [version(records, rules)] };
}

// ───────────────────────────── Express Funded Account ─────────────────────────────

function expressFunded(size: Size, path: 'standard' | 'consistency'): PropFirmProgram {
  const v = BY_SIZE[size];
  const standard = path === 'standard';
  const cap = standard ? 5_000 : 6_000;
  const payoutReqs = [
    standard ? '5 winning days of $150+ net P&L (need not be consecutive; a day locks at 4:00 PM CT)' : '3 trading days with at least 1 trade per day, and largest day ≤ 40% of total net profit',
    `Request up to 50% of the account balance, max ${usd(cap)} per payout`,
    'Minimum payout $125',
    'Net profit since the last payout must be positive (first payout exempt)',
    '90/10 profit split (traders who joined the new dashboard before Jan 12, 2026: 100% of the first $10,000 lifetime profit)',
  ];
  const records = [
    rec('accountSize', 'Account size', `${K(size)} XFA — balance starts at $0 in Topstep’s dashboard (Prop Guard tracks it from ${usd(size)})`, [S.xfaParams]),
    rec('maxLossLimit', 'Maximum Loss Limit', `${usd(v.mll)} below the starting balance; hitting it permanently closes the account`, [S.xfaParams, S.mll], { field: 'maxDrawdown' }),
    rec('drawdownMethod', 'Drawdown calculation', 'Trailing on the highest end-of-day balance; never moves down; monitored in real time including unrealized P&L.', [S.xfaParams, S.mll], { field: 'drawdownType' }),
    rec('drawdownLock', 'Drawdown lock point', 'Locks once it reaches the starting balance.', [S.mll], { field: 'trailingLocksAtStart' }),
    rec('dailyLossLimit', 'Daily Loss Limit (optional)', `Optional; if added: ${usd(v.optionalDll)}. Added at checkout it stays for the account’s life; manual limits can be changed.`, [S.dll], { status: 'needs_review', note: DLL_CONFLICT }),
    rec('scaling', 'Scaling Plan', 'Maximum position size is set by the Scaling Plan from the current balance; a higher level unlocks from the next session, never mid-session. 1 mini = 10 micros.', [S.scaling, S.xfaParams], { field: 'scalingRule' }),
    rec(
      'scalingTable',
      'Scaling Plan levels',
      'Contracts per balance level',
      [S.scaling, S.xfaParams],
      { status: 'needs_review', note: `The level table was not returned. Excerpts mention both “a $50K XFA can hold 2 minis” and a ${v.maxMinis}-contract maximum — enter your current level manually.` },
    ),
    ...(standard
      ? [rec('winningDays', 'Winning days for payout', '5 winning days of $150+ net P&L (not consecutive)', [S.payout, S.xfaParams], { field: 'minProfitableDays' })]
      : [
          rec('tradingDays', 'Trading days for payout', '3 trading days with at least 1 trade per day', [S.payout, S.consistency], { field: 'minTradingDays' }),
          rec('consistency', 'Consistency target (payout)', '40% — largest single day ≤ 40% of total net profit to be payout eligible', [S.consistency, S.payout, S.xfaParams], { field: 'consistencyRule' }),
        ]),
    rec('payoutEligibility', 'Payout eligibility', payoutReqs.join('; '), [S.payout, S.xfaParams], { field: 'payoutRequirements' }),
    rec('maxPayout', 'Maximum payout', `50% of balance up to ${usd(cap)} per request`, [S.payout, S.xfaParams]),
    rec('minPayout', 'Minimum payout', '$125', [S.payout]),
    rec('profitSplit', 'Payout percentage', '90% to the trader (90/10)', [S.payout, S.xfaParams]),
    rec('activation', 'Activation', 'Earned by passing the Trading Combine. Standard-path Combines: $149 activation fee per XFA; No Activation Fee path: none. No monthly subscription.', [S.xfaActivation, S.noActivationFee, S.overview], { field: 'activationThreshold' }),
    rec('inactivity', 'Inactivity', 'An XFA with no trading activity for more than 30 days may be closed; XFAs cannot be put on hold.', [S.xfaParams]),
    rec('accountLimit', 'Account limits', 'Up to 5 active XFAs (Standard and Consistency can be mixed); passing at the limit puts the new XFA on hold. Receiving a Live Funded Account closes all XFAs.', [S.xfaParams]),
    rec('back2funded', 'Back2Funded (reactivation)', `Up to 2 reactivations if the XFA is lost before the first payout; decide within 30 days; ${usd(v.back2funded)}; same size and payout rules; final and non-refundable.`, [S.back2funded]),
    ...conductRecords(),
  ];
  const rules: ProgramRules = {
    ...emptyProgramRules(),
    maxDrawdown: v.mll,
    drawdownType: 'eod_trailing',
    trailingLocksAtStart: true,
    consistencyRule: standard ? null : { maxDayPctOfProfit: 40, description: 'Largest day ≤ 40% of total net profit to be payout eligible.' },
    minTradingDays: standard ? null : 3,
    minProfitableDays: standard ? 5 : null,
    payoutRequirements: payoutReqs,
    scalingRule: 'Scaling Plan: max position size grows with the account balance; new levels apply from the next session (1 mini = 10 micros)',
    activationThreshold: 'Passed Trading Combine (Standard path: $149 activation fee; No Activation Fee path: none)',
    newsTradingAllowed: true,
    newsRestriction: 'no full max size into scheduled major releases; CPI opening-order restrictions on equity-index products',
    overnightAllowed: false,
    weekendHoldingAllowed: false,
    additionalRules: [...SHARED_EXTRAS, ...additional([['xfa-inactivity', 'Trade at least once every 30 days or the XFA may be closed']])],
  };
  const family = `Express Funded Account — ${standard ? 'Standard' : 'Consistency'}`;
  return { id: `topstep:xfa-${path}:${size / 1000}k`, firmId: 'topstep', name: `${K(size)} Express Funded Account (${standard ? 'Standard' : 'Consistency'})`, family, stage: 'funded', accountSize: size, active: true, versions: [version(records, rules)] };
}

// ───────────────────────────── Live Funded Account ─────────────────────────────

function liveFunded(size: Size): PropFirmProgram {
  const v = BY_SIZE[size];
  const payoutReqs = [
    '5 winning days of $150+ net P&L per payout cycle (not consecutive); the count restarts after each request',
    'Request up to 50% of the account balance — no dollar cap',
    'Total payouts are monitored to stay within 90% of the starting balance plus net trading profits',
  ];
  const records = [
    rec('accountSize', 'Account size', `Live Funded Account reached from a ${K(size)} account; Topstep sets the live starting capital (up to $150,000)`, [S.overview, S.lfaRules]),
    rec('dailyLossLimit', 'Daily Loss Limit', `${usd(v.liveDll)} to start; scales with available balance. Hitting it flattens positions, cancels orders and pauses trading until the next session (not a violation).`, [S.lfaParams, S.lfaRules], { field: 'dailyLossLimit' }),
    rec('dlre', 'Dynamic Live Risk Expansion', 'The Daily Loss Limit grows by $500 for each profit tier reached.', [S.dlre]),
    rec('maxLossLimit', 'Maximum Loss Limit', 'Account balance must stay above $1,000. If liquidated below $1,000 the account is closed and the remaining balance is paid out.', [S.lfaRules, S.lfaParams]),
    rec('payoutEligibility', 'Payout eligibility', payoutReqs.join('; '), [S.lfaRules, S.payout], { field: 'payoutRequirements' }),
    rec('winningDays', 'Winning days for payout', '5 winning days of $150+ net P&L per cycle', [S.lfaRules, S.payout], { field: 'minProfitableDays' }),
    rec('payoutFrequency', 'Payout frequency', 'Once per cycle of 5 new winning days', [S.lfaRules], { field: 'payoutFrequency' }),
    rec('maxPayout', 'Maximum payout', '50% of balance per request, no dollar cap', [S.lfaRules]),
    rec('activation', 'Activation', 'Earned after consistent XFA performance and a Risk Team review.', [S.overview], { field: 'activationThreshold' }),
    rec('accountLimit', 'Account limits', 'Only one Live Funded Account; receiving it closes all Express Funded Accounts.', [S.xfaParams]),
    rec('inactivity', 'Inactivity', 'No trades within 90 days → account considered abandoned and permanently closed.', [S.lfaParams], { status: 'needs_review', note: 'Stated in one search of the Live Funded Account pages; a second search of the same pages did not return it. Confirm on the page.' }),
    ...conductRecords(),
  ];
  const rules: ProgramRules = {
    ...emptyProgramRules(),
    dailyLossLimit: v.liveDll,
    minProfitableDays: 5,
    payoutRequirements: payoutReqs,
    payoutFrequency: 'Once per cycle of 5 new winning days',
    activationThreshold: 'Earned after consistent XFA performance and a Risk Team review',
    newsTradingAllowed: true,
    newsRestriction: 'no full max size into scheduled major releases',
    overnightAllowed: false,
    weekendHoldingAllowed: false,
    additionalRules: [...SHARED_EXTRAS, ...additional([['lfa-floor', 'Keep the Live account balance above $1,000']])],
  };
  return { id: `topstep:live-funded-account:${size / 1000}k`, firmId: 'topstep', name: `${K(size)} Live Funded Account`, family: 'Live Funded Account', stage: 'live', accountSize: size, active: true, versions: [version(records, rules)] };
}

export const TOPSTEP_PROGRAMS: PropFirmProgram[] = [
  ...SIZES.map(tradingCombine),
  ...SIZES.map((s) => expressFunded(s, 'standard')),
  ...SIZES.map((s) => expressFunded(s, 'consistency')),
  ...SIZES.map(liveFunded),
];
