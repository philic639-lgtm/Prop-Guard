/**
 * The example-screenshot guide must only ask for labels the importer can
 * actually read, and its mock-ups must never contain a real firm.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { extractPage, parseDate, parseMoney, type FieldKey, type OcrPage } from '@/lib/engines/accountImport';

import { EXAMPLE_FIRM, GUIDE, GUIDE_FIELDS, guidePageFor } from '../exampleGuide';

const firms = FIRM_RULES_SEED.firms;
const page = (lines: string[]): OcrPage => ({
  width: 800,
  height: lines.length * 40,
  confidence: 93,
  lines: lines.map((t, i) => {
    let x = 10;
    const words = t.split(/\s+/).map((w) => {
      const bbox = { x0: x, y0: i * 40, x1: x + w.length * 10, y1: i * 40 + 16 };
      x += w.length * 10 + 10;
      return { text: w, confidence: 93, bbox };
    });
    return { text: t, confidence: 93, bbox: { x0: 10, y0: i * 40, x1: x, y1: i * 40 + 16 }, words };
  }),
});

describe('example screenshot guide', () => {
  const tiles = GUIDE.flatMap((g) => g.tiles.filter((t) => t.field).map((t) => [g.title, t.label, t] as const));
  it.each(tiles)('%s: “%s” is read into the field it highlights', (_title, _label, t) => {
    const fields = extractPage(page([`${t.label} ${t.value}`]), 0, { firms }).fields;
    // Dates as ISO; money as shown (only P&L keeps its sign).
    const expected = t.field === 'startDate' ? parseDate(t.value.split(' '))!.iso : parseMoney(t.value);
    expect(fields[t.field!]?.value).toBe(expected);
  });

  it('the overview header identifies program, size, stage and status', () => {
    const g = GUIDE.find((x) => x.key === 'overview')!;
    const f = extractPage(page([g.header.title, g.header.subtitle]), 0, { firms }).fields;
    expect(f.program?.value).toBe(g.header.title);
    expect(f.accountSize?.value).toBe(50_000);
    expect(f.stage?.value).toBe('evaluation');
    expect(f.status?.value).toBe('Active');
  });

  it('covers balance, drawdown (amount, threshold, remaining), profit target and program; each field once', () => {
    const keys = GUIDE_FIELDS.map((g) => g.field);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['balance', 'startingBalance', 'maxDrawdown', 'drawdownThreshold', 'drawdownRemaining', 'dailyLossLimit', 'profitTarget', 'program', 'accountSize', 'startDate'] as FieldKey[]) expect(keys).toContain(k);
    expect(guidePageFor('profitTarget')?.key).toBe('rules');
    expect(guidePageFor('drawdownThreshold')?.key).toBe('drawdown');
  });

  it('mock-ups use a made-up firm — never a real one from the rules database', () => {
    const text = JSON.stringify(GUIDE) + EXAMPLE_FIRM;
    expect(extractPage(page([EXAMPLE_FIRM]), 0, { firms }).fields.firm).toBeUndefined();
    for (const f of firms) expect(text.toLowerCase()).not.toContain(f.name.toLowerCase());
  });
});
