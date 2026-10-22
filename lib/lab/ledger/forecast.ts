/**
 * The early forecast (06 section 6): Szabo-Huberman in log space, the multivariate (Pinto form)
 * ridge model unlocked at 50 complete posts, split-conformal 80% intervals, and the live freezes
 * of `ledger.early` (earlyForecastDue). Training and replay read only an AsOfData (06 7.2).
 */
import type { LabBand, LabPlatform, LabPost, LabPrediction } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { median } from '@/lib/lab/measures';
import { asOfView, type AsOfData } from '@/lib/lab/measure/asof';
import { commentIntentScore, surfaceOf } from '@/lib/lab/ledger/deps';
import { bandOf, ledgerBaseline, viewsAtAge } from '@/lib/lab/ledger/outcome';
import { draftPrediction, newPredictionId, seal } from '@/lib/lab/ledger/freeze';
import { log1p10 } from '@/lib/lab/ledger/metrics';

const HOUR = 3_600_000;

export type EarlyPredictor = 'sh_6h' | 'sh_24h' | 'mv_6h' | 'mv_24h';
export const EARLY_REF: Record<EarlyPredictor, 6 | 24> = { sh_6h: 6, sh_24h: 24, mv_6h: 6, mv_24h: 24 };
/** 06 6.3 feature points per mv predictor (hours). */
export const MV_FEATURES: Record<'mv_6h' | 'mv_24h', readonly number[]> = { mv_6h: [3, 6], mv_24h: [3, 6, 12, 24] };
export const SH_MIN_PAIRS = 20;
export const SH_GROUP_MIN = 40;
export const MV_MIN_POSTS = 50;
export const CAL_MIN = 20;
export const RIDGE_LAMBDA = 1;
export const INTERVAL_LEVEL = 0.8;

/* ── training data ───────────────────────────────────────────────────────────── */

export type TrainRow = { postId: string; postedAt: string; surface: string; x: number[]; y: number };

const isExo = (p: LabPost, exo?: ReadonlySet<string>) => Boolean(p.exoReason) || Boolean(exo?.has(p.id));

/**
 * Posts on `platform` whose 7-day outcome was known at data.asOf (posted_at + 180 h <= asOf),
 * not flagged exogenous, with every feature age and 168 h. x and y are log10(V + 1).
 */
export function trainingRows(data: AsOfData, platform: LabPlatform, featureAges: readonly number[], opts: { exo?: ReadonlySet<string> } = {}): TrainRow[] {
  const cut = Date.parse(data.asOf);
  const out: TrainRow[] = [];
  for (const p of data.posts) {
    if (p.platform !== platform || !p.postedAt || isExo(p, opts.exo)) continue;
    if (Date.parse(p.postedAt) + 180 * HOUR > cut) continue;
    const y = viewsAtAge(data, p, 168);
    if (!y) continue;
    const x: number[] = [];
    for (const a of featureAges) {
      const v = viewsAtAge(data, p, a);
      if (!v) break;
      x.push(log1p10(v.views));
    }
    if (x.length !== featureAges.length) continue;
    out.push({ postId: p.id, postedAt: p.postedAt, surface: surfaceOf(p), x, y: log1p10(y.views) });
  }
  return out.sort((a, b) => (a.postedAt < b.postedAt ? -1 : a.postedAt > b.postedAt ? 1 : a.postId < b.postId ? -1 : 1));
}

/** 06 6.4: the ceil((n + 1) x level)-th smallest absolute residual (17th of 20 at 0.8); null when it does not exist. */
export function conformalQ(absResiduals: readonly number[], level = INTERVAL_LEVEL): number | null {
  const s = [...absResiduals].sort((a, b) => a - b);
  const k = Math.ceil((s.length + 1) * level);
  return k >= 1 && k <= s.length ? s[k - 1] : null;
}

/** Split: first 70% fit, last 30% calibration when it has CAL_MIN rows; else everything fits, no interval. */
export function splitConformal<T>(rows: readonly T[]): { fit: T[]; cal: T[] } {
  const nFit = Math.ceil(rows.length * 0.7);
  const cal = rows.slice(nFit);
  return cal.length >= CAL_MIN ? { fit: rows.slice(0, nFit), cal } : { fit: [...rows], cal: [] };
}

/* ── Szabo-Huberman (06 6.1) ─────────────────────────────────────────────────── */

export type ShFit = { kind: 'sh'; platform: LabPlatform; refAgeH: number; c: number; n: number; groups: Record<string, { c: number; n: number }>; q: number | null; nCal: number; calResiduals: number[]; trainIds: string[]; calIds: string[] };

/** c = median(y168 - yRef); null under 20 pairs. */
export function fitShConstant(rows: readonly { x: number[]; y: number }[]): { c: number; n: number } | null {
  if (rows.length < SH_MIN_PAIRS) return null;
  return { c: median(rows.map((r) => r.y - r.x[0]))!, n: rows.length };
}

function shGroups(rows: readonly TrainRow[]): Record<string, { c: number; n: number }> {
  const by = new Map<string, TrainRow[]>();
  for (const r of rows) by.set(r.surface, [...(by.get(r.surface) ?? []), r]);
  const out: Record<string, { c: number; n: number }> = {};
  for (const [s, list] of by) if (list.length >= SH_GROUP_MIN) out[s] = fitShConstant(list)!;
  return out;
}

export function fitSh(data: AsOfData, platform: LabPlatform, refAgeH: 6 | 24, opts: { exo?: ReadonlySet<string> } = {}): ShFit | null {
  const rows = trainingRows(data, platform, [refAgeH], opts);
  if (rows.length < SH_MIN_PAIRS) return null;
  const { fit, cal } = splitConformal(rows);
  const base = fitShConstant(fit.length >= SH_MIN_PAIRS ? fit : rows)!;
  const groups = shGroups(fit);
  const cOf = (s: string) => groups[s]?.c ?? base.c;
  const calResiduals = cal.map((r) => r.y - (r.x[0] + cOf(r.surface)));
  return {
    kind: 'sh', platform, refAgeH, c: base.c, n: rows.length, groups, q: cal.length ? conformalQ(calResiduals.map(Math.abs)) : null, nCal: cal.length, calResiduals,
    trainIds: fit.map((r) => r.postId), calIds: cal.map((r) => r.postId),
  };
}

export type ForecastOut = Pick<LabPrediction, 'band' | 'score' | 'ratioPoint' | 'ratioLo' | 'ratioHi' | 'viewsPoint' | 'viewsLo' | 'viewsHi' | 'pBreakout' | 'intervalLevel'>;

/** Point, interval, ratio and band from a log10(V+1) prediction. */
export function forecastFromLog(yhat: number, q: number | null, calResiduals: readonly number[], baseline7dViews: number | null): ForecastOut {
  const point = 10 ** yhat - 1;
  const lo = q !== null ? 10 ** (yhat - q) - 1 : null;
  const hi = q !== null ? 10 ** (yhat + q) - 1 : null;
  const ratioPoint = baseline7dViews ? point / baseline7dViews : null;
  const band: LabBand | null = ratioPoint !== null ? bandOf(ratioPoint) : null;
  const pBreakout = baseline7dViews && calResiduals.length ? calResiduals.filter((r) => yhat + r >= log1p10(3 * baseline7dViews)).length / calResiduals.length : null;
  return {
    viewsPoint: point, viewsLo: lo, viewsHi: hi,
    ratioPoint, ratioLo: baseline7dViews && lo !== null ? lo / baseline7dViews : null, ratioHi: baseline7dViews && hi !== null ? hi / baseline7dViews : null,
    band, pBreakout, intervalLevel: q !== null ? INTERVAL_LEVEL : null, score: yhat,
  };
}

/** 06 6.4 worked example: c 0.30, V24 12,000, q 0.18 gives 23,945 (15,820 to 36,242). */
export function shForecast(fit: Pick<ShFit, 'c' | 'q'> & { calResiduals?: number[]; groups?: ShFit['groups'] }, vRef: number, baseline7dViews: number | null, surface?: string): ForecastOut {
  const c = (surface ? fit.groups?.[surface]?.c : undefined) ?? fit.c;
  return forecastFromLog(log1p10(vRef) + c, fit.q, fit.calResiduals ?? [], baseline7dViews);
}

/* ── Multivariate (06 6.3) ───────────────────────────────────────────────────── */

export type MvFit = { kind: 'mv'; platform: LabPlatform; predictor: 'mv_6h' | 'mv_24h'; beta: number[]; b0: number; means: number[]; sds: number[]; n: number; q: number | null; nCal: number; calResiduals: number[]; trainIds: string[]; calIds: string[] };

/** Solve A x = b (Gaussian elimination with partial pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Ridge on standardized features, intercept unpenalized: beta = (Z'Z + lambda I)^-1 Z'(y - mean y). */
export function ridgeFit(xs: readonly number[][], ys: readonly number[], lambda = RIDGE_LAMBDA): { beta: number[]; b0: number; means: number[]; sds: number[] } {
  const n = xs.length;
  const p = xs[0]?.length ?? 0;
  const means = Array.from({ length: p }, (_, j) => xs.reduce((s, r) => s + r[j], 0) / n);
  const sds = Array.from({ length: p }, (_, j) => Math.sqrt(xs.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / n) || 1);
  const Z = xs.map((r) => r.map((v, j) => (v - means[j]) / sds[j]));
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: p }, (_, i) => Z.reduce((s, r, k) => s + r[i] * (ys[k] - my), 0));
  return { beta: solve(A, b), b0: my, means, sds };
}

export function mvPredict(fit: Pick<MvFit, 'beta' | 'b0' | 'means' | 'sds'>, x: readonly number[]): number {
  return fit.b0 + x.reduce((s, v, j) => s + fit.beta[j] * ((v - fit.means[j]) / fit.sds[j]), 0);
}

/** Locked (null) under 50 complete posts on the platform. */
export function fitMultivariate(data: AsOfData, platform: LabPlatform, predictor: 'mv_6h' | 'mv_24h', opts: { exo?: ReadonlySet<string> } = {}): MvFit | null {
  const rows = trainingRows(data, platform, MV_FEATURES[predictor], opts);
  if (rows.length < MV_MIN_POSTS) return null;
  const { fit, cal } = splitConformal(rows);
  const m = ridgeFit(fit.map((r) => r.x), fit.map((r) => r.y));
  const calResiduals = cal.map((r) => r.y - mvPredict(m, r.x));
  return { kind: 'mv', platform, predictor, ...m, n: rows.length, q: cal.length ? conformalQ(calResiduals.map(Math.abs)) : null, nCal: cal.length, calResiduals, trainIds: fit.map((r) => r.postId), calIds: cal.map((r) => r.postId) };
}

export function mvForecast(fit: MvFit, views: readonly number[], baseline7dViews: number | null): ForecastOut {
  return forecastFromLog(mvPredict(fit, views.map(log1p10)), fit.q, fit.calResiduals, baseline7dViews);
}

/* ── cached nightly fits (06 7.4 step 3) ─────────────────────────────────────── */

export const fitKey = (predictor: EarlyPredictor, platform: LabPlatform) => `ledger:fit:${predictor}:${platform}`;

export function readFit(store: LabStore, predictor: EarlyPredictor, platform: LabPlatform): ShFit | MvFit | null {
  const v = store.priors.get(fitKey(predictor, platform))?.value as ShFit | MvFit | null | undefined;
  return v && (v.kind === 'sh' || v.kind === 'mv') ? v : null;
}

/** Ids of posts 04 flagged automatically (lab_measures.exo_auto); manual flags live on the post. */
export function exoAutoIds(store: LabStore): Set<string> {
  return new Set(store.measures.all().filter((m) => m.exoAuto).map((m) => m.postId));
}

/** Fit sh and mv per platform as of now and cache them in lab_priors; abstaining predictors lose their key. */
export function fitAndCache(store: LabStore, now: Date): { fitted: number } {
  const data = asOfView(store, now.toISOString());
  const exo = exoAutoIds(store);
  const platforms = [...new Set(data.posts.map((p) => p.platform))].sort();
  let fitted = 0;
  const at = now.toISOString();
  for (const platform of platforms) {
    const fits: [EarlyPredictor, ShFit | MvFit | null][] = [
      ['sh_6h', fitSh(data, platform, 6, { exo })],
      ['sh_24h', fitSh(data, platform, 24, { exo })],
      ['mv_6h', fitMultivariate(data, platform, 'mv_6h', { exo })],
      ['mv_24h', fitMultivariate(data, platform, 'mv_24h', { exo })],
    ];
    for (const [predictor, fit] of fits) {
      if (!fit) {
        store.priors.remove(fitKey(predictor, platform));
        continue;
      }
      // the train and cal id lists are for the leakage tests, not the cache
      const { trainIds, calIds, ...value } = fit;
      void trainIds; void calIds;
      store.priors.set({ key: fitKey(predictor, platform), value: { ...value, fittedAt: at }, n: fit.n, supersedesDefault: false, updatedAt: at });
      fitted++;
    }
  }
  return { fitted };
}

/* ── live freezes (06 6.6, 6.7) ──────────────────────────────────────────────── */

const PREDICTOR_VERSION: Record<EarlyPredictor, string> = { sh_6h: 'sh-1', sh_24h: 'sh-1', mv_6h: 'mv-1', mv_24h: 'mv-1' };

/** Freeze the early forecasts that are due: owned posts under 30 h, then comment_intent under 72 h. */
export function earlyForecastDue(store: LabStore, now: Date, opts: { dry?: boolean } = {}): { frozen: number } {
  const data = asOfView(store, now.toISOString());
  let frozen = 0;
  const frozenAt = now.toISOString();
  const owned = data.posts.filter((p) => p.isOwned && p.postedAt);
  for (const post of owned) {
    const age = (now.getTime() - Date.parse(post.postedAt!)) / HOUR;
    if (age < 0) continue;
    const existing = store.predictions.forPost(post.id).filter((p) => p.origin === 'live');
    if (age < 30) {
      for (const predictor of ['sh_6h', 'mv_6h', 'sh_24h', 'mv_24h'] as const) {
        const ref = EARLY_REF[predictor];
        if (existing.some((p) => p.predictor === predictor && p.refAgeH === ref)) continue;
        const fit = readFit(store, predictor, post.platform);
        if (!fit) continue; // abstains (06 2.3 rule 3)
        const reading = viewsAtAge(data, post, ref);
        if (!reading) continue;
        const ages = fit.kind === 'mv' ? MV_FEATURES[fit.predictor].map((a) => viewsAtAge(data, post, a)) : [reading];
        if (ages.some((a) => !a)) continue;
        const readAt = new Date(Date.parse(post.postedAt!) + Math.max(...ages.map((a) => a!.fromH[1])) * HOUR);
        const base = ledgerBaseline(asOfView(store, readAt.toISOString()), post, { store, now });
        const f = fit.kind === 'sh' ? shForecast(fit, reading.views, base?.views ?? null, surfaceOf(post)) : mvForecast(fit, ages.map((a) => a!.views), base?.views ?? null);
        const inputs = fit.kind === 'sh' ? { c: fit.groups[surfaceOf(post)]?.c ?? fit.c, n: fit.n, group: fit.groups[surfaceOf(post)] ? surfaceOf(post) : 'platform', q: fit.q, nCal: fit.nCal, vRef: reading.views } : { beta: fit.beta, means: fit.means, sds: fit.sds, n: fit.n, q: fit.q, nCal: fit.nCal, views: ages.map((a) => a!.views) };
        store.predictions.insert(seal(draftPrediction({
          id: newPredictionId(), predictor, predictorVersion: PREDICTOR_VERSION[predictor], kind: 'early', asOf: readAt.toISOString(), frozenAt,
          postId: post.id, sourceId: post.sourceId, platform: post.platform, surface: surfaceOf(post), refAgeH: ref,
          ...f, baseline7dViews: base?.views ?? null, baselineN: base?.n ?? null, inputs, dry: Boolean(opts.dry),
        })));
        frozen++;
      }
    }
    if (age < 72 && !existing.some((p) => p.predictor === 'comment_intent')) {
      const ci = commentIntentScore(store, post.id, now);
      if (ci && ci.intentRatio > 0) {
        const base = ledgerBaseline(data, post, { store, now });
        store.predictions.insert(seal(draftPrediction({
          id: newPredictionId(), predictor: 'comment_intent', predictorVersion: 'ci-1', kind: 'early', asOf: frozenAt, frozenAt,
          postId: post.id, sourceId: post.sourceId, platform: post.platform, surface: surfaceOf(post), refAgeH: Math.round(age * 100) / 100,
          score: Math.log10(ci.intentRatio), inputs: { ...ci }, baseline7dViews: base?.views ?? null, baselineN: base?.n ?? null, dry: Boolean(opts.dry),
        })));
        frozen++;
      }
    }
  }
  return { frozen };
}
