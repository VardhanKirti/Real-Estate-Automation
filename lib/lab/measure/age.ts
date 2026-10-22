/**
 * Ages and age values (04 3.1). Pure: every function takes an explicit `asOf` and never reads
 * the clock. Section 06's `viewsAtAge` calls `valueAtAge` (AC-06-8).
 */
import type { LabPlatform } from '@/lib/schemas';

/** owned, non-X */
export const TARGET_AGES_H = [3, 6, 12, 24, 48, 72, 168, 336] as const;
/** owned X */
export const X_TARGET_AGES_H = [0.5, 1, 1.5, 2, 3, 6, 12, 24, 48] as const;
/** what tiles print (01 AgeMatchedView.atH) */
export const JUDGE_AGES_H = [6, 24, 72, 168] as const;
/** X stops at 48h */
export const X_JUDGE_AGES_H = [6, 24] as const;
/** 14d */
export const MATURE_AGE_H = 336;
export const X_MATURE_AGE_H = 48;
/** ages a baseline is built at */
export const BASELINE_AGES_H = [6, 24, 72, 168, 336] as const;
/** X baselines stop at its mature age (3.8) */
export const X_BASELINE_AGES_H = [6, 24, 48] as const;

export type AgeValue = {
  /** the target age */
  ageH: number;
  /** views (or the platform's basis, 3.8) at that age */
  views: number;
  /** log10(max(views, 1)) */
  y: number;
  how: 'interpolated' | 'nearest' | 'mature';
  /** ages of the snapshots used */
  fromH: [number, number];
};

const HOUR = 3_600_000;

/** Hours from posted_at to captured_at. Negative reads (clock skew) are dropped by every caller. */
export function ageHours(postedAt: string, capturedAt: string): number {
  return (Date.parse(capturedAt) - Date.parse(postedAt)) / HOUR;
}

export const logY = (v: number): number => Math.log10(Math.max(v, 1));

/** The mature age for a platform (X stops at 48h, 3.8). */
export const matureAgeFor = (platform: LabPlatform): number => (platform === 'twitter' ? X_MATURE_AGE_H : MATURE_AGE_H);
export const baselineAgesFor = (platform: LabPlatform): readonly number[] => (platform === 'twitter' ? X_BASELINE_AGES_H : BASELINE_AGES_H);
export const judgeAgesFor = (platform: LabPlatform): readonly (6 | 24 | 72 | 168)[] => (platform === 'twitter' ? X_JUDGE_AGES_H : JUDGE_AGES_H);

/**
 * The basis value at `targetH`, using only snapshots captured at or before `asOf`.
 * 1. Bracketed by s1 < targetH < s2 with s2 <= 3 x s1 and s2 - s1 <= 168h: interpolate y linearly
 *    in log(age).
 * 2. Else a snapshot with |s - targetH| <= tol(targetH), tol = max(0.5, 0.25 x targetH): use it as is.
 * 3. targetH is the mature age (`opts.matureH`, default MATURE_AGE_H; X passes X_MATURE_AGE_H) and
 *    the newest snapshot is older than it: the snapshot nearest the mature age that is not younger.
 * 4. Else null. Never extrapolate.
 */
export function valueAtAge(
  snaps: readonly { capturedAt: string; basis: number | null }[],
  postedAt: string,
  targetH: number,
  asOf: string,
  opts: { matureH?: number } = {},
): AgeValue | null {
  const cut = Date.parse(asOf);
  const pts = snaps
    .filter((s) => s.basis !== null && Number.isFinite(s.basis) && Date.parse(s.capturedAt) <= cut)
    .map((s) => ({ h: ageHours(postedAt, s.capturedAt), v: s.basis as number }))
    .filter((p) => Number.isFinite(p.h) && p.h >= 0)
    .sort((a, b) => a.h - b.h);
  return valueAtAgeH(pts, targetH, opts.matureH ?? MATURE_AGE_H);
}

/** valueAtAge over points already as-of filtered, aged and sorted ascending (the recompute's fast path). */
export function valueAtAgeH(pts: readonly { h: number; v: number }[], targetH: number, matureH: number = MATURE_AGE_H): AgeValue | null {
  if (pts.length === 0) return null;
  // 1. bracket (nearest snapshot on each side)
  let lo: { h: number; v: number } | null = null;
  let hi: { h: number; v: number } | null = null;
  for (const p of pts) {
    if (p.h < targetH) lo = p;
    else if (p.h > targetH && hi === null) hi = p;
  }
  if (lo && hi && lo.h > 0 && hi.h <= 3 * lo.h && hi.h - lo.h <= 168) {
    const y1 = logY(lo.v);
    const y2 = logY(hi.v);
    const f = (Math.log10(targetH) - Math.log10(lo.h)) / (Math.log10(hi.h) - Math.log10(lo.h));
    const y = y1 + (y2 - y1) * f;
    return { ageH: targetH, views: 10 ** y, y, how: 'interpolated', fromH: [lo.h, hi.h] };
  }

  // 2. nearest within tolerance
  const tol = Math.max(0.5, 0.25 * targetH);
  let best: { h: number; v: number } | null = null;
  for (const p of pts) if (Math.abs(p.h - targetH) <= tol && (best === null || Math.abs(p.h - targetH) < Math.abs(best.h - targetH))) best = p;
  if (best) return { ageH: targetH, views: best.v, y: logY(best.v), how: 'nearest', fromH: [best.h, best.h] };

  // 3. mature: the first read at or past the mature age
  if (targetH === matureH && pts[pts.length - 1].h > matureH) {
    const m = pts.find((p) => p.h >= matureH)!;
    return { ageH: targetH, views: m.v, y: logY(m.v), how: 'mature', fromH: [m.h, m.h] };
  }
  return null;
}

/** Largest judge age <= current age; null under 6h ("too new"). X judges at 6h and 24h only. */
export function judgeAge(ageNowH: number, platform: LabPlatform): 6 | 24 | 72 | 168 | null {
  let out: 6 | 24 | 72 | 168 | null = null;
  for (const a of judgeAgesFor(platform)) if (ageNowH >= a) out = a;
  return out;
}
