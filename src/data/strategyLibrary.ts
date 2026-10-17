import type { ChecklistItem } from '@/types/domain';

import { BUILT_IN_TEMPLATES } from './strategies/catalog';
import type { StrategyTemplate } from './strategies/schema';

export * from './strategies/schema';

/**
 * Curated, EDUCATIONAL strategy frameworks. These are structures to adapt and
 * test — never presented as profitable, proven or recommended trades.
 */
export const STRATEGY_LIBRARY: StrategyTemplate[] = BUILT_IN_TEMPLATES;

const BY_ID = new Map(STRATEGY_LIBRARY.map((t) => [t.id, t]));

export function getTemplate(id: string | null | undefined): StrategyTemplate | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function checklistFromLabels(labels: string[], idPrefix: string): ChecklistItem[] {
  return labels.map((label, i) => ({ id: `${idPrefix}_${i}`, label, kind: 'yesno', required: true }));
}
