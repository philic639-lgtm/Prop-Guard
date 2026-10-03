import { planBrokerImport } from '@/lib/engines/journalEngine';
import { useAppStore } from '@/store/useAppStore';
import { uuid } from '@/utils/id';

import type { BrokerId, BrokerProvider } from './provider';

export type { BrokerClosedTrade, BrokerId, BrokerProvider } from './provider';

/** Planned integrations, shown in the UI as "coming soon". */
export const PLANNED_BROKERS: { id: BrokerId; name: string }[] = [
  { id: 'tradovate', name: 'Tradovate' },
  { id: 'ninjatrader', name: 'NinjaTrader' },
  { id: 'projectx', name: 'ProjectX' },
  { id: 'rithmic', name: 'Rithmic' },
];

const providers = new Map<BrokerId, BrokerProvider>();

/** Register an integration (none ship yet). */
export function registerBroker(provider: BrokerProvider) {
  providers.set(provider.id, provider);
}

export function connectedBrokers(): BrokerProvider[] {
  return [...providers.values()];
}

export interface BrokerSyncResult {
  imported: number;
  completedPending: number;
  skipped: number;
}

/**
 * Pull completed trades from a broker and journal them with no manual entry:
 * trades that match a pending check become full journal entries with the
 * plan's strategy, checklist and rules; trades open in the live monitor are
 * closed; anything else is imported as a broker trade.
 */
export async function syncBrokerTrades(provider: BrokerProvider, accountId: string, since: Date): Promise<BrokerSyncResult> {
  const brokerTrades = await provider.fetchClosedTrades({ accountId, since });
  const state = useAppStore.getState();
  const { actions, skipped } = planBrokerImport({
    accountId,
    brokerTrades,
    pendings: state.pendingTrades,
    trades: state.trades,
    newId: uuid,
  });
  state.applyBrokerImport(actions);
  return {
    imported: actions.filter((a) => a.kind === 'import-new').length,
    completedPending: actions.filter((a) => a.kind !== 'import-new').length,
    skipped: skipped.length,
  };
}
