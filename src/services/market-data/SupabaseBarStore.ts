import type { SupabaseClient } from '@supabase/supabase-js';

import type { CoverageKey, CoverageRange } from './DataCoverageService';
import type { HistoricalBarStore } from './HistoricalBarStore';
import type { NormalizedBar, Timeframe } from './MarketDataProvider';

/**
 * SERVER-SIDE bar store backed by Supabase (service-role client). Writes go to
 * historical_bars / historical_data_coverage, which end users cannot modify.
 */
const PAGE = 1000;

export class SupabaseBarStore implements HistoricalBarStore {
  constructor(private readonly db: SupabaseClient) {}

  async upsertBars(bars: readonly NormalizedBar[]) {
    let inserted = 0;
    for (let i = 0; i < bars.length; i += PAGE) {
      const rows = bars.slice(i, i + PAGE).map((b) => ({
        instrument: b.instrument,
        timeframe: b.timeframe,
        timestamp: b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        provider: b.source,
        contract_symbol: b.contractSymbol ?? null,
        continuous_symbol: b.continuousSymbol ?? null,
      }));
      const { error, count } = await this.db
        .from('historical_bars')
        .upsert(rows, { onConflict: 'instrument,timeframe,provider,timestamp', ignoreDuplicates: true, count: 'exact' });
      if (error) throw new Error(`historical_bars upsert failed: ${error.message}`);
      inserted += count ?? 0;
    }
    return { inserted, duplicates: Math.max(0, bars.length - inserted) };
  }

  async recordCoverage(key: CoverageKey, range: CoverageRange) {
    const { error } = await this.db.from('historical_data_coverage').insert({
      instrument: key.instrument,
      timeframe: key.timeframe,
      provider: key.provider,
      range_start: range.start,
      range_end: range.end,
    });
    if (error) throw new Error(`coverage insert failed: ${error.message}`);
  }

  async getCoverage(key: CoverageKey): Promise<CoverageRange[]> {
    const { data, error } = await this.db
      .from('historical_data_coverage')
      .select('range_start, range_end')
      .eq('instrument', key.instrument)
      .eq('timeframe', key.timeframe)
      .eq('provider', key.provider);
    if (error) throw new Error(`coverage read failed: ${error.message}`);
    return (data ?? []).map((r) => ({ start: new Date(r.range_start as string).toISOString(), end: new Date(r.range_end as string).toISOString() }));
  }

  async getBars(q: { instrument: string; timeframe: Timeframe; start: string; end: string; provider?: string }) {
    const out: NormalizedBar[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = this.db
        .from('historical_bars')
        .select('*')
        .eq('instrument', q.instrument)
        .eq('timeframe', q.timeframe)
        .gte('timestamp', q.start)
        .lt('timestamp', q.end)
        .order('timestamp')
        .range(from, from + PAGE - 1);
      if (q.provider) query = query.eq('provider', q.provider);
      const { data, error } = await query;
      if (error) throw new Error(`historical_bars read failed: ${error.message}`);
      for (const r of data ?? []) {
        out.push({
          timestamp: new Date(r.timestamp as string).toISOString(),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: Number(r.volume),
          instrument: r.instrument as string,
          timeframe: r.timeframe as Timeframe,
          source: r.provider as string,
          contractSymbol: (r.contract_symbol as string | null) ?? null,
          continuousSymbol: (r.continuous_symbol as string | null) ?? null,
        });
      }
      if (!data || data.length < PAGE) break;
    }
    return out;
  }
}
