import { randomUUID } from 'node:crypto';
import { BRAND } from '@/lib/brand';
import { labFetch } from '@/lib/lab/net';
import type { LabFeed, LabRun, LabTrendItem } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { resolveCred } from '@/lib/creds';
import { filmingMode } from '@/lib/paths';
import { isDry } from '@/lib/lab/dry';
import { gatedCall } from '@/lib/lab/spend';
import { createApifyClient, type ApifyClient, type FetchLike } from '@/lib/lab/apify-client';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { matchText } from '@/lib/lab/clusters';

/**
 * Trend feeds (SPEC §4.1 "Trend feeds", §4.10, Q6): non-creator signals that say a topic
 * is moving before creators pile in. Each item lands in lab_trend_items, matched to a
 * topic cluster by centroid, with `sources` (every feed that carried the same story) so
 * `source_count` can feed the timing heuristic.
 *
 *   hn             HN Algolia search API (free, no key)
 *   reddit         subreddit top-of-week JSON, Atom RSS as the fallback (free, no key)
 *   producthunt    Product Hunt GraphQL v2, ONLY when PRODUCTHUNT_TOKEN resolves
 *   google_trends  Apify actor `apify/google-trends-scraper` (paid: through the spend gate)
 *
 * Free sources still respect dry: under LAB_DRY=1 or Filming nothing leaves the process
 * (no fetch at all) and fixture headlines come back instead. Filming persists them into
 * the demo world; an env-dry session on a real install returns them WITHOUT writing, so
 * fixture headlines never sit in a real Trends tab (honest or absent).
 * Every fetch is injectable for tests.
 */

export const DEFAULT_SUBREDDITS = ['LocalLLaMA', 'OpenAI', 'ClaudeAI', 'singularity'] as const;
export const DEFAULT_TERMS = ['AI agent', 'LLM', 'Claude', 'ChatGPT', 'MCP'] as const;
export const GOOGLE_TRENDS_ACTOR = 'apify/google-trends-scraper';
/** Headline to cluster: looser than topic matching (a headline carries more words than a topic). */
export const FEED_MATCH_THRESHOLD = 0.35;
const UA = `${BRAND.name}-ContentLab/1.0 (personal research tool)`;

export type FeedItem = { feed: LabFeed; externalId: string; url: string; title: string; score: number | null; comments: number | null; source: string; at: string };

/* ── parsers (pure) ───────────────────────────────────────────────────── */

export function parseHn(json: unknown): FeedItem[] {
  const hits = (json as { hits?: unknown[] })?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.flatMap((h) => {
    const r = h as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title : typeof r.story_title === 'string' ? r.story_title : '';
    const id = String(r.objectID ?? '');
    if (!title || !id) return [];
    return [{ feed: 'hn' as const, externalId: id, url: typeof r.url === 'string' && r.url ? r.url : `https://news.ycombinator.com/item?id=${id}`, title, score: typeof r.points === 'number' ? r.points : null, comments: typeof r.num_comments === 'number' ? r.num_comments : null, source: 'hn', at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString() }];
  });
}

export function parseRedditJson(json: unknown, sub: string): FeedItem[] {
  const children = (json as { data?: { children?: unknown[] } })?.data?.children;
  if (!Array.isArray(children)) return [];
  return children.flatMap((c) => {
    const d = (c as { data?: Record<string, unknown> }).data ?? {};
    if (d.stickied === true || typeof d.title !== 'string' || !d.id) return [];
    const permalink = typeof d.permalink === 'string' ? `https://www.reddit.com${d.permalink}` : '';
    return [{ feed: 'reddit' as const, externalId: String(d.id), url: permalink || String(d.url ?? ''), title: d.title, score: typeof d.score === 'number' ? d.score : null, comments: typeof d.num_comments === 'number' ? d.num_comments : null, source: `r/${sub}`, at: typeof d.created_utc === 'number' ? new Date(d.created_utc * 1000).toISOString() : new Date().toISOString() }];
  });
}

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** Reddit's Atom feed (the fallback when JSON is refused). */
export function parseRedditAtom(xml: string, sub: string): FeedItem[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap((m) => {
    const e = m[1];
    const title = decode(e.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? '';
    const id = decode(e.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? link);
    const at = decode(e.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] ?? '') || new Date().toISOString();
    if (!title || !id) return [];
    return [{ feed: 'reddit' as const, externalId: id.replace(/^t3_/, ''), url: link, title, score: null, comments: null, source: `r/${sub}`, at }];
  });
}

export function parseProductHunt(json: unknown): FeedItem[] {
  const edges = (json as { data?: { posts?: { edges?: unknown[] } } })?.data?.posts?.edges;
  if (!Array.isArray(edges)) return [];
  return edges.flatMap((e) => {
    const n = (e as { node?: Record<string, unknown> }).node ?? {};
    if (typeof n.name !== 'string' || !n.id) return [];
    return [{ feed: 'producthunt' as const, externalId: String(n.id), url: String(n.url ?? ''), title: typeof n.tagline === 'string' && n.tagline ? `${n.name}: ${n.tagline}` : n.name, score: typeof n.votesCount === 'number' ? n.votesCount : null, comments: typeof n.commentsCount === 'number' ? n.commentsCount : null, source: 'producthunt', at: typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString() }];
  });
}

/** Google Trends actor items: rising related queries become headlines (verified:false until a live run). */
export function parseGoogleTrends(items: unknown[]): FeedItem[] {
  return items.flatMap((it) => {
    const r = it as Record<string, unknown>;
    const term = typeof r.searchTerm === 'string' ? r.searchTerm : typeof r.inputUrlOrTerm === 'string' ? r.inputUrlOrTerm : '';
    const rising = Array.isArray(r.relatedQueries_rising) ? (r.relatedQueries_rising as Record<string, unknown>[]) : [];
    return rising.slice(0, 10).flatMap((q) => {
      const query = typeof q.query === 'string' ? q.query : '';
      if (!query) return [];
      const value = typeof q.value === 'number' ? q.value : Number.parseInt(String(q.formattedValue ?? q.value ?? ''), 10);
      return [{ feed: 'google_trends' as const, externalId: `${term}:${query}`.toLowerCase(), url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`, title: query, score: Number.isFinite(value) ? value : null, comments: null, source: 'google_trends', at: new Date().toISOString() }];
    });
  });
}

/* ── merge + cluster (pure over the store) ────────────────────────────── */

export function canonicalKey(i: Pick<FeedItem, 'url' | 'title'>): string {
  const u = i.url.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const isDiscussion = /news\.ycombinator\.com|reddit\.com\/r\/|trends\.google\.com/.test(u);
  return isDiscussion || !u ? `t:${i.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}` : `u:${u}`;
}

/**
 * Turn fetched items into lab_trend_items rows: one row per (feed, id), `sources` = every
 * source that carried the same story (same canonical URL or the same headline), and the
 * best-matching cluster (or null).
 */
export function toTrendItems(store: LabStore, items: readonly FeedItem[], seenAt: string): LabTrendItem[] {
  const sourcesByKey = new Map<string, Set<string>>();
  for (const i of items) {
    const k = canonicalKey(i);
    (sourcesByKey.get(k) ?? sourcesByKey.set(k, new Set()).get(k)!).add(i.source);
  }
  const seen = new Set<string>();
  const out: LabTrendItem[] = [];
  for (const i of items) {
    const id = `${i.feed}:${i.externalId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const sources = [...(sourcesByKey.get(canonicalKey(i)) ?? new Set([i.source]))].sort();
    out.push({ id, feed: i.feed, url: i.url, title: i.title.slice(0, 300), score: i.score, comments: i.comments, sources, sourceCount: sources.length, clusterId: matchText(store, i.title, FEED_MATCH_THRESHOLD)?.id ?? null, seenAt, actedOnAt: null });
  }
  return out;
}

/* ── fetchers ─────────────────────────────────────────────────────────── */

type FeedOpts = { fetch?: FetchLike; now?: Date; terms?: string[]; subreddits?: string[] };

async function getJson(f: FetchLike, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await f(url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`${url.split('?')[0]} answered ${res.status}`);
  return res.json();
}

export async function fetchHn(o: FeedOpts): Promise<FeedItem[]> {
  const f = o.fetch ?? (labFetch as unknown as FetchLike);
  const since = Math.floor(((o.now ?? new Date()).getTime() - 7 * 86_400_000) / 1000);
  const out: FeedItem[] = [];
  for (const term of o.terms ?? DEFAULT_TERMS) {
    const q = new URLSearchParams({ query: term, tags: 'story', numericFilters: `created_at_i>${since},points>20`, hitsPerPage: '30' });
    out.push(...parseHn(await getJson(f, `https://hn.algolia.com/api/v1/search?${q.toString()}`)));
  }
  return out;
}

export async function fetchReddit(o: FeedOpts): Promise<FeedItem[]> {
  const f = o.fetch ?? (labFetch as unknown as FetchLike);
  const out: FeedItem[] = [];
  for (const sub of o.subreddits ?? DEFAULT_SUBREDDITS) {
    const name = sub.replace(/^r\//, '');
    try {
      out.push(...parseRedditJson(await getJson(f, `https://www.reddit.com/r/${encodeURIComponent(name)}/top.json?t=week&limit=25`), name));
    } catch {
      const res = await f(`https://www.reddit.com/r/${encodeURIComponent(name)}/top/.rss?t=week`, { method: 'GET', headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`r/${name} answered ${res.status} on JSON and RSS`);
      out.push(...parseRedditAtom(await res.text(), name));
    }
  }
  return out;
}

export const productHuntToken = (): string | undefined => resolveCred('PRODUCTHUNT_TOKEN', []);

export async function fetchProductHunt(o: FeedOpts & { token: string }): Promise<FeedItem[]> {
  const f = o.fetch ?? (labFetch as unknown as FetchLike);
  const after = new Date((o.now ?? new Date()).getTime() - 7 * 86_400_000).toISOString();
  const query = `{ posts(order: VOTES, topic: "artificial-intelligence", first: 20, postedAfter: "${after}") { edges { node { id name tagline url votesCount commentsCount createdAt } } } }`;
  const res = await f('https://api.producthunt.com/v2/api/graphql', { method: 'POST', headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA }, body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error(`Product Hunt answered ${res.status}`);
  return parseProductHunt(await res.json());
}

/* ── fixtures (dry) ───────────────────────────────────────────────────── */

const DRY_TEMPLATES: { feed: LabFeed; source: string; t: (label: string) => string }[] = [
  { feed: 'hn', source: 'hn', t: (l) => `Show HN: an open source take on ${l.toLowerCase()}` },
  { feed: 'reddit', source: 'r/LocalLLaMA', t: (l) => `${l} is moving faster than anyone expected this week` },
  { feed: 'reddit', source: 'r/OpenAI', t: (l) => `What are you actually using ${l.toLowerCase()} for?` },
  { feed: 'google_trends', source: 'google_trends', t: (l) => l.toLowerCase() },
];

/** Deterministic fixture headlines, built from the clusters the store already has. */
export function dryFeedItems(store: LabStore, now: Date = new Date()): FeedItem[] {
  const clusters = store.clusters.all().slice(0, 6);
  return clusters.flatMap((c, ci) =>
    DRY_TEMPLATES.filter((_, ti) => (ci + ti) % 2 === 0).map((tpl, ti) => ({ feed: tpl.feed, externalId: `dry-${c.id}-${ti}`, url: `https://example.invalid/${tpl.feed}/${c.id}/${ti}`, title: tpl.t(c.label), score: 40 + ((ci * 37 + ti * 11) % 300), comments: (ci * 13 + ti * 7) % 90, source: tpl.source, at: new Date(now.getTime() - (ci + ti) * 3_600_000).toISOString() })),
  );
}

/* ── one sync of every feed ───────────────────────────────────────────── */

export type FeedSyncResult = { dry: boolean; persisted: boolean; items: LabTrendItem[]; byFeed: Record<string, number>; skipped: { feed: LabFeed; reason: string }[]; errors: { feed: LabFeed; error: string }[]; googleTrendsRun: LabRun | null };

function logRun(store: LabStore, feed: string, dry: boolean, startedAt: string, items: number, error: string | null): void {
  const id = `lrun-${randomUUID().slice(0, 12)}`;
  store.runs.insert({ id, kind: 'search', apifyRunId: null, datasetId: null, actor: `feed:${feed}`, input: {}, status: error ? 'failed' : 'succeeded', items, costUsd: 0, dry, startedAt, finishedAt: new Date().toISOString(), error });
}

/**
 * Pull every feed once. Free feeds run directly (logged as 0-cost `search` runs); Google
 * Trends goes through `gatedCall` (provider apify) and comes back pending: its items are
 * read later by `ingestGoogleTrendsRun` once Apify finished (advance-on-read).
 */
export async function syncFeeds(store: LabStore, opts: FeedOpts & { apify?: ApifyClient | null; productHuntToken?: string | null; googleTrends?: boolean; override?: boolean; scheduled?: boolean } = {}): Promise<FeedSyncResult> {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const res: FeedSyncResult = { dry: isDry(), persisted: false, items: [], byFeed: {}, skipped: [], errors: [], googleTrendsRun: null };
  const feedSources = store.sources.all('feed').filter((s) => s.status === 'active');
  const subs = opts.subreddits ?? (feedSources.filter((s) => s.platform === 'reddit').map((s) => s.handle).filter((h) => h.startsWith('r/')).length ? feedSources.filter((s) => s.platform === 'reddit' && s.handle.startsWith('r/')).map((s) => s.handle) : [...DEFAULT_SUBREDDITS]);
  const terms = opts.terms ?? [...new Set([...store.clusters.all().slice(0, 6).map((c) => c.label), ...DEFAULT_TERMS])];
  let fetched: FeedItem[] = [];

  if (res.dry) {
    fetched = dryFeedItems(store, now);
    for (const feed of ['hn', 'reddit', 'google_trends'] as const) logRun(store, feed, true, at, fetched.filter((i) => i.feed === feed).length, null);
    res.skipped.push({ feed: 'producthunt', reason: 'dry: no request leaves the process' });
  } else {
    const ff = { ...opts, terms, subreddits: subs };
    for (const [feed, run] of [['hn', () => fetchHn(ff)], ['reddit', () => fetchReddit(ff)]] as const) {
      try {
        const items = await run();
        fetched.push(...items);
        logRun(store, feed, false, at, items.length, null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.errors.push({ feed, error: msg });
        logRun(store, feed, false, at, 0, msg.slice(0, 300));
      }
    }
    const ph = opts.productHuntToken === undefined ? productHuntToken() : opts.productHuntToken;
    if (!ph) res.skipped.push({ feed: 'producthunt', reason: 'PRODUCTHUNT_TOKEN not set' });
    else {
      try {
        const items = await fetchProductHunt({ ...ff, token: ph });
        fetched.push(...items);
        logRun(store, 'producthunt', false, at, items.length, null);
      } catch (err) {
        res.errors.push({ feed: 'producthunt', error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  if (opts.googleTrends !== false && !res.dry) {
    const token = opts.apify === undefined ? resolveApifyToken() : null;
    const client = opts.apify ?? (token ? createApifyClient({ token, fetch: opts.fetch ?? (labFetch as unknown as FetchLike) }) : null);
    if (!client) res.skipped.push({ feed: 'google_trends', reason: 'Apify not configured' });
    else {
      const input = { searchTerms: terms.slice(0, 5), timeRange: 'now 7-d', isMultiple: false, maxItems: 5 };
      try {
        const out = await gatedCall(store, { provider: 'apify', line: 'apify.sync', kind: 'search', actor: GOOGLE_TRENDS_ACTOR, input, override: opts.override, scheduled: opts.scheduled, now }, {
          dry: () => ({ result: null }),
          live: async () => {
            const run = await client.startRun(GOOGLE_TRENDS_ACTOR, input, { maxItems: 5 });
            return { result: run, units: 0, actualUsd: null, apifyRunId: run.id, datasetId: run.defaultDatasetId, pending: true };
          },
        });
        res.googleTrendsRun = out.run;
      } catch (err) {
        res.errors.push({ feed: 'google_trends', error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  res.items = toTrendItems(store, fetched, at);
  for (const i of res.items) res.byFeed[i.feed] = (res.byFeed[i.feed] ?? 0) + 1;
  // persist: always on a live run; in dry only inside the Filming demo world
  if (!res.dry || filmingMode()) {
    store.transaction(() => {
      for (const i of res.items) store.trendItems.upsert(i);
    });
    res.persisted = true;
  }
  return res;
}

/** Read a finished Google Trends run's dataset into trend items (call once Apify says SUCCEEDED). */
export async function ingestGoogleTrendsRun(store: LabStore, client: ApifyClient, datasetId: string, now: Date = new Date()): Promise<LabTrendItem[]> {
  const items = toTrendItems(store, parseGoogleTrends(await client.datasetItems(datasetId, { limit: 200 })), now.toISOString());
  store.transaction(() => {
    for (const i of items) store.trendItems.upsert(i);
  });
  return items;
}
