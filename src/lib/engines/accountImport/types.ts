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
}

export type MoneyField =
  | 'accountSize'
  | 'balance'
  | 'startingBalance'
  | 'netPnl'
  | 'dailyPnl'
  | 'maxDrawdown'
  | 'drawdownThreshold'
  | 'currentDrawdown'
  | 'drawdownRemaining'
  | 'dailyLossLimit'
  | 'profitTarget';
export type TextField = 'firm' | 'program' | 'stage' | 'status';
export type DateField = 'startDate' | 'statementDate';
export type FieldKey = MoneyField | TextField | DateField;

export const MONEY_FIELDS: MoneyField[] = [
  'accountSize',
  'balance',
  'startingBalance',
  'netPnl',
  'dailyPnl',
  'maxDrawdown',
  'drawdownThreshold',
  'currentDrawdown',
  'drawdownRemaining',
  'dailyLossLimit',
  'profitTarget',
];
export const TEXT_FIELDS: TextField[] = ['firm', 'program', 'stage', 'status'];
export const DATE_FIELDS: DateField[] = ['startDate', 'statementDate'];
export const ALL_FIELDS: FieldKey[] = [...TEXT_FIELDS, ...MONEY_FIELDS, ...DATE_FIELDS];

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
  maxDrawdown: 'Max drawdown (rule amount)',
  drawdownThreshold: 'Drawdown threshold (liquidation balance)',
  currentDrawdown: 'Current drawdown (used)',
  drawdownRemaining: 'Remaining drawdown allowance',
  dailyLossLimit: 'Daily loss limit',
  profitTarget: 'Profit target',
  startDate: 'Start / purchase date',
  statementDate: 'Dashboard date',
};

export const FIELD_HELP: Partial<Record<FieldKey, string>> = {
  balance: 'Your account balance right now.',
  maxDrawdown: 'The size of the loss allowance (e.g. $2,000) — not a balance.',
  drawdownThreshold: 'The balance at which the account fails (e.g. $48,000).',
  currentDrawdown: 'How much of the allowance is used.',
  drawdownRemaining: 'How much more you can lose before the threshold.',
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

export interface PageExtraction {
  page: number;
  fields: FieldMap;
  sensitive: SensitiveItem[];
  quality: 'good' | 'fair' | 'poor';
  ocrConfidence: number;
  wordCount: number;
}

export interface Extraction {
  fields: FieldMap;
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
