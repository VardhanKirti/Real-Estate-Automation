import type { LabBeat, LabConfidence, LabQuadrant, LabTiming, LabTrajectory } from '@/lib/schemas';
import { baselineConfidence as baselineConfidenceV2, isBreakoutV2 } from '@/lib/lab/measure/breakout';

/**
 * Content Lab measures: what "viral" means as numbers (SPEC §4.6, §4.7, §4.10).
 * Pure functions only, computed in TypeScript (SQLite has no median or ln). Nothing here
 * reads the store or the clock unless a `now` is passed in, so every number is testable.
 *
 * Conventions:
 * - A missing input yields null, never 0. "No views" means no rate (CINTEL's
 *   `views || engagement || 1` fallback is deliberately not ported).
 * - Every aggregate travels with its n. `enough(n)` (n >= 5) decides whether the UI may
 *   show the number or must say "not enough data".
 */

export const MIN_N = 5;
/** A Viral Profile feature value needs this many breakouts before it can show. */
export const MIN_PROFILE_BREAKOUTS = 8;
export const BREAKOUT_THRESHOLD = 3;

export const enough = (n: number, min = MIN_N): boolean => n >= min;

/* ── basic statistics ─────────────────────────────────────────────────── */

export function median(xs: readonly number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(xs: readonly number[], q: number): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pos = Math.min(1, Math.max(0, q)) * (v.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function mean(xs: readonly number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function sd(xs: readonly number[]): number | null {
  const m = mean(xs);
  const v = xs.filter((x) => Number.isFinite(x));
  if (m === null || v.length < 2) return null;
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}

function binomCdfHalf(k: number, n: number): number {
  // P(X <= k) for X ~ Bin(n, 0.5), exact for the small n a baseline has.
  let total = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    total += c;
    c = (c * (n - i)) / (i + 1);
  }
  return total / 2 ** n;
}

/**
 * Distribution-free 90% interval for a median from order statistics: the widest
 * [x(k), x(n-k+1)] with P(Bin(n, .5) <= k-1) <= 0.05 on each side. Below n 5 (or when
 * no k qualifies) it falls back to [min, max], which is honest and wide.
 */
export function medianInterval(xs: readonly number[], level = 0.9): [number, number] | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return null;
  const tail = (1 - level) / 2;
  let k = 0;
  for (let j = 1; j <= Math.floor(n / 2); j++) {
    if (binomCdfHalf(j - 1, n) <= tail) k = j;
    else break;
  }
  if (k === 0) return [v[0], v[n - 1]];
  return [v[k - 1], v[n - k]];
}

/** Wilson score interval for a proportion (z 1.645 = 90%). */
export function wilson(successes: number, n: number, z = 1.645): [number, number] | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/* ── per-post measures ────────────────────────────────────────────────── */

export type Counters = { views: number | null; likes: number | null; comments: number | null; saves: number | null };

/**
 * depth = (likes + comments + saves) / views. Saves count only where the platform
 * returns them (null is not 0). No views → null. Compare depth within a platform only.
 */
export function depth(c: Counters): number | null {
  if (c.views === null || !(c.views > 0)) return null;
  if (c.likes === null && c.comments === null && c.saves === null) return null;
  return ((c.likes ?? 0) + (c.comments ?? 0) + (c.saves ?? 0)) / c.views;
}

/** v1 callers: confidence with no fitted prior (04 9). The v2 rule lives in lib/lab/measure/breakout.ts. */
export function baselineConfidence(n: number): LabConfidence {
  return baselineConfidenceV2(n, false);
}

/* v1 `breakout`, `baselineSample`, `SHRINK_FULL_N` and the BASELINE_* constants moved to
   lib/lab/measure/baseline.ts (04 9); the v2 baseline is the EB baseline in lib/lab/measure/eb.ts. */

export type LadderRung = 'none' | 'notable' | 'strong' | 'exceptional';
export const LADDER: { rung: LadderRung; min: number; label: string }[] = [
  { rung: 'none', min: 0, label: 'none' },
  { rung: 'notable', min: 2, label: 'notable' },
  { rung: 'strong', min: 5, label: 'strong' },
  { rung: 'exceptional', min: 10, label: 'exceptional' },
];

/** The breakout Ladder: < 2x none · 2-5x notable · 5-10x strong · > 10x exceptional. */
export function ladder(ratio: number | null): LadderRung | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  if (ratio > 10) return 'exceptional';
  if (ratio >= 5) return 'strong';
  if (ratio >= 2) return 'notable';
  return 'none';
}

/** 1-4 index of the rung (the --lab-ladder-N token), 0 when unknown. */
export function ladderIndex(r: LadderRung | null): 0 | 1 | 2 | 3 | 4 {
  return r === null ? 0 : ((LADDER.findIndex((l) => l.rung === r) + 1) as 1 | 2 | 3 | 4);
}

/** "7.2x" (one decimal under 10, none above). */
export function fmtRatio(r: number | null): string | null {
  if (r === null || !Number.isFinite(r)) return null;
  return r >= 10 ? `${Math.round(r)}x` : `${(Math.round(r * 10) / 10).toFixed(1)}x`;
}

/** reach = views ÷ followers at posting time. */
export function reach(views: number | null, followers: number | null): number | null {
  if (views === null || followers === null || !(followers > 0)) return null;
  return views / followers;
}

export const hoursBetween = (fromIso: string, toIso: string): number => (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;

/**
 * Trajectory from the metric snapshots: the share of the latest views already reached at
 * 24 h (linear interpolation between reads). fast_flat >= 70% by 24 h, slow_sustained
 * < 40%, consistent between. Null with fewer than two reads, without a read inside 48 h
 * (the launch is unknown), or without views.
 */
export function trajectory(postedAt: string | null, snaps: readonly { capturedAt: string; views: number | null }[]): LabTrajectory | null {
  if (!postedAt) return null;
  const pts = snaps
    .filter((s) => s.views !== null)
    .map((s) => ({ h: hoursBetween(postedAt, s.capturedAt), v: s.views! }))
    .filter((p) => p.h >= 0)
    .sort((a, b) => a.h - b.h);
  if (pts.length < 2 || pts[0].h > 48) return null;
  const last = pts[pts.length - 1];
  if (!(last.v > 0) || last.h <= 24) return null;
  let at24: number;
  if (pts[0].h >= 24) at24 = pts[0].v * (24 / pts[0].h);
  else {
    const i = pts.findIndex((p) => p.h >= 24);
    const a = pts[i - 1];
    const b = pts[i];
    at24 = a.v + ((b.v - a.v) * (24 - a.h)) / (b.h - a.h);
  }
  const early = at24 / last.v;
  if (early >= 0.7) return 'fast_flat';
  if (early < 0.4) return 'slow_sustained';
  return 'consistent';
}

/** depth × breakout split at the niche medians. Null when either is unknown. */
export function quadrant(d: number | null, b: number | null, medians: { depth: number | null; breakout: number | null }): LabQuadrant | null {
  if (d === null || b === null || medians.depth === null || medians.breakout === null) return null;
  const deep = d >= medians.depth;
  const broad = b >= medians.breakout;
  if (deep && broad) return 'ideal';
  if (deep) return 'loyal';
  if (broad) return 'clickbait';
  return 'dud';
}

/** The breakout rule is v2's (04 3.7): ratio 3+, z 2+, confidence ok or high, judged at 24h or older. */
export const isBreakout = isBreakoutV2;

/**
 * Pattern mining (04 5.4): cases and controls only, never clickbait, never comment-keyword bait,
 * never an outside push (manual flag or the step-jump detector).
 */
export function minesPatterns(m: { quadrant: LabQuadrant | null; exoAuto?: boolean }, ctaType: string | null, ctx: { role: 'case' | 'control' | null; exoReason: string | null | undefined }): boolean {
  return (ctx.role === 'case' || ctx.role === 'control') && m.quadrant !== 'clickbait' && ctaType !== 'comment_keyword' && !ctx.exoReason && !m.exoAuto;
}

/* ── lift (Viral Profile, §4.7) ───────────────────────────────────────── */

export type Lift = { lift: number | null; lo: number | null; hi: number | null; n: number; total: number; shown: boolean };

/**
 * lift(feature=value) = P(breakout | value) ÷ P(breakout | format), with a 90% Wilson
 * interval on the conditional rate divided by the base rate. Shows only with >= 8
 * breakouts and an interval that excludes 1.0.
 */
export function lift(breakoutsWithValue: number, postsWithValue: number, breakoutsInFormat: number, postsInFormat: number): Lift {
  const base = postsInFormat > 0 ? breakoutsInFormat / postsInFormat : 0;
  if (postsWithValue <= 0 || !(base > 0)) return { lift: null, lo: null, hi: null, n: breakoutsWithValue, total: postsWithValue, shown: false };
  const p = breakoutsWithValue / postsWithValue;
  const w = wilson(breakoutsWithValue, postsWithValue)!;
  const l = p / base;
  const lo = w[0] / base;
  const hi = w[1] / base;
  return { lift: l, lo, hi, n: breakoutsWithValue, total: postsWithValue, shown: breakoutsWithValue >= MIN_PROFILE_BREAKOUTS && (lo > 1 || hi < 1) };
}

/* ── bands (features) ─────────────────────────────────────────────────── */

export const wpmOf = (wordCount: number, durationS: number | null): number | null => (durationS && durationS > 0 && wordCount > 0 ? (wordCount / durationS) * 60 : null);
export const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);
export const wordBudget = (durationS: number, wpm: number): number => Math.round((durationS * wpm) / 60);

export function durationBand(s: number | null): string | null {
  if (s === null || !(s > 0)) return null;
  if (s < 30) return 'under 30 s';
  if (s < 60) return '30-60 s';
  if (s < 90) return '60-90 s';
  if (s < 180) return '90 s-3 min';
  return 'over 3 min';
}
export function wpmBand(w: number | null): string | null {
  if (w === null) return null;
  if (w < 130) return 'under 130 wpm';
  if (w < 160) return '130-160 wpm';
  if (w < 185) return '160-185 wpm';
  return 'over 185 wpm';
}
export function hookWordsBand(words: number): string {
  if (words <= 6) return '1-6 words';
  if (words <= 10) return '7-10 words';
  if (words <= 15) return '11-15 words';
  return 'over 15 words';
}
/** Posting hour band in the Lab's local time zone (04 5.4: labTz(), not fixed UTC). */
export function hourBand(postedAt: string | null, tz?: string): string | null {
  if (!postedAt) return null;
  const d = new Date(postedAt);
  if (!Number.isFinite(d.getTime())) return null;
  let h = d.getUTCHours();
  let suffix = 'UTC';
  if (tz) {
    try {
      h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d)) % 24;
      suffix = 'local';
    } catch {
      // an invalid zone keeps UTC
    }
  }
  if (h < 6) return `00-06 ${suffix}`;
  if (h < 12) return `06-12 ${suffix}`;
  if (h < 18) return `12-18 ${suffix}`;
  return `18-24 ${suffix}`;
}

/* ── strand helpers ───────────────────────────────────────────────────── */

/** Sorted, clamped, non-overlapping beats covering what the dissection reported. */
export function normalizeBeats(beats: readonly LabBeat[]): LabBeat[] {
  const out: LabBeat[] = [];
  let cursor = 0;
  for (const b of [...beats].sort((a, b) => a.startPct - b.startPct)) {
    const start = Math.max(cursor, Math.min(100, Math.max(0, b.startPct)));
    const end = Math.min(100, Math.max(start, b.endPct));
    if (end - start <= 0) continue;
    out.push({ ...b, startPct: start, endPct: end });
    cursor = end;
  }
  return out;
}

/** The hook span (first hook beat) and the rehook tick positions (start of each rehook beat). */
export function strandMarks(beats: readonly LabBeat[]): { hook: { startPct: number; endPct: number } | null; rehookTicks: number[] } {
  const hook = beats.find((b) => b.type === 'hook');
  return { hook: hook ? { startPct: hook.startPct, endPct: hook.endPct } : null, rehookTicks: beats.filter((b) => b.type === 'rehook').map((b) => b.startPct) };
}

/** The beat-type sequence ("hook → reveal → demo → payoff → cta"), consecutive repeats merged. */
export function beatTemplate(beats: readonly LabBeat[]): string {
  const seq: string[] = [];
  for (const b of beats) if (seq[seq.length - 1] !== b.type) seq.push(b.type);
  return seq.join(' → ');
}

/* ── trends (§4.10) ───────────────────────────────────────────────────── */

/** momentum = this week's breakout-weighted count ÷ the trailing 4-week weekly median. */
export function momentum(thisWeek: number, trailing4: readonly number[]): number | null {
  const m = median(trailing4);
  if (m === null) return null;
  if (m === 0) return thisWeek > 0 ? null : 0;
  return thisWeek / m;
}

/** A week's breakout-weighted count: posts + 2 per breakout (breakouts are the signal). */
export const weightedCount = (posts: number, breakouts: number): number => posts + 2 * breakouts;

export type TimingInput = {
  /** this week's weighted count and the trailing 4 weeks' */
  current: number;
  trailing4: readonly number[];
  creators: number;
  sourceCount: number;
  breakoutRate: number | null;
  breakoutRatePrev: number | null;
};

/**
 * Timing heuristic, CINTEL's rule as the base (rising = current >= 2 × trailing average
 * and current >= 2): rising with few creators and few sources is early; rising with
 * breakouts still landing is open; many creators with a falling breakout rate is
 * closing; momentum under 0.6 is closed. Persisted per day on lab_trend_snapshots.
 */
export function timing(t: TimingInput): LabTiming | null {
  if (t.trailing4.length === 0 && t.current === 0) return null;
  const avg = mean(t.trailing4) ?? 0;
  const mom = momentum(t.current, t.trailing4);
  const rising = (t.current >= 2 * avg && t.current >= 2) || (mom !== null && mom >= 1.5) || (mom === null && t.current >= 2);
  const falling = t.breakoutRate !== null && t.breakoutRatePrev !== null && t.breakoutRate < t.breakoutRatePrev;
  if (rising) {
    if (t.creators <= 4 && t.sourceCount <= 2) return 'early';
    if (falling && t.creators >= 12) return 'closing';
    return 'open';
  }
  if (mom !== null && mom < 0.6) return 'closed';
  if (falling || t.creators >= 12) return 'closing';
  return 'open';
}
