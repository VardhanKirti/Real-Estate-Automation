/**
 * Exogenous spike flag (04 3.10): the automatic step-jump detector. The manual flag is
 * lab_posts.exo_reason (posts.flagExo). Both keep a post out of pattern mining and in Brody's stats.
 * EXO_REASONS lives in lib/schemas.ts (LabExoReasonSchema needs it there) and is re-exported.
 */
export { EXO_REASONS } from '@/lib/schemas';

/** Intervals that start before this age are never judged (launch growth is not a push). */
export const EXO_MIN_AGE_H = 48;
export const EXO_RATE_X = 3;
export const EXO_MIN_SHARE = 0.2;
export const EXO_MIN_DELTA = 500;

/**
 * For consecutive snapshot intervals both starting at age >= 48h, rate_i = delta / hours; flagged
 * when rate_i >= 3 x rate_(i-1), delta_i >= 0.2 x the basis at the interval start, and delta_i >= 500.
 * `atH` is the end of the jump interval and `jump` its basis increase.
 */
export function detectStepJump(snaps: readonly { ageH: number; basis: number }[]): { flagged: boolean; atH: number | null; jump: number | null } {
  const pts = snaps.filter((s) => Number.isFinite(s.ageH) && Number.isFinite(s.basis)).sort((a, b) => a.ageH - b.ageH);
  for (let i = 2; i < pts.length; i++) {
    const a = pts[i - 2];
    const b = pts[i - 1];
    const c = pts[i];
    if (a.ageH < EXO_MIN_AGE_H || c.ageH <= b.ageH || b.ageH <= a.ageH) continue;
    const prevRate = (b.basis - a.basis) / (b.ageH - a.ageH);
    const delta = c.basis - b.basis;
    const rate = delta / (c.ageH - b.ageH);
    if (rate >= EXO_RATE_X * prevRate && delta >= EXO_MIN_SHARE * b.basis && delta >= EXO_MIN_DELTA) return { flagged: true, atH: c.ageH, jump: delta };
  }
  return { flagged: false, atH: null, jump: null };
}
