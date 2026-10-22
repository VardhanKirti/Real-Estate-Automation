import type { LabTrendSnapshot } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { momentum, timing, weightedCount } from '@/lib/lab/measures';

/**
 * Trend tide v1 (SPEC §4.10): one lab_trend_snapshots row per cluster per day, rebuilt
 * from the stored posts (primary topic → cluster), measures and trend-feed items.
 * Each day's row describes the trailing 7 days ending that day, so a chart of any one
 * column over days is a rolling weekly series:
 *   posts, breakouts, creators, platforms   — competitor + owned posts in the cluster
 *   feed_mentions, source_count             — trend items seen in the window, distinct feeds
 *   momentum                                — weighted(this week) ÷ median(4 prior weeks)
 *   timing                                  — measures.timing() on the same window
 * Clustering itself (embeddings, centroid matching) is the Phase 5 lane's; this reads
 * whatever cluster ids the topics carry.
 */

const DAY = 86_400_000;
export const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10);

export function computeTrendSnapshots(store: LabStore, opts: { now?: Date; days?: number } = {}): LabTrendSnapshot[] {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 84;
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const posts = new Map(store.posts.all().map((p) => [p.id, p]));
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  type Ev = { t: number; sourceId: string; platform: string; breakout: boolean };
  const byCluster = new Map<string, Ev[]>();
  for (const topic of store.topics.all()) {
    if (!topic.isPrimary || !topic.clusterId) continue;
    const p = posts.get(topic.postId);
    if (!p?.postedAt) continue;
    const list = byCluster.get(topic.clusterId) ?? [];
    list.push({ t: Date.parse(p.postedAt), sourceId: p.sourceId, platform: p.platform, breakout: measures.get(p.id)?.isBreakout ?? false });
    byCluster.set(topic.clusterId, list);
  }
  const items = store.trendItems.all();
  const out: LabTrendSnapshot[] = [];

  for (const cluster of store.clusters.all()) {
    const evs = byCluster.get(cluster.id) ?? [];
    const feed = items.filter((i) => i.clusterId === cluster.id).map((i) => ({ t: Date.parse(i.seenAt), feed: i.feed, sources: i.sources }));
    const win = (from: number, to: number) => evs.filter((e) => e.t > from && e.t <= to);
    const weekly = (endT: number) => {
      const w = win(endT - 7 * DAY, endT);
      return { w, weighted: weightedCount(w.length, w.filter((e) => e.breakout).length) };
    };
    for (let d = days - 1; d >= 0; d--) {
      const dayEnd = end - d * DAY + DAY - 1;
      const cur = weekly(dayEnd);
      const trailing = [1, 2, 3, 4].map((k) => weekly(dayEnd - k * 7 * DAY).weighted);
      const prev = weekly(dayEnd - 7 * DAY).w;
      const f = feed.filter((x) => x.t > dayEnd - 7 * DAY && x.t <= dayEnd);
      const sourceCount = new Set(f.flatMap((x) => [x.feed, ...x.sources])).size;
      const creators = new Set(cur.w.map((e) => e.sourceId)).size;
      const rate = (xs: Ev[]) => (xs.length ? xs.filter((e) => e.breakout).length / xs.length : null);
      const row: LabTrendSnapshot = {
        clusterId: cluster.id,
        day: dayKey(dayEnd),
        posts: cur.w.length,
        breakouts: cur.w.filter((e) => e.breakout).length,
        creators,
        platforms: new Set(cur.w.map((e) => e.platform)).size,
        feedMentions: f.length,
        sourceCount,
        momentum: momentum(cur.weighted, trailing),
        timing: timing({ current: cur.weighted, trailing4: trailing, creators, sourceCount, breakoutRate: rate(cur.w), breakoutRatePrev: rate(prev) }),
      };
      store.trendSnapshots.upsert(row);
      out.push(row);
    }
  }
  return out;
}

/* ── angle exhaustion and coverage (Phase 5) ──────────────────────────── */

/** An angle with at least this many competitor posts and no breakout is exhausted. */
export const EXHAUSTED_MIN_POSTS = 5;
/** The window angle exhaustion looks back over. */
export const ANGLE_WINDOW_DAYS = 28;

export type AngleStat = { angle: string; posts: number; breakouts: number; best: number | null; exhausted: boolean; whitespace: boolean };

/**
 * Angle exhaustion inside one cluster (SPEC §4.10 whitespace check): per angle, how many
 * competitor posts tried it, how many broke out and the best ratio. Exhausted = many
 * tries ({@link EXHAUSTED_MIN_POSTS}+) and none reached the breakout threshold;
 * whitespace = tried at most twice and one of them broke out (a proven, uncrowded take).
 * Sorted best first.
 */
export function angleStats(rows: readonly { angle: string; breakout: number | null; isBreakout: boolean }[], threshold = 3): AngleStat[] {
  const by = new Map<string, { breakout: number | null; isBreakout: boolean }[]>();
  for (const r of rows) {
    const a = r.angle.trim();
    if (!a) continue;
    (by.get(a) ?? by.set(a, []).get(a)!).push(r);
  }
  return [...by.entries()]
    .map(([angle, rs]) => {
      const vals = rs.map((r) => r.breakout).filter((x): x is number => typeof x === 'number');
      const best = vals.length ? Math.max(...vals) : null;
      const breakouts = rs.filter((r) => r.isBreakout).length;
      return { angle, posts: rs.length, breakouts, best, exhausted: rs.length >= EXHAUSTED_MIN_POSTS && (best ?? 0) < threshold, whitespace: rs.length <= 2 && breakouts > 0 };
    })
    .sort((a, b) => (b.best ?? 0) - (a.best ?? 0) || a.angle.localeCompare(b.angle));
}

/** The competitor angle rows of one cluster in the window, ready for angleStats. */
export function clusterAngleRows(store: LabStore, clusterId: string, opts: { now?: Date; windowDays?: number } = {}) {
  const now = (opts.now ?? new Date()).getTime();
  const from = now - (opts.windowDays ?? ANGLE_WINDOW_DAYS) * DAY;
  const posts = new Map(store.posts.all().map((p) => [p.id, p]));
  const ms = new Map(store.measures.all().map((m) => [m.postId, m]));
  return store.topics
    .all()
    .filter((t) => t.isPrimary && t.clusterId === clusterId && t.angle)
    .flatMap((t) => {
      const p = posts.get(t.postId);
      if (!p || p.isOwned || !p.postedAt) return [];
      const at = Date.parse(p.postedAt);
      if (at < from || at > now) return [];
      const m = ms.get(p.id);
      return [{ postId: p.id, angle: t.angle, breakout: m?.breakout ?? null, isBreakout: m?.isBreakout ?? false }];
    });
}

/** Whether you already covered a cluster, and how your best post there did against your own baseline. */
export function coverage(store: LabStore, clusterId: string): { covered: boolean; postId: string | null; breakout: number | null; beatBaseline: boolean | null } {
  const ms = new Map(store.measures.all().map((m) => [m.postId, m]));
  const own = new Set(store.posts.all().filter((p) => p.isOwned).map((p) => p.id));
  const mine = store.topics
    .all()
    .filter((t) => t.isPrimary && t.clusterId === clusterId && own.has(t.postId))
    .map((t) => ({ postId: t.postId, b: ms.get(t.postId)?.breakout ?? null }))
    .sort((a, b) => (b.b ?? 0) - (a.b ?? 0));
  const best = mine[0];
  if (!best) return { covered: false, postId: null, breakout: null, beatBaseline: null };
  return { covered: true, postId: best.postId, breakout: best.b, beatBaseline: best.b === null ? null : best.b >= 1 };
}

/** The latest snapshot per cluster (timing, momentum), for ideas and the agent. */
export function latestSnapshots(store: LabStore): Map<string, LabTrendSnapshot> {
  const last = new Map<string, LabTrendSnapshot>();
  for (const s of store.trendSnapshots.all()) last.set(s.clusterId, s);
  return last;
}
