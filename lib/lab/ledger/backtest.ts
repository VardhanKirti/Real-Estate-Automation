/**
 * Rolling-origin backtest (06 section 7). Every replay receives only AsOfData from section 04's
 * asOfView (AC-06-52): replay functions have the signature (data: AsOfData, target: TargetPost)
 * and never see the store (leakage L5). Grading uses the as-of-now view, the only future data
 * allowed. Backtest rows are deleted and re-written per predictor version each night.
 */
import { createHash } from 'node:crypto';
import type { LabPost, LabPrediction } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { asOfView, type AsOfData } from '@/lib/lab/measure/asof';
import { followersAsOf, surfaceOf } from '@/lib/lab/ledger/deps';
import { gradeOne, ledgerBaseline, viewsAtAge } from '@/lib/lab/ledger/outcome';
import { draftPrediction, seal } from '@/lib/lab/ledger/freeze';
import { EARLY_REF, MV_FEATURES, exoAutoIds, fitMultivariate, fitSh, forecastFromLog, mvPredict, shForecast, type ForecastOut, type MvFit, type ShFit } from '@/lib/lab/ledger/forecast';
import { log1p10 } from '@/lib/lab/ledger/metrics';
import { quantile } from '@/lib/lab/measures';
import { predictorDef } from '@/lib/lab/ledger/predictors';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
export const HARNESS_VERSION = 'h-1';
export const MAX_ORIGINS = 26;

/** 06 7.1: Mondays 00:00 UTC from 26 weeks back to the last Monday at least 8 days before now, oldest first. */
export function origins(now: Date): string[] {
  const cutoff = new Date(now.getTime() - 8 * DAY);
  const mid = Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate());
  const dow = new Date(mid).getUTCDay();
  const last = mid - ((dow + 6) % 7) * DAY;
  const floor = now.getTime() - MAX_ORIGINS * WEEK;
  const out: string[] = [];
  for (let k = 0; k < MAX_ORIGINS; k++) {
    const t = last - k * WEEK;
    if (t < floor) break;
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out.reverse();
}

/**
 * asOfView's own filter applied to an existing AsOfData, so a past view can be cut from the
 * as-of-now view without re-reading the store. For any T <= data.asOf it equals
 * asOfView(store, T) (tests/lab-ledger-backtest.test.ts asserts it).
 */
export function narrowAsOf(data: AsOfData, asOf: string, only?: readonly LabPost[]): AsOfData {
  const cut = Date.parse(asOf);
  if (only) {
    // the reference view of one target: its own reads up to the cut (no other post is read from it)
    const posts = only.filter((p) => p.postedAt !== null && Date.parse(p.postedAt) <= cut);
    const metrics = new Map<string, NonNullable<ReturnType<AsOfData['metrics']['get']>>>();
    for (const p of posts) {
      const seen = (data.metrics.get(p.id) ?? []).filter((m) => Date.parse(m.capturedAt) <= cut);
      if (seen.length) metrics.set(p.id, seen);
    }
    return { posts, metrics, creatorSnapshots: new Map(), asOf };
  }
  const posts = data.posts.filter((p) => p.postedAt !== null && Date.parse(p.postedAt) <= cut);
  const keep = new Set(posts.map((p) => p.id));
  const metrics = new Map<string, NonNullable<ReturnType<AsOfData['metrics']['get']>>>();
  for (const [id, rows] of data.metrics) {
    if (!keep.has(id)) continue;
    const seen = rows.filter((m) => Date.parse(m.capturedAt) <= cut);
    if (seen.length) metrics.set(id, seen);
  }
  const creatorSnapshots = new Map<string, NonNullable<ReturnType<AsOfData['creatorSnapshots']['get']>>>();
  for (const [id, rows] of data.creatorSnapshots) {
    const seen = rows.filter((s) => Date.parse(s.capturedAt) <= cut);
    if (seen.length) creatorSnapshots.set(id, seen);
  }
  return { posts, metrics, creatorSnapshots, asOf };
}

/* ── replays: (data: AsOfData, target: TargetPost) => PredictionDraft | null ─── */

/** A target post and, for early forecasts, its reference-time view of that post alone (reads up to the end of valueAtAge's nearest window). */
export type TargetPost = { post: LabPost; reference: AsOfData | null };
export type PredictionDraft = ForecastOut & Pick<LabPrediction, 'baseline7dViews' | 'baselineN' | 'inputs' | 'refAgeH'> & { asOf: string };

const shMemo = new WeakMap<AsOfData, Map<string, ShFit | null>>();
const mvMemo = new WeakMap<AsOfData, Map<string, MvFit | null>>();
const exoMemo = new WeakMap<AsOfData, ReadonlySet<string>>();
/** The run's exogenous-auto set, attached to the as-of-now view it was read with. */
export function withExo(data: AsOfData, exo: ReadonlySet<string>): AsOfData {
  exoMemo.set(data, exo);
  return data;
}
const exoOf = (data: AsOfData) => exoMemo.get(data);

function shFitAt(data: AsOfData, platform: LabPost['platform'], ref: 6 | 24, exo?: ReadonlySet<string>): ShFit | null {
  let m = shMemo.get(data);
  if (!m) shMemo.set(data, (m = new Map()));
  const k = `${platform}|${ref}`;
  if (!m.has(k)) m.set(k, fitSh(data, platform, ref, { exo }));
  return m.get(k)!;
}
function mvFitAt(data: AsOfData, platform: LabPost['platform'], predictor: 'mv_6h' | 'mv_24h', exo?: ReadonlySet<string>): MvFit | null {
  let m = mvMemo.get(data);
  if (!m) mvMemo.set(data, (m = new Map()));
  const k = `${platform}|${predictor}`;
  if (!m.has(k)) m.set(k, fitMultivariate(data, platform, predictor, { exo }));
  return m.get(k)!;
}

/** creator_median: the creator's normal at 7 days from posts before the target, as of T. */
export function replayCreatorMedian(data: AsOfData, target: TargetPost): PredictionDraft | null {
  const b = ledgerBaseline(data, target.post);
  if (!b) return null;
  const p10 = quantile(b.sample, 0.1);
  const p90 = quantile(b.sample, 0.9);
  return {
    band: 'normal', score: 0, ratioPoint: 1, ratioLo: null, ratioHi: null, viewsPoint: b.views, viewsLo: p10, viewsHi: p90, pBreakout: null, intervalLevel: 0.8,
    baseline7dViews: b.views, baselineN: b.n, inputs: { n: b.n }, refAgeH: null, asOf: data.asOf,
  };
}

function replayEarly(predictor: 'sh_6h' | 'sh_24h' | 'mv_6h' | 'mv_24h') {
  return (data: AsOfData, target: TargetPost): PredictionDraft | null => {
    const ref = EARLY_REF[predictor];
    const refData = target.reference;
    if (!refData) return null;
    const exo = exoOf(data);
    const reading = viewsAtAge(refData, target.post, ref);
    if (!reading) return null;
    // the creator's normal as of the origin (reads up to T); the reference view holds only the target
    const base = ledgerBaseline(data, target.post);
    const baseline = base?.views ?? null;
    let f: ForecastOut;
    let inputs: Record<string, unknown>;
    if (predictor === 'sh_6h' || predictor === 'sh_24h') {
      const fit = shFitAt(data, target.post.platform, ref, exo);
      if (!fit) return null;
      f = shForecast(fit, reading.views, baseline, surfaceOf(target.post));
      inputs = { c: fit.groups[surfaceOf(target.post)]?.c ?? fit.c, n: fit.n, q: fit.q, nCal: fit.nCal };
    } else {
      const fit = mvFitAt(data, target.post.platform, predictor, exo);
      if (!fit) return null;
      const reads = MV_FEATURES[predictor].map((a) => viewsAtAge(refData, target.post, a));
      if (reads.some((r) => !r)) return null;
      f = forecastFromLog(mvPredict(fit, reads.map((r) => log1p10(r!.views))), fit.q, fit.calResiduals, baseline);
      inputs = { n: fit.n, q: fit.q, nCal: fit.nCal };
    }
    return { ...f, baseline7dViews: baseline, baselineN: base?.n ?? null, inputs, refAgeH: ref, asOf: refData.asOf };
  };
}

export const REPLAYS: Record<string, (data: AsOfData, target: TargetPost) => PredictionDraft | null> = {
  creator_median: replayCreatorMedian,
  sh_6h: replayEarly('sh_6h'),
  sh_24h: replayEarly('sh_24h'),
  mv_6h: replayEarly('mv_6h'),
  mv_24h: replayEarly('mv_24h'),
};

/* ── the harness (06 7.3) ────────────────────────────────────────────────────── */

export type BacktestResult = { origins: number; rows: Record<string, number>; abstained: Record<string, number>; graded: number };

const backtestId = (predictor: string, origin: string, postId: string) => `lpr-${createHash('sha256').update(`${predictor}|${origin}|${postId}`).digest('hex').slice(0, 16)}`;

/** Replays every replayable predictor at every origin, grades against the real 7-day outcome, and replaces the backtest rows. */
export function runBacktest(store: LabStore, opts: { now: Date; dry: boolean }): BacktestResult {
  const { now, dry } = opts;
  const dataNow = withExo(asOfView(store, now.toISOString()), exoAutoIds(store));
  const ids = Object.keys(REPLAYS);
  const rows: Record<string, LabPrediction[]> = Object.fromEntries(ids.map((id) => [id, []]));
  const abstained: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const backfill = (p: LabPost) => followersAsOf(dataNow.creatorSnapshots.get(p.sourceId) ?? [], p.postedAt!)?.asOf === 'backfill';
  const os = origins(now);
  let graded = 0;
  for (const origin of os) {
    const T = Date.parse(`${origin}T00:00:00.000Z`);
    const dataT = withExo(narrowAsOf(dataNow, new Date(T).toISOString()), exoOf(dataNow)!);
    for (const predictor of ids) {
      const ref = predictor === 'creator_median' ? 0 : EARLY_REF[predictor as keyof typeof EARLY_REF];
      for (const post of dataNow.posts) {
        if (!post.postedAt) continue;
        const at = Date.parse(post.postedAt) + ref * HOUR;
        if (at < T || at >= T + WEEK) continue;
        if (backfill(post)) continue;
        const reference = ref ? narrowAsOf(dataNow, new Date(Date.parse(post.postedAt) + ref * 1.25 * HOUR).toISOString(), [post]) : null;
        const draft = REPLAYS[predictor](dataT, { post, reference });
        if (!draft) {
          abstained[predictor]++;
          continue;
        }
        const { asOf, ...fields } = draft;
        const def = predictorDef(predictor);
        let row = draftPrediction({
          ...fields, id: backtestId(predictor, origin, post.id), origin: 'backtest', predictor, predictorVersion: def.version, kind: predictor === 'creator_median' ? 'pre_post' : 'early',
          asOf, frozenAt: asOf, backtestOrigin: origin, postId: post.id, sourceId: post.sourceId, platform: post.platform, surface: surfaceOf(post), dry,
        });
        const g = gradeOne(dataNow, row, post, now);
        if (g.kind === 'graded') {
          row = { ...row, ...g.g, status: 'graded', gradedAt: now.toISOString() };
          graded++;
        } else if (g.kind === 'ungradable') row = { ...row, status: 'ungradable', gradedAt: now.toISOString() };
        rows[predictor].push(seal(row));
      }
    }
  }
  for (const predictor of ids) store.predictions.replaceBacktest(predictor, predictorDef(predictor).version, rows[predictor]);
  return { origins: os.length, rows: Object.fromEntries(ids.map((id) => [id, rows[id].length])), abstained, graded };
}
