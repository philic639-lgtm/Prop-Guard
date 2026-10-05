import { useEffect, useState } from 'react';
import type { UseFormGetValues, UseFormSetValue } from 'react-hook-form';

import type { PropFirm, PropFirmProgram } from '@/data/propFirms/types';
import { findFirm, getFirm, getProgram, importProgramRules, linkFor } from '@/lib/engines/firmRulesEngine';
import type { Account, AccountFirmLink, CustomRule, FirmRuleField, FirmRuleValues } from '@/types/domain';

import { accountToForm, type AccountFormValues } from './accountSchema';
import { useFirmRules } from './useFirmRules';

const FIRM_RULE_PREFIX = 'firm-';
export const isFirmCustomRule = (c: CustomRule) => c.id.startsWith(FIRM_RULE_PREFIX);

/**
 * Firm → program → verified rules for the account form. Selecting a program
 * fills ONLY verified values; switching firm/program clears values that were
 * imported and left untouched, so a previous firm's rules never linger.
 */
export function useFirmRuleLink({
  existing,
  setValue,
  getValues,
  setCustom,
}: {
  existing: Account | null;
  setValue: UseFormSetValue<AccountFormValues>;
  getValues: UseFormGetValues<AccountFormValues>;
  setCustom: (update: (cur: CustomRule[]) => CustomRule[]) => void;
}) {
  const db = useFirmRules((s) => s.db);
  useEffect(() => {
    void useFirmRules.getState().refresh();
  }, []);

  const [link, setLink] = useState<AccountFirmLink | null>(() => {
    if (existing?.firmLink) return existing.firmLink;
    const known = findFirm(db, existing?.firm);
    return known ? linkFor(known, null, null, new Date().toISOString()) : null;
  });
  const firm = getFirm(db, link?.firmId);
  const program = getProgram(db, link?.programId);

  const set = (k: FirmRuleField, v: string) => setValue(k as keyof AccountFormValues, v as never, { shouldDirty: true, shouldValidate: false });

  /** Remove previously imported values the trader did not change. */
  const clearImported = (prev: FirmRuleValues | undefined) => {
    if (!prev) return;
    const current = getValues();
    for (const [k, v] of Object.entries(prev) as [FirmRuleField, string][]) {
      if (k === 'size' || k === 'drawdownType') continue;
      if (String(current[k as keyof AccountFormValues] ?? '') === v) set(k, '');
    }
    setCustom((cur) => cur.filter((c) => !isFirmCustomRule(c)));
  };

  const selectFirm = (f: PropFirm) => {
    clearImported(link?.imported);
    setValue('firm', f.name, { shouldDirty: true });
    setValue('kind', 'prop', { shouldDirty: true });
    setLink(linkFor(f, null, null, new Date().toISOString()));
  };

  const changeFirmText = (text: string) => {
    setValue('firm', text, { shouldDirty: true });
    if (firm && text.trim() !== firm.name) {
      clearImported(link?.imported);
      setLink(text.trim() ? linkFor(null, null, null, new Date().toISOString()) : null);
    } else if (!firm) {
      setLink(text.trim() ? linkFor(null, null, null, new Date().toISOString()) : null);
    }
  };

  const selectProgram = (p: PropFirmProgram) => {
    if (!firm) return;
    const now = new Date().toISOString();
    clearImported(link?.imported);
    const prevSize = getValues('size');
    if (p.accountSize) {
      // The trader picked this size; keep the balance in step for a new account.
      setValue('size', String(p.accountSize), { shouldDirty: true });
      if (!existing && (getValues('balance') === prevSize || !getValues('balance'))) setValue('balance', String(p.accountSize), { shouldDirty: true });
    }
    if (!existing) {
      // Generic starter values must not pass for this firm's rules: clear the untouched ones.
      const starter = accountToForm(null);
      for (const k of ['profitTarget', 'maxDrawdown', 'dailyLossLimit'] as const) if (getValues(k) === starter[k]) set(k, '');
    }
    const imp = importProgramRules(p, now);
    if (imp.status === 'verified') {
      for (const [k, v] of Object.entries(imp.values) as [FirmRuleField, string][]) set(k, v);
      setCustom((cur) => [...cur.filter((c) => !isFirmCustomRule(c)), ...imp.additionalRules.map((r) => ({ id: `${FIRM_RULE_PREFIX}${r.id}`, label: r.label, ...(r.description ? { description: r.description } : {}) }))]);
    }
    if (!getValues('name').trim()) setValue('name', `${firm.name} ${p.name}`.slice(0, 60), { shouldDirty: true });
    setLink(linkFor(firm, p, imp, now));
  };

  const customProgram = (name: string) => {
    if (!firm) return;
    if (link?.programId) clearImported(link.imported);
    setLink({ ...linkFor(firm, null, null, new Date().toISOString()), programName: name || null });
  };

  const restore = (k: FirmRuleField, v: string) => set(k, v);

  return { db, link, firm, program, selectFirm, changeFirmText, selectProgram, customProgram, restore };
}
