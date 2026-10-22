/**
 * One builder for the /trading payload (pages/trading.md §2), used by the page
 * and GET /api/trading so a refresh never shows a different picture from
 * first paint. Reads SQLite plus, only when PHANTOM_WALLET_ADDRESS is set, one
 * cached public RPC read (free). Never calls Robinhood. Sample and Filming
 * answer the fixture with zero outbound requests.
 */
import { getDb } from '@/lib/data';
import { robinhoodStatus } from '@/lib/connectors/robinhood';
import { phantomAddress, phantomStatus, readPhantom } from '@/lib/connectors/phantom';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { sampleTrading, type FoMode } from '@/lib/fo-sample';
import { AGENTIC_ID, buildView, type PhantomView, type TradingPayload } from '@/lib/trading-view';

export { AGENTIC_ID, type TradingPayload };

export async function tradingPayload(mode: FoMode, now: Date = new Date()): Promise<TradingPayload> {
  if (mode !== 'live') {
    const s = sampleTrading(now);
    const sampleStatus = (id: string, name: string): ConnectorStatus => ({ id, name, kind: 'payments', state: 'connected', detail: 'Sample data' });
    return {
      ...s,
      status: sampleStatus('robinhood', 'Robinhood'),
      phantomStatus: sampleStatus('phantom', 'Phantom'),
      view: buildView({ accounts: s.accounts, positions: s.positions, activity: s.activity, phantom: s.phantom, now: now.getTime() }),
      mode,
      sample: true,
      at: now.toISOString(),
    };
  }
  const t = getDb().trading;
  const accounts = t.latestSnapshots();
  const history = Object.fromEntries(accounts.map((a) => [a.accountId, t.history(a.accountId)]));
  const positions = t.positions();
  const activity = t.activity(50);
  const address = phantomAddress();
  // Read in parallel with nothing else to wait on; a dead RPC never blanks the board.
  const reading = await readPhantom(address);
  const phantom: PhantomView | null = reading.balance;
  return {
    accounts,
    history,
    positions,
    activity,
    analysis: t.latestAnalysis(AGENTIC_ID),
    openOrders: t.openOrders(),
    limits: t.limits(),
    status: robinhoodStatus(accounts, now),
    phantomStatus: phantomStatus(reading, address),
    phantom,
    view: buildView({ accounts, positions, activity, phantom, now: now.getTime() }),
    mode,
    sample: false,
    at: now.toISOString(),
  };
}
