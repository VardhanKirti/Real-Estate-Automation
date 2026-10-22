import { LabPlatformSchema, type LabPlatform, type LabReadKind, type LabRun, type LabRunProgress, type LabSource } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { ApifyError, POST_ACTORS, PRIMARY_EVENT, PROFILE_ACTORS, SCRAPE_DEPTH, SINGLE_RUN_ACTORS, isTerminal, labRunStatus, type ApifyClient } from '@/lib/lab/apify-client';
import { normalizeItems, normalizeProfile } from '@/lib/lab/normalize';
import { capFor, gatedCall, monthSpend, settleSpend, type GateEstimate } from '@/lib/lab/spend';
import { recomputeMeasures } from '@/lib/lab/compute';
import { isDry } from '@/lib/lab/dry';
import { isBlocked, fileVerifyRun, type VerifyRunInput } from '@/lib/lab/measure/actors';
import { assignVerdicts } from '@/lib/lab/measure/case-control';
import { epochOf } from '@/lib/lab/measure/platform';
import { wordCount, wpmOf } from '@/lib/lab/measures';
import { dryPostItems, dryProfileItems, type DryTarget } from '@/lib/lab/dry-items';
import { ingestSearch } from '@/lib/lab/discover';
import { GOOGLE_TRENDS_ACTOR, parseGoogleTrends, toTrendItems } from '@/lib/lab/feeds';
import { ingestRadarRun, isRadarActor } from '@/lib/lab/radar/ingest';

/**
 * The scrape cycle (SPEC §4.2, §4.3; CONTRACT.md "Phase 1 sync").
 *
 *   planScrape   which sources are due, at what depth, grouped into one actor run per
 *                platform and depth (pure over the store and the clock)
 *   startScrapes every group through the ONE spend gate (gatedCall). Live: Apify accepts
 *                the run and the lab_runs row stays `running` with its Apify run id; no
 *                in-request polling. Dry: fixture items in the actor's raw shape are
 *                ingested on the spot and a 0-cost dry ledger row is written.
 *   advanceRuns  advance-on-read: GET /api/lab/runs and the CLI move every open run older
 *                than 15 s forward (getRun → datasetItems → ingest → settleSpend with the
 *                run's own usageTotalUsd), like lib/creative-engine/generate.ts.
 *   ingest*      normalizeItems → posts.upsert on (platform, external_id) → an append-only
 *                metrics row per read → creator snapshot → recomputeMeasures.
 *
 * Defaults (SPEC §4.2): a creator's first scrape reads 50 posts, then 15 newest per cycle;
 * owned every cycle, tracked once a day, a suggestion once at 10. Re-sampling: the cycle
 * depth grows to cover every post younger than 14 days (newest-N re-reads them), capped at
 * the first-scrape depth. Profiles: one profile run per cycle where the post items carry
 * no follower count (Instagram); TikTok, YouTube, X and LinkedIn items carry the author
 * block, read at ingest. Either way each cycle writes one lab_creator_snapshots row per
 * source that returned a count.
 *
 * lab_runs.input for a scrape: { platform, sourceIds, limit, actorInput } — the actor input
 * is what was sent to Apify; the rest lets advance-on-read route the items back.
 */

export const RESAMPLE_DAYS = 14;
/** Tracked creators are read "daily"; 20 h of slack keeps a fixed daily schedule from skipping a day. */
export const TRACKED_EVERY_H = 20;
/** Runs younger than this are not polled (they cannot have finished). */
export const ADVANCE_MIN_AGE_S = 15;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type ScrapeGroup = { kind: 'scrape'; platform: LabPlatform; actorId: string; limit: number; sources: LabSource[]; actorInput: Record<string, unknown> };
export type ProfileGroup = { kind: 'profile'; platform: LabPlatform; actorId: string; sources: LabSource[]; actorInput: Record<string, unknown> };
/** v2 (04 2.3): `unverified` lists the platforms left out because their actor's field report is missing or failed. */
export type SyncPlan = { scrapes: ScrapeGroup[]; profiles: ProfileGroup[]; unverified?: { platform: LabPlatform; actorId: string }[] };

/** Depth for one source this cycle; null = not due. Pure. */
export function depthFor(s: { kind: LabSource['kind'] }, facts: { posts: number; youngPosts: number; lastScrapedAt: string | null }, now: Date, force = false): number | null {
  if (s.kind === 'feed') return null;
  if (s.kind === 'suggested') return facts.posts > 0 || facts.lastScrapedAt ? null : SCRAPE_DEPTH.suggestion;
  // a source with fewer posts than one cycle has never had its first full read (an accepted suggestion has its 10-post sample only)
  if (facts.posts < SCRAPE_DEPTH.cycle) return SCRAPE_DEPTH.first;
  if (s.kind === 'tracked' && !force && facts.lastScrapedAt && now.getTime() - Date.parse(facts.lastScrapedAt) < TRACKED_EVERY_H * HOUR) return null;
  return Math.min(SCRAPE_DEPTH.first, Math.max(SCRAPE_DEPTH.cycle, facts.youngPosts + 1));
}

/** When each source was last read by a successful scrape (from the run log, last 30 days). */
export function lastScrapedAt(store: LabStore, now: Date): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of store.runs.since(new Date(now.getTime() - 30 * DAY).toISOString(), 'scrape')) {
    if (r.status !== 'succeeded' && r.status !== 'running' && r.status !== 'queued') continue;
    const ids = (r.input as { sourceIds?: unknown } | null)?.sourceIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) if (typeof id === 'string' && !out.has(id)) out.set(id, r.startedAt);
  }
  return out;
}

/**
 * `override` passes 04 2.3's actor check (an actor reported missing or failed by verify-actors);
 * `checkActors` defaults to on outside dry and Filming (they skip the check).
 */
export type PlanOpts = { platforms?: readonly LabPlatform[]; force?: boolean; downloadVideos?: boolean; override?: boolean; checkActors?: boolean };

/** Which sources are due and how deep, one actor run per (platform, depth). */
export function planScrape(store: LabStore, now: Date, opts: PlanOpts = {}): SyncPlan {
  const last = lastScrapedAt(store, now);
  const youngCutoff = new Date(now.getTime() - RESAMPLE_DAYS * DAY).toISOString();
  const groups = new Map<string, ScrapeGroup>();
  const profileSources = new Map<LabPlatform, LabSource[]>();
  const checkActors = (opts.checkActors ?? !isDry()) && !opts.override;
  const unverified = new Map<LabPlatform, string>();
  for (const s of store.sources.all()) {
    if (s.status !== 'active') continue;
    const platform = LabPlatformSchema.safeParse(s.platform);
    if (!platform.success) continue;
    if (opts.platforms && !opts.platforms.includes(platform.data)) continue;
    if (checkActors && isBlocked(store, POST_ACTORS[platform.data].actorId)) {
      unverified.set(platform.data, POST_ACTORS[platform.data].actorId);
      continue;
    }
    const posts = store.posts.bySource(s.id);
    const limit = depthFor(s, { posts: posts.length, youngPosts: posts.filter((p) => (p.postedAt ?? '') >= youngCutoff).length, lastScrapedAt: last.get(s.id) ?? null }, now, opts.force);
    if (limit === null) continue;
    const key = `${platform.data}|${limit}`;
    const actor = POST_ACTORS[platform.data];
    const g = groups.get(key) ?? { kind: 'scrape' as const, platform: platform.data, actorId: actor.actorId, limit, sources: [], actorInput: {} };
    g.sources.push(s);
    groups.set(key, g);
    if (s.kind !== 'suggested' && PROFILE_ACTORS[platform.data]) (profileSources.get(platform.data) ?? profileSources.set(platform.data, []).get(platform.data)!).push(s);
  }
  const scrapes = [...groups.values()].map((g) => ({ ...g, actorInput: POST_ACTORS[g.platform].buildInput(g.sources.map((s) => s.handle), g.limit, { downloadVideos: opts.downloadVideos }) }));
  const profiles: ProfileGroup[] = [...profileSources].map(([platform, sources]) => {
    const actor = PROFILE_ACTORS[platform]!;
    return { kind: 'profile', platform, actorId: actor.actorId, sources, actorInput: actor.buildInput(sources.map((s) => s.handle)) };
  });
  return { scrapes, profiles, unverified: [...unverified].map(([platform, actorId]) => ({ platform, actorId })) };
}

/** What the SpendGate confirm names: actor, handles and item ceiling per run. */
export function describePlan(plan: SyncPlan) {
  return [
    ...plan.scrapes.map((g) => ({ kind: g.kind, platform: g.platform, actor: g.actorId, handles: g.sources.map((s) => s.handle), limit: g.limit, maxItems: g.limit * g.sources.length })),
    ...plan.profiles.map((g) => ({ kind: g.kind, platform: g.platform, actor: g.actorId, handles: g.sources.map((s) => s.handle), limit: 1, maxItems: g.sources.length })),
  ];
}

/* ── ingest ─────────────────────────────────────────────────────────────── */

export type IngestResult = { items: number; posts: number; newPosts: number; metrics: number; snapshots: number; transcripts: number; unmatched: number };

const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'x';
export const postIdFor = (platform: LabPlatform, externalId: string) => `lp-${platform}-${slug(externalId)}`;

/**
 * How a read is labelled (04 4.2): `readKind` for every row, or per external id through `targets`
 * (a fixed-age snapshot read; X targets under 2h are `dense`). Posts a snapshot run found that it was
 * not asked for are `discover` reads.
 */
export type IngestReadOpts = { readKind?: LabReadKind; targets?: Record<string, number> };

/** Normalize one actor's items and write posts, a metrics row per read, free subtitles and creator snapshots. */
export function ingestPosts(store: LabStore, platform: LabPlatform, sources: readonly LabSource[], items: readonly unknown[], now: Date, read: IngestReadOpts = {}): IngestResult {
  const at = now.toISOString();
  const byHandle = new Map(sources.map((s) => [s.handle.toLowerCase(), s]));
  const res: IngestResult = { items: items.length, posts: 0, newPosts: 0, metrics: 0, snapshots: 0, transcripts: 0, unmatched: 0 };
  store.transaction(() => {
    for (const p of normalizeItems(platform, items)) {
      const source = (p.authorHandle ? byHandle.get(p.authorHandle) : undefined) ?? (sources.length === 1 ? sources[0] : undefined);
      if (!source) {
        res.unmatched++;
        continue;
      }
      const id = postIdFor(platform, p.externalId);
      const existed = store.posts.get(id) !== null;
      const stored = store.posts.upsert({ id, sourceId: source.id, platform, externalId: p.externalId, url: p.url, postedAt: p.postedAt, caption: p.caption, contentType: p.contentType, thumbnailUrl: p.thumbnailUrl, mediaUrl: p.mediaUrl, durationS: p.durationS, isOwned: source.kind === 'owned', epoch: epochOf({ platform, contentType: p.contentType, postedAt: p.postedAt }) });
      res.posts++;
      if (!existed && stored === id) res.newPosts++;
      const target = read.targets?.[p.externalId];
      const readKind: LabReadKind = target !== undefined ? (platform === 'twitter' && target <= 2 ? 'dense' : 'snapshot') : read.targets ? 'discover' : (read.readKind ?? 'cycle');
      // age_h: the store computes it from posted_at (null when unknown or negative)
      store.metrics.add({ postId: stored, capturedAt: at, views: p.metrics.views, likes: p.metrics.likes, comments: p.metrics.comments, shares: p.metrics.shares, saves: p.metrics.saves, quotes: p.metrics.quotes ?? null, readKind, targetAgeH: target ?? null });
      res.metrics++;
      // YouTube subtitles come free with the item (SPEC §4.4): keep them now, the item is not read again
      if (p.transcript && store.transcripts.get(stored)?.status !== 'done') {
        const wc = wordCount(p.transcript);
        store.transcripts.upsert({ postId: stored, text: p.transcript, wordCount: wc, wpm: round1(wpmOf(wc, p.durationS)), provider: 'youtube-subtitles', costUsd: 0, status: 'done' });
        res.transcripts++;
      }
    }
    // follower counts from the author block the post items carry (not Instagram post items)
    const seen = new Set<string>();
    for (const raw of items) {
      const prof = normalizeProfile(platform, raw);
      if (!prof || prof.followers === null || seen.has(prof.handle)) continue;
      const source = byHandle.get(prof.handle);
      if (!source) continue;
      seen.add(prof.handle);
      store.creatorSnapshots.add({ sourceId: source.id, capturedAt: at, followers: prof.followers, following: prof.following, postCount: prof.postCount });
      res.snapshots++;
    }
  });
  return res;
}

/** Profile actor items → one creator snapshot per matched source. */
export function ingestProfiles(store: LabStore, platform: LabPlatform, sources: readonly LabSource[], items: readonly unknown[], now: Date): IngestResult {
  const byHandle = new Map(sources.map((s) => [s.handle.toLowerCase(), s]));
  const res: IngestResult = { items: items.length, posts: 0, newPosts: 0, metrics: 0, snapshots: 0, transcripts: 0, unmatched: 0 };
  const seen = new Set<string>();
  for (const raw of items) {
    const prof = normalizeProfile(platform, raw);
    const source = prof ? byHandle.get(prof.handle) : undefined;
    if (!prof || !source || seen.has(source.id)) {
      res.unmatched++;
      continue;
    }
    seen.add(source.id);
    store.creatorSnapshots.add({ sourceId: source.id, capturedAt: now.toISOString(), followers: prof.followers, following: prof.following, postCount: prof.postCount });
    res.snapshots++;
  }
  return res;
}

const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

type RunInput = { platform?: string; sourceIds?: string[]; terms?: string[]; limit?: number; actorInput?: unknown; targets?: Record<string, number>; mode?: 'discover' | 'reads' };

/** Route a finished run's items back to the right ingest, from what lab_runs.input recorded. */
export function ingestRun(store: LabStore, run: Pick<LabRun, 'kind' | 'input'>, items: readonly unknown[], now: Date): IngestResult {
  const input = (run.input ?? {}) as RunInput;
  const platform = LabPlatformSchema.safeParse(input.platform);
  const empty: IngestResult = { items: items.length, posts: 0, newPosts: 0, metrics: 0, snapshots: 0, transcripts: 0, unmatched: items.length };
  if (!platform.success) return empty;
  if (run.kind === 'search') {
    const r = ingestSearch(store, platform.data, items, input.terms ?? [], now);
    return { ...empty, unmatched: 0, posts: r.candidates };
  }
  const sources = (input.sourceIds ?? []).map((id) => store.sources.get(id)).filter((s): s is LabSource => s !== null);
  if (run.kind === 'scrape') return ingestPosts(store, platform.data, sources, items, now);
  if (run.kind === 'profile') return ingestProfiles(store, platform.data, sources, items, now);
  // 04 4.2: fixed-age snapshot and discovery reads of owned posts
  if (run.kind === 'snapshot') return ingestPosts(store, platform.data, sources, items, now, input.mode === 'discover' ? { readKind: 'discover' } : { targets: input.targets ?? {} });
  // 04 2.3: a verify run files its field report; its post and profile items are real reads of owned accounts
  if (run.kind === 'verify') {
    const v = input as unknown as VerifyRunInput;
    if (v.kind === 'post') return ingestPosts(store, platform.data, sources, items, now, { readKind: 'manual' });
    if (v.kind === 'profile') return ingestProfiles(store, platform.data, sources, items, now);
    return { ...empty, unmatched: 0 };
  }
  return empty;
}

/* ── start (through the gate) ──────────────────────────────────────────── */

export type SyncDeps = {
  store: LabStore;
  /** null in dry mode: the live branch is never reached there. */
  client: ApifyClient | null;
  now?: Date;
  /** Pass the monthly cap once (only from the SpendGate's explicit second confirm). */
  override?: boolean;
  /** launchd: never overrides; a cap stop records a `blocked` run. */
  scheduled?: boolean;
  /* v2 (09.2.6, 09.4.2; lane S): the run batch, and each group's estimate for the gate (lower reserve, frozen run_cost forecast). */
  batchId?: string | null;
  estimateFor?: (g: ScrapeGroup | ProfileGroup) => GateEstimate | null;
};

export function dryTargets(store: LabStore, sources: readonly LabSource[]): DryTarget[] {
  const latest = store.metrics.latest();
  return sources.map((s) => ({
    handle: s.handle,
    displayName: s.displayName,
    existing: store.posts.bySource(s.id).map((p) => ({ externalId: p.externalId, url: p.url, caption: p.caption, contentType: p.contentType, postedAt: p.postedAt, durationS: p.durationS, thumbnailUrl: p.thumbnailUrl, mediaUrl: p.mediaUrl, latestViews: latest.get(p.id)?.views ?? null })),
  }));
}

/** Headroom for Apify's per-run `maxTotalChargeUsd`, split across the runs about to start. Null = no ceiling to pass (uncapped, or overriding). */
export function chargeCeiling(store: LabStore, runsAhead: number, now: Date, override = false): number | null {
  const cap = capFor('apify');
  if (cap === null || override) return null;
  const head = cap - monthSpend(store, 'apify', now);
  return Math.max(0.01, Math.round((head / Math.max(1, runsAhead)) * 100) / 100);
}

export type StartedRun = { run: LabRun; ingest: IngestResult | null };

/**
 * 09.5.3 single-run guard: an actor that allows one concurrent run per account (the tweet scraper)
 * with an open run defers the next start to a later tick (no run row, no spend). Dry never defers.
 */
export function singleRunBusy(store: LabStore, actorId: string): boolean {
  return SINGLE_RUN_ACTORS.includes(actorId) && store.runs.openForActor(actorId).some((r) => !r.dry);
}
export const SINGLE_RUN_WAIT = 'Waiting for the other X run to finish';

/** Start every planned run through the gate. Stops at the first CapError (rethrown). */
export async function startPlan(deps: SyncDeps, plan: SyncPlan): Promise<StartedRun[]> {
  const now = deps.now ?? new Date();
  const out: StartedRun[] = [];
  const groups = [...plan.scrapes, ...plan.profiles];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!isDry() && singleRunBusy(deps.store, g.actorId)) continue;
    const input = { platform: g.platform, sourceIds: g.sources.map((s) => s.id), ...(g.kind === 'scrape' ? { limit: g.limit } : {}), actorInput: g.actorInput };
    const maxItems = g.kind === 'scrape' ? g.limit * g.sources.length : g.sources.length;
    const res = await gatedCall<IngestResult | null>(deps.store, { provider: 'apify', line: 'apify.sync', kind: g.kind, actor: g.actorId, input, override: deps.override, scheduled: deps.scheduled, now, batchId: deps.batchId ?? null, estimate: deps.estimateFor?.(g) ?? null }, {
      dry: () => {
        const items = g.kind === 'scrape' ? dryPostItems(g.platform, dryTargets(deps.store, g.sources), g.limit, now) : dryProfileItems(g.sources.map((s) => s.handle));
        return { result: ingestRun(deps.store, { kind: g.kind, input }, items, now), units: items.length, items: items.length };
      },
      live: async (_run, ctx) => {
        if (!deps.client) throw new Error('no Apify client');
        // v2 (08.6.3): the gate's reserve is the ceiling; chargeCeiling is the v1 fallback
        const ceiling = ctx.maxTotalChargeUsd ?? chargeCeiling(deps.store, groups.length - i, now, deps.override);
        const started = await deps.client.startRun(g.actorId, g.actorInput, { maxItems, ...(ceiling !== null ? { maxTotalChargeUsd: ceiling } : {}) });
        return { result: null, units: 0, actualUsd: null, apifyRunId: started.id, datasetId: started.defaultDatasetId, pending: true, items: null };
      },
    });
    out.push({ run: res.run, ingest: res.result });
  }
  if (out.some((r) => r.ingest && r.ingest.posts > 0)) recomputeMeasures(deps.store, now);
  return out;
}

/* ── advance on read ───────────────────────────────────────────────────── */

export type AdvanceResult = { checked: number; advanced: number; finished: number; failed: number; items: number; errors: string[] };

/** A run polled less than this ago is not polled again (09.4.3); its cached progress stands. */
export const POLL_THROTTLE_MS = 3_000;
/** On Apify 429: a random 500 to 1000 ms, doubled on each 429, at most 60 s (09.4.3). */
export const BACKOFF_MAX_MS = 60_000;

/** All of a dataset's items, paged (Apify caps a page; 10 pages × 1,000 is far past any Lab run). */
export async function fetchAllItems(client: ApifyClient, datasetId: string, pageSize = 1000, maxPages = 10): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await client.datasetItems(datasetId, { offset: page * pageSize, limit: pageSize });
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

/** Items so far from the run's own charge events (the actor's primary event), or null. */
export function itemsFromEvents(actorId: string | null, events: Record<string, number> | null): number | null {
  if (!events) return null;
  const primary = actorId ? PRIMARY_EVENT[actorId] : undefined;
  if (primary && typeof events[primary] === 'number') return events[primary];
  return null;
}

/** The next 429 wait: random 500 to 1000 ms, then double the previous wait, capped at 60 s. */
export function nextBackoffMs(prev: LabRunProgress | null, rand: () => number = Math.random): number {
  const was = prev?.backoffUntil && prev.polledAt ? Date.parse(prev.backoffUntil) - Date.parse(prev.polledAt) : 0;
  return was > 0 ? Math.min(BACKOFF_MAX_MS, was * 2) : Math.round(500 + rand() * 500);
}

let inflight: Promise<AdvanceResult> | null = null;

/**
 * Move every open Apify run forward once. Concurrent callers share one pass (two page
 * loads must not ingest the same dataset twice). Never throws: a failed poll leaves the
 * run open and reports the error.
 */
export function advanceRuns(store: LabStore, client: ApifyClient, opts: { now?: Date; minAgeS?: number; rand?: () => number } = {}): Promise<AdvanceResult> {
  if (inflight) return inflight;
  inflight = advanceOnce(store, client, opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Settle at the run's own charge; settleSpend grades its frozen run_cost forecast in the same transaction (08.6.3, 09.2.5). */
function settleAndGrade(store: LabStore, run: LabRun, usd: number, o: { units: number; items: number | null; status: LabRun['status']; error: string | null; events: Record<string, number> | null; now: Date }): void {
  settleSpend(store, run.id, usd, { units: o.units, items: o.items, status: o.status, error: o.error, events: o.events, now: o.now });
}

async function advanceOnce(store: LabStore, client: ApifyClient, opts: { now?: Date; minAgeS?: number; rand?: () => number }): Promise<AdvanceResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const at = now.toISOString();
  const minAge = (opts.minAgeS ?? ADVANCE_MIN_AGE_S) * 1000;
  const res: AdvanceResult = { checked: 0, advanced: 0, finished: 0, failed: 0, items: 0, errors: [] };
  let ingested = false;
  for (const run of store.runs.open()) {
    if (run.dry || !run.apifyRunId) continue;
    if (nowMs - Date.parse(run.startedAt) < minAge) continue;
    const prog = run.progress ?? null;
    // 09.4.3: a run polled under 3 s ago keeps its cached progress; a 429 backoff is honoured
    if (prog?.polledAt && nowMs - Date.parse(prog.polledAt) < POLL_THROTTLE_MS) continue;
    if (prog?.backoffUntil && Date.parse(prog.backoffUntil) > nowMs) continue;
    res.checked++;
    try {
      const ar = await client.getRun(run.apifyRunId);
      const datasetId = ar.defaultDatasetId ?? run.datasetId;
      if (!isTerminal(ar.status)) {
        const status = labRunStatus(ar.status);
        let items = itemsFromEvents(run.actor, ar.chargedEventCounts);
        // no primary event yet: one dataset call for itemCount (up to 5 s behind)
        if (items === null && datasetId) items = (await client.datasetInfo(datasetId).catch(() => ({ itemCount: null }))).itemCount;
        store.runs.update(run.id, { status, datasetId, progress: { items, usd: ar.usageTotalUsd, statusMessage: ar.statusMessage, polledAt: at, backoffUntil: null, events: ar.chargedEventCounts } });
        if (status !== run.status) res.advanced++;
        continue;
      }
      res.advanced++;
      const status = labRunStatus(ar.status);
      // SUCCEEDED, and now ABORTED and TIMED-OUT too: their items were paid for, so they are kept (09.4.3)
      if (ar.status !== 'FAILED') {
        const items = datasetId ? await fetchAllItems(client, datasetId) : [];
        if (isRadarActor(run.actor)) {
          // 05: the Radar's X watch list, TikTok Creative Center and Product Hunt runs are pings, not posts
          ingestRadarRun(store, run, items, now);
        } else if (run.kind === 'comments') {
          // 07 7.13: a live comments run's items are comments, not posts (lazy import: gen/comments pulls in the idea layer)
          const c = await import('@/lib/lab/gen/comments');
          const platform = (run.input as { platform?: string } | null)?.platform;
          if (platform && (c.COMMENT_PLATFORMS as readonly string[]).includes(platform)) {
            c.ingestCommentItems(store, (items as Record<string, unknown>[]).map((item) => ({ postId: null, item })), { platform: platform as (typeof c.COMMENT_PLATFORMS)[number], salt: c.commentSalt(), runId: run.id, now });
          }
        } else if (run.kind === 'verify') {
          fileVerifyRun(store, run.input as VerifyRunInput, items, ar.usageTotalUsd, now);
          const r = ingestRun(store, run, items, now);
          ingested = ingested || r.posts > 0 || r.snapshots > 0;
        } else if (run.actor === GOOGLE_TRENDS_ACTOR) {
          // the intel lane's Google Trends search run (lib/lab/feeds.ts): its items are trend headlines, not posts
          const trend = toTrendItems(store, parseGoogleTrends(items), at);
          store.transaction(() => {
            for (const i of trend) store.trendItems.upsert(i);
          });
        } else {
          const r = ingestRun(store, run, items, now);
          ingested = ingested || r.posts > 0 || r.snapshots > 0;
        }
        res.items += items.length;
        if (status === 'succeeded') res.finished++;
        else res.failed++;
        const error = status === 'succeeded' ? null : `Apify run ${ar.status.toLowerCase()}, ${items.length} items kept`;
        const progress = { items: items.length, usd: ar.usageTotalUsd, statusMessage: ar.statusMessage, polledAt: at, backoffUntil: null, events: ar.chargedEventCounts };
        if (ar.usageTotalUsd !== null) settleAndGrade(store, run, ar.usageTotalUsd, { units: items.length, items: items.length, status, error, events: ar.chargedEventCounts, now });
        // no charge reported yet: finish the run, leave the ledger row unsettled (counted in the meter)
        else store.runs.update(run.id, { status, items: items.length, datasetId, finishedAt: at, error });
        store.runs.update(run.id, { progress });
      } else {
        res.failed++;
        const error = `Apify run ${ar.status.toLowerCase()}`;
        if (ar.usageTotalUsd !== null) settleAndGrade(store, run, ar.usageTotalUsd, { units: 0, items: null, status, error, events: ar.chargedEventCounts, now });
        else store.runs.update(run.id, { status, error, finishedAt: at });
      }
    } catch (err) {
      if (err instanceof ApifyError && err.status === 429) {
        const wait = nextBackoffMs(prog, opts.rand);
        store.runs.update(run.id, { progress: { items: prog?.items ?? null, usd: prog?.usd ?? null, statusMessage: prog?.statusMessage ?? null, events: prog?.events ?? null, polledAt: at, backoffUntil: new Date(nowMs + wait).toISOString() } });
      }
      res.errors.push(`${run.id}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }
  // 04 9: verdicts first (cases and controls are fixed in time), then the measures
  if (ingested) {
    assignVerdicts(store, now);
    recomputeMeasures(store, now);
  }
  return res;
}
