/**
 * Crane-Sornette trajectory classes (04 3.9). Internal to section 04: written to
 * lab_measures.trajectory_class and read by no view builder. v1's `trajectory` enum stays as is.
 */
import type { LabTrajectoryClass } from '@/lib/schemas';

export type TrajectoryClass = LabTrajectoryClass;
/** A gap between reads (or from posting to the first read) longer than this gives null. */
export const MAX_GAP_H = 72;

/**
 * Cumulative basis at day boundaries 1..14, linear in time between snapshots, V(0) = 0.
 * Null when a read gap over 72h spans the first 14 days or no read reaches day 14.
 */
export function dailyCumulative(snaps: readonly { ageH: number; basis: number }[]): number[] | null {
  const pts = [{ ageH: 0, basis: 0 }, ...snaps.filter((s) => s.ageH > 0 && Number.isFinite(s.basis)).sort((a, b) => a.ageH - b.ageH)];
  if (pts[pts.length - 1].ageH < 336) return null;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1].ageH >= 336) break;
    if (pts[i].ageH - pts[i - 1].ageH > MAX_GAP_H) return null;
  }
  const out: number[] = [];
  for (let k = 1; k <= 14; k++) {
    const t = k * 24;
    const j = pts.findIndex((p) => p.ageH >= t);
    const b = pts[j];
    const a = pts[j - 1];
    out.push(b.ageH === t || !a ? b.basis : a.basis + ((b.basis - a.basis) * (t - a.ageH)) / (b.ageH - a.ageH));
  }
  return out;
}

/** max(d_k) / V(14), d_k = V(k) - V(k-1). */
export function peakDayShare(cum: readonly number[]): number | null {
  if (cum.length === 0) return null;
  const total = cum[cum.length - 1];
  if (!(total > 0)) return null;
  let prev = 0;
  let max = -Infinity;
  for (const v of cum) {
    max = Math.max(max, v - prev);
    prev = v;
  }
  return max / total;
}

/** >= 0.8 burst; 0.2 to < 0.8 critical; < 0.2 slow. */
export function trajectoryClass(share: number | null): TrajectoryClass | null {
  if (share === null || !Number.isFinite(share)) return null;
  if (share >= 0.8) return 'burst';
  if (share >= 0.2) return 'critical';
  return 'slow';
}
