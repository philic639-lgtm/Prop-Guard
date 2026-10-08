import { useEffect } from 'react';
import type { UseFormGetValues, UseFormSetValue } from 'react-hook-form';

import type { AccountFormValues } from '@/features/accounts/accountSchema';
import { applyImport } from '@/lib/engines/accountImport';
import type { Account } from '@/types/domain';
import { uuid } from '@/utils/id';

import { usePendingImport, type PendingImport } from './usePendingImport';

/**
 * Prefill a NEW account form from a confirmed screenshot import, then apply
 * it (balance, drawdown tracking, history) when the account is saved.
 * Verified program rules load through the normal firm-rule loader; screenshot
 * rule values are only used when no verified program matched and the trader
 * chose to save them.
 */
export function useConsumeImport(opts: {
  target: PendingImport['for'];
  setValue: UseFormSetValue<AccountFormValues>;
  getValues: UseFormGetValues<AccountFormValues>;
  loadFromImport: (programId: string, options: Record<string, string>, onDate?: string | null) => boolean;
}) {
  const stored = usePendingImport((s) => s.pending);
  const pending = stored && stored.for === opts.target ? stored : null;
  const { setValue, loadFromImport } = opts;

  useEffect(() => {
    if (!pending || pending.applied) return;
    const set = (k: keyof AccountFormValues, v: string) => setValue(k, v as never, { shouldDirty: true, shouldValidate: false });
    const loaded = pending.programId ? loadFromImport(pending.programId, pending.options, pending.startDate) : false;
    if (!loaded) {
      if (pending.firmName) set('firm', pending.firmName);
      if (pending.size) set('size', String(pending.size));
    }
    // Only present when no verified rule version applies and the trader chose to save them.
    for (const [k, v] of Object.entries(pending.rules)) if (v) set(k as keyof AccountFormValues, String(v));
    const bal = pending.confirmed.values.balance;
    if (typeof bal === 'number') set('balance', String(bal));
    else if (pending.size) set('balance', String(pending.size));
    usePendingImport.getState().markApplied();
  }, [pending, setValue, loadFromImport]);

  // Leaving the form drops an unsaved import (nothing is kept in the background).
  useEffect(() => () => usePendingImport.getState().clear(), []);

  const active = pending?.applied ? pending : null;
  /** Apply the import to the account being saved (no-op without one). */
  const finish = (account: Account): Account => (active ? applyImport(account, { ...active.confirmed, ruleUpdates: {} }, uuid()).account : account);
  return { active, finish, discard: () => usePendingImport.getState().clear() };
}
