/**
 * The measurement engine (04 3.2 to 3.6): age values, cell samples, EB fits, growth offsets and
 * one post's age-matched ratio, all as of an explicit instant. Shared by `recomputeMeasuresV2`
 * (every post as of now) and `assignVerdicts` (each post as of its own verdict time, 5.2), so the
 * two never disagree on the maths. Data in: an AsOfData-shaped view (posts, metrics, creator
 * snapshots); nothing here reads the store or the clock.
 */
import type { LabCreatorSnapshot, LabMetricBasis, LabPlatform, LabPost, LabPostMetrics } from '@/lib/schemas';
import { ageHours, baselineAgesFor, logY, matureAgeFor, valueAtAgeH, type AgeValue } from '@/lib/lab/measure/age';
import { BASELINE_MAX_POSTS, BASELINE_WINDOW_DAYS, cellKey, surfaceOf, type Surface } from '@/lib/lab/measure/baseline';
import { basisValue, metricBasis } from '@/lib/lab/measure/platform';
import { baselineConfidence, growthOffsets, OFFSET_MIN_N, type GrowthOffset } from '@/lib/lab/measure/breakout';
import { ebBaseline, fitEb, MEDIAN_VAR, MIN_CELL_N, ratioOf, robustSpread, type EbBaseline, type EbFit } from '@/lib/lab/measure/eb';
import { followersAsOf } from '@/lib/lab/measure/asof';
import type { LabConfidence } from '@/lib/schemas';

const DAY = 86_400_000;
/** Start of the UTC day (fit cache granularity). */
export const dayFloor = (ms: number): number => Math.floor(ms / DAY) * DAY;

export type EnginePost = {
  post: LabPost;
  idx: number;
  postedAtMs: number;
  platform: LabPlatform;
  surface: Surface;
  cell: string;
  basis: LabMetricBasis;
  matureH: number;
  /** basis reads, oldest first: capture time, age, value */
  reads: { at: number; h: number; v: number }[];
  /** every read (raw counters), oldest first */
  rows: LabPostMetrics[];
};

export type Judged = {
  ageH: number;
  y: number;
  basisAtAge: number;
  how: AgeValue['how'];
  ratio: number | null;
  lo: number | null;
  hi: number | null;
  z: number | null;
  n: number;
  confidence: LabConfidence;
  eb: EbBaseline | null;
  fit: EbFit | null;
  logF: number | null;
  followersKind: 'before' | 'backfill' | null;
};

/** Basis for one post: X keeps `views` when any read carries them, else the action score. */
function basisFor(platform: LabPlatform, rows: readonly LabPostMetrics[]): LabMetricBasis {
  if (platform === 'twitter') return rows.some((r) => r.views !== null) ? 'views' : 'x_action';
  return metricBasis(platform, { views: null, likes: null, comments: null, shares: null }).basis;
}

export class MeasureEngine {
  readonly posts: EnginePost[];
  readonly byId = new Map<string, EnginePost>();
  private byCell = new Map<string, EnginePost[]>();
  private byPlatformSurface = new Map<string, EnginePost[]>();
  private snaps: Map<string, LabCreatorSnapshot[]>;
  /** asOf -> age -> per-post value (undefined = not computed yet) */
  private valueCache = new Map<number, Map<number, (AgeValue | null | undefined)[]>>();
  private fitCache = new Map<string, EbFit>();
  private offsetCache = new Map<string, GrowthOffset[]>();

  constructor(data: { posts: readonly LabPost[]; metrics: ReadonlyMap<string, readonly LabPostMetrics[]>; creatorSnapshots: ReadonlyMap<string, readonly LabCreatorSnapshot[]> }) {
    this.snaps = new Map([...data.creatorSnapshots].map(([k, v]) => [k, [...v]]));
    this.posts = [];
    for (const post of data.posts) {
      if (!post.postedAt) continue;
      const postedAtMs = Date.parse(post.postedAt);
      if (!Number.isFinite(postedAtMs)) continue;
      const rows = [...(data.metrics.get(post.id) ?? [])].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
      const basis = basisFor(post.platform, rows);
      const reads = rows
        .map((r) => ({ at: Date.parse(r.capturedAt), h: ageHours(post.postedAt!, r.capturedAt), v: basisValue(basis, r) }))
        .filter((r): r is { at: number; h: number; v: number } => r.v !== null && Number.isFinite(r.v) && r.h >= 0);
      const ep: EnginePost = { post, idx: this.posts.length, postedAtMs, platform: post.platform, surface: surfaceOf(post), cell: cellKey(post), basis, matureH: matureAgeFor(post.platform), reads, rows };
      this.posts.push(ep);
      this.byId.set(post.id, ep);
      (this.byCell.get(ep.cell) ?? this.byCell.set(ep.cell, []).get(ep.cell)!).push(ep);
      const ps = `${ep.platform}|${ep.surface}`;
      (this.byPlatformSurface.get(ps) ?? this.byPlatformSurface.set(ps, []).get(ps)!).push(ep);
    }
    // cells oldest first, so a sample walks back from the target and stops at 30 or 90 days
    for (const list of this.byCell.values()) list.sort((a, b) => a.postedAtMs - b.postedAtMs || a.idx - b.idx);
  }

  /** Basis reads captured at or before asOf. */
  readsAsOf(p: EnginePost, asOfMs: number): { h: number; v: number }[] {
    return p.reads.filter((r) => r.at <= asOfMs);
  }

  /** valueAtAge for one post as of an instant (cached). */
  valueAt(p: EnginePost, ageH: number, asOfMs: number): AgeValue | null {
    if (p.postedAtMs > asOfMs) return null;
    let byAge = this.valueCache.get(asOfMs);
    if (!byAge) this.valueCache.set(asOfMs, (byAge = new Map()));
    let arr = byAge.get(ageH);
    if (!arr) byAge.set(ageH, (arr = new Array(this.posts.length)));
    const hit = arr[p.idx];
    if (hit !== undefined) return hit;
    const last = p.reads.length ? p.reads[p.reads.length - 1].at : 0;
    const v = valueAtAgeH(last <= asOfMs ? p.reads : this.readsAsOf(p, asOfMs), ageH, p.matureH);
    arr[p.idx] = v;
    return v;
  }

  /** y values of the target's cell sample at one age: posted before it, within 90 days, newest 30. */
  sample(t: EnginePost, ageH: number, asOfMs: number): number[] {
    const from = t.postedAtMs - BASELINE_WINDOW_DAYS * DAY;
    const cell = this.byCell.get(t.cell) ?? [];
    const out: number[] = [];
    // newest first: walk back from the last post before the target
    let i = cell.length - 1;
    while (i >= 0 && cell[i].postedAtMs >= t.postedAtMs) i--;
    for (; i >= 0 && out.length < BASELINE_MAX_POSTS; i--) {
      const p = cell[i];
      if (p.postedAtMs < from) break;
      if (p === t) continue;
      const v = this.valueAt(p, ageH, asOfMs);
      if (v) out.push(v.y);
    }
    return out;
  }

  /** Followers (log10) of a source as of an instant: the latest snapshot at or before it. */
  logFollowersAt(sourceId: string, asOfMs: number): number | null {
    let best: { at: number; f: number } | null = null;
    for (const s of this.snaps.get(sourceId) ?? []) {
      const at = Date.parse(s.capturedAt);
      if (at > asOfMs || s.followers === null || !(s.followers > 0)) continue;
      if (!best || at > best.at) best = { at, f: s.followers };
    }
    return best ? Math.log10(best.f) : null;
  }

  /** Followers as of the post's posting time (6.2). */
  followersFor(p: EnginePost, asOfMs: number): { followers: number; kind: 'before' | 'backfill' } | null {
    const snaps = (this.snaps.get(p.post.sourceId) ?? []).filter((s) => Date.parse(s.capturedAt) <= asOfMs);
    return followersAsOf(snaps, p.post.postedAt);
  }

  /**
   * The EB fit for one platform x surface x age (cached): every cell's sample of posts posted before
   * `beforeMs` (within the 90 days before it), valued as of `asOfMs`. A target's fit is cut at its own
   * posting day, so a later post never moves an earlier post's prior (6.4, AC-04-24).
   */
  fit(platform: LabPlatform, surface: Surface, ageH: number, asOfMs: number, beforeMs: number = asOfMs): EbFit {
    const key = `${platform}|${surface}|${ageH}|${asOfMs}|${beforeMs}`;
    const hit = this.fitCache.get(key);
    if (hit) return hit;
    const from = beforeMs - BASELINE_WINDOW_DAYS * DAY;
    const cells = new Map<string, { at: number; y: number }[]>();
    const sourceOf = new Map<string, string>();
    for (const p of this.byPlatformSurface.get(`${platform}|${surface}`) ?? []) {
      if (p.postedAtMs > asOfMs || p.postedAtMs >= beforeMs || p.postedAtMs < from) continue;
      const v = this.valueAt(p, ageH, asOfMs);
      if (!v) continue;
      (cells.get(p.cell) ?? cells.set(p.cell, []).get(p.cell)!).push({ at: p.postedAtMs, y: v.y });
      sourceOf.set(p.cell, p.post.sourceId);
    }
    const rows = [...cells].map(([cell, xs]) => {
      const ys = xs.sort((a, b) => b.at - a.at).slice(0, BASELINE_MAX_POSTS).map((x) => x.y);
      const { m, s } = robustSpread(ys);
      return { m, s2: s * s, n: ys.length, logF: this.logFollowersAt(sourceOf.get(cell)!, Math.min(asOfMs, beforeMs)) };
    });
    const f = fitEb(rows, { platform, surface, ageH });
    this.fitCache.set(key, f);
    return f;
  }

  /** Growth offsets c(a) for one platform x surface (cached), over posts posted before `beforeMs`, valued as of `asOfMs`. */
  offsets(platform: LabPlatform, surface: Surface, asOfMs: number, beforeMs: number = asOfMs): GrowthOffset[] {
    const key = `${platform}|${surface}|${asOfMs}|${beforeMs}`;
    const hit = this.offsetCache.get(key);
    if (hit) return hit;
    const rows: { platform: LabPlatform; surface: Surface; ages: Record<number, number>; matureH: number }[] = [];
    for (const p of this.byPlatformSurface.get(`${platform}|${surface}`) ?? []) {
      if (p.postedAtMs > asOfMs || p.postedAtMs >= beforeMs) continue;
      const ages: Record<number, number> = {};
      for (const a of baselineAgesFor(p.platform)) {
        const v = this.valueAt(p, a, asOfMs);
        if (v) ages[a] = v.y;
      }
      rows.push({ platform, surface, ages, matureH: p.matureH });
    }
    const out = growthOffsets(rows);
    this.offsetCache.set(key, out);
    return out;
  }

  /**
   * One post's age-matched ratio at `ageH` as of `asOfMs` (3.3, 3.4). Null when the post has no
   * value at that age. The fit and offsets use posts posted before the target's posting day, valued
   * as of `fitAsOfMs` (the verdict pass floors it to the day so fits are shared; never later data).
   */
  judge(t: EnginePost, ageH: number, asOfMs: number, fitAsOfMs: number = asOfMs): Judged | null {
    const v = this.valueAt(t, ageH, asOfMs);
    if (!v) return null;
    const fol = this.followersFor(t, asOfMs);
    const logF = fol ? Math.log10(fol.followers) : null;
    const before = dayFloor(t.postedAtMs);
    const fit = this.fit(t.platform, t.surface, ageH, fitAsOfMs, before);
    const base: Judged = { ageH, y: v.y, basisAtAge: v.views, how: v.how, ratio: null, lo: null, hi: null, z: null, n: 0, confidence: 'low', eb: null, fit, logF, followersKind: fol?.kind ?? null };
    const sample = this.sample(t, ageH, asOfMs);
    let eb: EbBaseline | null = null;
    if (sample.length >= MIN_CELL_N) eb = ebBaseline(sample, fit, logF, 0, 'matched');
    else if (ageH !== t.matureH) {
      // projected route (cold start): the cell's mature sample shifted by -c(a)
      const mature = this.sample(t, t.matureH, asOfMs);
      const off = this.offsets(t.platform, t.surface, fitAsOfMs, before).find((o) => o.ageH === ageH);
      if (mature.length >= MIN_CELL_N && off && off.n >= OFFSET_MIN_N) {
        eb = ebBaseline(mature.map((y) => y - off.c), fit, logF, (MEDIAN_VAR * off.sd * off.sd) / off.n, 'projected');
      }
    }
    if (!eb) return { ...base, n: sample.length };
    const r = ratioOf(v.y, eb);
    return { ...base, ratio: r.ratio, lo: r.lo, hi: r.hi, z: r.z, n: eb.n, confidence: baselineConfidence(eb.n, fit.alpha !== null && fit.beta !== null && logF !== null), eb };
  }

  /** The cell's mature sample before the target (for max_over_median), as y values. */
  matureSample(t: EnginePost, asOfMs: number): number[] {
    return this.sample(t, t.matureH, asOfMs);
  }

  private nicheCache = new Map<string, { median: number; n: number } | null>();

  /** Raw basis values of tracked posts on t's platform x surface at one age, posted in the 90 days before t's day. */
  nicheValues(t: EnginePost, ageH: number, asOfMs: number): number[] {
    const before = dayFloor(t.postedAtMs);
    const from = before - BASELINE_WINDOW_DAYS * DAY;
    const out: number[] = [];
    for (const p of this.byPlatformSurface.get(`${t.platform}|${t.surface}`) ?? []) {
      if (p === t || p.post.isOwned || p.postedAtMs >= before || p.postedAtMs < from) continue;
      const v = this.valueAt(p, ageH, asOfMs);
      if (v) out.push(v.views);
    }
    return out;
  }

  /** The niche median for t (3.11), cached per platform x surface x age x day (posts from before t's day only). */
  niche(t: EnginePost, ageH: number, asOfMs: number, fn: (xs: number[]) => { median: number; n: number } | null): { median: number; n: number } | null {
    const key = `${t.platform}|${t.surface}|${ageH}|${asOfMs}|${dayFloor(t.postedAtMs)}`;
    if (this.nicheCache.has(key)) return this.nicheCache.get(key)!;
    const r = fn(this.nicheValues(t, ageH, asOfMs));
    this.nicheCache.set(key, r);
    return r;
  }
}

export { logY };
