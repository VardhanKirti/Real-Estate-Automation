/**
 * Boot warm-up for the stale-while-revalidate caches (lib/swr.ts, founderos-ui SPEC 4.1 a3).
 *
 * After a restart every cache is empty, so the first visit to each live page waited for its
 * third-party calls. This runs the same reads the pages run, once, in the background as the
 * server starts (instrumentation.ts), so a first click after a restart finds a real result.
 *
 * Honest by construction: it only calls the same read functions the pages call, so what lands in
 * the cache is a real answer from the source (an unconfigured source returns before any call and
 * stores nothing). It never writes app data: the Zernio and Beehiiv reads are the fetches, not the
 * page's snapshot syncs. GET-style reads only; nothing here sends or spends. Every task is
 * independent and failures are swallowed (the page simply waits as before). GLADOS_WARM=0 turns
 * it off.
 */
import { allConnectorStatuses } from '@/lib/connectors';
import { createGBrainProvider } from '@/lib/connectors/gbrain';
import { attioClients } from '@/lib/connectors/attio';
import { zernioLiveAccounts, zernioPostDays, zernioRecentPosts } from '@/lib/connectors/zernio';
import { beehiivSubscribers } from '@/lib/connectors/beehiiv';
import { configuredProcessors, fanbasisMonthToDateIncome, monthToDateIncome, stripeSnapshot, wiseOutgoing } from '@/lib/connectors/payments';
import { unreadCounts } from '@/lib/connectors/email';
import { upcomingEvents } from '@/lib/connectors/gcal';
import { attioFunnelJourneys } from '@/lib/funnel-live';
import { ghlFunnelJourneys } from '@/lib/funnel-ghl';
import { rawLeads, skyescraperLiveProperties } from '@/lib/real-estate-live';
import { gatherCommsFeed } from '@/lib/comms-feed';
import { WHATSAPP_RECENT_ROWS, recentChats } from '@/lib/connectors/whatsapp';
import { looksLikeSolanaAddress, phantomAddress, readPhantom } from '@/lib/connectors/phantom';
import { computeSnapshot } from '@/lib/compute/miosa';
import { runtimeEnv } from '@/lib/creds';
import { isFilming } from '@/lib/demo-mode';
import { usageAvailability } from '@/lib/usage-guard';
import { readLocalUsage } from '@/lib/usage';

export type WarmTask = { name: string; run: () => Promise<unknown> };
export type WarmResult = { name: string; ok: boolean; ms: number };

/** The reads the live pages make on render, in the shape they make them (same cache keys). */
export function warmTasks(): WarmTask[] {
  const env = runtimeEnv();
  const now = new Date();
  const brain = createGBrainProvider();
  const tasks: WarmTask[] = [
    // Home, Integrations, Setup, Blueprint
    { name: 'connectors', run: () => allConnectorStatuses() },
    // Optimal Engine (doctor, then stats when the store answers, as /brain does)
    { name: 'gbrain', run: async () => ((await brain.overview()).doctor.connected ? brain.stats() : null) },
    // Funnel
    { name: 'attio-funnel', run: () => attioFunnelJourneys(now) },
    { name: 'ghl-funnel', run: () => ghlFunnelJourneys(now) },
    // Skyescraper: /funnel's provider and the real-estate dashboard's leads
    // panel share this one call (lib/real-estate-live.ts); brokers derives
    // from the same cached result, so warming leads warms brokers too.
    { name: 'skyescraper-leads', run: () => rawLeads() },
    { name: 'skyescraper-properties', run: () => skyescraperLiveProperties() },
    // Optimal Engine knowledge graph roster
    { name: 'attio-clients', run: () => attioClients() },
    // Compute
    { name: 'compute', run: () => computeSnapshot() },
    // Home (200) and Comms (140) ask the feed for the same per-source pulls
    { name: 'comms-feed', run: () => gatherCommsFeed(140) },
    { name: 'calendar', run: () => upcomingEvents(env, { days: 7, limit: 200, now }) },
    { name: 'email-unread', run: () => unreadCounts(env) },
    // Social and Analytics (the fetches only; the pages write today's snapshot themselves)
    { name: 'zernio-accounts', run: () => zernioLiveAccounts() },
    { name: 'zernio-posts', run: () => zernioRecentPosts(5) },
    { name: 'zernio-post-days', run: () => zernioPostDays() },
    { name: 'beehiiv', run: () => beehiivSubscribers(env) },
  ];
  // Usage: the first transcript scan (seconds on a large ~/.claude) runs here, not on the first visit (U-4).
  // Off on demo and filming instances, where Usage reads nothing (U-1).
  if (usageAvailability().available) tasks.push({ name: 'usage', run: () => readLocalUsage() });
  // WhatsApp chat list (the desktop database, read in a child process): the feed reads it through the
  // same cache key; warmed on its own so a first Home render never waits on it. Filming reads nothing real.
  if (!isFilming()) tasks.push({ name: 'whatsapp-chats', run: () => recentChats(WHATSAPP_RECENT_ROWS) });
  // Trading: the Phantom balance (a public RPC, up to 8 s), so /trading never waits on it after boot.
  // No address, no task (the read makes no call without one); sample/filming Trading reads none.
  const wallet = phantomAddress();
  if (!isFilming() && wallet && looksLikeSolanaAddress(wallet)) tasks.push({ name: 'phantom', run: () => readPhantom(wallet) });
  // Money: Home, Finances, Analytics. Filming never touches the live processors (as the pages).
  if (!isFilming()) {
    if (configuredProcessors(env).some((p) => p.id === 'stripe' && p.configured)) {
      tasks.push({ name: 'stripe-mtd', run: () => monthToDateIncome(env) });
      tasks.push({ name: 'stripe-snapshot', run: () => stripeSnapshot(env) });
    }
    tasks.push({ name: 'fanbasis', run: () => Promise.all([fanbasisMonthToDateIncome(env.FANBASIS_KEY_1), fanbasisMonthToDateIncome(env.FANBASIS_KEY_2)]) });
    tasks.push({ name: 'wise', run: () => wiseOutgoing(env) });
  }
  return tasks;
}

/** Run every task at once; never throws. Resolves when all have settled. */
export async function warmCaches(tasks: WarmTask[] = warmTasks()): Promise<WarmResult[]> {
  return Promise.all(
    tasks.map(async (t) => {
      const t0 = Date.now();
      try {
        await t.run();
        return { name: t.name, ok: true, ms: Date.now() - t0 };
      } catch {
        return { name: t.name, ok: false, ms: Date.now() - t0 };
      }
    }),
  );
}

/** Off with GLADOS_WARM=0, under vitest, and during `next build`. */
export function warmEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.GLADOS_WARM === '0' || env.VITEST === 'true') return false;
  if (env.NEXT_PHASE === 'phase-production-build') return false;
  return true;
}
