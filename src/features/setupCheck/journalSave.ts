import { buildPendingTrade } from '@/lib/engines/journalEngine';
import type { SetupDecision } from '@/lib/engines/setupCheck';
import type { Account, InstrumentSymbol, PendingTrade, SetupCheck } from '@/types/domain';

/**
 * SAVE TO JOURNAL for a Setup Check.
 * - QUALIFIED → the full analysis + a PENDING journal trade (planned, not
 *   executed: the result is added later, exactly like other checked trades).
 * - WAIT / STAND DOWN / BLOCKED / needs input → a SETUP REVIEW only. No trade
 *   is created, so avoided setups are kept without pretending they were taken.
 */
export function buildJournalSave(a: { check: SetupCheck; decision: SetupDecision; account: Account | null; pendingId: string; now: Date }): { setupCheck: SetupCheck; pendingTrade: PendingTrade | null } {
  const d = a.decision;
  const qualified = d.status === 'QUALIFIED';
  const setupType = `${d.strategyName.startsWith('ICC') ? 'ICC' : d.strategyName} — ${d.stage.label}`;
  const setupCheck: SetupCheck = { ...a.check, setupDecision: d, kind: qualified ? 'trade_plan' : 'setup_review', setupType };
  const f = a.check.inputs;
  const side = a.check.direction === 'long' || a.check.direction === 'short' ? a.check.direction : null;
  const snap =
    qualified && a.account && side
      ? buildPendingTrade({
          id: a.pendingId,
          accountId: a.account.id,
          strategyId: a.check.strategyId || null,
          instrument: a.check.instrument as InstrumentSymbol,
          direction: side,
          entry: f.entry,
          stop: f.stop,
          target: f.target,
          contracts: f.quantity,
          accountBalance: a.account.balance,
          origin: 'setup_check',
          checklist: d.match.conditions.map((c) => ({ itemId: c.id, label: c.label, value: c.state === 'matched' })),
          rulesFollowed: d.match.matched.map((c) => c.id),
          rulesViolated: d.match.failed.map((c) => c.id),
          setupScore: d.match.score,
          setupGrade: null,
          notes: a.check.notes,
          screenshotUri: a.check.screenshotUri,
          now: a.now,
        })
      : null;
  return { setupCheck: snap ? { ...setupCheck, saved: true } : setupCheck, pendingTrade: snap ? { ...snap, setupCheckId: a.check.id } : null };
}
