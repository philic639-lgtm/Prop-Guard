import type { Account } from '@/types/domain';

/**
 * One authoritative account record (pure — no store, no I/O).
 *
 * Every screen (dashboard, Risk Manager, Check Trade, account details, alerts)
 * reads the same `accounts[]` entry by id. These helpers keep that record
 * correct across saves, journal updates, screenshot imports and cloud
 * hydration:
 *  - `findLikelyDuplicate`: a save never silently adds a second copy of an account.
 *  - `tradeInBalance`: a journaled trade that closed before the balance was confirmed
 *    is already part of that balance — it never moves it again.
 *  - `olderSnapshot`: an older screenshot never silently replaces newer account data.
 *  - `mergeRemoteAccounts`: cloud data never overwrites a local save that has not
 *    reached the server yet.
 *  - `verifyPersisted`: a save is reported only after the stored copy reads back.
 */

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Same firm text ("Lucid Trading", "LUCID", "Lucid") — first word, at least 3 characters. */
function sameFirm(a: string, b: string): boolean {
  const x = compact(a);
  const y = compact(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const first = (s: string) => compact(s.trim().split(/\s+/)[0] ?? '');
  const fa = first(a);
  const fb = first(b);
  return fa.length >= 3 && fa === fb;
}

export type AccountIdentity = Pick<Account, 'firm' | 'size' | 'kind'> & {
  id?: string;
  programId?: string | null;
  firmId?: string | null;
  fingerprint?: string | null;
};

/**
 * An active account that is almost certainly the same one: same firm, same size, same
 * program (or one side has no program link), and no different account number.
 */
export function findLikelyDuplicate(accounts: Account[], c: AccountIdentity): Account | null {
  if (c.kind !== 'prop' || !(c.size > 0) || !c.firm.trim()) return null;
  return (
    accounts.find((a) => {
      if (a.id === c.id || a.status !== 'active' || a.kind !== 'prop' || a.size !== c.size) return false;
      const firmMatch = (c.firmId && a.firmLink?.firmId === c.firmId) || sameFirm(a.firm, c.firm);
      if (!firmMatch) return false;
      const ap = a.firmLink?.programId ?? null;
      if (ap && c.programId && ap !== c.programId) return false;
      const af = a.importState?.fingerprint ?? null;
      if (af && c.fingerprint && af !== c.fingerprint) return false;
      return true;
    }) ?? null
  );
}

/**
 * When the current balance was confirmed by a screenshot or typed by the trader.
 * Trades that closed at or before this moment are already in the balance.
 */
export function balanceBaseline(account: Account): string | null {
  const o = account.importState?.origins?.balance;
  return o && (o.source === 'screenshot' || o.source === 'manual') ? o.at : null;
}

/** A closed trade's P&L is already part of the confirmed balance (closed before it was confirmed). */
export function tradeInBalance(account: Account, closedAt: string | null | undefined): boolean {
  const base = balanceBaseline(account);
  if (!base || !closedAt) return false;
  const t = Date.parse(closedAt);
  const b = Date.parse(base);
  return Number.isFinite(t) && Number.isFinite(b) && t <= b;
}

/**
 * The newest date the account's balance is known for (YYYY-MM-DD): the dashboard date of
 * the last confirmed screenshot, or the day the trader typed the balance.
 */
export function accountDataDate(account: Account): string | null {
  const st = account.importState;
  const typed = st?.origins?.balance?.source === 'manual' ? st.origins.balance.at : null;
  const dates = [st?.reported?.asOf ?? null, typed]
    .filter((d): d is string => !!d)
    .map((d) => d.slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return dates.length ? dates.sort()[dates.length - 1]! : null;
}

/**
 * A screenshot dashboard date older than what the account already knows. Saving it
 * would replace newer values — only after the trader explicitly confirms.
 */
export function olderSnapshot(account: Account | null, statementDate: string | null): { screenshot: string; account: string } | null {
  if (!account || !statementDate || !/^\d{4}-\d{2}-\d{2}/.test(statementDate)) return null;
  const known = accountDataDate(account);
  const shot = statementDate.slice(0, 10);
  return known && shot < known ? { screenshot: shot, account: known } : null;
}

/**
 * Cloud hydration: remote accounts replace local ones EXCEPT those with a local save that
 * has not reached the server (`unsynced`) — those stay as saved on this device and are
 * uploaded again. Accounts created on this device and not uploaded yet are kept too.
 */
export function mergeRemoteAccounts(local: Account[], remote: Account[], unsynced: string[]): { accounts: Account[]; reupload: Account[] } {
  const pending = new Set(unsynced);
  const localById = new Map(local.map((a) => [a.id, a]));
  const reupload: Account[] = [];
  const accounts = remote.map((r) => {
    const l = localById.get(r.id);
    if (l && pending.has(r.id)) {
      reupload.push(l);
      return l;
    }
    return r;
  });
  const remoteIds = new Set(remote.map((r) => r.id));
  for (const l of local) {
    if (!remoteIds.has(l.id) && pending.has(l.id)) {
      accounts.push(l);
      reupload.push(l);
    }
  }
  return { accounts, reupload };
}

/** The values a save must read back exactly (dashboard numbers). */
const SAVED_KEYS = ['balance', 'startingBalance', 'cycleStartBalance', 'highWaterMark', 'size'] as const;

/**
 * Compare the account as saved with the copy read back from storage. Returns null when
 * they agree, otherwise what differs — a save is confirmed only on null.
 */
export function verifyPersisted(expected: Account, stored: Account | null | undefined): string | null {
  if (!stored) return 'The account was not found in storage after saving.';
  for (const k of SAVED_KEYS) {
    if (Math.abs((stored[k] ?? 0) - (expected[k] ?? 0)) > 0.005) return `Stored ${k} (${stored[k]}) does not match the saved value (${expected[k]}).`;
  }
  const a = expected.importState?.threshold?.value ?? null;
  const b = stored.importState?.threshold?.value ?? null;
  if (a !== b) return 'The stored drawdown threshold does not match the saved value.';
  return null;
}
