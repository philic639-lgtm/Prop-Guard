/**
 * Copy Trade — a copy-trade ASSISTANT, not an execution engine.
 *
 * A trader follows other traders (source traders). For each idea they copy,
 * Prop Guard translates the source's trade into the trader's own size and
 * risk, checks it against the selected account's rules, and keeps a separate
 * log so the trader can see whether following someone is worth it.
 * Nothing here places, mirrors or executes trades.
 */

export type CopyPlatform = 'discord' | 'telegram' | 'x' | 'youtube' | 'mentor' | 'friend' | 'other';
export type CopyAssetClass = 'futures' | 'options' | 'stocks' | 'forex' | 'crypto' | 'other';

/**
 * How a copied idea becomes the trader's size:
 * - fixed_risk:   a fixed dollar risk per copied trade
 * - percent_risk: a percentage of the account balance
 * - scale:        source contracts × (mine / source), e.g. source 5 → mine 2
 * - mirror:       the source's contract count (still capped by every limit)
 */
export type CopySizingMode = 'fixed_risk' | 'percent_risk' | 'scale' | 'mirror';

export interface CopySettings {
  /** Account whose rules decide the copy (null = the active account). */
  accountId: string | null;
  sizingMode: CopySizingMode;
  fixedRisk: number | null;
  percentRisk: number | null;
  /** Scaling rule: for every `source` contracts the source trades, I trade `mine`. */
  scale: { source: number; mine: number } | null;
  maxContracts: number | null;
  maxTradesPerDay: number | null;
  /** Only copy these symbols (empty = any). */
  allowedInstruments: string[];
  /** Only copy between these local times (HH:MM, the trader's time zone). */
  session: { start: string; end: string } | null;
  /** Only copy ideas the trader rates A+. */
  aPlusOnly: boolean;
  /** The trader confirms the translated size before logging. */
  requireManualConfirm: boolean;
  /** Block when today's risk room or the drawdown buffer is nearly used. */
  blockNearLimit: boolean;
}

export interface SourceTrader {
  id: string;
  name: string;
  platform: CopyPlatform;
  assetClass: CopyAssetClass;
  instruments: string[];
  style: string | null;
  notes: string;
  /** The trader's own 1–5 trust rating (not a performance claim). */
  trustRating: number | null;
  isActive: boolean;
  /** Archived traders keep their history but leave every picker. */
  archived: boolean;
  settings: CopySettings;
  createdAt: string;
  updatedAt: string;
}

/** live = taken on the account; simulated = paper / sim; missed = seen but not taken. */
export type CopyMode = 'live' | 'simulated' | 'missed';
export type CopyConviction = 'A+' | 'A' | 'B' | 'C';

/**
 * safe     — "Safe to copy"
 * reduce   — "Reduce size" (the copy fits at a smaller size)
 * exceeds  — "Exceeds risk limit" (not even one contract fits)
 * blocked  — "Not allowed under account rules" (daily stop, trade cap, hours, instrument…)
 * review   — "Requires manual review" (missing inputs or unknown account limits)
 */
export type CopyVerdict = 'safe' | 'reduce' | 'exceeds' | 'blocked' | 'review';

/** What the risk translation decided when the copy was logged (kept as logged). */
export interface CopyTranslationSnapshot {
  verdict: CopyVerdict;
  instrument: string;
  contracts: number | null;
  riskDollars: number | null;
  dailyRiskRemaining: number | null;
  reasons: string[];
}

export interface CopyOutcome {
  exitPrice: number | null;
  /** Dollar result at the trader's size (hypothetical for simulated / missed copies). */
  pnl: number | null;
  r: number | null;
  closedAt: string | null;
}

export interface CopyTrade {
  id: string;
  sourceTraderId: string;
  /** Kept if the source trader is later renamed or archived. */
  sourceTraderName: string;
  accountId: string | null;
  instrument: string;
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target: number | null;
  /** What the source traded (optional — used by scale / mirror sizing). */
  sourceContracts: number | null;
  sourceInstrument: string | null;
  /** When the source posted the idea. */
  at: string;
  setup: string;
  notes: string;
  conviction: CopyConviction | null;
  mode: CopyMode;
  screenshotUri: string | null;
  /** Contracts the trader took (live) or would have taken. */
  contracts: number;
  translation: CopyTranslationSnapshot;
  /** Journal trade for live copies. */
  tradeId: string | null;
  /** Result for simulated / missed copies (live copies use the journal trade). */
  outcome: CopyOutcome | null;
  lesson: string;
  createdAt: string;
  updatedAt: string;
}
