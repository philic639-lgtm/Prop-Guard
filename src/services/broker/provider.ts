import type { BrokerClosedTrade } from '@/lib/engines/journalEngine';

export type { BrokerClosedTrade } from '@/lib/engines/journalEngine';

export type BrokerId = 'tradovate' | 'ninjatrader' | 'projectx' | 'rithmic';

/**
 * Contract every broker integration implements. Credentials and OAuth tokens
 * never live in the client: a provider calls a server-side function (like the
 * AI gateway) that holds the broker secret and returns completed trades.
 */
export interface BrokerProvider {
  readonly id: BrokerId;
  readonly name: string;
  isConnected(): Promise<boolean>;
  /**
   * Completed round-trip trades closed since `since` for the broker account
   * linked to a Prop Guard account. Fills are paired into round trips by the
   * provider (or its server function) before they reach the app.
   */
  fetchClosedTrades(args: { accountId: string; since: Date }): Promise<BrokerClosedTrade[]>;
}
