/**
 * Readiness predictions for each n gate (09.3). Every gate is an existing rule owned by 04, 05 or
 * 06; this file only predicts when it is met. The formula part (mu_q, Wilson, Poisson ranges,
 * predictGates) is pure and ships to the browser with PlanInputs; gateRates and gateCounts read
 * the store they are handed (type-only import, so this module stays browser-safe).
 *
 * Rates are observed first and labelled priors before (09.3.3). The profile's interval is the
 * Mantel-Haenszel odds-ratio interval (multiplicative, shown as "about x{w} either side"), not a
 * Wilson interval; Wilson is for rates only.
 */
import type { LabPlatform } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { PlanSelection } from '@/lib/lab/setup/estimate';

export type GateId = 'baseline_24h' | 'breakouts_week' | 'forecast_fit_24h' | 'profile_family' | 'profile_strong' | 'profile_moderate' | 'radar_crowd' | 'niche_baseline';

export type RateSource = 'observed' | 'blended' | 'prior';
export type Rate = { value: number; source: RateSource; n: number; note: string };
export type GateRates = {
  /** f: posts per tracked creator per week */
  postsPerWeek: Rate;
  /** r: cases / judged at verdict age */
  breakoutRate: Rate;
  /** q: share of cases dropped from mining */
  excluded: Rate;
  /** phi: share of cases in the largest format family */
  topFamilyShare: Rate;
  /** p0: share of controls carrying a typical shown value */
  valuePrevalence: Rate;
  /** u24: share of tracked posts with a usable 24 h value */
  read24Share: Rate;
  /** 8+ cells with n >= 5 at 24 h and 168 h */
  priorFitted: Record<LabPlatform, boolean>;
};

export type GateEta = {
  gate: GateId;
  platform: LabPlatform | 'all';
  state: 'met' | 'predicted' | 'blocked' | 'not_applicable';
  metAt: string | null;
  /** from now */
  days: { lo: number; med: number; hi: number } | null;
  /** breakouts_week only */
  rate: number | null;
  rateRange: [number, number] | null;
  /** profile gates */
  interval: { widthFactor: number; atCases: number } | null;
  /** 'Needs 8 creators on Instagram for a fitted prior' etc. */
  blockedReason: string | null;
  sources: RateSource[];
};

export type GateCounts = { casesTopFamily: number; casesWithTopValue: number; pairs24h: Record<LabPlatform, number>; matchedPerCreator: Record<string, number>; activeTracked: number };

/* ── priors (09.3.3) ──────────────────────────────────────────────────────── */

export const GATE_PRIORS = { f: 4, r: 0.05, q: 0.15, phi: 0.4, p0: 0.18, u24: 0.75 } as const;
/** Effect sizes the profile gates are predicted for (illustrative, open item 19). */
export const OR_STRONG = 4;
export const OR_MODERATE = 2.5;
/** 90% two-sided z. */
export const Z90 = 1.645;
const PLATFORMS: LabPlatform[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'];
export const PLATFORM_NAME: Record<LabPlatform, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X' };

/* ── Poisson and Wilson (pure) ───────────────────────────────────────────── */

/** P(X >= N) for X ~ Poisson(mu). */
export function poissonTail(N: number, mu: number): number {
  if (N <= 0) return 1;
  if (mu <= 0) return 0;
  let term = Math.exp(-mu);
  let cdf = term;
  for (let k = 1; k < N; k++) {
    term *= mu / k;
    cdf += term;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

/** The Poisson mean at which P(X >= N) = q (09.3.4): mu_0.1(8) 4.66, mu_0.5(8) 7.67, mu_0.9(8) 11.77. 0 when N <= 0. */
export function muQ(q: number, N: number): number {
  if (N <= 0) return 0;
  let lo = 0;
  let hi = Math.max(10, N * 4 + 20);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (poissonTail(N, mid) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The p-th quantile of Poisson(lambda): the smallest k with CDF(k) >= p. */
export function poissonQuantile(p: number, lambda: number): number {
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda);
  let cdf = term;
  let k = 0;
  while (cdf < p && k < 100_000) {
    k++;
    term *= lambda / k;
    cdf += term;
  }
  return k;
}

/** Wilson interval at z 1.645 (09.3.3): k 5, n 100 gives 0.0245 to 0.0992. */
export function wilson90(k: number, n: number, z = Z90): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/* ── the profile maths (09.3.4) ──────────────────────────────────────────── */

/** Prevalence among cases for a value with odds ratio OR and control prevalence p0. */
export const caseShare = (or: number, p0: number) => (or * p0) / (1 - p0 + or * p0);
/** Woolf variance per case at one control per case. */
export const woolfK = (p1: number, p0: number) => 1 / p1 + 1 / (1 - p1) + 1 / p0 + 1 / (1 - p0);
/** Family cases for the 90% interval to exclude 1. */
export const nInterval = (or: number, p0: number) => Math.ceil(woolfK(caseShare(or, p0), p0) * (Z90 / Math.log(or)) ** 2);
/** The interval's multiplicative half-width at the gate. */
export function widthAtGate(or: number, p0: number): { widthFactor: number; atCases: number } {
  const p1 = caseShare(or, p0);
  const K = woolfK(p1, p0);
  const ng = Math.max(8 / p1, nInterval(or, p0));
  return { widthFactor: Math.exp(Z90 * Math.sqrt(K / ng)), atCases: ng };
}

const QS = [0.1, 0.5, 0.9] as const;
const r1 = (x: number) => Math.round(x * 10) / 10;
const daysOf = (f: (q: number) => number, adjust: number | null) => {
  const k = adjust ?? 1;
  const [lo, med, hi] = QS.map((q) => Math.max(0, f(q) * k));
  return { lo: r1(lo), med: r1(med), hi: r1(hi) };
};

/**
 * Predict every gate for a selection (09.3.4). `counts` are what the store already holds (they
 * are subtracted, and a profile already accruing cases skips the warm-up); `adjust` scales the
 * days by the Lab's own record (09.3.6, null under 5 graded rows).
 */
export function predictGates(rates: GateRates, sel: PlanSelection, counts: GateCounts, now: Date, adjust: number | null): GateEta[] {
  void now;
  const f = rates.postsPerWeek.value;
  const u24 = rates.read24Share.value;
  const r = rates.breakoutRate.value;
  const q = rates.excluded.value;
  const phi = rates.topFamilyShare.value;
  const p0 = rates.valuePrevalence.value;
  const byPlatform = new Map<LabPlatform, number>();
  for (const t of sel.tracked) byPlatform.set(t.platform, (byPlatform.get(t.platform) ?? 0) + Math.max(0, t.count));
  const C = [...byPlatform.values()].reduce((a, b) => a + b, 0);
  const allSources = [...new Set([rates.postsPerWeek.source, rates.breakoutRate.source, rates.read24Share.source])];
  const base = (gate: GateId, platform: LabPlatform | 'all'): GateEta => ({ gate, platform, state: 'predicted', metAt: null, days: null, rate: null, rateRange: null, interval: null, blockedReason: null, sources: allSources });
  const out: GateEta[] = [];

  // breakouts per week: lambda_b = C x f x r, 90% range = Poisson 5th and 95th percentiles
  {
    const g = base('breakouts_week', 'all');
    const lambda = C * f * r;
    if (C === 0) out.push({ ...g, state: 'blocked', blockedReason: 'Add creators to see what this set gets you.' });
    else out.push({ ...g, rate: r1(lambda), rateRange: [poissonQuantile(0.05, lambda), poissonQuantile(0.95, lambda)], sources: [rates.postsPerWeek.source, rates.breakoutRate.source] });
  }

  const platforms = PLATFORMS.filter((p) => (byPlatform.get(p) ?? 0) > 0);
  // a fitted prior needs 8+ creators on the platform (09.3.4)
  const fitted = (p: LabPlatform) => (byPlatform.get(p) ?? 0) >= 8;
  const perDay = f * u24 / 7;

  for (const p of platforms) {
    const Cp = byPlatform.get(p) ?? 0;
    // baseline_24h, per creator on p (median creator)
    const g = base('baseline_24h', p);
    const nNeed = fitted(p) ? 5 : 10;
    const matched = Object.values(counts.matchedPerCreator);
    const have = matched.length ? [...matched].sort((a, b) => a - b)[Math.floor(matched.length / 2)] : 0;
    const left = Math.max(0, nNeed - have);
    const blockedReason = fitted(p) ? null : `Needs 8 creators on ${PLATFORM_NAME[p]} for a fitted prior`;
    if (left === 0) out.push({ ...g, state: 'met', days: { lo: 0, med: 0, hi: 0 }, blockedReason, sources: [rates.postsPerWeek.source, rates.read24Share.source] });
    else out.push({ ...g, days: daysOf((qq) => 1 + muQ(qq, left) / perDay, adjust), blockedReason, sources: [rates.postsPerWeek.source, rates.read24Share.source] });

    // forecast_fit_24h, per platform: 20 pairs, each 7.5 days old
    const fg = base('forecast_fit_24h', p);
    const pairsNow = counts.pairs24h[p] ?? 0;
    const pairsLeft = Math.max(0, 20 - pairsNow);
    if (pairsLeft === 0) out.push({ ...fg, state: 'met', days: { lo: 0, med: 0, hi: 0 } });
    else out.push({ ...fg, days: daysOf((qq) => 7.5 + muQ(qq, pairsLeft) / (Cp * perDay), adjust) });

    // niche_baseline at 24 h: 20 tracked posts at that age in 90 days
    const ng = base('niche_baseline', p);
    out.push({ ...ng, days: daysOf((qq) => muQ(qq, 20) / (Cp * perDay) + 24 / 24, adjust) });
  }

  // Viral Profile (top family)
  if (C > 0) {
    const allFitted = platforms.every(fitted);
    const warm = counts.casesTopFamily > 0;
    const tStart = warm ? 0 : (7 * (allFitted ? 5 : 10)) / f + 8;
    const lambdaF = ((C * f) / 7) * r * (1 - q) * phi;
    const famLeft = Math.max(0, 8 - counts.casesTopFamily);
    const fam = base('profile_family', 'all');
    fam.sources = [rates.breakoutRate.source, rates.excluded.source, rates.topFamilyShare.source];
    out.push(famLeft === 0 ? { ...fam, state: 'met', days: { lo: 0, med: 0, hi: 0 } } : { ...fam, days: daysOf((qq) => tStart + muQ(qq, famLeft) / lambdaF, adjust) });
    for (const [gate, or] of [['profile_strong', OR_STRONG], ['profile_moderate', OR_MODERATE]] as const) {
      const g = base(gate, 'all');
      g.sources = [rates.breakoutRate.source, rates.excluded.source, rates.topFamilyShare.source, rates.valuePrevalence.source];
      const p1 = caseShare(or, p0);
      const nInt = nInterval(or, p0);
      const aLeft = Math.max(0, 8 - counts.casesWithTopValue);
      const iLeft = Math.max(0, nInt - counts.casesTopFamily);
      const interval = widthAtGate(or, p0);
      if (aLeft === 0 && iLeft === 0) {
        out.push({ ...g, state: 'met', days: { lo: 0, med: 0, hi: 0 }, interval: { widthFactor: Math.round(interval.widthFactor * 100) / 100, atCases: Math.round(interval.atCases * 10) / 10 } });
        continue;
      }
      out.push({
        ...g,
        days: daysOf((qq) => Math.max(tStart + muQ(qq, aLeft) / (lambdaF * p1), tStart + muQ(qq, iLeft) / lambdaF), adjust),
        interval: { widthFactor: Math.round(interval.widthFactor * 100) / 100, atCases: Math.round(interval.atCases * 10) / 10 },
      });
    }
  } else {
    for (const gate of ['profile_family', 'profile_strong', 'profile_moderate'] as const) out.push({ ...base(gate, 'all'), state: 'blocked', blockedReason: 'Add creators to see what this set gets you.' });
  }

  // radar crowd rule: 5 tracked creators who post
  {
    const g = base('radar_crowd', 'all');
    const n = Math.max(C, counts.activeTracked);
    out.push(n >= 5 ? { ...g, state: 'met', days: { lo: 0, med: 0, hi: 0 } } : { ...g, state: 'blocked', blockedReason: `Needs 5 creators who post (you have ${n})` });
  }
  return out;
}

/* ── observed rates and counts (read the store it is handed) ─────────────── */

const DAY = 86_400_000;
const rate = (value: number, source: RateSource, n: number, note: string): Rate => ({ value, source, n, note });
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Does a post have a usable 24 h value (04 3.1: a read at 18 to 30 h, or two reads bracketing 24 h with s2 <= 3 s1)? */
function has24(ages: number[]): boolean {
  if (ages.some((a) => a >= 18 && a <= 30)) return true;
  const before = ages.filter((a) => a < 24).sort((a, b) => b - a)[0];
  const after = ages.filter((a) => a > 24).sort((a, b) => a - b)[0];
  return before !== undefined && after !== undefined && before > 0 && after <= 3 * before;
}

/** Observed rates with labelled priors (09.3.3). Never fetches. */
export function gateRates(store: LabStore, now: Date): GateRates {
  const T = now.getTime();
  const tracked = store.sources.all('tracked').filter((s) => s.status === 'active');
  const trackedIds = new Set(tracked.map((s) => s.id));
  const posts = store.posts.all().filter((p) => trackedIds.has(p.sourceId));
  const recent = posts.filter((p) => p.postedAt && T - Date.parse(p.postedAt) <= 28 * DAY && Date.parse(p.postedAt) <= T);
  const activeCreators = new Set(recent.map((p) => p.sourceId));
  const fObs = activeCreators.size ? recent.length / activeCreators.size / 4 : 0;
  const postsPerWeek = activeCreators.size >= 5 ? rate(fObs, 'observed', activeCreators.size, `from ${activeCreators.size} creators over 28 days`) : rate(GATE_PRIORS.f, 'prior', activeCreators.size, 'assumed 4 a week');

  // breakout rate: beta prior worth 100 posts at 0.05, over 90 days of verdicts
  const measures = store.measures.all();
  const postById = new Map(store.posts.all().map((p) => [p.id, p]));
  const judged = measures.filter((m) => {
    const p = postById.get(m.postId);
    return p && !p.isOwned && m.breakout !== null && p.postedAt && T - Date.parse(p.postedAt) <= 90 * DAY;
  });
  const k = judged.filter((m) => m.isBreakout).length;
  const n = judged.length;
  const rBlend = (k + GATE_PRIORS.r * 100) / (n + 100);
  const breakoutRate = n === 0 ? rate(GATE_PRIORS.r, 'prior', 0, 'assumed until 100 posts are judged') : rate(rBlend, n >= 400 ? 'observed' : 'blended', n, `${k} of ${n} judged`);

  const cases = store.controls.all().filter((c) => c.role === 'case');
  const controls = store.controls.all().filter((c) => c.role === 'control');
  const exo = cases.filter((c) => postById.get(c.postId)?.exoReason);
  const excluded = cases.length >= 20 ? rate(exo.length / cases.length, 'observed', cases.length, `${exo.length} of ${cases.length} cases`) : rate(GATE_PRIORS.q, 'prior', cases.length, 'assumed');

  const fam = new Map<string, number>();
  for (const c of cases) {
    const d = store.dissections.get(c.postId);
    if (d?.format) fam.set(d.format, (fam.get(d.format) ?? 0) + 1);
  }
  const top = Math.max(0, ...fam.values());
  const famTotal = [...fam.values()].reduce((a, b) => a + b, 0);
  const topFamilyShare = famTotal >= 20 ? rate(top / famTotal, 'observed', famTotal, 'largest family') : rate(GATE_PRIORS.phi, 'prior', famTotal, 'assumed');

  const prevalences: number[] = [];
  for (const p of store.profiles.latest()) {
    const nonCases = Math.max(1, p.postsN - p.breakoutsN);
    for (const f of p.features) if (f.n + Math.max(0, f.total - f.n) >= 5) prevalences.push(Math.max(0, f.total - f.n) / nonCases);
  }
  const p0Obs = median(prevalences);
  const valuePrevalence = controls.length >= 30 && p0Obs !== null ? rate(p0Obs, 'observed', controls.length, 'median among controls') : rate(GATE_PRIORS.p0, 'prior', controls.length, 'assumed');

  const metrics = store.metrics.byPost();
  const old = posts.filter((p) => p.postedAt && T - Date.parse(p.postedAt) >= 2 * DAY);
  const with24 = old.filter((p) => has24((metrics.get(p.id) ?? []).map((m) => m.ageH ?? (p.postedAt ? (Date.parse(m.capturedAt) - Date.parse(p.postedAt)) / 3_600_000 : -1)).filter((a) => a >= 0)));
  const read24Share = old.length >= 50 ? rate(with24.length / old.length, 'observed', old.length, `${with24.length} of ${old.length} posts`) : rate(GATE_PRIORS.u24, 'prior', old.length, 'derived from daily reads');

  const priorFitted = Object.fromEntries(PLATFORMS.map((pl) => {
    const creators = tracked.filter((s) => s.platform === pl);
    const enough = creators.filter((s) => (store.posts.bySource(s.id).filter((p) => has24((metrics.get(p.id) ?? []).map((m) => m.ageH ?? -1).filter((a) => a >= 0))).length) >= 5);
    return [pl, enough.length >= 8];
  })) as Record<LabPlatform, boolean>;

  return { postsPerWeek, breakoutRate, excluded, topFamilyShare, valuePrevalence, read24Share, priorFitted };
}

/** What the store already holds against each gate (09.3.8). Never fetches. */
export function gateCounts(store: LabStore, now: Date): GateCounts {
  const T = now.getTime();
  const cases = store.controls.all().filter((c) => c.role === 'case');
  const fam = new Map<string, number>();
  for (const c of cases) {
    const d = store.dissections.get(c.postId);
    if (d?.format) fam.set(d.format, (fam.get(d.format) ?? 0) + 1);
  }
  let topFamily: string | null = null;
  for (const [f, k] of fam) if (topFamily === null || k > (fam.get(topFamily) ?? 0)) topFamily = f;
  const casesTopFamily = topFamily ? fam.get(topFamily) ?? 0 : 0;
  const profile = topFamily ? store.profiles.latest().find((p) => p.formatFamily === topFamily) : undefined;
  const casesWithTopValue = Math.max(0, ...(profile?.features ?? []).map((f) => f.n));

  const metrics = store.metrics.byPost();
  const pairs24h = Object.fromEntries(PLATFORMS.map((p) => [p, 0])) as Record<LabPlatform, number>;
  const matchedPerCreator: Record<string, number> = {};
  const tracked = store.sources.all('tracked').filter((s) => s.status === 'active');
  const trackedIds = new Set(tracked.map((s) => s.id));
  for (const p of store.posts.all()) {
    if (!p.postedAt) continue;
    const ages = (metrics.get(p.id) ?? []).map((m) => m.ageH ?? (Date.parse(m.capturedAt) - Date.parse(p.postedAt!)) / 3_600_000).filter((a) => a >= 0);
    const ok24 = has24(ages);
    if (ok24 && ages.some((a) => a >= 156) && T - Date.parse(p.postedAt) >= 180 * 3_600_000) pairs24h[p.platform] += 1;
    if (ok24 && trackedIds.has(p.sourceId)) matchedPerCreator[p.sourceId] = (matchedPerCreator[p.sourceId] ?? 0) + 1;
  }
  const activeTracked = tracked.filter((s) => store.posts.bySource(s.id).some((p) => p.postedAt && T - Date.parse(p.postedAt) <= 28 * DAY)).length;
  return { casesTopFamily, casesWithTopValue, pairs24h, matchedPerCreator, activeTracked };
}
