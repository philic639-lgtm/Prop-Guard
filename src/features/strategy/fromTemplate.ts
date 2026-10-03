import { checklistFromLabels, type LibraryTemplate } from '@/data/strategyLibrary';
import type { InstrumentSymbol, Strategy } from '@/types/domain';
import { uuid } from '@/utils/id';

export function strategyFromTemplate(t: LibraryTemplate, preferredMarkets?: InstrumentSymbol[]): Strategy {
  const now = new Date().toISOString();
  const markets = preferredMarkets?.filter((m) => t.markets.includes(m)) ?? [];
  return {
    id: uuid(),
    name: t.name,
    markets: markets.length ? markets : t.markets.slice(0, 2),
    session: t.session,
    ...t.defaults,
    stopMethod: t.stopMethod,
    typicalStopMin: t.stopRange[0],
    typicalStopMax: t.stopRange[1],
    notes: '',
    checklist: checklistFromLabels(t.checklist, t.id),
    source: 'library',
    libraryId: t.id,
    createdAt: now,
    updatedAt: now,
  };
}

export function blankStrategy(): Strategy {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    name: '',
    markets: ['ES', 'MES'],
    session: 'NY Open',
    timeframe: '',
    entryWindowStart: '09:45',
    entryWindowEnd: '10:45',
    biasRequirement: '1H trend',
    requiresBiasAlignment: true,
    entryTrigger: '',
    confirmationRules: '',
    retestRules: '',
    stopMethod: '',
    typicalStopMin: null,
    typicalStopMax: null,
    targetMethod: '',
    minRR: 2,
    maxTrades: 1,
    invalidationRules: '',
    notes: '',
    checklist: [],
    source: 'custom',
    createdAt: now,
    updatedAt: now,
  };
}
