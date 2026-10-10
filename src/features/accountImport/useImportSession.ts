import { create } from 'zustand';

import type { FirmRulesDatabase } from '@/data/propFirms/types';
import { extractPage, redactText, visionToPage, type FieldKey, type PageExtraction } from '@/lib/engines/accountImport';
import { aiService } from '@/services/ai';
import { MAX_IMAGES, releaseImages, type ImportImage } from '@/services/accountImport/images';
import { disposeOcr, OcrError, ocrAvailable, ocrLog, recognize, redactImage } from '@/services/accountImport/ocr';
import { rejectReason } from '@/services/accountImport/validate';

/**
 * One screenshot-import session (in memory only — cleared when the import
 * screen closes). Images are read one by one with on-device OCR; the optional
 * advanced reader runs only when the trader asks for it on a specific image.
 */
export type ImageStatus = 'queued' | 'reading' | 'done' | 'error';

export interface SessionImage {
  image: ImportImage & { sample?: boolean };
  status: ImageStatus;
  progress: number;
  page: PageExtraction | null;
  error: string | null;
  reader: 'ocr' | 'vision' | null;
  /** Debug builds only: the recognised text (account numbers / emails masked), in memory only. */
  ocrText?: string[];
}

/** Show the recognised text for troubleshooting (development, or EXPO_PUBLIC_IMPORT_DEBUG=true). */
export const IMPORT_DEBUG = (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_IMPORT_DEBUG === 'true';

interface State {
  images: SessionImage[];
  reading: boolean;
  /** Trader edits: a value, or null = "not present / clear it". */
  edits: Partial<Record<FieldKey, number | string | null>>;
  add: (images: (ImportImage & { sample?: boolean })[]) => { added: number; skipped: number; rejected: string[] };
  remove: (id: string) => void;
  readAll: (db: FirmRulesDatabase) => Promise<void>;
  /** Read one failed screenshot again (fresh OCR worker). */
  retry: (id: string, db: FirmRulesDatabase) => Promise<void>;
  readWithVision: (id: string, db: FirmRulesDatabase) => Promise<void>;
  setEdit: (k: FieldKey, v: number | string | null) => void;
  resetEdit: (k: FieldKey) => void;
  reset: () => void;
}

const patch = (images: SessionImage[], id: string, p: Partial<SessionImage>) => images.map((i) => (i.image.id === id ? { ...i, ...p } : i));
const friendly = (e: unknown) => {
  if (e instanceof OcrError) return e.message;
  const m = (e as Error)?.message ?? String(e);
  return /network|fetch|load/i.test(m) ? 'The text reader could not load. Check your connection and try again.' : 'This screenshot could not be read. Try again, or enter the values manually.';
};
/** Bumped by reset(): a read still running from a closed import never writes into a new one. */
let generation = 0;

export const useImportSession = create<State>((set, get) => ({
  images: [],
  reading: false,
  edits: {},

  add: (incoming) => {
    const cur = get().images;
    const room = Math.max(0, MAX_IMAGES - cur.length);
    const rejected: string[] = [];
    const valid = incoming.filter((i) => {
      const why = rejectReason({ name: i.name, type: i.type, bytes: i.bytes, width: i.width, height: i.height });
      if (why) rejected.push(why);
      return !why;
    });
    const fresh = valid.filter((i) => !cur.some((c) => c.image.name === i.name && c.image.width === i.width && c.image.height === i.height));
    const take = fresh.slice(0, room);
    releaseImages(incoming.filter((i) => !take.includes(i)));
    set({ images: [...cur, ...take.map((image) => ({ image, status: 'queued' as const, progress: 0, page: null, error: null, reader: null }))] });
    return { added: take.length, skipped: valid.length - take.length, rejected };
  },

  remove: (id) => {
    const img = get().images.find((i) => i.image.id === id);
    if (img) releaseImages([img.image]);
    set({ images: get().images.filter((i) => i.image.id !== id).map((i, n) => (i.page ? { ...i, page: { ...i.page, page: n } } : i)) });
  },

  readAll: async (db) => {
    if (get().reading) return;
    const gen = generation;
    set({ reading: true });
    try {
      for (const item of get().images) {
        if (gen !== generation) return;
        if (item.status === 'done') continue;
        const id = item.image.id;
        if (!ocrAvailable()) {
          set({ images: patch(get().images, id, { status: 'error', error: 'On-device text reading is not available on this device.' }) });
          continue;
        }
        set({ images: patch(get().images, id, { status: 'reading', progress: 0.02, error: null }) });
        try {
          const ocr = await recognize(item.image, (p) => gen === generation && set({ images: patch(get().images, id, { progress: p }) }));
          if (gen !== generation) return;
          const index = get().images.findIndex((i) => i.image.id === id);
          if (index < 0) continue; // removed while reading
          const page = extractPage(ocr, index, { firms: db.firms });
          // Counts only — never the screenshot's text or values.
          ocrLog('page: parsed', { words: page.wordCount, confidence: page.ocrConfidence, quality: page.quality, labels: page.labelsFound ?? 0, fields: Object.keys(page.fields).length });
          const ocrText = IMPORT_DEBUG ? ocr.lines.map((l) => `${l.confidence}% | ${redactText(l.text)}`) : undefined;
          set({ images: patch(get().images, id, { status: 'done', progress: 1, page, reader: 'ocr', ...(ocrText ? { ocrText } : {}) }) });
        } catch (e) {
          if (gen !== generation) return;
          set({ images: patch(get().images, id, { status: 'error', progress: 0, error: friendly(e) }) });
        }
      }
    } finally {
      if (gen === generation) set({ reading: false });
    }
  },

  retry: async (id, db) => {
    if (get().reading) return;
    set({ images: patch(get().images, id, { status: 'queued', progress: 0, page: null, error: null, reader: null }) });
    await get().readAll(db);
  },

  readWithVision: async (id, db) => {
    const item = get().images.find((i) => i.image.id === id);
    if (!item) return;
    set({ images: patch(get().images, id, { status: 'reading', progress: 0.3, error: null }) });
    try {
      // Black out account numbers / emails found by OCR before the image leaves the device (web).
      const boxes = (item.page?.sensitive ?? []).map((s) => s.bbox).filter((b): b is NonNullable<typeof b> => !!b);
      const redacted = await redactImage(item.image, boxes);
      if (!redacted) throw new Error('The advanced reader needs a browser to black out account numbers first.');
      const reading = await aiService.readAccountScreenshot({ imageBase64: redacted.base64, mimeType: 'image/jpeg' });
      if (!reading) throw new Error('The advanced reader is not available. Enter the values below instead.');
      const index = get().images.findIndex((i) => i.image.id === id);
      const page = visionToPage(reading, index);
      // Keep sensitive-item detection from OCR (the reader never returns identifiers).
      if (item.page) page.sensitive = item.page.sensitive;
      set({ images: patch(get().images, id, { status: 'done', progress: 1, page, reader: 'vision' }) });
    } catch (e) {
      set({ images: patch(get().images, id, { status: item.page ? 'done' : 'error', progress: 1, error: friendly(e) }) });
    }
    void db;
  },

  setEdit: (k, v) => set({ edits: { ...get().edits, [k]: v } }),
  resetEdit: (k) => {
    const next = { ...get().edits };
    delete next[k];
    set({ edits: next });
  },

  reset: () => {
    generation++;
    releaseImages(get().images.map((i) => i.image));
    set({ images: [], reading: false, edits: {} });
    void disposeOcr();
  },
}));
