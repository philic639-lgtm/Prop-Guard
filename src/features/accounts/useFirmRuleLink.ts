import { useEffect, useRef, useState } from 'react';
import type { UseFormGetValues, UseFormSetValue } from 'react-hook-form';

import type { PropFirm, PropFirmProgram } from '@/data/propFirms/types';
import { findFirm, getFirm, getProgram, importProgramRules, linkFor } from '@/lib/engines/firmRulesEngine';
import type { Account, AccountFirmLink, CustomRule, FirmRuleField, FirmRuleValues } from '@/types/domain';

import { accountToForm, type AccountFormValues } from './accountSchema';
import { useFirmRules } from './useFirmRules';

const FIRM_RULE_PREFIX = 'firm-';
export const isFirmCustomRule = (c: CustomRule) => c.id.startsWith(FIRM_RULE_PREFIX);

/**
 * Firm → program → account size → verified rules for the account form.
 * Selecting a size fills ONLY that program's verified values (and snapshots
 * them with their sources); switching firm/program clears values that were
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
  // Program (family) chosen before the account size.
  const [familyKey, setFamilyKey] = useState<string | null>(() => {
    const p = getProgram(db, existing?.firmLink?.programId);
    return p ? `${p.stage}:${p.family}` : null;
  });

  // Purchase options (e.g. Lucid "Daily Loss Limit: On/Off") and purchase date (older rule versions).
  const [options, setOptions] = useState<Record<string, string>>(() => existing?.firmLink?.options ?? {});
  const [purchasedOn, setPurchasedOn] = useState<string>(() => (existing?.firmLink?.purchasedOn ?? new Date().toISOString()).slice(0, 10));

  // Last account name Prop Guard generated (so it can follow the selection without overwriting a typed name).
  const autoName = useRef<string | null>(null);
  const autoBalance = useRef<string | null>(null);

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
    setOptions({});
    setValue('firm', f.name, { shouldDirty: true });
    setValue('kind', 'prop', { shouldDirty: true });
    setFamilyKey(null);
    setLink(linkFor(f, null, null, new Date().toISOString()));
  };

  /** Program picked: wait for the size; drop rules imported from another program. */
  const selectFamily = (key: string) => {
    if (!firm) return;
    clearImported(link?.imported);
    setValue('size', '', { shouldDirty: true });
    setFamilyKey(key);
    setLink(linkFor(firm, null, null, new Date().toISOString()));
  };

  const changeFirmText = (text: string) => {
    setValue('firm', text, { shouldDirty: true });
    if (firm && text.trim() !== firm.name) {
      clearImported(link?.imported);
      setFamilyKey(null);
      setLink(text.trim() ? linkFor(null, null, null, new Date().toISOString()) : null);
    } else if (!firm) {
      setLink(text.trim() ? linkFor(null, null, null, new Date().toISOString()) : null);
    }
  };

  /** Load THIS program's verified rules for the chosen options and purchase date (nothing from any other program). */
  const loadProgram = (p: PropFirmProgram, opts: Record<string, string>, onDate: string, f: PropFirm | null = firm) => {
    const firm = f;
    if (!firm) return;
    const now = new Date().toISOString();
    clearImported(link?.imported);
    setFamilyKey(`${p.stage}:${p.family}`);
    const prevSize = getValues('size');
    if (p.accountSize) {
      // The trader picked this size; keep the balance in step for a new account (unless they typed one).
      setValue('size', String(p.accountSize), { shouldDirty: true });
      const bal = getValues('balance');
      if (!existing && (!bal || bal === prevSize || bal === accountToForm(null).balance || bal === autoBalance.current)) {
        autoBalance.current = String(p.accountSize);
        setValue('balance', autoBalance.current, { shouldDirty: true });
      }
    }
    if (!existing) {
      // Generic starter values must not pass for this firm's rules: clear the untouched ones.
      const starter = accountToForm(null);
      for (const k of ['profitTarget', 'maxDrawdown', 'dailyLossLimit'] as const) if (getValues(k) === starter[k]) set(k, '');
    }
    const imp = importProgramRules(p, onDate, opts);
    if (imp.status === 'verified') {
      for (const [k, v] of Object.entries(imp.values) as [FirmRuleField, string][]) set(k, v);
      setCustom((cur) => [...cur.filter((c) => !isFirmCustomRule(c)), ...imp.additionalRules.map((r) => ({ id: `${FIRM_RULE_PREFIX}${r.id}`, label: r.label, ...(r.description ? { description: r.description } : {}) }))]);
    }
    // Name follows the selection unless the trader typed their own.
    const name = getValues('name').trim();
    if (!name || name === autoName.current) {
      autoName.current = `${firm.name} ${p.name}`.slice(0, 60);
      setValue('name', autoName.current, { shouldDirty: true });
    }
    setLink({ ...linkFor(firm, p, imp, now, opts), purchasedOn: onDate });
  };

  const selectProgram = (p: PropFirmProgram) => {
    // Keep only option choices this program also offers; anything else is cleared.
    const kept = Object.fromEntries(Object.entries(options).filter(([k, v]) => p.options?.some((o) => o.id === k && o.choices.some((c) => c.id === v))));
    setOptions(kept);
    loadProgram(p, kept, purchasedOn);
  };

  const selectOption = (id: string, choice: string) => {
    const next = { ...options, [id]: choice };
    setOptions(next);
    if (program) loadProgram(program, next, purchasedOn);
  };

  const changePurchasedOn = (date: string) => {
    setPurchasedOn(date);
    if (program && /^\d{4}-\d{2}-\d{2}$/.test(date)) loadProgram(program, options, date);
  };

  const customProgram = (name: string) => {
    if (!firm) return;
    if (link?.programId) clearImported(link.imported);
    setFamilyKey(null);
    setLink({ ...linkFor(firm, null, null, new Date().toISOString()), programName: name || null });
  };

  const restore = (k: FirmRuleField, v: string) => set(k, v);

  /** From a confirmed screenshot import: load the matched program (its firm comes from the program itself). */
  const loadFromImport = (programId: string, opts: Record<string, string>, onDate?: string | null) => {
    const p = getProgram(db, programId);
    const f = p ? getFirm(db, p.firmId) : null;
    if (!p || !f) return false;
    setValue('firm', f.name, { shouldDirty: true });
    setValue('kind', 'prop', { shouldDirty: true });
    const kept = Object.fromEntries(Object.entries(opts).filter(([k, v]) => p.options?.some((o) => o.id === k && o.choices.some((c) => c.id === v))));
    const date = onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : purchasedOn;
    setOptions(kept);
    setPurchasedOn(date);
    loadProgram(p, kept, date, f);
    return true;
  };

  return { db, link, firm, program, familyKey, options, purchasedOn, selectFirm, selectFamily, changeFirmText, selectProgram, selectOption, changePurchasedOn, customProgram, restore, loadFromImport };
}
