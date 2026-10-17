/**
 * Prop Guard historical market-data jobs (SERVER-SIDE ONLY).
 *
 *   npm run data:ingest   -- --instrument ES --timeframe 1m --start 2025-01-02 --end 2025-02-01
 *   npm run data:generate -- --strategy orb-15 --instrument ES --start 2025-01-02 --end 2025-02-01
 *   npm run data:coverage -- --instrument ES --timeframe 1m
 *
 * Environment (never EXPO_PUBLIC_*):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → persist to Supabase (omit for an in-memory dry run)
 *   DATABENTO_API_KEY                         → real data; without it the SIMULATED mock provider is used
 *   MARKET_DATA_PROVIDER=databento|mock       → optional override
 */
import { createClient } from '@supabase/supabase-js';

import {
  createServerMarketDataProvider,
  DataCoverageService,
  generateHistoricalScenarios,
  InMemoryBarStore,
  InMemoryScenarioStore,
  ingestHistoricalData,
  TIMEFRAMES,
  type HistoricalBarStore,
  type ScenarioStore,
  type Timeframe,
} from '@/services/market-data';
import { SupabaseBarStore } from '@/services/market-data/SupabaseBarStore';
import { SupabaseScenarioStore } from '@/services/market-data/ScenarioStore';

type Args = Record<string, string>;

function parseArgs(argv: string[]): { cmd: string; args: Args } {
  const [cmd = 'help', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      args[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    }
  }
  return { cmd, args };
}

function need(args: Args, key: string): string {
  const v = args[key];
  if (!v) throw new Error(`Missing --${key}`);
  return v;
}

/** Dates are ET session dates; ranges are [start 00:00 UTC, end 00:00 UTC). */
const day = (d: string) => new Date(`${d}T00:00:00Z`).toISOString();

function stores(): { barStore: HistoricalBarStore; scenarioStore: ScenarioStore; persistent: boolean } {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    return { barStore: new SupabaseBarStore(db), scenarioStore: new SupabaseScenarioStore(db), persistent: true };
  }
  console.warn('⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — running an in-memory DRY RUN (nothing is saved).');
  return { barStore: new InMemoryBarStore(), scenarioStore: new InMemoryScenarioStore(), persistent: false };
}

async function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));
  const provider = await createServerMarketDataProvider({
    MARKET_DATA_PROVIDER: args.provider ?? process.env.MARKET_DATA_PROVIDER,
    DATABENTO_API_KEY: process.env.DATABENTO_API_KEY,
    DATABENTO_DATASET: process.env.DATABENTO_DATASET,
  });
  console.log(`Provider: ${provider.displayName} (${provider.verified ? 'VERIFIED market data' : 'SIMULATED — not real market data'})`);
  const { barStore, scenarioStore, persistent } = stores();
  const log = (m: string) => console.log(m);

  if (cmd === 'ingest' || cmd === 'pipeline') {
    const timeframe = (args.timeframe ?? '1m') as Timeframe;
    if (!TIMEFRAMES.includes(timeframe)) throw new Error(`--timeframe must be one of ${TIMEFRAMES.join(', ')}`);
    const res = await ingestHistoricalData(
      { instrument: need(args, 'instrument'), timeframe, startDate: day(need(args, 'start')), endDate: day(need(args, 'end')) },
      { provider, store: barStore, chunkDays: Number(args.chunkDays ?? 7), log },
    );
    console.log(JSON.stringify({ ...res, persistent }, null, 2));
    if (cmd === 'ingest') return;
  }
  if (cmd === 'generate' || cmd === 'pipeline') {
    const res = await generateHistoricalScenarios(
      {
        strategyId: need(args, 'strategy'),
        instrument: need(args, 'instrument'),
        startDate: day(need(args, 'start')),
        endDate: day(need(args, 'end')),
        timeframe: (args.chartTimeframe ?? '5m') as Timeframe,
        sourceTimeframe: (args.timeframe ?? '1m') as Timeframe,
      },
      { barStore, scenarioStore, provider, log },
    );
    const { sample, ...summary } = res;
    console.log(JSON.stringify({ ...summary, persistent, sampleIds: sample.map((s) => s.id) }, null, 2));
    if (!persistent) console.log('ℹ Dry run: use `pipeline` to ingest + generate in one process without Supabase.');
    return;
  }
  if (cmd === 'coverage') {
    const key = { instrument: need(args, 'instrument'), timeframe: (args.timeframe ?? '1m') as Timeframe, provider: provider.id };
    console.log(JSON.stringify(await new DataCoverageService(barStore).covered(key), null, 2));
    return;
  }
  console.log('Commands: ingest | generate | pipeline | coverage   (see header of scripts/market-data.ts)');
}

main().catch((e) => {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
});
