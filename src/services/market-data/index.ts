/**
 * Market-data layer entry point.
 *
 * App code may use the mock / CSV providers. DatabentoProvider and the
 * Supabase-backed store are server-side only — import them from server
 * scripts (scripts/market-data.ts) or edge functions, never from screens.
 */
import type { MarketDataProvider } from './MarketDataProvider';
import { MockHistoricalProvider } from './MockHistoricalProvider';

export * from './MarketDataProvider';
export * from './normalize';
export * from './DataCoverageService';
export * from './HistoricalBarStore';
export * from './ingestion';
export { MockHistoricalProvider } from './MockHistoricalProvider';
export { CSVHistoricalProvider, type CsvDataset } from './CSVHistoricalProvider';
export * from './ScenarioStore';
export * from './scenarioJobs';

export interface ProviderEnv {
  /** Which provider to use: "databento" | "mock" (default: databento when a key exists). */
  MARKET_DATA_PROVIDER?: string;
  DATABENTO_API_KEY?: string;
  DATABENTO_DATASET?: string;
}

/**
 * Server-side provider factory. Falls back to simulated data when no
 * credentials are configured — results are then never marked verified.
 */
export async function createServerMarketDataProvider(env: ProviderEnv): Promise<MarketDataProvider> {
  const wanted = (env.MARKET_DATA_PROVIDER ?? (env.DATABENTO_API_KEY ? 'databento' : 'mock')).toLowerCase();
  if (wanted === 'databento') {
    const { DatabentoProvider } = await import('./DatabentoProvider');
    return new DatabentoProvider({ apiKey: env.DATABENTO_API_KEY ?? '', dataset: env.DATABENTO_DATASET || undefined });
  }
  if (wanted === 'mock') return new MockHistoricalProvider();
  throw new Error(`Unknown MARKET_DATA_PROVIDER "${wanted}".`);
}
