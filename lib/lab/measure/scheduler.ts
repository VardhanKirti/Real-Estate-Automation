/**
 * Fixed-age snapshot scheduler (04 section 4): the body of section 08's `snapshots` job, every
 * 30 minutes inside the one `glados.agent.lab` tick (C3: no second LaunchAgent).
 *
 *   owned IG, TikTok, YouTube, LinkedIn  reads at 3h, 6h, 12h, 24h, 48h, 72h, 7d, 14d; discovery
 *                                         every 2 h 06:00 to 24:00 local (newest 3 per account)
 *   owned X                               reads at 0.5h to 48h; the hourly query 07:00 to 23:00 is
 *                                         discovery and snapshot at once, plus 30-minute dense
 *                                         queries while a tweet is under 2 h old; nothing after 48h
 *
 * At 80% of a line's monthly cap the plan thins to THIN_TARGETS_H (X: 1h, 6h, 24h, 48h); at 100%
 * the line stops (a scheduled cap stop is one `blocked` run, 08.6). Dry and Filming re-read fixtures.
 */
import type { LabPlatform, LabRun, LabSource, LabSpendLine } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { POST_ACTORS, SINGLE_POST_INPUT, type ApifyClient } from '@/lib/lab/apify-client';
import { CapError, gatedCall, lineCapFor, capFor, lineSpend } from '@/lib/lab/spend';
import { isDry } from '@/lib/lab/dry';
import { dryPostItems } from '@/lib/lab/dry-items';
import { ingestRun, singleRunBusy, SINGLE_RUN_WAIT, dryTargets } from '@/lib/lab/sync';
import { TARGET_AGES_H, X_TARGET_AGES_H } from '@/lib/lab/measure/age';
import { isBlocked } from '@/lib/lab/measure/actors';
import { labTz } from '@/lib/lab/setup/jobs';
import { providerOf } from '@/lib/schemas';

export const THIN_TARGETS_H = [6, 24, 72, 168, 336] as const;
export const X_THIN_TARGETS_H = [1, 6, 24, 48] as const;
/** Thinning starts at this share of the line's monthly cap. */
export const THIN_AT = 0.8;
/** Discovery: newest posts per owned account per discovery tick. */
export const DISCOVER_NEWEST = 3;
/** Discovery every 2 h from 06:00 to 22:00 local (9 a day); the X query hourly 07:00 to 23:00 (17 a day). */
export const DISCOVER_HOURS = [6, 8, 10, 12, 14, 16, 18, 20, 22] as const;
export const X_QUERY_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as const;
/** X targets at or under this many hours are dense reads (30-minute queries). */
export const X_DENSE_MAX_H = 2;
export const SNAPSHOT_PLATFORMS: readonly LabPlatform[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'];

const HOUR = 3_600_000;

export type DueRead = { postId: string; platform: LabPlatform; targetH: number; ageH: number };
export type SnapshotPlan = {
  discover: { platform: LabPlatform; sourceIds: string[]; actorInput: Record<string, unknown> }[];
  reads: { platform: LabPlatform; posts: DueRead[]; actorInput: Record<string, unknown> }[];
  thinned: boolean;
  skipped: { reason: 'cap' | 'paused' | 'actor_unverified'; platform: LabPlatform }[];
};

/** Tolerance before and after a target age (04 4.2). */
export function tolerance(targetH: number): { pre: number; post: number } {
  if (targetH < 3) return { pre: 0.25, post: 0.25 };
  if (targetH <= 72) return { pre: 0.5, post: Math.max(1, Math.round(targetH) / 10) };
  return { pre: 2, post: 3 };
}

export const lineFor = (platform: LabPlatform): LabSpendLine => (platform === 'twitter' ? 'apify.x' : 'apify.snapshots');
export const targetsFor = (platform: LabPlatform, thin = false): readonly number[] => (platform === 'twitter' ? (thin ? X_THIN_TARGETS_H : X_TARGET_AGES_H) : thin ? THIN_TARGETS_H : TARGET_AGES_H);

/** Ages (hours) of every read of a post (the store's age_h, else from the capture time). */
function readAges(store: LabStore, postId: string, postedAt: string): number[] {
  return store.metrics.forPost(postId).map((m) => m.ageH ?? (Date.parse(m.capturedAt) - Date.parse(postedAt)) / HOUR).filter((h) => Number.isFinite(h) && h >= 0);
}

/** Due (post, target) pairs at `now` over owned posts (04 4.2). `thin` restricts the targets. */
export function dueReadsWith(store: LabStore, now: Date, thin: { snapshots: boolean; x: boolean } = { snapshots: false, x: false }): DueRead[] {
  const out: DueRead[] = [];
  const owned = new Set(store.sources.all('owned').filter((s) => s.status === 'active').map((s) => s.id));
  for (const p of store.posts.all()) {
    if (!p.isOwned || !p.postedAt || !owned.has(p.sourceId)) continue;
    const ageH = (now.getTime() - Date.parse(p.postedAt)) / HOUR;
    if (ageH < 0) continue;
    const targets = targetsFor(p.platform, p.platform === 'twitter' ? thin.x : thin.snapshots);
    if (ageH > targets[targets.length - 1] + 3) continue;
    let ages: number[] | null = null;
    for (const t of targets) {
      const tol = tolerance(t);
      if (ageH < t - tol.pre || ageH > t + tol.post) continue;
      ages ??= readAges(store, p.id, p.postedAt);
      if (ages.some((h) => Math.abs(h - t) <= tol.post)) continue;
      out.push({ postId: p.id, platform: p.platform, targetH: t, ageH: Math.round(ageH * 100) / 100 });
    }
  }
  return out;
}

/** Every due (post, target) pair at `now` (no thinning). */
export function dueReads(store: LabStore, now: Date): DueRead[] {
  return dueReadsWith(store, now);
}

/** The hour and minute of `now` in the Lab's local zone. */
export function localClock(now: Date, tz: string = labTz()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get('hour') % 24, minute: get('minute') };
}

function lineState(store: LabStore, line: LabSpendLine, now: Date): { pct: number | null; capped: boolean } {
  const cap = lineCapFor(line) ?? capFor(providerOf(line));
  if (cap === null) return { pct: null, capped: false };
  if (cap <= 0) return { pct: 1, capped: true };
  const spent = lineSpend(store, line, now);
  return { pct: spent / cap, capped: spent >= cap };
}

/**
 * The tick's plan. `thin` forces thinning (tests and the Setup preview); `paused` comes from the
 * kill switch (08); `tz` defaults to labTz().
 */
export function planSnapshots(store: LabStore, now: Date, opts: { thin?: boolean; paused?: boolean; tz?: string } = {}): SnapshotPlan {
  const plan: SnapshotPlan = { discover: [], reads: [], thinned: false, skipped: [] };
  const owned = store.sources.all('owned').filter((s) => s.status === 'active');
  const platforms = SNAPSHOT_PLATFORMS.filter((p) => owned.some((s) => s.platform === p));
  if (platforms.length === 0) return plan;
  if (opts.paused) {
    plan.skipped = platforms.map((platform) => ({ reason: 'paused' as const, platform }));
    return plan;
  }
  const snap = lineState(store, 'apify.snapshots', now);
  const x = lineState(store, 'apify.x', now);
  const thinSnap = opts.thin ?? (snap.pct !== null && snap.pct >= THIN_AT);
  const thinX = opts.thin ?? (x.pct !== null && x.pct >= THIN_AT);
  plan.thinned = thinSnap;
  const due = dueReadsWith(store, now, { snapshots: thinSnap, x: thinX });
  const clock = localClock(now, opts.tz);
  const firstHalf = clock.minute < 30;
  const posts = new Map(store.posts.all().filter((p) => p.isOwned).map((p) => [p.id, p]));

  for (const platform of platforms) {
    const line = lineFor(platform);
    if ((line === 'apify.x' ? x : snap).capped) {
      plan.skipped.push({ reason: 'cap', platform });
      continue;
    }
    if (isBlocked(store, POST_ACTORS[platform].actorId)) {
      plan.skipped.push({ reason: 'actor_unverified', platform });
      continue;
    }
    const sources = owned.filter((s) => s.platform === platform);
    const handles = sources.map((s) => s.handle);
    const mine = due.filter((d) => d.platform === platform);
    if (platform === 'twitter') {
      // the hourly query reads every tweet under 48 h (discovery and snapshot at once); dense queries
      // run every 30 minutes only while a tweet has a target at or under 2 h
      const hourly = firstHalf && (X_QUERY_HOURS as readonly number[]).includes(clock.hour);
      const dense = mine.filter((d) => d.targetH <= X_DENSE_MAX_H);
      const reads = hourly ? mine : dense;
      if (hourly || dense.length) plan.reads.push({ platform, posts: reads, actorInput: SINGLE_POST_INPUT.twitter([], handles) });
      continue;
    }
    if (firstHalf && (DISCOVER_HOURS as readonly number[]).includes(clock.hour)) {
      plan.discover.push({ platform, sourceIds: sources.map((s) => s.id), actorInput: POST_ACTORS[platform].buildInput(handles, DISCOVER_NEWEST) });
    }
    if (mine.length) {
      const urls = mine.map((d) => posts.get(d.postId)!.url);
      plan.reads.push({ platform, posts: mine, actorInput: SINGLE_POST_INPUT[platform](urls, handles) });
    }
  }
  return plan;
}

/**
 * Start the plan's runs through the gate (kind 'snapshot', job 'snapshots'). The tweet scraper
 * defers while another X run is open (09.5.3). A cap stop on one line skips that line's remaining
 * runs this tick; other lines go on. Dry and Filming ingest fixture re-reads at once.
 */
export async function startSnapshots(store: LabStore, client: ApifyClient | null, plan: SnapshotPlan, opts: { override?: boolean; scheduled: boolean; now?: Date; batchId?: string | null; onDefer?: (platform: LabPlatform, why: string) => void }): Promise<LabRun[]> {
  const now = opts.now ?? new Date();
  const runs: LabRun[] = [];
  const stopped = new Set<LabSpendLine>();
  const owned = store.sources.all('owned');
  const jobs: { platform: LabPlatform; mode: 'discover' | 'reads'; sources: LabSource[]; posts: DueRead[]; actorInput: Record<string, unknown> }[] = [
    ...plan.discover.map((d) => ({ platform: d.platform, mode: 'discover' as const, sources: owned.filter((s) => d.sourceIds.includes(s.id)), posts: [], actorInput: d.actorInput })),
    ...plan.reads.map((r) => ({ platform: r.platform, mode: 'reads' as const, sources: owned.filter((s) => s.platform === r.platform && s.status === 'active'), posts: r.posts, actorInput: r.actorInput })),
  ];
  for (const j of jobs) {
    const line = lineFor(j.platform);
    if (stopped.has(line)) continue;
    const actor = POST_ACTORS[j.platform].actorId;
    if (!isDry() && singleRunBusy(store, actor)) {
      // 09.5.3: the other X run is still open; no run row, no spend, the next tick runs it
      opts.onDefer?.(j.platform, SINGLE_RUN_WAIT);
      continue;
    }
    const dueIds = new Set(j.posts.map((d) => d.postId));
    const duePosts = store.posts.all().filter((p) => dueIds.has(p.id));
    const targets = Object.fromEntries(j.posts.map((d) => [duePosts.find((p) => p.id === d.postId)!.externalId, d.targetH]));
    const input = { platform: j.platform, sourceIds: j.sources.map((s) => s.id), mode: j.mode, postIds: j.posts.map((d) => d.postId), targets, actorInput: j.actorInput };
    const maxItems = j.platform === 'twitter' ? Math.max(50, 50 * j.sources.length) : j.mode === 'discover' ? DISCOVER_NEWEST * j.sources.length * (j.platform === 'youtube' ? 2 : 1) : Math.max(1, j.posts.length);
    try {
      const res = await gatedCall<null>(store, { provider: 'apify', line, kind: 'snapshot', actor, input, override: opts.override, scheduled: opts.scheduled, job: 'snapshots', batchId: opts.batchId ?? null, now }, {
        dry: () => {
          const fixtures = j.mode === 'discover' || j.platform === 'twitter'
            ? dryTargets(store, j.sources).map((t) => ({ ...t, existing: t.existing.filter((e) => j.platform !== 'twitter' || !e.postedAt || now.getTime() - Date.parse(e.postedAt) <= 48 * HOUR) }))
            : j.sources.map((s) => ({ handle: s.handle, displayName: s.displayName, existing: dryTargets(store, [s])[0].existing.filter((e) => duePosts.some((p) => p.externalId === e.externalId)) })).filter((t) => t.existing.length);
          const items = dryPostItems(j.platform, fixtures, j.mode === 'discover' ? DISCOVER_NEWEST : 50, now);
          const r = ingestRun(store, { kind: 'snapshot', input }, items, now);
          return { result: null, units: items.length, items: r.posts };
        },
        live: async (_run, ctx) => {
          if (!client) throw new Error('no Apify client');
          const started = await client.startRun(actor, j.actorInput, { maxItems, ...(ctx.maxTotalChargeUsd !== null ? { maxTotalChargeUsd: ctx.maxTotalChargeUsd } : {}) });
          return { result: null, units: 0, actualUsd: null, apifyRunId: started.id, datasetId: started.defaultDatasetId, pending: true, items: null };
        },
      });
      runs.push(res.run);
    } catch (err) {
      // a manual tick hands a passable cap stop to the SpendGate (402, override once); a scheduled
      // tick records its one blocked run (gatedCall) and skips that line for the rest of the tick
      if (err instanceof CapError && !opts.scheduled && err.reason === 'cap') throw err;
      if (err instanceof CapError) {
        stopped.add(line);
        continue;
      }
      throw err;
    }
  }
  return runs;
}

export { SINGLE_RUN_WAIT };

/**
 * Fixed-age hit rate over the last `days` (default 14): a (owned post, target) pair is due when its
 * window closed in that span and the Lab knew the post in time (a read at or before the window's
 * end); a hit is a read within the target's tolerance. AC-04-18 reads it from the Setup panel.
 */
export const HIT_RATE_DAYS = 14;
export function snapshotHitRate(store: LabStore, now: Date, days = HIT_RATE_DAYS): { rate: number | null; hits: number; due: number; byTarget: Record<number, { hits: number; due: number }> } {
  const from = now.getTime() - days * 24 * HOUR;
  const byTarget: Record<number, { hits: number; due: number }> = {};
  let hits = 0;
  let due = 0;
  for (const p of store.posts.all()) {
    if (!p.isOwned || !p.postedAt) continue;
    const posted = Date.parse(p.postedAt);
    const ages = readAges(store, p.id, p.postedAt);
    if (ages.length === 0) continue;
    const first = Math.min(...ages);
    for (const t of targetsFor(p.platform)) {
      const tol = tolerance(t);
      const at = posted + t * HOUR;
      if (at < from || at + tol.post * HOUR > now.getTime()) continue;
      if (first > t + tol.post) continue;
      const hit = ages.some((h) => Math.abs(h - t) <= tol.post);
      const b = (byTarget[t] ??= { hits: 0, due: 0 });
      b.due++;
      due++;
      if (hit) {
        b.hits++;
        hits++;
      }
    }
  }
  return { rate: due ? hits / due : null, hits, due, byTarget };
}
