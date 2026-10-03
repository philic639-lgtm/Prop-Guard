import { z } from 'zod';

import type { Account, DrawdownType } from '@/types/domain';
import { numToInput, parseNum } from '@/utils/format';

const money = (msg: string) => z.string().refine((v) => (parseNum(v) ?? -1) > 0, msg);
const optionalMoney = z.string().refine((v) => v.trim() === '' || (parseNum(v) ?? -1) >= 0, 'Enter a valid amount');
const optionalInt = z.string().refine((v) => v.trim() === '' || (Number.isInteger(parseNum(v)) && (parseNum(v) ?? 0) > 0), 'Whole number');

export const accountSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the account').max(60),
    firm: z.string().trim().max(60),
    kind: z.enum(['prop', 'personal']),
    size: money('Enter the account size'),
    balance: money('Enter the current balance'),
    profitTarget: optionalMoney,
    maxDrawdown: optionalMoney,
    drawdownType: z.enum(['static', 'trailing', 'eod_trailing']),
    dailyLossLimit: optionalMoney,
    maxContracts: optionalInt,
    consistencyPct: z.string().refine((v) => v.trim() === '' || ((parseNum(v) ?? 0) > 0 && (parseNum(v) ?? 0) <= 100), '1–100'),
    minTradingDays: optionalInt,
    payoutThreshold: optionalMoney,
  })
  .refine((v) => (parseNum(v.maxDrawdown) ?? 0) < (parseNum(v.size) ?? Infinity), {
    message: 'Drawdown must be smaller than the account size',
    path: ['maxDrawdown'],
  });

export type AccountFormValues = z.infer<typeof accountSchema>;

export function accountToForm(a: Account | null, defaults?: Partial<AccountFormValues>): AccountFormValues {
  if (!a) {
    return {
      name: '',
      firm: '',
      kind: 'prop',
      size: '25000',
      balance: '25000',
      profitTarget: '1500',
      maxDrawdown: '1500',
      drawdownType: 'eod_trailing',
      dailyLossLimit: '500',
      maxContracts: '',
      consistencyPct: '',
      minTradingDays: '',
      payoutThreshold: '',
      ...defaults,
    };
  }
  return {
    name: a.name,
    firm: a.firm,
    kind: a.kind,
    size: String(a.size),
    balance: String(a.balance),
    profitTarget: numToInput(a.rules.profitTarget),
    maxDrawdown: numToInput(a.rules.maxDrawdown),
    drawdownType: a.rules.drawdownType,
    dailyLossLimit: numToInput(a.rules.dailyLossLimit),
    maxContracts: numToInput(a.rules.maxContracts),
    consistencyPct: numToInput(a.rules.consistencyPct),
    minTradingDays: numToInput(a.rules.minTradingDays),
    payoutThreshold: numToInput(a.rules.payoutThreshold),
  };
}

/**
 * @param drawdownRemaining Optional current buffer (e.g. from a dashboard). When given for a
 * trailing account, the high-water mark is derived so the engine reproduces that buffer.
 */
export function formToAccount(v: AccountFormValues, base: Account | null, id: string, drawdownRemaining?: number | null): Account {
  const size = parseNum(v.size)!;
  const balance = parseNum(v.balance)!;
  const maxDd = parseNum(v.maxDrawdown);
  const derivedHwm =
    drawdownRemaining != null && maxDd != null && v.drawdownType !== 'static' ? Math.max(size, balance + maxDd - drawdownRemaining) : null;
  return {
    id,
    name: v.name,
    firm: v.firm,
    kind: v.kind,
    size,
    startingBalance: base?.startingBalance ?? size,
    balance,
    cycleStartBalance: base?.cycleStartBalance ?? size,
    highWaterMark: derivedHwm ?? Math.max(base?.highWaterMark ?? 0, balance, base ? 0 : size),
    status: base?.status ?? 'active',
    createdAt: base?.createdAt ?? new Date().toISOString(),
    rules: {
      dailyLossLimit: parseNum(v.dailyLossLimit),
      maxDrawdown: parseNum(v.maxDrawdown),
      drawdownType: v.drawdownType as DrawdownType,
      trailingLocksAtStart: derivedHwm != null ? false : (base?.rules.trailingLocksAtStart ?? true),
      profitTarget: parseNum(v.profitTarget),
      maxContracts: parseNum(v.maxContracts),
      consistencyPct: parseNum(v.consistencyPct),
      minTradingDays: parseNum(v.minTradingDays),
      maxTradingDays: base?.rules.maxTradingDays ?? null,
      payoutThreshold: parseNum(v.payoutThreshold),
      custom: base?.rules.custom ?? [],
    },
  };
}
