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
    name: t.shortName,
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
    sourceType: 'BUILT_IN',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * An EMPTY strategy. It deliberately carries no strategy-specific defaults
 * (no ORB window, no bias rule, no session) — earlier versions pre-filled an
 * ORB-style plan here, which leaked into strategies built from descriptions.
 */
export function blankStrategy(markets: InstrumentSymbol[] = []): Strategy {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    name: '',
    markets: [...markets],
    session: '',
    timeframe: '',
    entryWindowStart: null,
    entryWindowEnd: null,
    biasRequirement: '',
    requiresBiasAlignment: false,
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
    sourceType: 'CUSTOM',
    createdAt: now,
    updatedAt: now,
  };
}
