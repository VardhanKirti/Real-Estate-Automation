/**
 * Test-only reference of section 04's measurement maths (04 3.1, 3.2, 3.4, 3.8, 6.2), used by the
 * ledger tests while lane D's functions are still LAB_STUBs in lib/lab/ledger/deps.ts. Once lane D
 * merges, `withMeasureFallback` probes each real function, finds it built and uses it instead, so
 * the same ledger tests then run against 04's real code.
 */
import type { LabCreatorSnapshot, LabPlatform, LabPost, LabPostMetrics } from '@/lib/schemas';
import type * as Deps from '@/lib/lab/ledger/deps';

type AgeValue = Deps.AgeValue;
type EbFit = Deps.EbFit;
type EbBaseline = Deps.EbBaseline;
type Surface = Deps.Surface;

const H = 3_600_000;
const median = (xs: readonly number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function valueAtAge(snaps: readonly { capturedAt: string; basis: number | null }[], postedAt: string, targetH: number, asOf: string): AgeValue | null {
  const cut = Date.parse(asOf);
  const pts = snaps
    .filter((s) => s.basis !== null && Date.parse(s.capturedAt) <= cut)
    .map((s) => ({ age: (Date.parse(s.capturedAt) - Date.parse(postedAt)) / H, v: s.basis as number }))
    .filter((p) => p.age >= 0)
    .sort((a, b) => a.age - b.age);
  if (!pts.length) return null;
  const y = (v: number) => Math.log10(Math.max(v, 1));
  const lo = [...pts].reverse().find((p) => p.age < targetH);
  const hi = pts.find((p) => p.age > targetH);
  if (lo && hi && lo.age > 0 && hi.age <= 3 * lo.age && hi.age - lo.age <= 168) {
    const f = (Math.log(targetH) - Math.log(lo.age)) / (Math.log(hi.age) - Math.log(lo.age));
    const yy = y(lo.v) + (y(hi.v) - y(lo.v)) * f;
    return { ageH: targetH, views: 10 ** yy, y: yy, how: 'interpolated', fromH: [lo.age, hi.age] };
  }
  const tol = Math.max(0.5, 0.25 * targetH);
  const near = [...pts].sort((a, b) => Math.abs(a.age - targetH) - Math.abs(b.age - targetH))[0];
  if (Math.abs(near.age - targetH) <= tol) return { ageH: targetH, views: near.v, y: y(near.v), how: 'nearest', fromH: [near.age, near.age] };
  if (targetH === 336 && pts[pts.length - 1].age > 336) {
    const m = pts.find((p) => p.age >= 336)!;
    return { ageH: targetH, views: m.v, y: y(m.v), how: 'mature', fromH: [m.age, m.age] };
  }
  return null;
}

export function surfaceOf(post: Pick<LabPost, 'platform' | 'contentType'>): Surface {
  if (post.platform === 'youtube') return post.contentType === 'short' ? 'short' : 'long';
  const c = post.contentType as Surface;
  return (['short', 'long', 'reel', 'image', 'carousel', 'text', 'video'] as const).includes(c) ? c : 'video';
}

export function cellKey(post: Pick<LabPost, 'sourceId' | 'platform' | 'contentType' | 'postedAt'>): string {
  const s = surfaceOf(post);
  const epoch = post.platform === 'youtube' && s === 'short' && post.postedAt && post.postedAt < '2025-03-31T00:00:00Z' ? 'yt_shorts_pre_2025_03_31' : 'current';
  return `${post.sourceId}|${s}|${epoch}`;
}

const shrunk = (n: number, s2: number, S2: number) => (n * s2 + 5 * S2) / (n + 5);

export function fitEb(cells: readonly { m: number; s2: number; n: number; logF: number | null }[], key: Omit<EbFit, 'alpha' | 'beta' | 'flatPrior' | 'S2' | 'tau2' | 'cells'>): EbFit {
  const fit = cells.filter((c) => c.n >= 5);
  const S2 = fit.length >= 3 ? median(fit.map((c) => c.s2)) : 0.06;
  const withF = fit.filter((c) => c.logF !== null);
  let alpha: number | null = null;
  let beta: number | null = null;
  let flatPrior: number | null = null;
  if (withF.length >= 8) {
    const mx = withF.reduce((s, c) => s + c.logF!, 0) / withF.length;
    const my = withF.reduce((s, c) => s + c.m, 0) / withF.length;
    const sxx = withF.reduce((s, c) => s + (c.logF! - mx) ** 2, 0);
    beta = sxx ? withF.reduce((s, c) => s + (c.logF! - mx) * (c.m - my), 0) / sxx : 0;
    alpha = my - beta * mx;
  } else if (fit.length >= 3) flatPrior = median(fit.map((c) => c.m));
  const prior = (c: { logF: number | null }) => (alpha !== null && c.logF !== null ? alpha + beta! * c.logF : flatPrior);
  const resid = fit.filter((c) => prior(c) !== null).map((c) => c.m - prior(c)!);
  const se2 = fit.map((c) => (1.5708 * shrunk(c.n, c.s2, S2)) / c.n);
  const varR = resid.length > 1 ? resid.reduce((s, r) => s + (r - resid.reduce((a, b) => a + b, 0) / resid.length) ** 2, 0) / (resid.length - 1) : 0;
  const tau2 = Math.max(0.01, varR - (se2.length ? se2.reduce((a, b) => a + b, 0) / se2.length : 0));
  return { ...key, alpha, beta, flatPrior, S2, tau2, cells: fit.length };
}

export function ebBaseline(sample: readonly number[], fit: EbFit, logF: number | null, extraVar = 0): EbBaseline | null {
  const n = sample.length;
  if (n < 5) return null;
  const m = median(sample);
  const s = 1.4826 * median(sample.map((y) => Math.abs(y - m)));
  const st2 = shrunk(n, s * s, fit.S2);
  const se2 = (1.5708 * st2) / n;
  const prior = fit.alpha !== null && fit.beta !== null && logF !== null ? fit.alpha + fit.beta * logF : fit.flatPrior;
  const B = prior === null ? 0 : se2 / (se2 + fit.tau2);
  const b = prior === null ? m : B * prior + (1 - B) * m;
  return { m, sTilde: Math.sqrt(st2), se2, prior, B, b, V: B * fit.tau2 + extraVar, n, source: 'matched' };
}

export function followersAsOf(snaps: readonly LabCreatorSnapshot[], postedAt: string): { followers: number; asOf: 'before' | 'backfill' } | null {
  const t = Date.parse(postedAt);
  const withF = snaps.filter((s) => s.followers !== null);
  const before = withF.filter((s) => Date.parse(s.capturedAt) <= t).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  if (before) return { followers: before.followers!, asOf: 'before' };
  const after = withF.filter((s) => Date.parse(s.capturedAt) > t && Date.parse(s.capturedAt) <= t + 7 * 24 * H).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))[0];
  return after ? { followers: after.followers!, asOf: 'backfill' } : null;
}

export function metricBasis(platform: LabPlatform, m: Pick<LabPostMetrics, 'views' | 'likes' | 'comments' | 'shares' | 'saves'> & { quotes?: number | null }): { basis: 'views' | 'x_action' | 'li_reactions'; value: number | null } {
  if (platform === 'linkedin') return { basis: 'li_reactions', value: m.likes === null && m.comments === null && m.shares === null ? null : (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) };
  if (platform === 'twitter' && m.views === null) return { basis: 'x_action', value: 0.5 * (m.likes ?? 0) + (m.shares ?? 0) + 5 * (m.comments ?? 0) + 5 * (m.quotes ?? 0) };
  return { basis: 'views', value: m.views };
}

const REF = { valueAtAge, surfaceOf, cellKey, fitEb, ebBaseline, followersAsOf, metricBasis };

const isStub = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch (err) {
    return (err as Error)?.name === 'LabStubError';
  }
};

/** The deps module with every lane D function that is still a stub replaced by the reference. */
export function withMeasureFallback(real: typeof Deps): typeof Deps {
  const post = { sourceId: 's', platform: 'instagram' as const, contentType: 'reel', postedAt: '2026-01-01T00:00:00.000Z' };
  const fit: EbFit = { platform: 'instagram', surface: 'reel', ageH: 168, alpha: null, beta: null, flatPrior: null, S2: 0.06, tau2: 0.04, cells: 0 };
  const probes: Record<keyof typeof REF, () => unknown> = {
    valueAtAge: () => real.valueAtAge([], post.postedAt, 24, post.postedAt),
    surfaceOf: () => real.surfaceOf(post),
    cellKey: () => real.cellKey(post),
    fitEb: () => real.fitEb([], { platform: 'instagram', surface: 'reel', ageH: 168 }),
    ebBaseline: () => real.ebBaseline([1, 2, 3, 4, 5], fit, null),
    followersAsOf: () => real.followersAsOf([], post.postedAt),
    metricBasis: () => real.metricBasis('instagram', { views: 1, likes: 0, comments: 0, shares: 0, saves: 0 }),
  };
  const out: Record<string, unknown> = { ...real };
  for (const k of Object.keys(REF) as (keyof typeof REF)[]) if (isStub(probes[k])) out[k] = REF[k];
  return out as typeof Deps;
}
