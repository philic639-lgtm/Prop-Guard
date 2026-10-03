import type { Bias, Direction, InstrumentSymbol, TradeSource } from '@/types/domain';

/** In-progress pre-trade plan. Numeric fields are kept as strings for inputs. */
export interface PreTradeDraft {
  instrument: InstrumentSymbol;
  direction: Direction;
  strategyId: string | null;
  bias: Bias | null;
  answers: Record<string, boolean | null>;
  entry: string;
  stop: string;
  target: string;
  contracts: string;
  source: TradeSource;
  screenshotUri: string | null;
}

export type AppMode = 'demo' | 'local' | 'cloud';

export interface AuthUser {
  id: string;
  email: string;
}
