/**
 * Server builder for the /trading page (pages/trading.md). One fetch feeds
 * every tree: app/trading/page.tsx calls this, picks a tree, and the tree only
 * renders the returned model. The Bennett Legacy tree joins later by adding a
 * branch to the page; nothing here changes.
 */
import { getDb } from '@/lib/data';
import { foMode } from '@/lib/fo-sample';
import { BRAND } from '@/lib/brand';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { tradingPayload } from '@/lib/trading-payload';
import { tradingModel, type TradingModel } from '@/lib/trading-model';

export type TradingSearch = { sample?: string; acct?: string; log?: string };

/** The push endpoint the Markets agent posts to (the path; the browser adds its origin). Never the token. */
export const TRADING_PUSH_PATH = '/api/trading/snapshot';

export type TradingPage =
  | {
      ok: true;
      model: TradingModel;
      pushPath: string;
      setup: { robinhood: string; phantom: string };
    }
  | { ok: false; error: string };

export async function buildTradingPage(search: TradingSearch = {}, now: Date = new Date()): Promise<TradingPage> {
  try {
    const qs = new URLSearchParams();
    if (search.sample) qs.set('sample', search.sample);
    const mode = foMode(`http://localhost/trading?${qs}`, getDb().trading.isEmpty());
    const payload = await tradingPayload(mode, now);
    return {
      ok: true,
      model: tradingModel(payload, { now: now.getTime(), acct: search.acct ?? null, log: search.log ?? null, brandName: BRAND.name }),
      pushPath: TRADING_PUSH_PATH,
      setup: { robinhood: setupHrefFor('robinhood'), phantom: setupHrefFor('phantom') },
    };
  } catch (e) {
    // The store itself is unreachable: a real problem, shown as the page error (§3 Error).
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
