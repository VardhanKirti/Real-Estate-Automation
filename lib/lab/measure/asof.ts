/**
 * The as-of view (04 6.1): everything the maths may see at `asOf`. Every function in
 * lib/lab/measure/ takes data from asOfView, never from the store directly; section 06's
 * backtest calls it with past dates (AC-06-52 imports AsOfData from here).
 */
import type { LabCreatorSnapshot, LabPost, LabPostMetrics } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';

export type AsOfData = { posts: LabPost[]; metrics: Map<string, LabPostMetrics[]>; creatorSnapshots: Map<string, LabCreatorSnapshot[]>; asOf: string };

/** Posts posted at or before asOf, metric rows captured at or before it, creator snapshots captured at or before it. */
export function asOfView(store: LabStore, asOf: string): AsOfData {
  const cut = Date.parse(asOf);
  const posts = store.posts.all().filter((p) => p.postedAt !== null && Date.parse(p.postedAt) <= cut);
  const keep = new Set(posts.map((p) => p.id));
  const metrics = new Map<string, LabPostMetrics[]>();
  for (const [id, rows] of store.metrics.byPost()) {
    if (!keep.has(id)) continue;
    const seen = rows.filter((m) => Date.parse(m.capturedAt) <= cut);
    if (seen.length) metrics.set(id, seen);
  }
  const creatorSnapshots = new Map<string, LabCreatorSnapshot[]>();
  for (const s of store.creatorSnapshots.all()) {
    if (Date.parse(s.capturedAt) > cut) continue;
    const list = creatorSnapshots.get(s.sourceId);
    if (list) list.push(s);
    else creatorSnapshots.set(s.sourceId, [s]);
  }
  return { posts, metrics, creatorSnapshots, asOf };
}

/** A backfill snapshot may sit at most this long after posting (6.2). */
export const FOLLOWERS_BACKFILL_DAYS = 7;

/**
 * Followers as of posting (6.2): the latest snapshot captured at or before `postedAt`; else the
 * earliest captured within 7 days after it, marked `backfill`; else null (no prior for the post).
 * Replaces v1 `followersAt`, which fell back to the earliest snapshot at any distance.
 */
export function followersAsOf(snaps: readonly { capturedAt: string; followers: number | null }[], postedAt: string | null): { followers: number; kind: 'before' | 'backfill' } | null {
  if (!postedAt) return null;
  const t = Date.parse(postedAt);
  const withF = snaps.filter((s) => s.followers !== null && s.followers > 0).map((s) => ({ at: Date.parse(s.capturedAt), f: s.followers as number })).sort((a, b) => a.at - b.at);
  let before: { at: number; f: number } | null = null;
  for (const s of withF) if (s.at <= t) before = s;
  if (before) return { followers: before.f, kind: 'before' };
  const after = withF.find((s) => s.at > t && s.at - t <= FOLLOWERS_BACKFILL_DAYS * 86_400_000);
  return after ? { followers: after.f, kind: 'backfill' } : null;
}
