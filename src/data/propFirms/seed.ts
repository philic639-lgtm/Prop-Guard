import { LUCID_PROGRAMS } from './firms/lucid';
import { TOPSTEP_PROGRAMS } from './firms/topstep';
import { FIRM_RULES_SCHEMA_VERSION, type FirmRulesDatabase, type PropFirm } from './types';

/**
 * Seed for the prop-firm rules database.
 *
 * Add a firm: one entry in FIRMS. Add its programs in `firms/<firm>.ts` (one
 * entry per program × size × stage, each with its own rule records).
 * Add rules: a `versions` entry with `verification.status: 'verified'`, at
 * least one official source URL, `verifiedBy` and `lastVerifiedAt` — every
 * value checked against that source. Unverified values are never applied, so
 * do not add numbers you have not checked; leave `versions: []` instead and the
 * app asks the trader to enter the rules ("Rules not yet verified").
 *
 * Firm terms change often: prefer publishing verified versions through the
 * backend (`npm run firm-rules:publish`) over editing this file.
 */

const FIRMS: PropFirm[] = [
  { id: 'topstep', name: 'Topstep', aliases: ['TopstepX', 'Top Step'], logo: null, website: 'https://www.topstep.com', active: true },
  { id: 'apex', name: 'Apex Trader Funding', aliases: ['Apex', 'ATF'], logo: null, website: 'https://apextraderfunding.com', active: true },
  { id: 'lucid', name: 'Lucid Trading', aliases: ['Lucid'], logo: null, website: 'https://lucidtrading.com', active: true },
  { id: 'take-profit-trader', name: 'Take Profit Trader', aliases: ['TPT', 'TakeProfitTrader'], logo: null, website: 'https://takeprofittrader.com', active: true },
  { id: 'my-funded-futures', name: 'My Funded Futures', aliases: ['MFFU', 'MyFundedFutures'], logo: null, website: 'https://myfundedfutures.com', active: true },
  { id: 'tradeify', name: 'Tradeify', aliases: [], logo: null, website: 'https://tradeify.co', active: true },
  { id: 'bulenox', name: 'Bulenox', aliases: [], logo: null, website: 'https://bulenox.com', active: true },
  { id: 'earn2trade', name: 'Earn2Trade', aliases: ['E2T', 'Earn 2 Trade'], logo: null, website: 'https://www.earn2trade.com', active: true },
  { id: 'elite-trader-funding', name: 'Elite Trader Funding', aliases: ['ETF', 'Elite'], logo: null, website: 'https://elitetraderfunding.com', active: true },
  { id: 'tradeday', name: 'TradeDay', aliases: ['Trade Day'], logo: null, website: 'https://www.tradeday.com', active: true },
  { id: 'tickticktrader', name: 'TickTickTrader', aliases: ['Tick Tick Trader', 'TTT'], logo: null, website: 'https://tickticktrader.com', active: true },
];

/**
 * Program catalogue. Researched from official pages, every rule with its
 * source: Topstep (`firms/topstep.ts`) and Lucid Trading — LucidPro and
 * LucidFlex, evaluation + funded (`firms/lucid.ts`). The other firms list no
 * programs until theirs are verified — traders enter those rules manually.
 */
const PROGRAMS = [...TOPSTEP_PROGRAMS, ...LUCID_PROGRAMS];

export const FIRM_RULES_SEED: FirmRulesDatabase = {
  schemaVersion: FIRM_RULES_SCHEMA_VERSION,
  publishedAt: '2026-10-08T00:00:00.000Z',
  source: 'seed',
  firms: FIRMS,
  programs: PROGRAMS,
};
