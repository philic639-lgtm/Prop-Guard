import type { DrawdownType } from '@/types/domain';

/**
 * Prop-firm rules database.
 *
 * A firm never has one universal ruleset: rules are stored per
 * firm → program (account type) → account size → stage (evaluation / funded /
 * live) → rule version (effective date). Every value is `null` unless it has
 * been verified against the firm's official terms — `null` means "unknown,
 * enter it yourself", never "no rule".
 *
 * The app ships a seed (`seed.ts`); a backend job can publish newer verified
 * versions to Supabase (`prop_firm_*` tables) which the app merges on top
 * without a frontend release.
 */

export const FIRM_RULES_SCHEMA_VERSION = 1;

/** evaluation = challenge; funded = SIMULATED funded account; live = real-capital account. */
export type ProgramStage = 'evaluation' | 'funded' | 'live';

/**
 * A choice the trader makes when buying the account (e.g. Lucid's
 * "Daily Loss Limit: On / Off"). Rule records can depend on it (`when`).
 */
export interface ProgramOption {
  id: string;
  label: string;
  description?: string;
  choices: { id: string; label: string; description?: string }[];
  sources: RuleSource[];
}

export interface PropFirm {
  id: string;
  name: string;
  /** Other names traders type ("Apex", "MFFU", "TPT"). */
  aliases: string[];
  logo: string | null;
  website: string | null;
  active: boolean;
}

export interface RuleSource {
  /** Official firm page or document the values were checked against. */
  url: string;
  title?: string;
  /** ISO date the source was checked. */
  retrievedAt: string;
  /**
   * How the page was read: `page` = opened directly; `search_excerpt` = the
   * official page's text as returned by a search restricted to the firm's own
   * domains (used when the page itself could not be opened).
   */
  method?: 'page' | 'search_excerpt';
}

/** Status of ONE rule. `needs_review` = official sources conflict or are unclear — never auto-applied. */
export type RuleRecordStatus = 'verified' | 'needs_review' | 'unverified';

/** One rule of a program version with its own evidence. */
export interface FirmRuleRecord {
  /** Stable key, e.g. "profitTarget", "hedging". */
  key: string;
  label: string;
  /** The rule as the firm states it (display text). */
  value: string;
  /** The structured `ProgramRules` field this record backs, if any. */
  field?: keyof ProgramRules;
  status: RuleRecordStatus;
  sources: RuleSource[];
  /** ISO date the rule was last checked. */
  checkedAt: string;
  /** Conflict explanation / caveats. */
  note?: string;
  /** Applies only for these purchase options, e.g. `{ dll: 'on' }`. Absent = always. */
  when?: Record<string, string>;
  /** Structured values this record sets when it applies AND is verified (option-dependent values). */
  structured?: Partial<ProgramRules>;
}

export type VerificationStatus = 'verified' | 'unverified';

export interface RuleVerification {
  /**
   * `verified` only when a person (or the verification job, with a human
   * sign-off) checked every non-null value against `sources`. Anything else is
   * `unverified` and is NEVER auto-applied to an account.
   */
  status: VerificationStatus;
  sources: RuleSource[];
  verifiedBy: string | null;
  notes?: string;
}

export interface ConsistencyRule {
  /** Largest single day may not exceed this % of total profit. */
  maxDayPctOfProfit: number | null;
  /** When it applies (e.g. "evaluation only", "before each payout"). */
  description: string;
}

/** Daily loss limit that changes with the account (e.g. Lucid's LucidScale DLL). */
export interface DailyLossScaling {
  /** Percent of the basis, e.g. 60. */
  pct: number;
  basis: 'peak_eod_profit' | 'peak_eod_balance';
  /** Applies once the end-of-day balance closes above this balance (null = from the start). */
  afterBalance: number | null;
}

/** Typed payout eligibility (null = not stated / not verified). */
export interface PayoutRules {
  minRequest: number | null;
  /** Largest request in dollars (first / later payouts may differ — see records). */
  maxRequest: number | null;
  /** Largest request as % of profit. */
  maxRequestPctOfProfit: number | null;
  /** Profit needed in each payout cycle. */
  cycleProfitGoal: number | null;
  /** Days in the cycle that must each reach `minDayProfit`. */
  minProfitableDays: number | null;
  minDayProfit: number | null;
  /** Payouts allowed before the account moves on (e.g. to live). */
  maxPayouts: number | null;
  /** Balance that must remain: starting balance + this amount (payouts never come from it). */
  bufferAboveStart: number | null;
}

export const emptyPayoutRules = (): PayoutRules => ({ minRequest: null, maxRequest: null, maxRequestPctOfProfit: null, cycleProfitGoal: null, minProfitableDays: null, minDayProfit: null, maxPayouts: null, bufferAboveStart: null });

export interface FirmAdditionalRule {
  id: string;
  label: string;
  description?: string;
}

/** Rules of one program version. `null` = not verified / not known. */
export interface ProgramRules {
  profitTarget: number | null;
  dailyLossLimit: number | null;
  maxDrawdown: number | null;
  drawdownType: DrawdownType | null;
  /** Trailing drawdown stops trailing once the floor reaches the starting balance. */
  trailingLocksAtStart: boolean | null;
  /** Floor stops trailing at starting balance + this amount (e.g. Lucid: +$100). Overrides trailingLocksAtStart. */
  trailingLockOffset: number | null;
  /** Percentage-based max drawdown (% of starting balance), when the firm states it as a percent. */
  maxDrawdownPct: number | null;
  /** The drawdown floor jumps to the lock level when a payout is requested (e.g. LucidFlex). */
  drawdownLocksOnPayout: boolean | null;
  /** `none` = this configuration has NO daily loss limit (verified), never "unknown". */
  dailyLossMode: 'none' | 'fixed' | 'scaling' | null;
  /** soft = locked out for the session; hard = account failed. */
  dailyLossBreach: 'soft' | 'hard' | null;
  dailyLossScaling: DailyLossScaling | null;
  payout: PayoutRules | null;
  inactivityRule: string | null;
  maxContracts: number | null;
  consistencyRule: ConsistencyRule | null;
  minTradingDays: number | null;
  maxTradingDays: number | null;
  minProfitableDays: number | null;
  payoutThreshold: number | null;
  payoutRequirements: string[];
  payoutFrequency: string | null;
  scalingRule: string | null;
  positionLimits: string | null;
  activationThreshold: string | null;
  newsTradingAllowed: boolean | null;
  newsRestriction: string | null;
  overnightAllowed: boolean | null;
  weekendHoldingAllowed: boolean | null;
  copyTradingAllowed: boolean | null;
  additionalRules: FirmAdditionalRule[];
}

export interface ProgramRuleVersion {
  /** e.g. "2026-09". Unique per program. */
  ruleVersion: string;
  /** ISO date the firm's terms take effect. */
  effectiveDate: string;
  /** ISO date-time the values were last checked against the sources. */
  lastVerifiedAt: string | null;
  verification: RuleVerification;
  rules: ProgramRules;
  /**
   * Per-rule evidence. When present, a structured value is applied ONLY if
   * the record backing its field is `verified`.
   */
  records?: FirmRuleRecord[];
}

export interface PropFirmProgram {
  id: string;
  firmId: string;
  /** Display name, e.g. "50K Trading Combine". */
  name: string;
  /**
   * Program family, e.g. "Trading Combine" — the "Program" the trader picks
   * before the account size. Each size is its own program with its own rules
   * (sizes never inherit from each other).
   */
  family: string;
  stage: ProgramStage;
  accountSize: number | null;
  active: boolean;
  /**
   * Product line the trader recognises ("LucidPro", "LucidFlex"). Picked
   * first, then the stage, then the size. Absent = the family is the line.
   */
  line?: string;
  /** Purchase options that change the rules (all must be chosen before rules load). */
  options?: ProgramOption[];
  /** Rule versions, any order. The active one is picked by effective date. */
  versions: ProgramRuleVersion[];
}

export interface FirmRulesDatabase {
  schemaVersion: number;
  /** ISO date-time this database was published. */
  publishedAt: string;
  source: 'seed' | 'remote' | 'merged';
  firms: PropFirm[];
  programs: PropFirmProgram[];
}

/** An empty rule set — the only legitimate default (everything unknown). */
export const emptyProgramRules = (): ProgramRules => ({
  profitTarget: null,
  dailyLossLimit: null,
  maxDrawdown: null,
  drawdownType: null,
  trailingLocksAtStart: null,
  trailingLockOffset: null,
  maxDrawdownPct: null,
  drawdownLocksOnPayout: null,
  dailyLossMode: null,
  dailyLossBreach: null,
  dailyLossScaling: null,
  payout: null,
  inactivityRule: null,
  maxContracts: null,
  consistencyRule: null,
  minTradingDays: null,
  maxTradingDays: null,
  minProfitableDays: null,
  payoutThreshold: null,
  payoutRequirements: [],
  payoutFrequency: null,
  scalingRule: null,
  positionLimits: null,
  activationThreshold: null,
  newsTradingAllowed: null,
  newsRestriction: null,
  overnightAllowed: null,
  weekendHoldingAllowed: null,
  copyTradingAllowed: null,
  additionalRules: [],
});
