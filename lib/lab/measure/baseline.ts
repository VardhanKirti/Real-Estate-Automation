/**
 * The baseline cell (04 3.2): creator x surface x epoch, never the dissected format, so a
 * baseline is never built from winners. Also home of v1's same-format `breakout` and
 * `baselineSample` (moved out of lib/lab/measures.ts, 04 9; kept for the v1 tests and nothing else).
 */
import type { LabConfidence, LabPost } from '@/lib/schemas';
import { median, medianInterval } from '@/lib/lab/measures';
import { baselineConfidence } from '@/lib/lab/measure/breakout';
import { epochOf } from '@/lib/lab/measure/platform';

export type Surface = 'short' | 'long' | 'reel' | 'image' | 'carousel' | 'text' | 'video';
const SURFACES = new Set<Surface>(['short', 'long', 'reel', 'image', 'carousel', 'text', 'video']);

/** contentType per platform: youtube video -> 'long', youtube short -> 'short'; others pass through. */
export function surfaceOf(post: Pick<LabPost, 'platform' | 'contentType'>): Surface {
  if (post.platform === 'youtube') return post.contentType === 'short' ? 'short' : 'long';
  return SURFACES.has(post.contentType as Surface) ? (post.contentType as Surface) : 'video';
}

/** `${sourceId}|${surface}|${epoch}`. */
export function cellKey(post: Pick<LabPost, 'sourceId' | 'platform' | 'contentType' | 'postedAt'>): string {
  return `${post.sourceId}|${surfaceOf(post)}|${epochOf(post)}`;
}

export const BASELINE_MAX_POSTS = 30;
export const BASELINE_WINDOW_DAYS = 90;
const DAY = 86_400_000;

/**
 * The v2 baseline sample for target t at one age: posts in t's cell posted before t and within the
 * 90 days before it, each with a value at that age, newest 30 (their y values).
 */
export function cellSample(target: { id: string; postedAtMs: number }, cell: readonly { id: string; postedAtMs: number; y: number | null }[]): number[] {
  const from = target.postedAtMs - BASELINE_WINDOW_DAYS * DAY;
  return cell
    .filter((p) => p.id !== target.id && p.y !== null && p.postedAtMs < target.postedAtMs && p.postedAtMs >= from)
    .sort((a, b) => b.postedAtMs - a.postedAtMs)
    .slice(0, BASELINE_MAX_POSTS)
    .map((p) => p.y as number);
}

/* ── v1, moved from lib/lab/measures.ts (04 9) ─────────────────────────── */

/** Below this baseline n the v1 creator median was shrunk toward the niche median (weight n/10). */
export const SHRINK_FULL_N = 10;

export type BaselinePost = { id: string; postedAt: string | null; views: number | null };

/** v1: the same creator's same-format posts posted before it within 90 days, newest 30. */
export function baselineSample(target: { id: string; postedAt: string | null }, sameCreatorSameFormat: readonly BaselinePost[]): number[] {
  if (!target.postedAt) return [];
  const t = Date.parse(target.postedAt);
  const from = t - BASELINE_WINDOW_DAYS * DAY;
  return sameCreatorSameFormat
    .filter((p) => p.id !== target.id && p.postedAt && p.views !== null && p.views > 0)
    .map((p) => ({ at: Date.parse(p.postedAt!), views: p.views! }))
    .filter((p) => p.at < t && p.at >= from)
    .sort((a, b) => b.at - a.at)
    .slice(0, BASELINE_MAX_POSTS)
    .map((p) => p.views);
}

export type Breakout = { ratio: number; lo: number; hi: number; baseline: number; n: number; confidence: LabConfidence; ownWeight: number };

/** v1 breakout: views / the creator's same-format median shrunk toward the niche (weight n/10). */
export function breakout(views: number | null, baseline: readonly number[], niche: { median: number | null; p25?: number | null; p75?: number | null }): Breakout | null {
  if (views === null || !(views > 0)) return null;
  const n = baseline.length;
  const own = median(baseline);
  const ownInt = medianInterval(baseline);
  const w = Math.min(1, n / SHRINK_FULL_N);
  const nm = niche.median;
  if ((own === null || w === 0) && (nm === null || !(nm > 0))) return null;
  let base: number;
  let baseLo: number;
  let baseHi: number;
  if (w >= 1 || nm === null || !(nm > 0)) {
    base = own!;
    [baseLo, baseHi] = ownInt!;
  } else {
    const nLo = niche.p25 ?? nm;
    const nHi = niche.p75 ?? nm;
    const oMed = own ?? nm;
    const [oLo, oHi] = ownInt ?? [nLo, nHi];
    base = w * oMed + (1 - w) * nm;
    baseLo = w * oLo + (1 - w) * nLo;
    baseHi = w * oHi + (1 - w) * nHi;
  }
  if (!(base > 0)) return null;
  const safeLo = baseLo > 0 ? baseLo : base;
  const safeHi = baseHi > 0 ? baseHi : base;
  return { ratio: views / base, lo: views / Math.max(safeHi, safeLo), hi: views / Math.min(safeHi, safeLo), baseline: base, n, confidence: baselineConfidence(n, false), ownWeight: w };
}
