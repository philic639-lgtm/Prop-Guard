import type { StrategyRecord } from '@/lib/engines/setupCheck';
import type { Strategy } from '@/types/domain';

/** The saved strategy as Setup Check reads it — same fields the server loads from the database. */
export function strategyRecordOf(s: Strategy): StrategyRecord {
  return {
    id: s.id,
    name: s.name,
    updatedAt: s.updatedAt,
    markets: s.markets,
    timeframe: s.timeframe,
    entryWindowStart: s.entryWindowStart,
    entryWindowEnd: s.entryWindowEnd,
    biasRequirement: s.biasRequirement,
    requiresBiasAlignment: s.requiresBiasAlignment,
    entryTrigger: s.entryTrigger,
    confirmationRules: s.confirmationRules,
    retestRules: s.retestRules,
    invalidationRules: s.invalidationRules,
    minRR: s.minRR,
    libraryId: s.libraryId ?? null,
    checklist: s.checklist.map((c) => ({ id: c.id, label: c.label, required: c.required })),
    conditions: s.structured?.testableRules?.conditions.map((c) => ({ id: c.id, role: c.role, text: c.text })),
  };
}
