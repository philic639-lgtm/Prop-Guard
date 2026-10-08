import { parseDate, parseMoney, stageFrom, statusFrom } from './extract';
import type { FieldKey, FieldMap, PageExtraction } from './types';
import { ALL_FIELDS, DATE_FIELDS, MONEY_FIELDS } from './types';

/**
 * Advanced reader (server-side vision) → the same PageExtraction as OCR, so
 * its values go through the same merge, cross-checks, matching and review.
 * Values are re-validated here; confidence is capped (a model reading is not
 * proof) and the field is marked `vision`.
 */
export interface VisionReading {
  fields: Record<string, { value: number | string | null; label: string | null; confidence: number } | null>;
  legible: boolean;
  notes: string;
}

const CAP = 0.85;

export function visionToPage(r: VisionReading, page: number): PageExtraction {
  const fields: FieldMap = {};
  for (const key of ALL_FIELDS) {
    const f = r.fields[key];
    if (!f || f.value == null || f.value === '') continue;
    let value: number | string | null = null;
    if ((MONEY_FIELDS as FieldKey[]).includes(key)) {
      value = typeof f.value === 'number' ? f.value : parseMoney(String(f.value), key === 'accountSize');
      if (value != null && !['netPnl', 'dailyPnl'].includes(key)) value = Math.abs(value);
    } else if ((DATE_FIELDS as FieldKey[]).includes(key)) value = parseDate([String(f.value)])?.iso ?? null;
    else if (key === 'stage') value = stageFrom(String(f.value));
    else if (key === 'status') value = statusFrom(String(f.value));
    else value = String(f.value).slice(0, 60);
    if (value == null || (typeof value === 'number' && !Number.isFinite(value))) continue;
    const conf = Math.min(CAP, Math.max(0, f.confidence)) * (r.legible ? 1 : 0.6);
    fields[key] = { key, value, confidence: Math.round(conf * 100) / 100, source: 'vision', evidence: f.label ? `Advanced reader: “${f.label.slice(0, 60)}”` : 'Advanced reader', page };
  }
  const n = Object.keys(fields).length;
  return { page, fields, sensitive: [], quality: !r.legible ? 'poor' : n >= 4 ? 'good' : 'fair', ocrConfidence: r.legible ? 80 : 40, wordCount: n * 2 };
}
