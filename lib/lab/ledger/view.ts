/**
 * Ledger domain view (06 13.1; 01 D13): LedgerView for /lab/ledger, ledgerLine for Today and
 * predictionChip for Studio, the Post sheet and tiles. Reads stored rows only (no fetch, no fit).
 * Hidden predictors never show a number outside the Ledger (06 8.3).
 */
import type { LabBand, LabEval, LabPlatform, LabPrediction, LabTest } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabKeyId, LabKeyRow } from '@/lib/lab/setup/keys';
import { LAB_KEYS } from '@/lib/lab/setup/keys';
import { forecastRecord as buildForecastRecord, type ForecastRecord } from '@/lib/lab/setup/forecasts';
import { labTz } from '@/lib/lab/setup/jobs';
import { resolveCred } from '@/lib/creds';
import { keyRow } from '@/lib/lab/setup/key-rows';
import { healthResults } from '@/lib/lab/setup/health';
import { decidingEval, displayKind, hideReasonFor, isShown, recordLineFor, verdictFor, type Verdict } from '@/lib/lab/ledger/hide';
import { BAND_LABEL } from '@/lib/lab/ledger/outcome';
import { predictorDef, type PredictorDef } from '@/lib/lab/ledger/predictors';
import { pairwiseAccuracy, typicalFactor } from '@/lib/lab/ledger/metrics';
import { rankRows, knownPredictors } from '@/lib/lab/ledger/evals';
import { verifyFrozen } from '@/lib/lab/ledger/freeze';
import { plannerGate, plannerView, type PlannerView } from '@/lib/lab/ledger/planner';
import { resultCopy } from '@/lib/lab/ledger/tests';
import { retentionByBeatType, retentionByHookForm, type RetentionByBeatTypeRow, type RetentionByHookFormRow } from '@/lib/lab/ledger/retention/map';
import { HARNESS_VERSION } from '@/lib/lab/ledger/backtest';
import { HARNESS_PRIOR } from '@/lib/lab/ledger/job';

export type { LabBand, LabTest } from '@/lib/schemas';
export type { Verdict } from '@/lib/lab/ledger/hide';
export type { PlannerView } from '@/lib/lab/ledger/planner';
export type { TestMark } from '@/lib/lab/ledger/tests';

export type LedgerState = 'empty' | 'collecting' | 'live' | 'dry' | 'filming' | 'sample';
export type ReliabilityBin = { band: LabBand; said: number; hit: number; baseRate: number | null; enough: boolean };
export type MetricCell = { value: number | null; lo: number | null; hi: number | null; n: number; enough: boolean; display: string };
export type PredictorCard = {
  id: string;
  label: string;
  isBaseline: boolean;
  shown: boolean;
  hiddenReason: string | null;
  verdict: { forecast: Verdict | null; ranking: Verdict | null; classifier: Verdict | null };
  /** recordLine or 'not enough yet' */
  record: string;
  n: number;
  voided: number;
  late: number;
  abstained: number;
  pairwise: MetricCell | null;
  spearman: MetricCell | null;
  logMae: MetricCell | null;
  coverage: MetricCell | null;
  prAuc: MetricCell | null;
  /** pairwise or logMae by computed_date, 12 points max */
  trend: { date: string; value: number | null }[];
};
export type PredictionRow = {
  id: string;
  /** LabPredictorId (01's ?predictor= filter matches it, decision C1) */
  predictor: string;
  predictorLabel: string;
  postId: string | null;
  postTitle: string | null;
  platform: LabPlatform | null;
  frozenAt: string;
  /** 'Above your normal (1.5x to 3x)' */
  said: string;
  /** '2.4x at 7 days' | 'Waiting for 7 days (due 14 Oct)' | 'Could not be graded' */
  happened: string | null;
  hit: boolean | null;
  status: LabPrediction['status'];
  late: boolean;
  sealOk: boolean;
  voidReason: string | null;
};
export type TestRow = { id: string; kind: LabTest['kind']; title: string; hypothesis: string; status: LabTest['status']; result: LabTest['result']; resultLabel: string; confirms: string | null; arms: { label: string; rate: string | null; isWinner: boolean }[] };

export type LedgerView = {
  state: LedgerState;
  hero: { sentence: string; n: number; enough: boolean; reliability: ReliabilityBin[] };
  predictors: PredictorCard[];
  /** newest 50 live */
  predictions: PredictionRow[];
  ungradable: number;
  tests: TestRow[];
  experiments: { featureKey: string; label: string; above: number; around: number; below: number; n: number }[];
  planner: PlannerView | null;
  plannerGate: { n: number; need: 20 };
  retention: { youtube: LabKeyRow; instagram: LabKeyRow; byHookForm: RetentionByHookFormRow[]; byBeatType: RetentionByBeatTypeRow[] };
  harness: { lastRunAt: string | null; nextRunAt: string; version: string; origins: number; lastError: string | null };
  /** built by 09's forecastRecord(store) (09.3.6); not a predictor */
  forecastRecord: ForecastRecord;
};

export const NOT_ENOUGH = 'not enough yet';
const BANDS: LabBand[] = ['below', 'normal', 'above', 'breakout'];
const BAND_RANGE: Record<LabBand, string> = { below: 'under 0.75x', normal: '0.75x to 1.5x', above: '1.5x to 3x', breakout: '3x or more' };
const HOUR = 3_600_000;

/* ── formatting (domain copy; 01's format.ts formats the page numbers) ───────── */

/** 24K, 1.2M, 950. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const strip = (s: string) => s.replace(/\.0$/, '');
  if (a >= 1e6) return `${strip((n / 1e6).toFixed(a >= 1e7 ? 0 : 1))}M`;
  if (a >= 1e3) return `${strip((n / 1e3).toFixed(a >= 1e4 ? 0 : 1))}K`;
  return String(Math.round(n));
}
const ratioText = (x: number) => `${x.toFixed(1)}x`;
const pct0 = (x: number) => `${Math.round(x * 100)}%`;
function dayMonth(iso: string): string {
  const d = new Date(iso);
  const tz = labTz();
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric' }).format(d)} ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'short' }).format(d)}`;
}

/* ── metric cells (06 5.7) ───────────────────────────────────────────────────── */

const cell = (value: number | null, lo: number | null, hi: number | null, n: number, display: (v: number) => string): MetricCell | null =>
  value === null ? null : { value, lo, hi, n, enough: n >= 5, display: n >= 5 ? display(value) : NOT_ENOUGH };

export function metricCells(def: PredictorDef, e: LabEval | null): Pick<PredictorCard, 'pairwise' | 'spearman' | 'logMae' | 'coverage' | 'prAuc'> {
  if (!e) return { pairwise: null, spearman: null, logMae: null, coverage: null, prAuc: null };
  const n = e.nPosts;
  const chance = n < 20 ? ', at chance until n 20' : '';
  const judge = def.kinds.includes('pairwise');
  return {
    pairwise: cell(e.pairwise, e.pairwiseLo, e.pairwiseHi, n, (v) =>
      judge
        ? `right ${Math.round(v * n)} of ${n} (${pct0(v)}, 90% ${pct0(e.pairwiseLo ?? v)} to ${pct0(e.pairwiseHi ?? v)})${chance}`
        : `${pct0(v)} (n ${n})${chance}`),
    spearman: cell(e.spearman, e.spearmanLo, e.spearmanHi, n, (v) => `${v.toFixed(2)} (${(e.spearmanLo ?? v).toFixed(2)} to ${(e.spearmanHi ?? v).toFixed(2)}, n ${n})`),
    logMae: cell(e.logMae, e.maeDeltaLo, e.maeDeltaHi, n, (v) => `typically off by x${typicalFactor(v).toFixed(1)} (n ${n})`),
    coverage: e.coverageN ? cell(e.coverage, e.coverageLo, e.coverageHi, e.coverageN, (v) => `${pct0(v)} range held ${Math.round(v * e.coverageN)} of ${e.coverageN}`) : null,
    prAuc: cell(e.prAuc, e.prAucLo, e.prAucHi, n, (v) => `${v.toFixed(2)} against ${(e.baseRate ?? 0).toFixed(2)} by chance (n ${n})`),
  };
}

/* ── key rows (section 08's LabKeyRow) ───────────────────────────────────────── */

/** The youtube / instagram rows the Setup sheet shows: section 08's keyRow over the stored health results. */
export function ledgerKeyRow(store: LabStore, id: Extract<LabKeyId, 'youtube' | 'instagram'>, opts: { dry: boolean; now: Date }): LabKeyRow {
  const spec = LAB_KEYS.find((k) => k.id === id)!;
  return keyRow(spec, { health: opts.dry ? [] : healthResults(store, { now: opts.now }), dry: opts.dry, store, now: opts.now });
}

/* ── rows ────────────────────────────────────────────────────────────────────── */

const liveRows = (store: LabStore, includeDry: boolean) => store.predictions.list({ origin: 'live', limit: 1_000_000 }).filter((p) => includeDry || !p.dry);
const counted = (p: LabPrediction) => p.status === 'graded' && !p.late && (p.kind === 'pre_post' || p.kind === 'early');

function saidText(p: LabPrediction, def: PredictorDef): string {
  if (p.kind === 'pairwise') return p.inputs.abstained ? 'Abstained: the two orders disagreed' : `Picked hook ${p.inputs.winner === p.inputs.aId ? 'A' : p.inputs.winner === p.inputs.bId ? 'B' : String(p.inputs.winner ?? '')}`;
  if (p.predictor.startsWith('external:')) return `${String(p.inputs.toolLabel ?? def.label)} ${String(p.inputs.rawScore ?? '')}/${String(p.inputs.scaleMax ?? '')}`;
  if (p.predictor === 'creator_median') return p.viewsPoint !== null ? `Your normal: ${compact(p.viewsPoint)} at 7 days` : 'Your normal';
  if (p.predictor === 'comment_intent') return `Comment requests ${p.score !== null ? ratioText(10 ** p.score) : ''} of usual`.replace('  ', ' ');
  if (p.kind === 'early' && p.viewsPoint !== null) return `Projected ${compact(p.viewsPoint)}${p.viewsLo !== null && p.viewsHi !== null ? ` (80% range ${compact(p.viewsLo)} to ${compact(p.viewsHi)})` : ''}`;
  if (p.band) return `${BAND_LABEL[p.band]} (${p.ratioLo !== null && p.ratioHi !== null ? `${ratioText(p.ratioLo)} to ${ratioText(p.ratioHi)}` : BAND_RANGE[p.band]})`;
  return def.label;
}

function happenedText(store: LabStore, p: LabPrediction): string | null {
  if (p.status === 'void') return null;
  if (p.kind === 'pairwise') {
    if (p.status === 'graded') return p.pairRight ? 'Picked the test winner' : 'Missed the test winner';
    if (p.status === 'ungradable') return p.note === 'abstained' ? 'Abstained' : 'Could not be graded';
    return 'Waiting for a test result';
  }
  if (p.late) return 'Frozen after posting, not graded';
  if (p.status === 'graded') return p.outcomeRatio7d !== null ? `${ratioText(p.outcomeRatio7d)} at 7 days` : p.outcomeViews7d !== null ? `${compact(p.outcomeViews7d)} at 7 days` : 'Graded';
  if (p.status === 'ungradable') return 'Could not be graded';
  const post = p.postId ? store.posts.get(p.postId) : null;
  if (!post?.postedAt) return 'Not posted yet';
  return `Waiting for 7 days (due ${dayMonth(new Date(Date.parse(post.postedAt) + 168 * HOUR).toISOString())})`;
}

function postTitle(store: LabStore, p: LabPrediction): string | null {
  if (p.scriptId) {
    const s = store.scripts.get(p.scriptId);
    if (s) return s.title;
  }
  const post = p.postId ? store.posts.get(p.postId) : null;
  if (!post) return null;
  const line = post.caption.split('\n')[0].trim();
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}...` : line || null;
}

export function predictionRow(store: LabStore, p: LabPrediction): PredictionRow {
  const def = predictorDef(p.predictor, typeof p.inputs.toolLabel === 'string' ? p.inputs.toolLabel : undefined);
  return {
    id: p.id, predictor: p.predictor, predictorLabel: def.label, postId: p.postId, postTitle: postTitle(store, p), platform: p.platform, frozenAt: p.frozenAt,
    said: saidText(p, def), happened: happenedText(store, p), hit: p.hitBand ?? p.pairRight ?? (p.status === 'graded' && p.kind !== 'pairwise' ? p.inInterval : null),
    status: p.status, late: p.late, sealOk: verifyFrozen(p), voidReason: p.voidReason,
  };
}

function reliability(rows: readonly LabPrediction[]): ReliabilityBin[] {
  const graded = rows.filter((r) => r.outcomeBand);
  return BANDS.map((band) => {
    const said = graded.filter((r) => r.band === band);
    const hit = said.filter((r) => r.outcomeBand === band).length;
    return { band, said: said.length, hit, baseRate: graded.length ? graded.filter((r) => r.outcomeBand === band).length / graded.length : null, enough: said.length >= 5 };
  });
}

/** 06 13.2 hero: Brody's reliability if he has the most graded rows, else the shown forecast predictor with the most. */
function hero(store: LabStore, rows: readonly LabPrediction[]): LedgerView['hero'] {
  const graded = rows.filter(counted);
  const by = (id: string) => graded.filter((r) => r.predictor === id);
  const forecasters = ['sh_6h', 'sh_24h', 'mv_6h', 'mv_24h'].filter((id) => isShown(store, id, 'all', 'forecast')).sort((a, b) => by(b).length - by(a).length);
  const best = forecasters[0];
  const who = best && by(best).length > by('brody').length ? best : 'brody';
  const mine = by(who);
  const n = mine.length;
  const bins = reliability(mine);
  if (n === 0) return { sentence: 'Nothing graded yet. Freeze a prediction before your next post and it is graded 7 days later.', n, enough: false, reliability: bins };
  if (n < 5) return { sentence: `${n} graded so far. Not enough yet to say whether the Lab, or you, call it right.`, n, enough: false, reliability: bins };
  const top = [...bins].sort((a, b) => b.said - a.said)[0];
  const label = BAND_LABEL[top.band];
  const whoText = who === 'brody' ? 'you' : `the ${predictorDef(who).label.toLowerCase()}`;
  const tail = n < 20 ? ', at chance until n 20' : `, ${pct0(top.baseRate ?? 0)} of all posts land there`;
  return { sentence: `When ${whoText} said ${label.charAt(0).toLowerCase()}${label.slice(1)}, it landed there ${top.hit} of ${top.said} times (n ${n}${tail}).`, n, enough: true, reliability: bins };
}

function predictorCard(store: LabStore, def: PredictorDef, rows: readonly LabPrediction[]): PredictorCard {
  const mine = rows.filter((r) => r.predictor === def.id);
  const e = decidingEval(store, def.id, 'all');
  const kind = displayKind(def);
  const v = (k: 'forecast' | 'ranking' | 'classifier'): Verdict | null => (def.kinds.includes(k) && e ? verdictFor(e, k) : null);
  const verdict = def.kinds.includes('pairwise') ? { forecast: null, ranking: e ? verdictFor(e, 'pairwise') : null, classifier: null } : { forecast: v('forecast'), ranking: v('ranking'), classifier: v('classifier') };
  const mainVerdict = e ? verdictFor(e, kind) : null;
  const shown = def.isBaseline || mainVerdict === 'beats';
  const history = store.evals.history(def.id, 'all', 24).filter((h) => h.scope === (def.replayable ? 'backtest' : 'live') && h.windowWeeks === 12).slice(-12);
  return {
    id: def.id, label: def.label, isBaseline: def.isBaseline, shown, hiddenReason: shown ? null : hideReasonFor(def, e, mainVerdict, kind), verdict,
    record: recordLineFor(def, e, kind),
    n: mine.filter((r) => (def.kinds.includes('pairwise') ? r.status === 'graded' : counted(r))).length,
    voided: mine.filter((r) => r.status === 'void').length, late: mine.filter((r) => r.late).length,
    abstained: (e?.abstained ?? 0) || mine.filter((r) => r.status === 'ungradable' && r.note === 'abstained').length,
    ...metricCells(def, e),
    trend: history.map((h) => ({ date: h.computedDate, value: kind === 'forecast' ? h.logMae : h.pairwise })),
  };
}

function testRow(t: LabTest): TestRow {
  const c = resultCopy(t);
  const feature = t.featureKey ? t.featureKey.split(':').slice(1).join(':').replaceAll('_', ' ') : null;
  const confirms = t.confirms === true && feature ? `Confirms the Playbook: ${feature}` : t.confirms === false && feature ? `Goes against the Playbook: ${feature}` : null;
  const arms = t.arms.map((a) => {
    const rate = t.kind === 'yt_test_compare' ? (a.metrics.watchTimeSharePct !== null ? `${a.metrics.watchTimeSharePct}% watch time share` : null) : a.metrics.reach && a.metrics.shares !== null ? `${((a.metrics.shares / a.metrics.reach) * 100).toFixed(2)}% shares per reach` : null;
    return { label: a.label, rate, isWinner: t.winnerArm === a.id };
  });
  return { id: t.id, kind: t.kind, title: t.title, hypothesis: t.hypothesis, status: t.status, result: t.result, resultLabel: c.label, confirms, arms };
}

function experiments(store: LabStore, includeDry: boolean): LedgerView['experiments'] {
  const by = new Map<string, { above: number; around: number; below: number }>();
  for (const t of store.tests.all({ kind: 'self_experiment' })) {
    if (t.status !== 'done' || !t.featureKey || (t.dry && !includeDry)) continue;
    const ratio = typeof t.judgeDetail.ratio === 'number' ? t.judgeDetail.ratio : null;
    if (ratio === null) continue;
    const b = by.get(t.featureKey) ?? { above: 0, around: 0, below: 0 };
    if (ratio >= 1.5) b.above++;
    else if (ratio <= 0.67) b.below++;
    else b.around++;
    by.set(t.featureKey, b);
  }
  return [...by.entries()].map(([featureKey, b]) => {
    const n = b.above + b.around + b.below;
    const name = featureKey.split(':').slice(1).join(':').replaceAll('_', ' ') || featureKey;
    return { featureKey, label: `${name}: ${b.above} above normal, ${b.around} around, ${b.below} below (n ${n})`, ...b, n };
  });
}

/** The next 03:30 in labTz() after now (08.5.1 `ledger` slot). */
export function nextLedgerRun(now: Date): string {
  const tz = labTz();
  for (let h = 0; h <= 48; h++) {
    const t = new Date(Math.floor(now.getTime() / (30 * 60_000)) * 30 * 60_000 + h * 30 * 60_000);
    if (t <= now) continue;
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
    if (hm === '03:30') return t.toISOString();
  }
  return new Date(now.getTime() + 24 * HOUR).toISOString();
}

function harness(store: LabStore, now: Date): LedgerView['harness'] {
  const prior = store.priors.get(HARNESS_PRIOR)?.value as { ranAt?: string; origins?: number } | null | undefined;
  const recent = store.runs.recent(200).filter((r) => r.kind === 'backtest' || r.kind === 'grade' || r.kind === 'retention' || r.kind === 'oauth_refresh');
  const last = recent.find((r) => r.kind === 'backtest');
  return { lastRunAt: last?.startedAt ?? prior?.ranAt ?? null, nextRunAt: nextLedgerRun(now), version: HARNESS_VERSION, origins: prior?.origins ?? 0, lastError: recent.find((r) => r.error)?.error ?? null };
}

/** 09's card (lib/lab/setup/forecasts.ts forecastRecord). */
function forecastRecordOf(store: LabStore): ForecastRecord {
  return buildForecastRecord(store);
}

/* ── builders ────────────────────────────────────────────────────────────────── */

export function ledgerView(store: LabStore, opts: { now?: Date; dry?: boolean; filming?: boolean; sample?: boolean }): LedgerView {
  const now = opts.now ?? new Date();
  const fixtureWorld = Boolean(opts.dry || opts.filming || opts.sample);
  const rows = liveRows(store, fixtureWorld);
  const defs = knownPredictors(store);
  const predictors = defs.map((d) => predictorCard(store, d, rows));
  const graded = rows.filter(counted);
  const tests = store.tests.all().filter((t) => (t.kind === 'trial_reels' || t.kind === 'yt_test_compare') && (fixtureWorld || !t.dry));
  const evalsExist = store.evals.all().length > 0;
  const state: LedgerState = opts.sample ? 'sample' : opts.filming ? 'filming' : opts.dry ? 'dry'
    : !rows.length && !tests.length && !evalsExist ? 'empty'
    : predictors.some((p) => p.n >= 5) ? 'live' : 'collecting';
  const retentionRows = store.retention.all();
  const ytN = retentionRows.filter((r) => r.platform === 'youtube').length;
  const igN = retentionRows.filter((r) => r.platform === 'instagram').length;
  const gate = plannerGate(store);
  return {
    state,
    hero: hero(store, rows),
    predictors,
    predictions: rows.filter((r) => r.kind !== 'pairwise' || r.status !== 'void').slice(0, 50).map((p) => predictionRow(store, p)),
    ungradable: rows.filter((r) => r.status === 'ungradable' && r.note !== 'abstained' && r.kind !== 'pairwise').length,
    tests: tests.map(testRow),
    experiments: experiments(store, fixtureWorld),
    planner: gate.open ? plannerView(store, now) : null,
    plannerGate: { n: gate.n, need: 20 },
    retention: {
      youtube: ledgerKeyRow(store, 'youtube', { dry: Boolean(opts.dry || opts.filming), now }),
      instagram: ledgerKeyRow(store, 'instagram', { dry: Boolean(opts.dry || opts.filming), now }),
      byHookForm: retentionByHookForm(store, ytN > igN ? 'youtube' : 'instagram'),
      byBeatType: retentionByBeatType(store),
    },
    harness: harness(store, now),
    forecastRecord: forecastRecordOf(store),
  };
}

/** Today's line (06 8.5). */
export function ledgerLine(store: LabStore, now: Date): string {
  const rows = liveRows(store, false).filter(counted);
  if (!rows.length) return 'No predictions graded yet. Freeze one in Studio before you post.';
  const month = now.toISOString().slice(0, 7);
  const thisMonth = rows.filter((r) => (r.gradedAt ?? '').slice(0, 7) === month).length;
  const brody = rows.filter((r) => r.predictor === 'brody');
  const n = brody.length;
  if (n < 5) return `Predictions this month: ${thisMonth} graded, pairwise not enough yet`;
  const pw = pairwiseAccuracy(rankRows(brody));
  const e = decidingEval(store, 'brody', 'all');
  const tail = n < 20 ? ', at chance until n 20' : e && verdictFor(e, 'ranking') === 'beats' ? ', beats your normal' : ', at chance';
  return `Predictions this month: ${thisMonth} graded, pairwise ${pw ? pct0(pw.acc) : NOT_ENOUGH} (n ${n}${tail})`;
}

/** Studio, Post sheet, tiles (06 13.1): a shown forecast with its record, Brody's own pick, or the reason it is hidden. */
export function predictionChip(store: LabStore, scope: { postId?: string; scriptId?: string }): { text: string | null; record: string | null; hiddenReason: string | null } {
  const rows = (scope.postId ? store.predictions.forPost(scope.postId) : scope.scriptId ? store.predictions.forScript(scope.scriptId) : []).filter((p) => p.origin === 'live' && p.status !== 'void');
  const early = rows.filter((p) => p.kind === 'early' && p.predictor !== 'comment_intent').sort((a, b) => (b.refAgeH ?? 0) - (a.refAgeH ?? 0) || (a.predictor < b.predictor ? 1 : -1));
  for (const p of early) {
    const platform = p.platform ?? 'all';
    if (isShown(store, p.predictor, platform, 'forecast') && p.viewsPoint !== null) {
      const range = p.viewsLo !== null && p.viewsHi !== null ? ` (80% range ${compact(p.viewsLo)} to ${compact(p.viewsHi)})` : '';
      return { text: `Projected 7-day: ${compact(p.viewsPoint)}${range}.`, record: recordLineFor(predictorDef(p.predictor), decidingEval(store, p.predictor, platform), 'forecast'), hiddenReason: null };
    }
  }
  const brody = rows.find((p) => p.predictor === 'brody');
  if (brody?.band) return { text: `You said ${BAND_LABEL[brody.band].charAt(0).toLowerCase()}${BAND_LABEL[brody.band].slice(1)}.`, record: recordLineFor(predictorDef('brody'), decidingEval(store, 'brody', brody.platform ?? 'all'), 'ranking'), hiddenReason: null };
  if (early.length) {
    const p = early[0];
    const def = predictorDef(p.predictor);
    const e = decidingEval(store, p.predictor, p.platform ?? 'all');
    return { text: null, record: null, hiddenReason: hideReasonFor(def, e, e ? verdictFor(e, 'forecast') : null, 'forecast') };
  }
  const cm = rows.find((p) => p.predictor === 'creator_median');
  if (cm?.viewsPoint !== null && cm?.viewsPoint !== undefined) return { text: `Your normal: ${compact(cm.viewsPoint)} at 7 days.`, record: null, hiddenReason: null };
  return { text: null, record: null, hiddenReason: null };
}
