import type { PreTradeDraft } from '@/store/types';
import type { InstrumentSymbol, Strategy } from '@/types/domain';

export function newDraft(strategy: Strategy | null, instrument: InstrumentSymbol): PreTradeDraft {
  const market = strategy?.markets.includes(instrument) ? instrument : (strategy?.markets[0] ?? instrument);
  return {
    instrument: market,
    direction: 'long',
    strategyId: strategy?.id ?? null,
    bias: null,
    answers: {},
    entry: '',
    stop: '',
    target: '',
    contracts: '1',
    source: 'manual',
    screenshotUri: null,
  };
}
