/**
 * Account screenshot import — shared types.
 *
 * Pipeline: image → OCR (on-device, free) or optional vision reader → OcrPage
 * → extractPage (labels + layout) → reconcile (merge pages, cross-checks)
 * → matchImport (firm/program/duplicates) → trader review → applyImport.
 * Nothing here ever invents a value: a field is either read from the image,
 * calculated from two read values (marked `derived`), entered by the trader,
 * or `null` ("Not detected").
 */

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  /** 0–100. */
  confidence: number;
  bbox: OcrBox;
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: OcrBox;
  words: OcrWord[];
}

/** One recognized image (any engine produces this shape). */
export interface OcrPage {
  width: number;
  height: number;
  /** Mean OCR confidence 0–100. */
  confidence: number;
  lines: OcrLine[];
  /**
   * Further readings of the SAME image (e.g. at another scale). Each is extracted on its own and
   * merged field by field: agreeing values are kept, disagreeing ones become a conflict.
   */
  passes?: OcrPage[];
}

export type MoneyField =
  | 'accountSize'
  | 'balance'
  | 'startingBalance'
  | 'netPnl'
  | 'dailyPnl'
  | 'equity'
  | 'unrealizedPnl'
  | 'maxDrawdown'
  | 'drawdownThreshold'
  | 'currentDrawdown'
  | 'drawdownRemaining'
  | 'dailyLossLimit'
  | 'profitTarget'
  | 'profitTargetBalance'
  | 'profitRemaining';
export type TextField = 'firm' | 'program' | 'stage' | 'status' | 'drawdownType';
export type DateField = 'startDate' | 'statementDate';
/** Whole-number counts. */
export type CountField = 'tradingDays';
export type FieldKey = MoneyField | TextField | DateField | CountField;

export const MONEY_FIELDS: MoneyField[] = [
  'accountSize',
  'balance',
  'startingBalance',
  'netPnl',
  'dailyPnl',
  'equity',
  'unrealizedPnl',
  'maxDrawdown',
  'drawdownThreshold',
  'currentDrawdown',
  'drawdownRemaining',
  'dailyLossLimit',
  'profitTarget',
  'profitTargetBalance',
  'profitRemaining',
];
export const TEXT_FIELDS: TextField[] = ['firm', 'program', 'stage', 'status', 'drawdownType'];
export const DATE_FIELDS: DateField[] = ['startDate', 'statementDate'];
export const COUNT_FIELDS: CountField[] = ['tradingDays'];
export const ALL_FIELDS: FieldKey[] = [...TEXT_FIELDS, ...MONEY_FIELDS, ...DATE_FIELDS, ...COUNT_FIELDS];

/** Drawdown types a screenshot can state (same values as the account's `drawdownType`). */
export const DRAWDOWN_TYPES = ['eod_trailing', 'trailing', 'static'] as const;
export const DRAWDOWN_TYPE_LABEL: Record<(typeof DRAWDOWN_TYPES)[number], string> = { eod_trailing: 'End-of-day trailing', trailing: 'Intraday trailing', static: 'Static' };

/** Display labels. Balance, drawdown amount, threshold and remaining are deliberately distinct. */
export const FIELD_LABEL: Record<FieldKey, string> = {
  firm: 'Prop firm',
  program: 'Program / plan',
  stage: 'Stage',
  status: 'Account status',
  accountSize: 'Account size',
  balance: 'Current balance',
  startingBalance: 'Starting balance',
  netPnl: 'Net profit / loss',
  dailyPnl: 'Today’s P&L',
  equity: 'Equity / net liquidation (incl. open positions)',
  unrealizedPnl: 'Unrealized (open) P&L',
  maxDrawdown: 'Max drawdown (rule amount)',
  drawdownThreshold: 'Drawdown threshold (liquidation balance)',
  currentDrawdown: 'Current drawdown (used)',
  drawdownRemaining: 'Remaining drawdown allowance',
  dailyLossLimit: 'Daily loss limit',
  profitTarget: 'Profit target (amount)',
  profitTargetBalance: 'Profit target (balance level)',
  profitRemaining: 'Profit remaining to target',
  drawdownType: 'Drawdown type',
  tradingDays: 'Trading days',
  startDate: 'Start / purchase date',
  statementDate: 'Dashboard date',
};

export const FIELD_HELP: Partial<Record<FieldKey, string>> = {
  balance: 'Your account balance right now.',
  maxDrawdown: 'The size of the loss allowance (e.g. $2,000) — not a balance.',
  drawdownThreshold: 'The balance at which the account fails (e.g. $48,000).',
  currentDrawdown: 'How much of the allowance is used.',
  drawdownRemaining: 'How much more you can lose before the threshold.',
  profitTarget: 'Profit still to make in total (e.g. $1,250) — not a balance.',
  profitTargetBalance: 'The balance that passes the target (e.g. $26,250).',
  profitRemaining: 'Profit still needed to reach the target balance (e.g. $860).',
  tradingDays: 'Days traded so far, as the dashboard shows it.',
};

export type FieldSource = 'ocr' | 'vision' | 'derived' | 'user';

export interface ExtractedField<V = number | string> {
  key: FieldKey;
  value: V;
  /** 0–1. */
  confidence: number;
  source: FieldSource;
  /** What the value was read from (label + text), or how it was calculated. */
  evidence: string;
  page: number;
  /** Other readings that disagreed (multi-screenshot conflicts). */
  alternatives?: { value: V; confidence: number; page: number }[];
}

export type FieldMap = Partial<Record<FieldKey, ExtractedField>>;

export type SensitiveKind = 'account_id' | 'email' | 'phone' | 'name';

export interface SensitiveItem {
  kind: SensitiveKind;
  /** Masked for display, e.g. "••••4917". The raw value is never stored. */
  masked: string;
  page: number;
  bbox: OcrBox | null;
  /** Non-reversible fingerprint for duplicate detection (account ids only). */
  fingerprint: string | null;
}

/**
 * A value found next to a label but NOT assigned to it, with the reason —
 * e.g. "−$66.00" under "Profit target" (a loss is never a target), or the
 * "−$66 / $1,250" progress part of a target card. Shown to the trader as
 * "needs review", never used as the field's value.
 */
export interface AmbiguousReading {
  key: FieldKey;
  value: number;
  evidence: string;
  reason: string;
  page: number;
}

export interface PageExtraction {
  page: number;
  fields: FieldMap;
  ambiguous?: AmbiguousReading[];
  sensitive: SensitiveItem[];
  quality: 'good' | 'fair' | 'poor';
  ocrConfidence: number;
  wordCount: number;
  /** Account labels recognised on the page (diagnostics: 0 with many words = layout not understood). */
  labelsFound?: number;
}

export interface Extraction {
  fields: FieldMap;
  /** Values next to a label that were not assigned (see `AmbiguousReading`). */
  ambiguous?: AmbiguousReading[];
  sensitive: SensitiveItem[];
  pages: { page: number; quality: PageExtraction['quality']; ocrConfidence: number; wordCount: number; fieldCount: number }[];
  /** Cross-check results shown to the trader. */
  checks: ImportCheck[];
  /** Fingerprint of the account identifier, when one was read. */
  fingerprint: string | null;
}

export interface ImportCheck {
  id: string;
  status: 'consistent' | 'warning' | 'conflict';
  message: string;
  fields: FieldKey[];
}

export const LOW_CONFIDENCE = 0.7;
export const confidenceBand = (c: number): 'high' | 'medium' | 'low' => (c >= 0.85 ? 'high' : c >= LOW_CONFIDENCE ? 'medium' : 'low');
