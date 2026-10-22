/**
 * lab_evals (06 8.1, 5): one row per predictor x scope x platform x window per day, computed on
 * graded, non-void, non-late rows (dry rows only in a dry cycle), with bootstrap intervals and
 * the 8.2 verdicts.
 */
import type { LabEval, LabPrediction } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { PREDICTORS, predictorDef, type PredictorDef } from '@/lib/lab/ledger/predictors';
import { bootstrap, coverage, log1p10, pairwiseAccuracy, prAuc, spearmanWithin, wilson90, type RankRow } from '@/lib/lab/ledger/metrics';
import { VERDICT_MIN_N, verdictFor } from '@/lib/lab/ledger/hide';
import { HARNESS_VERSION } from '@/lib/lab/ledger/backtest';

const WEEK = 7 * 24 * 3_600_000;
export const EVAL_WINDOWS = [12, 26] as const;

/** Ranking rows: score (forecasts: log10(viewsPoint + 1)) against y within each creator (06 5 preamble). */
export function rankRows(rows: readonly LabPrediction[]): (RankRow & { id: string })[] {
  const byCreator = new Map<string, LabPrediction[]>();
  for (const r of rows) {
    const c = r.sourceId ?? 'unknown';
    byCreator.set(c, [...(byCreator.get(c) ?? []), r]);
  }
  const out: (RankRow & { id: string })[] = [];
  for (const [creator, list] of byCreator) {
    const useRatio = list.every((r) => r.outcomeRatio7d !== null && r.outcomeRatio7d > 0);
    for (const r of list) {
      const s = r.score ?? (r.viewsPoint !== null ? log1p10(r.viewsPoint) : null);
      const y = useRatio ? Math.log10(r.outcomeRatio7d!) : r.outcomeViews7d !== null ? log1p10(r.outcomeViews7d) : null;
      if (s === null || y === null) continue;
      out.push({ creator, s, y, id: r.id });
    }
  }
  return out;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const errBase = (r: LabPrediction) => (r.baseline7dViews !== null && r.outcomeViews7d !== null ? Math.abs(log1p10(r.baseline7dViews) - log1p10(r.outcomeViews7d)) : null);

/** The eval for one predictor over already-filtered rows (pure). */
export function evalFor(def: PredictorDef, rows: readonly LabPrediction[], o: { scope: LabEval['scope']; platform: LabEval['platform']; windowWeeks: number; now: Date; dry: boolean; abstained?: number; origins?: number; B?: number }): LabEval {
  const computedDate = o.now.toISOString().slice(0, 10);
  const seed = `${def.id}|${o.scope}|${o.platform}|${o.windowWeeks}|${computedDate}`;
  const graded = rows.filter((r) => r.status === 'graded' && !r.late);
  // Intervals are drawn only where they can be shown or decide: n 5 or more, and on a platform row
  // only at the n 20 that lets it decide (06 8.2); the `all` row always carries them from n 5.
  const B = graded.length < 5 || (o.platform !== 'all' && graded.length < VERDICT_MIN_N) ? 0 : (o.B ?? 2000);
  const abstainedLive = rows.filter((r) => r.status === 'ungradable' && r.note === 'abstained').length;
  const e: LabEval = {
    predictor: def.id, predictorVersion: def.version, scope: o.scope, population: def.scope, platform: o.platform, windowWeeks: o.windowWeeks, computedDate, computedAt: o.now.toISOString(),
    harnessVersion: HARNESS_VERSION, origins: o.origins ?? 0, nPosts: graded.length, nCreators: new Set(graded.map((r) => r.sourceId ?? 'unknown')).size, abstained: (o.abstained ?? 0) + abstainedLive, nPairs: 0,
    pairwise: null, pairwiseLo: null, pairwiseHi: null, spearman: null, spearmanLo: null, spearmanHi: null,
    logMae: null, logMaeBaseline: null, maeDeltaLo: null, maeDeltaHi: null, coverage: null, coverageLo: null, coverageHi: null, coverageN: 0,
    prAuc: null, prAucLo: null, prAucHi: null, baseRate: null, positives: 0, bandHits: {}, verdictForecast: null, verdictRanking: null, verdictClassifier: null, dry: o.dry,
  };

  if (def.kinds.includes('pairwise')) {
    // 06 5.8: right of n with Wilson 90%
    const right = graded.filter((r) => r.pairRight === true).length;
    if (graded.length) {
      const [lo, hi] = wilson90(right, graded.length);
      Object.assign(e, { pairwise: right / graded.length, pairwiseLo: lo, pairwiseHi: hi, nPairs: graded.length });
    }
    e.verdictRanking = verdictFor(e, 'pairwise');
    return e;
  }

  // ranking (every post-level predictor carries it; creator_median scores 0, so it sits at 0.5)
  const rr = rankRows(graded);
  const pw = pairwiseAccuracy(rr);
  if (pw) {
    const ci = bootstrap(rr, (s) => pairwiseAccuracy(s)?.acc ?? null, { B, seed, clusterBy: (r) => r.creator });
    Object.assign(e, { pairwise: pw.acc, pairwiseLo: ci?.lo ?? null, pairwiseHi: ci?.hi ?? null, nPairs: pw.pairs });
  }
  const sp = spearmanWithin(rr);
  if (sp) {
    const ci = bootstrap(rr, (s) => spearmanWithin(s)?.rho ?? null, { B, seed, clusterBy: (r) => r.creator });
    Object.assign(e, { spearman: sp.rho, spearmanLo: ci?.lo ?? null, spearmanHi: ci?.hi ?? null });
  }

  if (def.kinds.includes('forecast')) {
    const fr = graded.filter((r) => r.absLogErr !== null);
    e.logMae = mean(fr.map((r) => r.absLogErr!));
    const paired = fr.filter((r) => errBase(r) !== null).map((r) => ({ creator: r.sourceId ?? 'unknown', model: r.absLogErr!, base: errBase(r)! }));
    e.logMaeBaseline = mean(paired.map((p) => p.base));
    if (paired.length) {
      const ci = bootstrap(paired, (s) => mean(s.map((p) => p.base - p.model)), { B, seed, clusterBy: (p) => p.creator });
      e.maeDeltaLo = ci?.lo ?? null;
      e.maeDeltaHi = ci?.hi ?? null;
    }
    const cov = coverage(graded.map((r) => r.inInterval));
    if (cov) Object.assign(e, { coverage: cov.value, coverageLo: cov.lo, coverageHi: cov.hi, coverageN: cov.m });
  }

  if (def.kinds.includes('classifier')) {
    const cr = graded
      .filter((r) => r.outcomeIsBreakout !== null && (r.pBreakout ?? r.ratioPoint ?? r.score) !== null)
      .map((r) => ({ score: (r.pBreakout ?? r.ratioPoint ?? r.score)!, positive: r.outcomeIsBreakout!, postId: r.postId ?? r.id, creator: r.sourceId ?? 'unknown' }));
    const ap = prAuc(cr);
    e.positives = cr.filter((r) => r.positive).length;
    e.baseRate = cr.length ? e.positives / cr.length : null;
    if (ap) {
      const ci = bootstrap(cr, (s) => prAuc(s)?.ap ?? null, { B, seed, clusterBy: (r) => r.creator });
      Object.assign(e, { prAuc: ap.ap, prAucLo: ci?.lo ?? null, prAucHi: ci?.hi ?? null, baseRate: ap.base });
    }
  }

  const hits: Record<string, { said: number; hit: number }> = {};
  for (const r of graded) {
    if (!r.band || !r.outcomeBand) continue;
    const h = (hits[r.band] ??= { said: 0, hit: 0 });
    h.said++;
    if (r.band === r.outcomeBand) h.hit++;
  }
  e.bandHits = hits;
  if (def.kinds.includes('forecast')) e.verdictForecast = verdictFor(e, 'forecast');
  if (def.kinds.includes('ranking')) e.verdictRanking = verdictFor(e, 'ranking');
  if (def.kinds.includes('classifier')) e.verdictClassifier = verdictFor(e, 'classifier');
  return e;
}

/** Every predictor id the store knows: the registry plus external tools seen in live rows. */
export function knownPredictors(store: LabStore): PredictorDef[] {
  const ext = new Set(store.predictions.list({ origin: 'live', limit: 1_000_000 }).map((p) => p.predictor).filter((id) => id.startsWith('external:')));
  return [...PREDICTORS, ...[...ext].sort().map((id) => predictorDef(id))];
}

/** 06 7.4 step 5: windows 12 and 26 weeks, scope backtest (replayable) and live, platform all and each. */
export function computeEvals(store: LabStore, opts: { now: Date; dry: boolean; abstained?: Record<string, number>; origins?: number; B?: number }): { written: number } {
  const { now, dry } = opts;
  let written = 0;
  for (const def of knownPredictors(store)) {
    const scopes: LabEval['scope'][] = def.replayable ? ['backtest', 'live'] : ['live'];
    for (const scope of scopes) {
      const all = store.predictions.list({ origin: scope, predictor: def.id, limit: 1_000_000 }).filter((r) => r.status !== 'void' && !r.late && (dry || !r.dry));
      for (const w of EVAL_WINDOWS) {
        const since = now.getTime() - w * WEEK;
        const inWindow = all.filter((r) => Date.parse(scope === 'backtest' ? `${r.backtestOrigin}T00:00:00.000Z` : r.frozenAt) >= since);
        if (!inWindow.length && scope === 'live') continue;
        const platforms = ['all', ...[...new Set(inWindow.map((r) => r.platform).filter((p): p is NonNullable<typeof p> => p !== null))].sort()] as LabEval['platform'][];
        for (const platform of platforms) {
          const rows = platform === 'all' ? inWindow : inWindow.filter((r) => r.platform === platform);
          store.evals.upsert(evalFor(def, rows, { scope, platform, windowWeeks: w, now, dry, abstained: scope === 'backtest' && platform === 'all' ? opts.abstained?.[def.id] : 0, origins: scope === 'backtest' ? opts.origins : 0, B: opts.B }));
          written++;
        }
      }
    }
  }
  return { written };
}
