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

export type ProgramStage = 'evaluation' | 'funded' | 'live';

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
