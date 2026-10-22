/**
 * Grading at 7 days (06 section 4): views at an exact age (04's valueAtAge, no tolerance of the
 * ledger's own), the 7-day baseline in 04's cell, the daily grader and the pairwise grader.
 */
import { randomUUID } from 'node:crypto';
import type { LabBand, LabPost, LabPrediction, LabRun } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { median } from '@/lib/lab/measures';
import { asOfView, type AsOfData } from '@/lib/lab/measure/asof';
import { cellKey, ebBaseline, fitEb, followersAsOf, metricBasis, surfaceOf, valueAtAge, type AgeValue, type EbBaseline, type EbFit, type Surface } from '@/lib/lab/ledger/deps';
import { linkPredictionsToPost } from '@/lib/lab/ledger/freeze';
import { log1p10 } from '@/lib/lab/ledger/metrics';

/** 06 2.1 band labels (01 12.3 uses them verbatim). */
export const BAND_LABEL: Record<LabBand, string> = {
  below: 'Below your normal',
  normal: 'Around your normal',
  above: 'Above your normal',
  breakout: 'Breakout',
};

/** 06 2.1: below < 0.75 <= normal < 1.5 <= above < 3 <= breakout (3 = BREAKOUT_THRESHOLD). */
export function bandOf(ratio: number): LabBand {
  if (ratio < 0.75) return 'below';
  if (ratio < 1.5) return 'normal';
  if (ratio < 3) return 'above';
  return 'breakout';
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 168 h + 12 h for the 168 h read to land. */
export const GRADE_DUE_H = 180;
/** A nearest read is accepted once valueAtAge's nearest window at 168 h (tol 42 h) has closed. */
export const NEAREST_SETTLED_H = 168 + 42;
/** No usable read by 14 days: ungradable. */
export const UNGRADABLE_AFTER_H = 336;

/* ── views at an exact age (06 4.1) ──────────────────────────────────────────── */

const ageMemo = new WeakMap<AsOfData, Map<string, AgeValue | null>>();

/** valueAtAge over one post's snapshot rows from an AsOfData, basis per 04 3.8. */
export function viewsAtAge(data: AsOfData, post: Pick<LabPost, 'id' | 'postedAt' | 'platform'>, ageH: number): AgeValue | null {
  if (!post.postedAt) return null;
  let memo = ageMemo.get(data);
  if (!memo) ageMemo.set(data, (memo = new Map()));
  const key = `${post.id}|${ageH}`;
  if (memo.has(key)) return memo.get(key)!;
  const snaps = (data.metrics.get(post.id) ?? []).map((m) => ({ capturedAt: m.capturedAt, basis: metricBasis(post.platform, m).value }));
  const v = snaps.length ? valueAtAge(snaps, post.postedAt, ageH, data.asOf) : null;
  memo.set(key, v);
  return v;
}

/* ── the 7-day baseline (06 4.3) ─────────────────────────────────────────────── */

const cellMemo = new WeakMap<AsOfData, Map<string, string>>();
function cellOf(data: AsOfData, p: LabPost): string {
  let memo = cellMemo.get(data);
  if (!memo) cellMemo.set(data, (memo = new Map()));
  let k = memo.get(p.id);
  if (k === undefined) memo.set(p.id, (k = cellKey(p)));
  return k;
}

/** 04 3.2 sample at 168 h for a cell: earlier posts within 90 days, newest 30 with a value. */
function cellSample(data: AsOfData, key: string, before: number): { y: number[]; views: number[] } {
  const rows = data.posts
    .filter((p) => p.postedAt && Date.parse(p.postedAt) < before && Date.parse(p.postedAt) >= before - 90 * DAY && cellOf(data, p) === key)
    .sort((a, b) => (a.postedAt! < b.postedAt! ? 1 : a.postedAt! > b.postedAt! ? -1 : 0));
  const y: number[] = [];
  const views: number[] = [];
  for (const p of rows) {
    if (y.length >= 30) break;
    const v = viewsAtAge(data, p, 168);
    if (!v) continue;
    y.push(v.y);
    views.push(v.views);
  }
  return { y, views };
}

const MAD_K = 1.4826;
function mad(ys: readonly number[], m: number): number {
  return median(ys.map((y) => Math.abs(y - m))) ?? 0;
}

function storedFit(store: LabStore, platform: LabPost['platform'], surface: Surface): EbFit | null {
  const v = store.priors.get(`eb:${platform}:${surface}:168`)?.value as Partial<EbFit> | null | undefined;
  if (!v || typeof v.S2 !== 'number' || typeof v.tau2 !== 'number') return null;
  return { platform, surface, ageH: 168, alpha: v.alpha ?? null, beta: v.beta ?? null, flatPrior: v.flatPrior ?? null, S2: v.S2, tau2: v.tau2, cells: v.cells ?? 0 };
}

function logFollowers(data: AsOfData, sourceId: string, postedAt: string): number | null {
  const f = followersAsOf(data.creatorSnapshots.get(sourceId) ?? [], postedAt);
  return f && f.asOf === 'before' && f.followers > 0 ? Math.log10(f.followers) : null;
}

const fitMemo = new WeakMap<AsOfData, Map<string, EbFit>>();
/**
 * 04 3.4 fit over the cells of one platform x surface in `data`, each cell's 3.2 sample at 168 h
 * as of data.asOf and followers as of then. One fit per as-of view (the backtest fits once per origin).
 */
function fitAt(data: AsOfData, platform: LabPost['platform'], surface: Surface): EbFit {
  let memo = fitMemo.get(data);
  if (!memo) fitMemo.set(data, (memo = new Map()));
  const mk = `${platform}|${surface}`;
  const hit = memo.get(mk);
  if (hit) return hit;
  const cut = Date.parse(data.asOf) + 1;
  const keys = new Map<string, LabPost>();
  for (const p of data.posts) {
    if (p.platform !== platform || !p.postedAt || surfaceOf(p) !== surface) continue;
    const k = cellOf(data, p);
    if (!keys.has(k)) keys.set(k, p);
  }
  const cells = [...keys.entries()].map(([k, p]) => {
    const s = cellSample(data, k, cut);
    const m = median(s.y) ?? 0;
    return { m, s2: (MAD_K * mad(s.y, m)) ** 2, n: s.y.length, logF: logFollowers(data, p.sourceId, data.asOf) };
  }).filter((c) => c.n > 0);
  const fit = fitEb(cells, { platform, surface, ageH: 168 });
  memo.set(mk, fit);
  return fit;
}

/**
 * The creator's age-matched baseline at 168 h in the target's 04 cell, as of `data.asOf`.
 * Live (data.asOf within 1 h of `now`, with a store) reads 04's stored fit `eb:<platform>:<surface>:168`;
 * otherwise (the backtest) it fits over the cells of the same platform x surface in `data` only.
 * Null when the sample has under 5 values (the caller abstains).
 */
export function ledgerBaseline(data: AsOfData, target: Pick<LabPost, 'sourceId' | 'platform' | 'contentType' | 'postedAt'>, opts: { store?: LabStore; now?: Date } = {}): (EbBaseline & { views: number; sample: number[] }) | null {
  if (!target.postedAt) return null;
  const before = Date.parse(target.postedAt);
  const surface = surfaceOf(target);
  const key = cellKey(target);
  const own = cellSample(data, key, before);
  if (own.y.length < 5) return null;
  const live = opts.store && opts.now && Math.abs(Date.parse(data.asOf) - opts.now.getTime()) <= HOUR;
  const fit = (live ? storedFit(opts.store!, target.platform, surface) : null) ?? fitAt(data, target.platform, surface);
  const b = ebBaseline(own.y, fit, logFollowers(data, target.sourceId, target.postedAt));
  if (!b) return null;
  return { ...b, views: 10 ** b.b, sample: own.views };
}

/* ── run rows ────────────────────────────────────────────────────────────────── */

export function ledgerRun(store: LabStore, r: { kind: LabRun['kind']; started: Date; items: number; dry: boolean; error?: string | null; input?: Record<string, unknown>; status?: LabRun['status']; now?: Date }): LabRun {
  const run: LabRun = {
    id: `lrun-${randomUUID().slice(0, 12)}`, kind: r.kind, apifyRunId: null, datasetId: null, actor: null, input: r.input ?? {},
    status: r.status ?? (r.error ? 'failed' : 'succeeded'), items: r.items, costUsd: 0, dry: r.dry,
    startedAt: r.started.toISOString(), finishedAt: (r.now ?? new Date()).toISOString(), error: r.error ? r.error.slice(0, 200) : null, line: null, job: 'ledger',
  };
  store.runs.insert(run);
  return run;
}

/* ── gradeDue (06 4.2) ───────────────────────────────────────────────────────── */

/** One row's grade against its 168 h read, or 'wait'. Exported for the backtest (same rules). */
export function gradeOne(data: AsOfData, row: Pick<LabPrediction, 'band' | 'viewsPoint' | 'viewsLo' | 'viewsHi' | 'ratioLo' | 'ratioHi' | 'baseline7dViews'>, post: Pick<LabPost, 'id' | 'postedAt' | 'platform'>, now: Date):
  | { kind: 'wait' }
  | { kind: 'ungradable' }
  | { kind: 'graded'; g: Pick<LabPrediction, 'outcomeViews7d' | 'outcomeRatio7d' | 'outcomeBand' | 'outcomeIsBreakout' | 'outcomeMethod' | 'hitBand' | 'inInterval' | 'absLogErr'> } {
  if (!post.postedAt) return { kind: 'wait' };
  const age = (now.getTime() - Date.parse(post.postedAt)) / HOUR;
  if (age < GRADE_DUE_H) return { kind: 'wait' };
  const r = viewsAtAge(data, post, 168);
  if (!r || (r.how === 'nearest' && age < NEAREST_SETTLED_H)) return age > UNGRADABLE_AFTER_H ? { kind: 'ungradable' } : { kind: 'wait' };
  const ratio = row.baseline7dViews ? r.views / row.baseline7dViews : null;
  const outcomeBand = ratio !== null ? bandOf(ratio) : null;
  const between = (lo: number, x: number, hi: number) => lo <= x && x <= hi;
  return {
    kind: 'graded',
    g: {
      outcomeViews7d: r.views, outcomeRatio7d: ratio, outcomeBand, outcomeIsBreakout: ratio !== null ? ratio >= 3 : null, outcomeMethod: r.how,
      hitBand: row.band && outcomeBand ? row.band === outcomeBand : null,
      inInterval: row.viewsLo !== null && row.viewsHi !== null ? between(row.viewsLo, r.views, row.viewsHi) : row.ratioLo !== null && row.ratioHi !== null && ratio !== null ? between(row.ratioLo, ratio, row.ratioHi) : null,
      absLogErr: row.viewsPoint !== null ? Math.abs(log1p10(row.viewsPoint) - log1p10(r.views)) : null,
    },
  };
}

/** Grade every live pre-post and early prediction whose post is old enough; then the pairwise rows. One `grade` run row. */
export function gradeDue(store: LabStore, now: Date, opts: { dry?: boolean; writeRun?: boolean } = {}): { graded: number; ungradable: number; pairwise: number; linked: number; experiments: number; run: LabRun | null } {
  const started = new Date();
  // 2.5: retry linking for published scripts whose post time is now known
  let linked = 0;
  for (const s of store.scripts.all()) {
    if (s.status !== 'published' || !s.publishedPostId) continue;
    if (store.predictions.forScript(s.id).some((p) => p.origin === 'live' && p.kind === 'pre_post' && p.postId === null && p.status !== 'void')) {
      linked += linkPredictionsToPost(store, s.id, s.publishedPostId, now);
    }
  }
  const data = asOfView(store, now.toISOString());
  const rows = store.predictions.list({ origin: 'live', status: 'frozen', limit: 1_000_000 }).filter((p) => (p.kind === 'pre_post' || p.kind === 'early') && !p.late && p.postId);
  let graded = 0;
  let ungradable = 0;
  const gradedAt = now.toISOString();
  store.transaction(() => {
    for (const row of rows) {
      const post = store.posts.get(row.postId!);
      if (!post?.postedAt) continue;
      const g = gradeOne(data, row, post, now);
      if (g.kind === 'wait') continue;
      if (g.kind === 'ungradable') {
        store.predictions.grade(row.id, { outcomeViews7d: null, outcomeRatio7d: null, outcomeBand: null, outcomeIsBreakout: null, outcomeMethod: null, hitBand: null, inInterval: null, absLogErr: null, status: 'ungradable', gradedAt });
        ungradable++;
        continue;
      }
      store.predictions.grade(row.id, { ...g.g, status: 'graded', gradedAt });
      graded++;
    }
  });
  const experiments = gradeSelfExperiments(store, now);
  const pairwise = gradePairwiseDue(store, now);
  const run = opts.writeRun === false ? null : ledgerRun(store, { kind: 'grade', started, items: graded + pairwise, dry: Boolean(opts.dry), input: { graded, ungradable, pairwise, linked }, now: new Date() });
  return { graded, ungradable, pairwise, linked, experiments, run };
}

/* ── self-experiments (06 10.5) ──────────────────────────────────────────────── */

/** At the brody row's grade: observedSign = sign(log10 ratio); winner when ratio >= 1.5 or <= 0.67. */
export function gradeSelfExperiments(store: LabStore, now: Date): number {
  let n = 0;
  for (const t of store.tests.all({ kind: 'self_experiment' })) {
    if (t.status === 'done' || t.status === 'abandoned' || !t.scriptId) continue;
    const row = store.predictions.forScript(t.scriptId).find((p) => p.origin === 'live' && p.predictor === 'brody' && p.status === 'graded');
    if (!row) continue;
    const ratio = row.outcomeRatio7d;
    const observedSign = ratio !== null && ratio !== 1 ? (ratio > 1 ? 1 : -1) : null;
    const result = ratio !== null && (ratio >= 1.5 || ratio <= 0.67) ? 'winner' : 'inconclusive';
    store.tests.update(t.id, {
      status: 'done', result, winnerArm: result === 'winner' ? 'a' : null, observedSign,
      confirms: observedSign !== null && t.expectedSign !== null ? observedSign === t.expectedSign : null,
      judgeDetail: { ratio, rule: 'self_experiment' }, judgedAt: now.toISOString(),
      arms: t.arms.map((a, i) => (i === 0 ? { ...a, postId: a.postId ?? row.postId } : a)),
    });
    n++;
  }
  return n;
}

/* ── gradePairwiseDue (06 4.4) ───────────────────────────────────────────────── */

export function gradePairwiseDue(store: LabStore, now: Date): number {
  const at = now.toISOString();
  let n = 0;
  const rows = store.predictions.list({ origin: 'live', predictor: 'judge', status: 'frozen', limit: 1_000_000 });
  for (const row of rows) {
    if (!row.scriptId) continue;
    const aId = String(row.inputs.aId ?? '');
    const bId = String(row.inputs.bId ?? '');
    const t = store.tests.all({ scriptId: row.scriptId, status: 'done' })
      .filter((x) => x.kind === 'trial_reels' || x.kind === 'yt_test_compare')
      .filter((x) => { const hooks = x.arms.map((a) => a.hookId); return hooks.includes(aId) && hooks.includes(bId); })
      .sort((a, b) => ((a.judgedAt ?? a.updatedAt) < (b.judgedAt ?? b.updatedAt) ? 1 : -1))[0];
    if (!t) continue;
    if (t.result === 'inconclusive' || t.result === 'performed_same' || !t.result) {
      store.predictions.gradePairwise(row.id, { testId: t.id, pairRight: null, status: 'ungradable', note: 'test had no clear winner', gradedAt: at });
    } else {
      const win = t.arms.find((a) => a.id === t.winnerArm)?.hookId ?? null;
      if (win !== aId && win !== bId) store.predictions.gradePairwise(row.id, { testId: t.id, pairRight: null, status: 'ungradable', note: 'winner was a third hook', gradedAt: at });
      else store.predictions.gradePairwise(row.id, { testId: t.id, pairRight: win === row.inputs.winner, status: 'graded', gradedAt: at });
    }
    n++;
  }
  return n;
}
