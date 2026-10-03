import { checklistFromLabels, type LibraryTemplate } from '@/data/strategyLibrary';
import type { InstrumentSymbol, Strategy } from '@/types/domain';
import { uuid } from '@/utils/id';

export function strategyFromTemplate(t: LibraryTemplate, preferredMarkets?: InstrumentSymbol[]): Strategy {
  const now = new Date().toISOString();
  const overlap = preferredMarkets?.filter((m) => t.markets.includes(m)) ?? [];
  // Templates are structures, not market-specific: if the trader trades other
  // contracts (CL, GC, 6E…), apply the template to those.
  const markets = overlap.length ? overlap : preferredMarkets?.length ? preferredMarkets.slice(0, 2) : t.markets.slice(0, 2);
  // Template stop ranges are stated in S&P/Nasdaq index points; they don't transfer to other markets.
  const indexOnly = markets.every((m) => t.markets.includes(m));
  return {
    id: uuid(),
    name: t.name,
    markets,
    session: t.session,
    ...t.defaults,
    stopMethod: t.stopMethod,
    typicalStopMin: indexOnly ? t.stopRange[0] : null,
    typicalStopMax: indexOnly ? t.stopRange[1] : null,
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
