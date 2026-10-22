import type { LabDissection } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { median } from '@/lib/lab/measures';
import { recomputeMeasuresV2 } from '@/lib/lab/measure/compute';

/**
 * Rebuild lab_measures (v1 SPEC 4.6; v2 04 3.12). The single entry point stays here; the body is
 * section 04's `recomputeMeasuresV2` (age-matched, empirical-Bayes baseline, robust z, the v2
 * breakout rule). Derived data: safe to run after every sync.
 */

export const formatKey = (d: LabDissection | null | undefined): string => d?.format ?? 'undissected';

export function recomputeMeasures(store: LabStore, now: Date = new Date()): { posts: number; measured: number; breakouts: number } {
  const r = recomputeMeasuresV2(store, { now });
  return { posts: store.posts.count(), measured: r.measured, breakouts: r.breakouts };
}

/** The niche medians the quadrants were split at (for the Field's quadrant lines). */
export function nicheMedians(store: LabStore): { breakout: number | null; depthByPlatform: Record<string, number | null>; depth: number | null } {
  const owned = new Set(store.posts.all().filter((p) => p.isOwned).map((p) => p.id));
  const platformOf = new Map(store.posts.all().map((p) => [p.id, p.platform]));
  const ms = store.measures.all().filter((m) => !owned.has(m.postId));
  const byPlatform: Record<string, number[]> = {};
  for (const m of ms) if (m.depth !== null) (byPlatform[platformOf.get(m.postId) ?? 'other'] ??= []).push(m.depth);
  return {
    breakout: median(ms.map((m) => m.breakout).filter((x): x is number => x !== null)),
    depth: median(ms.map((m) => m.depth).filter((x): x is number => x !== null)),
    depthByPlatform: Object.fromEntries(Object.entries(byPlatform).map(([k, v]) => [k, median(v)])),
  };
}
