/**
 * The canonical trading plan built from the trader's OWN description.
 *
 * One model for extraction, editing, follow-up questions, scoring, saving and practice. Every field
 * keeps its structured value, the trader's words it came from, a status and a source — so the app
 * can always say what the trader said, what is still unclear, and what (if anything) Prop Guard
 * suggested and the trader accepted. Nothing is filled in silently.
 */

export type PlanFieldKey =
  | 'instrument'
  | 'timezone'
  | 'openingRange'
  | 'lookStart'
  | 'evaluationWindow'
  | 'entryCutoff'
  | 'executionTimeframe'
  | 'entryTrigger'
  | 'stop'
  | 'target'
  | 'sizing'
  | 'maxTrades'
  | 'maxLosses'
  | 'dailyLossLimit'
  | 'filters';

/**
 * supplied — the trader stated it (description or answer);
 * needs_clarification — stated, but open to more than one reading;
 * missing — not stated;
 * accepted — a Prop Guard suggestion the trader explicitly accepted;
 * not_used — the trader said they do not use it (optional items only).
 */
export type PlanFieldStatus = 'supplied' | 'needs_clarification' | 'missing' | 'accepted' | 'not_used';

/** description — the trader's text; answer — a follow-up answer / edit; saved_settings — a saved setting the trader confirmed; suggestion — accepted Prop Guard suggestion. */
export type PlanFieldSource = 'description' | 'answer' | 'saved_settings' | 'suggestion';

/** How much the field matters for THIS plan (optional items never cost points). */
export type PlanRelevance = 'required' | 'recommended' | 'optional';

export interface TimeRange {
  start: string;
  end: string;
  minutes: number;
}

export interface PlanValues {
  instrument: string[];
  timezone: { zone: 'America/New_York'; written: string | null };
  openingRange: TimeRange;
  lookStart: string;
  /** A window the trader mentioned whose meaning is not certain (e.g. "by 9:50–9:55"). */
  evaluationWindow: { start: string; end: string; meaning: 'check_window' | 'entry_window' | null };
  /** "none" = the trader confirmed there is no cutoff. */
  entryCutoff: string;
  executionTimeframe: string;
  entryTrigger: string;
  stop: string;
  target: string;
  sizing: string;
  maxTrades: number;
  maxLosses: number;
  dailyLossLimit: number;
  filters: string[];
}

export interface PlanField<K extends PlanFieldKey = PlanFieldKey> {
  key: K;
  label: string;
  value: PlanValues[K] | null;
  /** Plain-language value. */
  display: string | null;
  status: PlanFieldStatus;
  source: PlanFieldSource | null;
  /** The trader's own words this comes from. */
  evidence?: string;
  /** Why it needs clarification, or how it was interpreted. */
  note?: string;
  relevance: PlanRelevance;
  updatedAt?: string;
  /** An earlier answer kept after the description changed — the trader re-confirms it. */
  review?: boolean;
}

export type PlanFields = { [K in PlanFieldKey]: PlanField<K> };

/** One "if … then …" branch of the plan (e.g. price outside vs inside the opening range). */
export interface PlanBranch {
  id: string;
  kind: 'outside_range' | 'inside_range' | 'other';
  condition: string;
  action: string;
  evidence: string;
  /** How the direction is decided in this branch, once clear. */
  directionRule: string | null;
  status: 'supplied' | 'needs_clarification';
  source: PlanFieldSource;
  note?: string;
  /** An earlier answer kept after the description changed — the trader re-confirms it. */
  review?: boolean;
}

export type SuggestionDecision = 'pending' | 'accepted' | 'rejected';

/** An optional refinement to TEST — never part of the plan until accepted. */
export interface PlanSuggestion {
  id: string;
  title: string;
  rule: string;
  /** Always a hypothesis, never a claim of edge. */
  hypothesis: string;
  status: SuggestionDecision;
  decidedAt?: string;
}

export interface StrategyPlan {
  version: 1;
  originalText: string;
  /** The description mentions an opening range (ORB-style plan). */
  usesOpeningRange: boolean;
  fields: PlanFields;
  branches: PlanBranch[];
  /** Decisions on suggestions by id (the suggestion list itself is derived). */
  decisions: Record<string, { status: SuggestionDecision; at: string }>;
  createdAt: string;
  updatedAt: string;
}

export const FIELD_LABELS: Record<PlanFieldKey, string> = {
  instrument: 'Instrument',
  timezone: 'Time zone',
  openingRange: 'Opening range',
  lookStart: 'Start looking for entries',
  evaluationWindow: 'Price check window',
  entryCutoff: 'Last entry time',
  executionTimeframe: 'Execution chart timeframe',
  entryTrigger: 'Entry trigger',
  stop: 'Stop',
  target: 'Target',
  sizing: 'Position size',
  maxTrades: 'Maximum trades per day',
  maxLosses: 'Stop after losing trades',
  dailyLossLimit: 'Daily dollar-loss limit',
  filters: 'Optional filters (volume, order flow…)',
};

export const SOURCE_LABEL: Record<PlanFieldSource, string> = {
  description: 'From your description',
  answer: 'Your answer',
  saved_settings: 'From your saved settings (you confirmed)',
  suggestion: 'Suggestion you accepted',
};

export const STATUS_LABEL: Record<PlanFieldStatus, string> = {
  supplied: 'Defined',
  needs_clarification: 'Needs clarification',
  missing: 'Not in your description',
  accepted: 'Accepted suggestion',
  not_used: 'Not used',
};

/**
 * The four rule labels the app shows. trader_supplied — your description, your answer, or a saved
 * setting you confirmed; needs_clarification — stated but unclear, not stated yet, or an earlier answer
 * to re-check; app_suggestion — an idea Prop Guard offers (inactive); trader_accepted — an idea you accepted.
 */
export type RuleTag = 'trader_supplied' | 'needs_clarification' | 'app_suggestion' | 'trader_accepted';
export const RULE_TAG_LABEL: Record<RuleTag, string> = {
  trader_supplied: 'Trader supplied',
  needs_clarification: 'Needs clarification',
  app_suggestion: 'App suggestion',
  trader_accepted: 'Trader accepted',
};
