/**
 * Ledger metrics (06 section 5): within-creator pairwise accuracy, Spearman within creator, log
 * MAE, interval coverage, PR-AUC next to the base rate, the stratified bootstrap and the seeded
 * RNG. Pure functions, no store, no clock.
 */
import { quantile, wilson } from '@/lib/lab/measures';

/* ── RNG (06 5.6): mulberry32(fnv1a32(seed)) ───────────────────────────────────── */

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic stream for a string seed. */
export function rng(seed: string): () => number {
  return mulberry32(fnv1a32(seed));
}

/** Standard normal draw (Box-Muller) from a uniform stream. */
export function normal(next: () => number): number {
  const u = Math.max(next(), 1e-12);
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ── Metrics ─────────────────────────────────────────────────────────────────── */

/** One graded post for ranking metrics: its creator, the predictor's score and the outcome y. */
export type RankRow = { creator: string; s: number; y: number };

const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

function byCreator<T extends { creator: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.creator);
    if (list) list.push(r);
    else m.set(r.creator, [r]);
  }
  return m;
}

/** 06 5.1: pairs within one creator whose outcomes differ by 0.01 or more; ties in score earn 0.5. */
export function pairwiseAccuracy(rows: readonly RankRow[]): { acc: number; pairs: number } | null {
  let credit = 0;
  let pairs = 0;
  for (const list of byCreator(rows).values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dy = list[i].y - list[j].y;
        if (Math.abs(dy) < 0.01) continue;
        pairs++;
        const ds = list[i].s - list[j].s;
        if (ds === 0) credit += 0.5;
        else if (sign(ds) === sign(dy)) credit += 1;
      }
    }
  }
  return pairs ? { acc: credit / pairs, pairs } : null;
}

/** Average ranks (1-based), ties share the mean rank. */
export function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  if (n < 2) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

/** 06 5.2: Spearman per creator (n_c >= 5), pooled weighted by n_c. */
export function spearmanWithin(rows: readonly RankRow[]): { rho: number; n: number } | null {
  let num = 0;
  let den = 0;
  for (const list of byCreator(rows).values()) {
    if (list.length < 5) continue;
    const rho = pearson(ranks(list.map((r) => r.s)), ranks(list.map((r) => r.y)));
    if (rho === null) continue;
    num += list.length * rho;
    den += list.length;
  }
  return den ? { rho: num / den, n: den } : null;
}

/** log10(v + 1), the ledger's error scale. */
export const log1p10 = (v: number) => Math.log10(Math.max(0, v) + 1);

/** 06 5.3: mean |log10(point + 1) - log10(actual + 1)|. */
export function logMae(rows: readonly { point: number; actual: number }[]): number | null {
  if (!rows.length) return null;
  return rows.reduce((s, r) => s + Math.abs(log1p10(r.point) - log1p10(r.actual)), 0) / rows.length;
}

/** "typically off by x1.5": 10^logMae to one decimal. */
export function typicalFactor(mae: number): number {
  return Math.round(10 ** mae * 10) / 10;
}

/** 06 5.4: share of rows inside their interval, with the Wilson 90% interval. */
export function coverage(flags: readonly (boolean | null)[]): { value: number; k: number; m: number; lo: number; hi: number } | null {
  const usable = flags.filter((f): f is boolean => f !== null);
  if (!usable.length) return null;
  const k = usable.filter(Boolean).length;
  const [lo, hi] = wilson90(k, usable.length);
  return { value: k / usable.length, k, m: usable.length, lo, hi };
}

/** Wilson 90% (z 1.645), v1's `wilson`. */
export function wilson90(k: number, n: number): [number, number] {
  return wilson(k, n, 1.645) ?? [0, 1];
}

/** 06 5.5: average precision, ties broken by postId ascending; needs 3 positives and 3 negatives. */
export function prAuc(rows: readonly { score: number; positive: boolean; postId: string }[]): { ap: number; base: number; P: number; n: number } | null {
  const P = rows.filter((r) => r.positive).length;
  const n = rows.length;
  if (P < 3 || n - P < 3) return null;
  const sorted = [...rows].sort((a, b) => b.score - a.score || (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0));
  let hits = 0;
  let sum = 0;
  sorted.forEach((r, i) => {
    if (!r.positive) return;
    hits++;
    sum += hits / (i + 1);
  });
  return { ap: sum / P, base: P / n, P, n };
}

/**
 * 06 5.6: percentile bootstrap, resampling by post within creator (stratified: each creator
 * draws n_c of its own rows with replacement). Deterministic for a seed.
 */
export function bootstrap<T>(rows: readonly T[], stat: (rs: T[]) => number | null, opts: { B?: number; level?: number; seed: string; clusterBy: (r: T) => string }): { lo: number; hi: number } | null {
  const B = opts.B ?? 2000;
  const level = opts.level ?? 0.9;
  if (!rows.length) return null;
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = opts.clusterBy(r);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const keys = [...groups.keys()].sort();
  const next = rng(opts.seed);
  const stats: number[] = [];
  for (let b = 0; b < B; b++) {
    const sample: T[] = [];
    for (const k of keys) {
      const g = groups.get(k)!;
      for (let i = 0; i < g.length; i++) sample.push(g[Math.floor(next() * g.length)]);
    }
    const v = stat(sample);
    if (v !== null && Number.isFinite(v)) stats.push(v);
  }
  if (!stats.length) return null;
  const tail = (1 - level) / 2;
  return { lo: quantile(stats, tail)!, hi: quantile(stats, 1 - tail)! };
}

/**
 * Newcombe hybrid score interval for p1 - p2 (06 10.3), from Wilson bounds at z (90%: 1.645).
 * lo = d - sqrt((p1 - l1)^2 + (u2 - p2)^2), hi = d + sqrt((u1 - p1)^2 + (p2 - l2)^2).
 */
export function newcombe(k1: number, n1: number, k2: number, n2: number, z = 1.645): { d: number; lo: number; hi: number } {
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const [l1, u1] = wilson(k1, n1, z) ?? [0, 1];
  const [l2, u2] = wilson(k2, n2, z) ?? [0, 1];
  const d = p1 - p2;
  return { d, lo: d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), hi: d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2) };
}

/** Sample variance (n - 1). */
export function variance(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}
