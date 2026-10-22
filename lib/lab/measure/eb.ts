/**
 * Empirical-Bayes baseline with a log-follower prior (04 3.4), robust log z (3.5) and
 * volatility (3.6). Pure. Every y is log10(max(basis, 1)).
 */
import type { LabPlatform } from '@/lib/schemas';
import type { Surface } from '@/lib/lab/measure/baseline';

/** Variance of a median: pi/2 x sigma^2 / n. */
export const MEDIAN_VAR = 1.5708;
/** Shrinkage of a cell's spread toward the pooled spread. */
export const SPREAD_K = 5;
/** Pooled spread until 3 cells with n >= 5 exist. */
export const DEFAULT_S2 = 0.06;
export const TAU2_FLOOR = 0.01;
export const MIN_CELL_N = 5;
/** OLS prior needs this many cells; 3 to 7 give a flat prior. */
export const OLS_MIN_CELLS = 8;
export const FLAT_MIN_CELLS = 3;
export const Z90 = 1.645;

const medianOf = (xs: readonly number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

/** Robust centre and spread of a sample: median and 1.4826 x MAD. */
export function robustSpread(ys: readonly number[]): { m: number; s: number } {
  const m = medianOf(ys);
  const mad = medianOf(ys.map((y) => Math.abs(y - m)));
  return { m, s: 1.4826 * mad };
}

export type EbFit = { platform: LabPlatform; surface: Surface; ageH: number; alpha: number | null; beta: number | null; flatPrior: number | null; S2: number; tau2: number; cells: number };

/**
 * Fit the pooled spread S^2, the prior (OLS of m_c on log10 F_c with 8+ cells, else the median
 * m_c with 3 to 7 cells, else none) and tau^2 (method of moments, floored at 0.01) over the cells
 * on one platform x surface x age with n >= 5.
 */
export function fitEb(cells: readonly { m: number; s2: number; n: number; logF: number | null }[], key: Omit<EbFit, 'alpha' | 'beta' | 'flatPrior' | 'S2' | 'tau2' | 'cells'>): EbFit {
  const fit = cells.filter((c) => c.n >= MIN_CELL_N && Number.isFinite(c.m));
  const S2 = fit.length >= FLAT_MIN_CELLS ? medianOf(fit.map((c) => c.s2)) : DEFAULT_S2;
  let alpha: number | null = null;
  let beta: number | null = null;
  let flatPrior: number | null = null;
  const withF = fit.filter((c) => c.logF !== null && Number.isFinite(c.logF));
  if (withF.length >= OLS_MIN_CELLS) {
    const xs = withF.map((c) => c.logF as number);
    const ys = withF.map((c) => c.m);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    if (sxx > 0) {
      beta = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
      alpha = my - beta * mx;
    }
  }
  if (alpha === null && fit.length >= FLAT_MIN_CELLS) flatPrior = medianOf(fit.map((c) => c.m));

  let tau2 = TAU2_FLOOR;
  const priorOf = (c: { logF: number | null }): number | null => (alpha !== null && beta !== null ? (c.logF === null ? null : alpha + beta * c.logF) : flatPrior);
  const resid: number[] = [];
  const se2s: number[] = [];
  for (const c of fit) {
    const p = priorOf(c);
    if (p === null) continue;
    resid.push(c.m - p);
    se2s.push((MEDIAN_VAR * ((c.n * c.s2 + SPREAD_K * S2) / (c.n + SPREAD_K))) / c.n);
  }
  if (resid.length >= 2) {
    const mr = resid.reduce((a, b) => a + b, 0) / resid.length;
    const v = resid.reduce((a, r) => a + (r - mr) ** 2, 0) / (resid.length - 1);
    const mse = se2s.reduce((a, b) => a + b, 0) / se2s.length;
    tau2 = Math.max(TAU2_FLOOR, v - mse);
  }
  return { ...key, alpha, beta, flatPrior, S2, tau2, cells: fit.length };
}

export type EbBaseline = { m: number; sTilde: number; se2: number; prior: number | null; B: number; b: number; V: number; n: number; source: 'matched' | 'projected' };

/** The posterior baseline for one cell sample (y values at the judge age). Null when n < 5. */
export function ebBaseline(sample: readonly number[], fit: EbFit, logF: number | null, extraVar = 0, source: 'matched' | 'projected' = 'matched'): EbBaseline | null {
  const n = sample.length;
  if (n < MIN_CELL_N) return null;
  const { m, s } = robustSpread(sample);
  const s2t = (n * s * s + SPREAD_K * fit.S2) / (n + SPREAD_K);
  const se2 = (MEDIAN_VAR * s2t) / n;
  const prior = fit.alpha !== null && fit.beta !== null ? (logF === null ? null : fit.alpha + fit.beta * logF) : fit.flatPrior;
  const B = prior === null ? 0 : se2 / (se2 + fit.tau2);
  const b = prior === null ? m : B * prior + (1 - B) * m;
  // no prior: the posterior is the sample median, whose variance is se^2 (the tau^2 -> infinity limit)
  const V = (prior === null ? se2 : B * fit.tau2) + extraVar;
  return { m, sTilde: Math.sqrt(s2t), se2, prior, B, b, V, n, source };
}

/** The ratio, its 90% interval, and robust z = (y_t - b) / s~ (3.5; 0.6745 x 1.4826 = 1). */
export function ratioOf(yT: number, eb: EbBaseline): { ratio: number; lo: number; hi: number; z: number } {
  const d = yT - eb.b;
  const half = Z90 * Math.sqrt(eb.V);
  return { ratio: 10 ** d, lo: 10 ** (d - half), hi: 10 ** (d + half), z: d / eb.sTilde };
}

export type VolatilityClass = 'steady' | 'normal' | 'swingy';
/** steady s~ < 0.15; normal 0.15 to 0.35; swingy > 0.35 */
export function volatilityClass(sTilde: number | null): VolatilityClass | null {
  if (sTilde === null || !Number.isFinite(sTilde)) return null;
  if (sTilde < 0.15) return 'steady';
  if (sTilde <= 0.35) return 'normal';
  return 'swingy';
}
/** "Usually lands between 10^-s~ and 10^s~ of normal". */
export const volatilityBand = (sTilde: number): [number, number] => [10 ** -sTilde, 10 ** sTilde];
