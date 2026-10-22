/**
 * The pure half of the price book (09.2.2): types, the recorded copy of 09.1.2, the
 * pricingInfos parser and the per-tier price. No node:*, no store, no fetch, so estimate.ts
 * (which ships to the browser, AC-09-7) can import it. pricing.ts re-exports all of it and adds
 * the store and network half.
 */
import type { ApifyTier } from '@/lib/schemas';

export type { ApifyTier } from '@/lib/schemas';

export type PriceEvent = {
  /** the actorChargeEvents key, e.g. 'post', 'actor-start', 'apify-actor-start' */
  name: string;
  title: string;
  /** eventPriceUsd */
  flatUsd: number | null;
  /** eventTieredPricingUsd[tier].tieredEventPriceUsd */
  tiered: Partial<Record<ApifyTier, number>> | null;
  primary: boolean;
  oneTime: boolean;
};

/** live: fetched within 24 h; cached: older (fetch failing), shown with its date; recorded: RECORDED_PRICES (2026-10-11). */
export type PriceSource = 'live' | 'cached' | 'recorded';

export type ActorPriceBook = {
  /** 'apify/instagram-post-scraper' */
  actorId: string;
  model: 'PAY_PER_EVENT' | 'PRICE_PER_DATASET_ITEM' | 'FLAT_PRICE_PER_MONTH' | 'FREE';
  entryStartedAt: string;
  events: PriceEvent[];
  minMaxTotalChargeUsd: number | null;
  /** defaultRunOptions.memoryMbytes */
  defaultMemoryMb: number;
  /** the earliest entry with startedAt in the future */
  next: { startsAt: string; events: PriceEvent[] } | null;
  source: PriceSource;
  fetchedAt: string | null;
};

/** The date RECORDED_PRICES was read from the live pricingInfos (09.1.2). */
export const RECORDED_PRICES_DATE = '2026-10-11';

const ev = (name: string, title: string, free: number, bronze: number, gold: number, o: { primary?: boolean; oneTime?: boolean } = {}): PriceEvent => ({
  name,
  title,
  flatUsd: null,
  tiered: { FREE: free, BRONZE: bronze, GOLD: gold },
  primary: Boolean(o.primary),
  oneTime: Boolean(o.oneTime),
});
const flat = (name: string, title: string, usd: number, o: { primary?: boolean; oneTime?: boolean } = {}): PriceEvent => ({
  name,
  title,
  flatUsd: usd,
  tiered: null,
  primary: Boolean(o.primary),
  oneTime: Boolean(o.oneTime),
});
const book = (actorId: string, startedAt: string, minMax: number | null, memoryMb: number, events: PriceEvent[]): ActorPriceBook => ({
  actorId,
  model: 'PAY_PER_EVENT',
  entryStartedAt: `${startedAt}T00:00:00.000Z`,
  events,
  minMaxTotalChargeUsd: minMax,
  defaultMemoryMb: memoryMb,
  next: null,
  source: 'recorded',
  fetchedAt: null,
});

/**
 * The recorded copy of 09.1.2 (read 2026-10-11 from GET /v2/acts/{id}, current entry; FREE,
 * BRONZE and GOLD per event; SILVER, PLATINUM and DIAMOND fall back to FREE through priceOf).
 * Used when nothing live is available. Update by hand only, with a dated comment.
 * The add-ons the Lab never sends (TikTok filters, AI descriptions, YouTube date filter) are left out.
 */
export const RECORDED_PRICES: Record<string, ActorPriceBook> = {
  'apify/instagram-post-scraper': book('apify/instagram-post-scraper', '2026-10-07', 0.005, 1024, [
    ev('post', 'Post', 0.0017, 0.0015, 0.001, { primary: true }),
    ev('post-details', 'Post details', 0.001, 0.0008, 0.0006),
    ev('music-data', 'Add-on: music data', 0.007, 0.006, 0.004),
  ]),
  'apify/instagram-profile-scraper': book('apify/instagram-profile-scraper', '2026-02-17', 0.0026, 1024, [
    ev('profile', 'Profile', 0.0026, 0.0023, 0.0016, { primary: true }),
    ev('about-account', 'Add-on: About account', 0.007, 0.006, 0.004),
  ]),
  'clockworks/tiktok-scraper': book('clockworks/tiktok-scraper', '2026-08-18', 0.5, 4096, [
    ev('result', 'Result', 0.0037, 0.003, 0.0017, { primary: true }),
    ev('actor-start', 'Actor start', 0.001, 0.001, 0.001, { oneTime: true }),
    ev('video-download', 'Add-on: video download', 0.0013, 0.001, 0.0006),
    ev('comment-dataset-item', 'Add-on: Comment', 0.00125, 0.001, 0.0005),
    ev('transcription-minute', 'Add-on: Transcript (per minute)', 0.048, 0.041, 0.027),
  ]),
  'streamers/youtube-scraper': book('streamers/youtube-scraper', '2026-09-02', null, 1024, [
    ev('result', 'Video', 0.004, 0.003, 0.0024, { primary: true }),
    ev('transcribeMinute', 'Add-on: transcript minute', 0.048, 0.041, 0.027),
  ]),
  'harvestapi/linkedin-profile-posts': book('harvestapi/linkedin-profile-posts', '2026-03-09', 0.002, 256, [
    ev('post', 'Post', 0.002, 0.002, 0.0015, { primary: true }),
    ev('reaction', 'Reaction', 0.002, 0.002, 0.0015),
    ev('comment', 'Comment', 0.002, 0.002, 0.0015),
    flat('no-result', '0-result query', 0.001),
    flat('apify-actor-start', 'Actor start', 0.00005, { oneTime: true }),
  ]),
  'apidojo/tweet-scraper': book('apidojo/tweet-scraper', '2026-06-09', null, 256, [flat('apify-default-dataset-item', 'tweet', 0.0004, { primary: true })]),
  'apify/instagram-comment-scraper': book('apify/instagram-comment-scraper', '2026-07-14', 0.0026, 1024, [ev('comment', 'Comment', 0.0026, 0.0023, 0.0019, { primary: true })]),
  'clockworks/tiktok-comments-scraper': book('clockworks/tiktok-comments-scraper', '2026-03-18', null, 4096, [ev('result', 'comment', 0.00125, 0.001, 0.0005, { primary: true })]),
  'streamers/youtube-comments-scraper': book('streamers/youtube-comments-scraper', '2026-03-03', 0.5, 1024, [ev('result', 'Comment', 0.002, 0.0015, 0.0009, { primary: true })]),
  'apify/instagram-hashtag-scraper': book('apify/instagram-hashtag-scraper', '2026-07-14', 0.0026, 1024, [ev('result', 'Result', 0.0026, 0.0023, 0.0019, { primary: true })]),
};

/** Price of one event for a tier. Tiered map missing the tier: the FREE price, and `fallback: true`. */
export function priceOf(e: PriceEvent, tier: ApifyTier): { usd: number; fallback: boolean } {
  if (e.flatUsd !== null && e.flatUsd !== undefined) return { usd: e.flatUsd, fallback: false };
  const t = e.tiered ?? {};
  if (typeof t[tier] === 'number') return { usd: t[tier]!, fallback: false };
  return { usd: typeof t.FREE === 'number' ? t.FREE : 0, fallback: true };
}

const startOf = (x: unknown): number => {
  const s = (x as { startedAt?: unknown } | null)?.startedAt;
  const t = typeof s === 'string' ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/** The entry with the latest startedAt <= at; `next` = earliest entry with startedAt > at. */
export function currentEntry(raw: unknown[], at: Date): { current: unknown; next: unknown | null } {
  const t = at.getTime();
  let current: unknown = null;
  let next: unknown = null;
  for (const e of raw) {
    const s = startOf(e);
    if (s <= t) {
      if (current === null || s > startOf(current)) current = e;
    } else if (next === null || s < startOf(next)) next = e;
  }
  return { current, next };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One pricingInfos entry's events (09.1.1 shape). */
export function parseEvents(entry: unknown): PriceEvent[] {
  const events = ((entry as { pricingPerEvent?: { actorChargeEvents?: Record<string, unknown> } } | null)?.pricingPerEvent?.actorChargeEvents ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(events).map(([name, e]) => {
    const tieredRaw = (e.eventTieredPricingUsd ?? null) as Record<string, { tieredEventPriceUsd?: unknown }> | null;
    let tiered: Partial<Record<ApifyTier, number>> | null = null;
    if (tieredRaw && typeof tieredRaw === 'object') {
      tiered = {};
      for (const [tier, v] of Object.entries(tieredRaw)) {
        const p = num(v?.tieredEventPriceUsd);
        if (p !== null) tiered[tier as ApifyTier] = p;
      }
    }
    return {
      name,
      title: typeof e.eventTitle === 'string' ? e.eventTitle : name,
      flatUsd: num(e.eventPriceUsd),
      tiered,
      primary: e.isPrimaryEvent === true,
      oneTime: e.isOneTimeEvent === true,
    };
  });
}

/**
 * Turn a GET /v2/acts/{id} body into a book (source 'live', fetched at `now`). Null when the
 * body carries no pricing entry in force.
 */
export function parseActorBook(actorId: string, body: unknown, now: Date): ActorPriceBook | null {
  const d = ((body as { data?: unknown } | null)?.data ?? body) as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return null;
  const infos = Array.isArray(d.pricingInfos) ? (d.pricingInfos as unknown[]) : [];
  const { current, next } = currentEntry(infos, now);
  if (!current) return null;
  const c = current as Record<string, unknown>;
  const model = (typeof c.pricingModel === 'string' ? c.pricingModel : 'FREE') as ActorPriceBook['model'];
  const mem = num((d.defaultRunOptions as { memoryMbytes?: unknown } | undefined)?.memoryMbytes) ?? RECORDED_PRICES[actorId]?.defaultMemoryMb ?? 1024;
  return {
    actorId,
    model,
    entryStartedAt: typeof c.startedAt === 'string' ? c.startedAt : now.toISOString(),
    events: parseEvents(current),
    minMaxTotalChargeUsd: num(c.minimalMaxTotalChargeUsd),
    defaultMemoryMb: mem,
    next: next ? { startsAt: String((next as { startedAt?: unknown }).startedAt), events: parseEvents(next) } : null,
    source: 'live',
    fetchedAt: now.toISOString(),
  };
}

/** Plan names for the tier label ('Live prices for your Starter plan'). */
export const TIER_PLAN_LABEL: Record<ApifyTier, string> = { FREE: 'Free', BRONZE: 'Starter', SILVER: 'Scale', GOLD: 'Business', PLATINUM: 'Enterprise', DIAMOND: 'Enterprise' };
