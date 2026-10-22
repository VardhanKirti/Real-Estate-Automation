/**
 * Cross-lane imports of the ledger (lane L), in one file so there is one place to rewire.
 * Section 06 calls section 04's measurement maths (`lib/lab/measure/*`, lane D) and section 07's
 * comment-intent score (lib/lab/gen/comments.ts intentScore). The ledger defines no interpolation, tolerance, baseline grouping
 * or as-of type of its own (AC-06-8, AC-06-34, AC-06-52).
 */
import type { LabCreatorSnapshot } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { followersAsOf as followersAsOfD } from '@/lib/lab/measure/asof';
import { intentScore } from '@/lib/lab/gen/comments';

export { valueAtAge, type AgeValue } from '@/lib/lab/measure/age';
export { surfaceOf, cellKey, type Surface } from '@/lib/lab/measure/baseline';
export { fitEb, ebBaseline, type EbFit, type EbBaseline } from '@/lib/lab/measure/eb';
export { metricBasis } from '@/lib/lab/measure/platform';

/** 04 6.2 (lib/lab/measure/asof.ts), with the ledger's field name `asOf` for D's `kind`. */
export function followersAsOf(snaps: readonly LabCreatorSnapshot[], postedAt: string): { followers: number; asOf: 'before' | 'backfill' } | null {
  const r = followersAsOfD(snaps, postedAt);
  return r ? { followers: r.followers, asOf: r.kind } : null;
}

/** 07 7.13.4 (06 section 18): the comment request ratio for a young owned post, null under 07's thresholds (20 comments, 5 comparison posts). */
export function commentIntentScore(store: LabStore, postId: string, now: Date): { requestRate: number; intentRatio: number; comments: number; compareN: number } | null {
  void now;
  const s = intentScore(store, postId);
  return s.shown && s.requestRate !== null && s.ratio !== null ? { requestRate: s.requestRate, intentRatio: s.ratio, comments: s.n, compareN: s.comparison } : null;
}
