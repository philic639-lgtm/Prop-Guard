/**
 * Smart screenshot updates & multi-account management.
 * Screenshots here are SYNTHETIC text pages run through the real extraction pipeline
 * (`extractPage`); passing tests do not prove accuracy on screenshots that were not tested.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { makeAccount, makeRules, makeTrade } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import { applyDetailEdits, detailValues } from '../accountDetails';
import { applyImport, confirmImport, extractPage, undoLatestUpdate, type OcrPage } from '../accountImport';
import { accountCard, filterCounts, needsAttention, overview, stageOf } from '../accountOverview';
import { tradesAwaitingBalance } from '../accountSync';
import { accountFigures, compareUpdate, updateSummary } from '../accountUpdate';
import { extractionOf, matchToAccount, planBulk, type BulkItemInput } from '../bulkImport';
import { computeDailyGuard } from '../dailyGuardEngine';

const db = FIRM_RULES_SEED;
const NOW = new Date('2026-10-14T16:00:00Z');

function textPage(lines: string[], confidence = 93): OcrPage {
  return {
    width: 800,
    height: lines.length * 40,
    confidence,
    lines: lines.map((t, i) => {
      let x = 10;
      const words = t
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => {
          const bbox = { x0: x, y0: i * 40, x1: x + w.length * 10, y1: i * 40 + 16 };
          x += w.length * 10 + 10;
          return { text: w, confidence, bbox };
        });
      return { text: t, confidence, bbox: { x0: 10, y0: i * 40, x1: x, y1: i * 40 + 16 }, words };
    }),
  };
}
const page = (lines: string[], confidence = 93) => extractPage(textPage(lines, confidence), 0, { firms: db.firms });
const lucidShot = (balance: string, threshold: string, opts: { account?: string; date?: string; extra?: string[] } = {}) =>
  page([
    'Lucid Trading',
    'LucidFlex 25K Evaluation',
    ...(opts.account ? [`Account ${opts.account}`] : []),
    ...(opts.date ? [`As of ${opts.date}`] : []),
    `Account Balance ${balance}`,
    'Starting Balance $25,000.00',
    `Liquidation Threshold ${threshold}`,
    'Daily Loss Limit $600.00',
    ...(opts.extra ?? []),
  ]);

/** A LucidFlex 25K account with a confirmed floor (as saved by an earlier import). */
function flex(id: string, over: Partial<Account> = {}, fingerprint: string | null = null): Account {
  return makeAccount({
    id,
    name: `LucidFlex 25K Evaluation ${id}`,
    firm: 'Lucid Trading',
    size: 25_000,
    startingBalance: 25_000,
    cycleStartBalance: 25_000,
    balance: 25_090,
    highWaterMark: 25_270,
    rules: { dailyLossLimit: 600, maxDrawdown: 1_000, drawdownType: 'eod_trailing', profitTarget: 1_250 } as never,
    importState: {
      fingerprint,
      maskedId: null,
      reported: { at: '2026-10-13T15:00:00Z', asOf: '2026-10-13', balance: 25_090, drawdownThreshold: 24_270 } as never,
      history: [],
      threshold: { value: 24_270, source: 'screenshot', at: '2026-10-13T15:00:00Z' },
      origins: { balance: { source: 'screenshot', at: '2026-10-13T15:00:00Z' } },
    },
    ...over,
  });
}

const item = (id: string, p: ReturnType<typeof page>, accounts: Account[], over: Partial<BulkItemInput> = {}): BulkItemInput => {
  const extraction = extractionOf(p);
  const match = matchToAccount(extraction, accounts, db);
  return { id, extraction, match, accountId: match.accountId, matchConfirmed: false, skipped: false, acks: {}, manualChoice: {}, ...over };
};

describe('1. LucidFlex 25K screenshot → update with old vs new values', () => {
  it('shows saved vs new balance, total P&L, floor and remaining drawdown ($976) before saving', () => {
    const a = flex('a');
    const x = extractionOf(lucidShot('$25,246.00', '$24,270.00'));
    const after = applyImport(a, confirmImport({ fields: x.fields, edited: new Set(), fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW }), 'r1').account;
    const rows = compareUpdate(a, after);
    const row = (k: string) => rows.find((r) => r.key === k)!;
    expect(row('balance')).toMatchObject({ before: 25_090, after: 25_246, changed: true });
    expect(row('totalPnl')).toMatchObject({ before: 90, after: 246 });
    expect(row('floor')).toMatchObject({ after: 24_270 });
    expect(row('remaining')).toMatchObject({ before: 820, after: 976 });
    expect(row('dailyLossLimit').after).toBe(600);
    expect(updateSummary(rows, (n) => `$${n}`)).toBe('Balance $25090 → $25246 · remaining drawdown $976');
  });

  it('equity and unrealized P&L are read for reference only — never the balance', () => {
    const x = extractionOf(page(['Account Balance $25,246.00', 'Equity $25,410.00', 'Unrealized P&L $164.00']));
    expect(x.fields.balance?.value).toBe(25_246);
    expect(x.fields.equity?.value).toBe(25_410);
    expect(x.fields.unrealizedPnl?.value).toBe(164);
  });
});

describe('2. updating an account after a manual edit', () => {
  it('a manual balance stays unless the trader picks the screenshot; the update can be undone', () => {
    const a = flex('a');
    const before = detailValues(a, 400);
    const edited = applyDetailEdits(a, before, { ...before, balance: 25_200 }, new Date('2026-10-14T12:00:00Z')).account;
    // Bulk / single update: manual correction conflicts are kept by default.
    const plan = planBulk([item('s1', lucidShot('$25,246.00', '$24,270.00'), [edited], { accountId: edited.id, matchConfirmed: true })], { accounts: [edited], db, now: NOW })[0]!;
    expect(plan.manual.map((c) => c.key)).toEqual(['balance']);
    expect(plan.confirmed?.keepManual).toEqual(['balance']);
    const kept = applyImport(edited, plan.confirmed!, 'r2').account;
    expect(kept.balance).toBe(25_200);

    // Undo returns the previous values; only the latest update can be undone.
    const updated = applyImport(edited, confirmImport({ fields: extractionOf(lucidShot('$25,246.00', '$24,270.00')).fields, edited: new Set(), fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW }), 'r3').account;
    expect(updated.balance).toBe(25_246);
    const u = undoLatestUpdate(updated, 'r3', NOW);
    expect(u.ok && u.account.balance).toBe(25_200);
    expect(u.ok && u.account.importState?.history.find((r) => r.id === 'r3')?.undoneAt).toBe(NOW.toISOString());
    expect(undoLatestUpdate(updated, updated.importState!.history[1]!.id, NOW).ok).toBe(false);
  });

  it('undo is refused when trades were journaled after the update (their P&L would be lost)', () => {
    const updated = applyImport(flex('a'), confirmImport({ fields: extractionOf(lucidShot('$25,246.00', '$24,270.00')).fields, edited: new Set(), fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW }), 'r1').account;
    const journaled = { ...updated, importState: { ...updated.importState!, origins: { ...updated.importState!.origins, balance: { source: 'calculated' as const, at: '2026-10-14T17:00:00Z' } } } };
    expect(undoLatestUpdate(journaled, 'r1', NOW)).toMatchObject({ ok: false });
  });
});

describe('3–4. five accounts (different firms / same firm)', () => {
  const rules = makeRules({ dailyStop: 400 });
  const five: Account[] = [
    flex('a', { balance: 25_246 }),
    flex('b', { balance: 24_400, firmLink: { stage: 'funded' } as never, name: 'Lucid Funded b' }),
    flex('c', { balance: 25_600 }),
    makeAccount({ id: 'd', name: 'Topstep 50K Combine', firm: 'Topstep', size: 50_000, balance: 50_400 }),
    flex('e', { status: 'archived' }),
  ];
  const cards = five.map((a) => accountCard(a, { trades: [], rules, now: NOW, primaryId: 'c', activeId: 'a' }));

  it('cards use the dashboard engines: remaining = Daily Guard buffer; unknown floor = needs update, never a number', () => {
    const a = cards.find((c) => c.id === 'a')!;
    expect(a.remaining).toBe(computeDailyGuard({ account: five[0]!, rules, trades: [], now: NOW }).drawdownBuffer);
    expect(a.remaining).toBe(976);
    const d = cards.find((c) => c.id === 'd')!;
    expect(d.remaining).toBeNull();
    expect(d.attention[0]?.text).toMatch(/needs update/);
  });

  it('critically low drawdown is "Needs Attention"; nothing is ever called breached', () => {
    const b = cards.find((c) => c.id === 'b')!;
    expect(b.remaining).toBe(130);
    expect(needsAttention(b)).toBe(true);
    expect(b.attention[0]).toMatchObject({ level: 'critical' });
    const below = accountCard(flex('z', { balance: 24_200 }), { trades: [], rules, now: NOW, primaryId: null, activeId: null });
    expect(below.attention[0]!.text).toMatch(/check with your firm/);
    expect(JSON.stringify(cards.concat(below))).not.toMatch(/breach/i);
  });

  it('filters: primary first, archived hidden, evaluations vs funded, recently updated', () => {
    const all = overview(cards, 'all', { now: NOW });
    expect(all[0]!.id).toBe('c');
    expect(all.map((c) => c.id)).not.toContain('e');
    expect(overview(cards, 'all', { now: NOW, showArchived: true }).map((c) => c.id)).toContain('e');
    expect(overview(cards, 'funded', { now: NOW }).map((c) => c.id)).toEqual(['b']);
    expect(overview(cards, 'evaluation', { now: NOW }).map((c) => c.id).sort()).toEqual(['a', 'c', 'd']);
    expect(filterCounts(cards, NOW).attention).toBeGreaterThanOrEqual(2);
    expect(stageOf(makeAccount({ name: 'Apex PA 50K' }))).toBe('funded');
  });
});

describe('5. bulk screenshot updates', () => {
  const a = flex('a', {}, 'fp-a');
  const b = flex('b', {}, 'fp-b');
  const c = flex('c');
  const accounts = [a, b, c];

  it('an account-number match is certain; without a number several same-firm accounts are ambiguous — never assigned silently', () => {
    const withNumber = { ...lucidShot('$25,246.00', '$24,270.00'), sensitive: [{ kind: 'account_id' as const, masked: '••••1', fingerprint: 'fp-b', bbox: null, page: 0 }] };
    expect(matchToAccount(extractionOf(withNumber), accounts, db)).toMatchObject({ certainty: 'account_number', accountId: 'b' });
    const anon = matchToAccount(extractionOf(lucidShot('$25,246.00', '$24,270.00')), accounts, db);
    expect(anon).toMatchObject({ certainty: 'ambiguous', accountId: null });
    // Accounts on file with a different number are ruled out.
    expect(anon.candidates.map((x) => x.accountId)).toEqual(['a', 'b', 'c']);
    const unknown = matchToAccount(extractionOf(page(['Account Balance $10,000.00'])), accounts, db);
    expect(unknown).toMatchObject({ certainty: 'none', accountId: null });
  });

  it('one fitting account is "likely" and still needs the trader to confirm', () => {
    const p = planBulk([item('s', lucidShot('$25,246.00', '$24,270.00'), [c])], { accounts: [c], db, now: NOW })[0]!;
    expect(p.status).toBe('needs_confirmation');
    const ok = planBulk([item('s', lucidShot('$25,246.00', '$24,270.00'), [c], { matchConfirmed: true })], { accounts: [c], db, now: NOW })[0]!;
    expect(ok.status).toBe('ready');
  });

  it('plans each screenshot on its own: ready / needs account / two screenshots for one account / skipped', () => {
    const shotB = { ...lucidShot('$25,400.00', '$24,400.00'), sensitive: [{ kind: 'account_id' as const, masked: '••••2', fingerprint: 'fp-b', bbox: null, page: 0 }] };
    const plan = planBulk(
      [
        item('1', shotB, accounts),
        item('2', lucidShot('$25,246.00', '$24,270.00'), accounts),
        item('3', lucidShot('$25,300.00', '$24,300.00'), accounts, { accountId: 'b', matchConfirmed: true }),
        item('4', lucidShot('$25,100.00', '$24,270.00'), accounts, { skipped: true }),
      ],
      { accounts, db, now: NOW },
    );
    expect(plan.map((p) => p.status)).toEqual(['duplicate_target', 'needs_account', 'duplicate_target', 'skipped']);
    const single = planBulk([item('1', shotB, accounts)], { accounts, db, now: NOW })[0]!;
    expect(single.status).toBe('ready');
    expect(single.changes.find((r) => r.key === 'remaining')?.after).toBe(1_000);
  });

  it('missing / unclear values: no balance → needs a value; low-confidence balance → needs verification check', () => {
    const noBal = planBulk([item('x', page(['Lucid Trading', 'LucidFlex 25K Evaluation', 'Liquidation Threshold $24,270.00']), [c], { accountId: 'c', matchConfirmed: true })], { accounts: [c], db, now: NOW })[0]!;
    expect(noBal.status).toBe('needs_values');
    const fuzzy = planBulk([item('y', lucidShot('$25,246.00', '$24,270.00', {}), [c], { accountId: 'c', matchConfirmed: true })].map((i) => ({ ...i, extraction: { ...i.extraction, fields: { ...i.extraction.fields, balance: { ...i.extraction.fields.balance!, confidence: 0.4 } } } })), { accounts: [c], db, now: NOW })[0]!;
    expect(fuzzy.acksNeeded.map((x) => x.id)).toContain('uncertain-balance');
  });

  it('outdated screenshots need an explicit check; a lower floor goes to a single update (reset decision)', () => {
    const newer = flex('n', { importState: { ...flex('n').importState!, reported: { ...flex('n').importState!.reported!, asOf: '2026-10-14' } } });
    const old = planBulk([item('o', lucidShot('$25,000.00', '$24,270.00', { date: '2026-10-10' }), [newer], { accountId: 'n', matchConfirmed: true })], { accounts: [newer], db, now: NOW })[0]!;
    expect(old.acksNeeded.map((x) => x.id)).toContain('older-screenshot');
    expect(old.status).toBe('needs_ack');
    const lower = planBulk([item('l', lucidShot('$25,000.00', '$24,000.00'), [c], { accountId: 'c', matchConfirmed: true })], { accounts: [c], db, now: NOW })[0]!;
    expect(lower.status).toBe('single_update');
  });
});

describe('6. trade screenshots never move the balance on their own', () => {
  it('lists screenshot trades not yet in the balance (manual journal trades are in it)', () => {
    const a = flex('a');
    const shot = makeTrade({ accountId: 'a', status: 'closed', pnl: -156, source: 'screenshot', closedAt: '2026-10-14T15:30:00Z' });
    const manual = makeTrade({ accountId: 'a', status: 'closed', pnl: 80, source: 'manual', closedAt: '2026-10-14T15:40:00Z' });
    expect(tradesAwaitingBalance(a, [shot, manual]).map((t) => t.id)).toEqual([shot.id]);
  });
});

describe('9. static vs trailing drawdown in the comparison', () => {
  it('static: floor = start − allowance regardless of balance; trailing: confirmed floor kept, never lowered', () => {
    const stat = makeAccount({ id: 's', firm: 'X', balance: 50_800, startingBalance: 50_000, cycleStartBalance: 50_000, highWaterMark: 51_000, rules: { drawdownType: 'static', maxDrawdown: 2_000 } as never });
    expect(accountFigures(stat)).toMatchObject({ floor: 48_000, remaining: 2_800 });
    const trail = flex('t', { balance: 25_400, highWaterMark: 25_400 });
    const f = accountFigures(trail);
    expect(f.floor).toBeGreaterThanOrEqual(24_270);
    expect(f.remaining).toBe(25_400 - (f.floor as number));
  });
});
