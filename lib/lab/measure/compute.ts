/**
 * The v2 measure recompute (04 3.12): the body of `recomputeMeasures` and of section 08's
 * `measure.verdicts` job (after `assignVerdicts`). Order: (1) as-of view; (2) per post, values at
 * every baseline age; (3) growth offsets; (4) cell samples and EB fits; (5) per post at its judge
 * age: ratio, interval, z, confidence, volatility, niche ratio, Dual-High; (6) depth, reach,
 * per-view, v1 trajectory, trajectory class, exo auto; (7) quadrant split at niche medians (v1
 * rule) on the age-matched ratio; (8) isBreakoutV2; (9) write in one transaction.
 */
import type { LabAgeRead, LabMeasureV2, LabPost } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { asOfView } from '@/lib/lab/measure/asof';
import { baselineAgesFor, judgeAge } from '@/lib/lab/measure/age';
import { MeasureEngine, type EnginePost, type Judged } from '@/lib/lab/measure/engine';
import { isBreakoutV2, isDualHigh, nicheBaseline } from '@/lib/lab/measure/breakout';
import { robustSpread, volatilityClass } from '@/lib/lab/measure/eb';
import { perView, xActionScore } from '@/lib/lab/measure/platform';
import { dailyCumulative, peakDayShare, trajectoryClass } from '@/lib/lab/measure/trajectory';
import { detectStepJump } from '@/lib/lab/measure/exogenous';
import { depth, median, quadrant, reach, trajectory } from '@/lib/lab/measures';

export { assignVerdicts } from '@/lib/lab/measure/case-control';

export const MEASURE_VERSION = 'measure-v2';

export type RecomputeResult = { posts: number; measured: number; breakouts: number; dualHigh: number; projected: number; fits: number };

type Row = { p: EnginePost; m: LabMeasureV2 };

const r4 = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10_000) / 10_000);

function emptyMeasure(post: Pick<LabPost, 'id'>, at: string): LabMeasureV2 {
  return {
    postId: post.id, depth: null, breakout: null, breakoutLo: null, breakoutHi: null, baselineN: 0, baselineConfidence: 'low', reach: null, velocity: null, trajectory: null, quadrant: null, isBreakout: false, computedAt: at,
    measureVersion: MEASURE_VERSION, metricBasis: 'views', judgedAgeH: null, basisAtAge: null, baselineLog: null, baselineVar: null, priorLog: null, shrinkB: null, baselineSource: null, robustZ: null, volatility: null, volatilityClass: null,
    maxOverMedian: null, nicheRatio: null, dualHigh: false, trajectoryClass: null, peakDayShare: null, exoAuto: false, sharesPerView: null, savesPerView: null, xActionScore: null, followersAsOf: null, ages: {},
  };
}

/** Every post's v2 measure as of `asOf` (pure over the engine; no writes). */
export function computeMeasuresV2(engine: MeasureEngine, asOfMs: number, at: string): { rows: Row[]; projected: number } {
  const rows: Row[] = [];
  let projected = 0;
  for (const p of engine.posts) {
    if (p.postedAtMs > asOfMs) continue;
    const m = emptyMeasure(p.post, at);
    m.metricBasis = p.basis;
    const ageNow = (asOfMs - p.postedAtMs) / 3_600_000;
    const judged = new Map<number, Judged>();
    const ages: Record<string, LabAgeRead> = {};
    for (const a of baselineAgesFor(p.platform)) {
      if (a > ageNow) continue;
      const j = engine.judge(p, a, asOfMs);
      if (!j) continue;
      judged.set(a, j);
      ages[String(a)] = { y: r4(j.y), ratio: r4(j.ratio), lo: r4(j.lo), hi: r4(j.hi), z: r4(j.z), n: j.n, how: j.how };
    }
    m.ages = ages;
    const ja = judgeAge(ageNow, p.platform);
    m.judgedAgeH = ja;
    const j = ja === null ? undefined : judged.get(ja);
    if (j) {
      m.basisAtAge = r4(j.basisAtAge);
      m.baselineN = j.n;
      m.baselineConfidence = j.confidence;
      m.followersAsOf = j.followersKind;
      if (j.eb && j.ratio !== null) {
        m.breakout = j.ratio;
        m.breakoutLo = j.lo;
        m.breakoutHi = j.hi;
        m.robustZ = j.z;
        m.baselineLog = j.eb.b;
        m.baselineVar = j.eb.V;
        m.priorLog = j.eb.prior;
        m.shrinkB = j.eb.B;
        m.baselineSource = j.eb.source;
        if (j.eb.source === 'projected') projected++;
      }
      const niche = engine.niche(p, j.ageH, asOfMs, nicheBaseline);
      m.nicheRatio = niche && niche.median > 0 ? r4(j.basisAtAge / niche.median) : null;
    } else {
      const fol = engine.followersFor(p, asOfMs);
      m.followersAsOf = fol?.kind ?? null;
    }
    // volatility: s~ at 24h, falling back to 168h then the mature age
    const vol = [24, 168, p.matureH].map((a) => judged.get(a)?.eb?.sTilde ?? null).find((x) => x !== null) ?? null;
    m.volatility = r4(vol);
    m.volatilityClass = volatilityClass(vol);
    const mature = engine.matureSample(p, asOfMs);
    if (mature.length >= 5) m.maxOverMedian = r4(10 ** (Math.max(...mature) - robustSpread(mature).m));
    m.dualHigh = isDualHigh(m.breakout, m.nicheRatio);

    // (6) depth, reach, per-view, trajectories, exo auto (from reads captured by asOf)
    const seen = p.rows.filter((r) => Date.parse(r.capturedAt) <= asOfMs);
    const latest = seen[seen.length - 1] ?? null;
    if (latest) {
      m.depth = depth(latest);
      const fol = engine.followersFor(p, asOfMs);
      m.reach = reach(latest.views, fol?.followers ?? null);
      if (p.platform === 'tiktok') {
        const pv = perView(latest);
        m.sharesPerView = r4(pv.sharesPerView);
        m.savesPerView = r4(pv.savesPerView);
      }
      if (p.platform === 'twitter') m.xActionScore = xActionScore({ likes: latest.likes, shares: latest.shares, comments: latest.comments, quotes: latest.quotes ?? null });
    }
    m.trajectory = trajectory(p.post.postedAt, seen);
    const reads = engine.readsAsOf(p, asOfMs).map((r) => ({ ageH: r.h, basis: r.v }));
    if (p.platform !== 'twitter' && ageNow >= 336) {
      const cum = dailyCumulative(reads);
      const share = cum ? peakDayShare(cum) : null;
      m.peakDayShare = r4(share);
      m.trajectoryClass = trajectoryClass(share);
    }
    m.exoAuto = detectStepJump(reads).flagged;
    rows.push({ p, m });
  }
  return { rows, projected };
}

/** Rebuild lab_measures as of `asOf` (default now). Writes every post's row in one transaction. */
export function recomputeMeasuresV2(store: LabStore, opts: { now?: Date; asOf?: Date } = {}): RecomputeResult {
  const now = opts.now ?? new Date();
  const asOf = opts.asOf ?? now;
  const asOfIso = asOf.toISOString();
  const asOfMs = asOf.getTime();
  const at = now.toISOString();
  const data = asOfView(store, asOfIso);
  const engine = new MeasureEngine(data);
  const { rows, projected } = computeMeasuresV2(engine, asOfMs, at);

  // (7) quadrant at the niche medians (v1 rule): competitor ratios; depth per platform
  const comp = rows.filter((r) => !r.p.post.isOwned);
  const breakoutMedian = median(comp.map((r) => r.m.breakout).filter((x): x is number => x !== null));
  const depthMedian = new Map<string, number | null>();
  for (const platform of new Set(comp.map((r) => r.p.platform))) depthMedian.set(platform, median(comp.filter((r) => r.p.platform === platform).map((r) => r.m.depth).filter((x): x is number => x !== null)));
  let measured = 0;
  let breakouts = 0;
  let dualHigh = 0;
  for (const r of rows) {
    r.m.quadrant = quadrant(r.m.depth, r.m.breakout, { depth: depthMedian.get(r.p.platform) ?? null, breakout: breakoutMedian });
    // (8) the v2 rule; clickbait no longer removes a post from the breakout set (3.7)
    r.m.isBreakout = isBreakoutV2({ ratio: r.m.breakout, z: r.m.robustZ, confidence: r.m.baselineConfidence, judgedAgeH: r.m.judgedAgeH });
    if (r.m.breakout !== null) measured++;
    if (r.m.isBreakout) breakouts++;
    if (r.m.dualHigh) dualHigh++;
  }

  // the fits as of now, per platform x surface x age, for audit (lab_priors eb:*)
  const fits: { key: string; value: unknown }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const a of baselineAgesFor(r.p.platform)) {
      const key = `eb:${r.p.platform}:${r.p.surface}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = engine.fit(r.p.platform, r.p.surface, a, asOfMs);
      if (f.cells === 0) continue;
      fits.push({ key, value: { alpha: f.alpha, beta: f.beta, flatPrior: f.flatPrior, S2: f.S2, tau2: f.tau2, cells: f.cells, fitAt: asOfIso } });
    }
  }

  // (9) one transaction; posts with no posting time keep an empty row (v1 wrote one for every post)
  const measuredIds = new Set(rows.map((r) => r.p.post.id));
  store.transaction(() => {
    store.measures.clear();
    for (const r of rows) store.measures.upsert(r.m);
    for (const post of data.posts) if (!measuredIds.has(post.id)) store.measures.upsert(emptyMeasure(post, at));
    for (const post of store.posts.all()) if (!post.postedAt) store.measures.upsert(emptyMeasure(post, at));
    for (const f of fits) store.priors.set({ key: f.key, value: f.value, n: (f.value as { cells: number }).cells, supersedesDefault: false, updatedAt: at });
  });
  return { posts: rows.length, measured, breakouts, dualHigh, projected, fits: fits.length };
}
