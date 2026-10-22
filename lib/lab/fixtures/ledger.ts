/**
 * Ledger fixture layer (08.7.2 "Judge", "Ledger", "Tests", "Planner", "Retention").
 * Predictor ids from 06's registry only (C1); each row sealed with 06 2.4(a)'s payload hash
 * (sha256 of canonical JSON of FROZEN_FIELDS, keys sorted at every depth), so verifyFrozen holds.
 * S0 builds the rows directly; lane L replaces the numbers with its own maths when it lands.
 */
import type { LabBand, LabEval, LabPlatform, LabPost, LabPrediction, LabTest, LabTestArm } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { canonicalJson, payloadSha256 } from '@/lib/lab/ledger/freeze';
import { bandOf } from '@/lib/lab/ledger/outcome';
import { PLANNER_DIMENSIONS } from '@/lib/lab/ledger/planner';
import { stream } from '@/lib/lab/fixtures/rand';
import { TEST_HOOKS, YT_TITLES } from '@/lib/lab/fixtures/text';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

/** 06 2.4(a) seal helpers live in the ledger (freeze.ts); re-exported for the fixture tests. */
export { canonicalJson, payloadSha256 };

const hex16 = (n: number) => n.toString(16).padStart(16, '0');

type Seed = { predictor: string; version: string; kind: LabPrediction['kind']; graded: number; pending: number; hitRate: number; refAgeH: number | null };
/** 08.7.2 "Ledger" and "Judge" rows. */
const SEEDS: Seed[] = [
  { predictor: 'sh_6h', version: 'sh-1', kind: 'early', graded: 18, pending: 2, hitRate: 0.72, refAgeH: 6 },
  { predictor: 'sh_24h', version: 'sh-1', kind: 'early', graded: 12, pending: 2, hitRate: 0.67, refAgeH: 24 },
  { predictor: 'comment_intent', version: 'ci-1', kind: 'early', graded: 12, pending: 0, hitRate: 0.42, refAgeH: 6 },
  { predictor: 'brody', version: 'brody-1', kind: 'pre_post', graded: 9, pending: 1, hitRate: 0.56, refAgeH: null },
  { predictor: 'external:sample_tool', version: 'ext-1', kind: 'pre_post', graded: 6, pending: 1, hitRate: 0.5, refAgeH: null },
];

export function seedLedger(store: LabStore, anchor: Date): { predictions: number; evals: number; tests: number; retention: number } {
  const T = anchor.getTime();
  const r = stream('ledger');
  const posts = store.posts.all().filter((p) => p.postedAt);
  const owned = posts.filter((p) => p.isOwned);
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const old = owned.filter((p) => T - Date.parse(p.postedAt!) > 8 * DAY);
  const young = owned.filter((p) => T - Date.parse(p.postedAt!) < 6 * DAY);
  let seq = 0;
  let count = 0;
  let evals = 0;
  let retention = 0;
  const tests: LabTest[] = [];
  /** FIXTURE_IDS.prediction is the first row; the rest use 06's id form ('lpr-' + 16 hex). */
  const nextId = () => (++seq === 1 ? 'fx-pred-1' : `lpr-${hex16(seq)}`);

  const base = (p: LabPost | null, s: { predictor: string; version: string; kind: LabPrediction['kind']; refAgeH: number | null }, frozenAt: number): Omit<LabPrediction, 'payloadSha256'> => ({
    id: nextId(),
    origin: 'live', predictor: s.predictor, predictorVersion: s.version, kind: s.kind,
    scriptId: null, scriptVersion: null, postId: p?.id ?? null, sourceId: p?.sourceId ?? null, platform: (p?.platform ?? null) as LabPlatform | null, surface: p ? (p.contentType === 'short' ? 'short' : 'video') : null,
    refAgeH: s.refAgeH, asOf: iso(frozenAt), frozenAt: iso(frozenAt), backtestOrigin: null,
    band: null, score: null, ratioPoint: null, ratioLo: null, ratioHi: null, viewsPoint: null, viewsLo: null, viewsHi: null, pBreakout: null, intervalLevel: null, baseline7dViews: null, baselineN: null,
    inputs: {}, note: '', late: false, status: 'frozen', voidReason: null, voidedAt: null,
    outcomeViews7d: null, outcomeRatio7d: null, outcomeBand: null, outcomeIsBreakout: null, outcomeMethod: null, hitBand: null, inInterval: null, absLogErr: null, testId: null, pairRight: null, gradedAt: null, dry: false,
  });
  const insert = (row: Omit<LabPrediction, 'payloadSha256'>) => {
    store.predictions.insert({ ...row, payloadSha256: payloadSha256(row) });
    count++;
  };

  store.transaction(() => {
    for (const s of SEEDS) {
      for (let i = 0; i < s.graded + s.pending; i++) {
        const graded = i < s.graded;
        const pool = graded ? old : young;
        if (!pool.length) continue;
        const p = pool[(graded ? i : i - s.graded) % pool.length]; // distinct posts per predictor (06 unique live indexes)
        const posted = Date.parse(p.postedAt!);
        const frozenAt = s.kind === 'pre_post' ? posted - 3 * HOUR : posted + (s.refAgeH ?? 6) * HOUR;
        const outcome = measures.get(p.id)?.breakout ?? Math.round(r.between(0.4, 4) * 100) / 100;
        const hit = graded && r.chance(s.hitRate);
        const said = hit ? outcome : outcome * (r.chance(0.5) ? 2.4 : 0.35);
        const band: LabBand = bandOf(said);
        const row = base(p, s, frozenAt);
        const scored = s.predictor.startsWith('external:') ? { score: Math.round(r.between(0.3, 0.95) * 100) / 100, inputs: { rawScore: r.int(30, 95), scaleMax: 100, toolLabel: 'Sample tool' } } : s.predictor === 'comment_intent' ? { score: Math.round(r.between(0.5, 3) * 100) / 100, inputs: { requestRate: 1.2, n: 24 } } : {};
        Object.assign(row, {
          band: s.predictor.startsWith('external:') ? null : band,
          score: s.predictor === 'brody' ? ['below', 'normal', 'above', 'breakout'].indexOf(band) : null,
          ratioPoint: s.kind === 'early' ? Math.round(said * 100) / 100 : null,
          ratioLo: s.kind === 'early' ? Math.round(said * 0.6 * 100) / 100 : null,
          ratioHi: s.kind === 'early' ? Math.round(said * 1.7 * 100) / 100 : null,
          intervalLevel: s.kind === 'early' ? 0.8 : null,
          ...scored,
        });
        if (graded) {
          Object.assign(row, {
            status: 'graded', outcomeViews7d: Math.round(outcome * 12_000), outcomeRatio7d: outcome, outcomeBand: bandOf(outcome), outcomeIsBreakout: outcome >= 3, outcomeMethod: 'interpolated',
            hitBand: row.band ? row.band === bandOf(outcome) : null, inInterval: s.kind === 'early' ? outcome >= (row.ratioLo ?? 0) && outcome <= (row.ratioHi ?? 0) : null,
            absLogErr: Math.round(Math.abs(Math.log10(Math.max(0.01, said) / Math.max(0.01, outcome))) * 1000) / 1000, gradedAt: iso(posted + 175 * HOUR),
          });
        }
        insert(row);
        // creator_median is frozen alongside every brody pre-post row (06 2.7)
        if (s.predictor === 'brody') {
          const cm = base(p, { predictor: 'creator_median', version: 'cm-1', kind: 'pre_post', refAgeH: null }, frozenAt);
          Object.assign(cm, { band: 'normal', score: 0, ratioPoint: 1, viewsPoint: 12_000, viewsLo: 6_000, viewsHi: 24_000, baseline7dViews: 12_000, baselineN: 9, intervalLevel: 0.8 });
          if (graded) Object.assign(cm, { status: 'graded', outcomeViews7d: Math.round(outcome * 12_000), outcomeRatio7d: outcome, outcomeBand: bandOf(outcome), outcomeIsBreakout: outcome >= 3, outcomeMethod: 'interpolated', hitBand: bandOf(outcome) === 'normal', inInterval: outcome >= 0.5 && outcome <= 2, absLogErr: Math.round(Math.abs(Math.log10(Math.max(0.01, outcome))) * 1000) / 1000, gradedAt: iso(posted + 175 * HOUR) });
          insert(cm);
        }
      }
    }

    // the posted fixture script's frozen prediction (08.7.2 "posted (frozen prediction, linked post)")
    const posted = store.scripts.get('fx-script-3');
    if (posted?.publishedPostId) {
      const p = store.posts.get(posted.publishedPostId);
      if (p?.postedAt) {
        const row = base(p, { predictor: 'brody', version: 'brody-1', kind: 'pre_post', refAgeH: null }, Date.parse(p.postedAt) - 5 * HOUR);
        Object.assign(row, { scriptId: posted.id, scriptVersion: 2, band: 'above', score: 2, note: 'Frozen before posting.' });
        insert(row);
      }
    }

    // judge: 10 pairwise rows on fixture scripts: 7 graded (5 right), 2 abstained, 1 pending
    for (let i = 0; i < 10; i++) {
      const row = base(null, { predictor: 'judge', version: 'judge-v1', kind: 'pairwise', refAgeH: null }, T - (40 - i * 3) * DAY / 2);
      const abstained = i === 7 || i === 8;
      Object.assign(row, {
        scriptId: `fx-script-${(i % 3) + 1}`, inputs: { aId: `h${i}a`, bId: `h${i}b`, winner: abstained ? null : `h${i}a`, abstained, promptVersion: 'judge-v1' },
        note: abstained ? 'abstained' : '', status: abstained ? 'ungradable' : i < 7 ? 'graded' : 'frozen',
        testId: i < 7 ? `fx-test-j${i}` : null, pairRight: i < 7 ? i < 5 : null, gradedAt: i < 7 || abstained ? iso(T - (30 - i * 3) * DAY / 2) : null,
      });
      insert(row);
    }

    // lab_evals: 8 weekly rows per predictor, scope backtest and live
    const verdicts: Record<string, { f: LabEval['verdictForecast']; rk: LabEval['verdictRanking']; c: LabEval['verdictClassifier']; n: number }> = {
      creator_median: { f: 'at_chance', rk: null, c: null, n: 40 },
      sh_6h: { f: 'beats', rk: 'beats', c: 'beats', n: 34 },
      sh_24h: { f: 'beats', rk: 'beats', c: 'at_chance', n: 26 },
      comment_intent: { f: null, rk: 'worse', c: null, n: 24 },
      brody: { f: null, rk: 'not_enough', c: null, n: 9 },
      'external:sample_tool': { f: null, rk: 'not_enough', c: null, n: 6 },
      judge: { f: null, rk: 'not_enough', c: null, n: 7 },
    };
    for (const [predictor, v] of Object.entries(verdicts)) {
      for (const scope of ['backtest', 'live'] as const) {
        for (let w = 7; w >= 0; w--) {
          const day = iso(T - w * 7 * DAY).slice(0, 10);
          const n = Math.max(1, v.n - w);
          const pw = predictor === 'comment_intent' ? 0.46 : predictor === 'creator_median' ? 0.5 : 0.6 + r.between(-0.03, 0.03);
          store.evals.upsert({
            predictor, predictorVersion: predictor === 'creator_median' ? 'cm-1' : predictor.startsWith('sh') ? 'sh-1' : predictor === 'comment_intent' ? 'ci-1' : predictor === 'judge' ? 'judge-v1' : predictor === 'brody' ? 'brody-1' : 'ext-1',
            scope, population: predictor.startsWith('sh') || predictor === 'creator_median' ? 'all' : 'owned', platform: 'all', windowWeeks: 12, computedDate: day, computedAt: `${day}T03:30:00.000Z`, harnessVersion: 'h-1',
            origins: scope === 'backtest' ? 26 : 0, nPosts: n, nCreators: predictor.startsWith('sh') ? 14 : 1, abstained: predictor === 'judge' ? 2 : 0, nPairs: n * 3,
            pairwise: Math.round(pw * 1000) / 1000, pairwiseLo: Math.round((pw - 0.08) * 1000) / 1000, pairwiseHi: Math.round((pw + 0.08) * 1000) / 1000,
            spearman: predictor === 'comment_intent' ? -0.05 : 0.31, spearmanLo: predictor === 'comment_intent' ? -0.3 : 0.05, spearmanHi: predictor === 'comment_intent' ? 0.2 : 0.52,
            logMae: predictor.startsWith('sh') ? 0.17 : predictor === 'creator_median' ? 0.29 : null, logMaeBaseline: predictor.startsWith('sh') ? 0.29 : null, maeDeltaLo: predictor.startsWith('sh') ? 0.04 : null, maeDeltaHi: predictor.startsWith('sh') ? 0.19 : null,
            coverage: predictor.startsWith('sh') ? 0.8 : null, coverageLo: predictor.startsWith('sh') ? 0.62 : null, coverageHi: predictor.startsWith('sh') ? 0.91 : null, coverageN: predictor.startsWith('sh') ? 20 : 0,
            prAuc: predictor.startsWith('sh') ? 0.72 : null, prAucLo: predictor.startsWith('sh') ? 0.55 : null, prAucHi: predictor.startsWith('sh') ? 0.86 : null, baseRate: predictor.startsWith('sh') ? 0.3 : null, positives: predictor.startsWith('sh') ? 9 : 0,
            bandHits: { below: { said: 4, hit: 3 }, normal: { said: 8, hit: 5 }, above: { said: 5, hit: 3 }, breakout: { said: 2, hit: 1 } },
            verdictForecast: v.f, verdictRanking: v.rk, verdictClassifier: v.c, dry: false,
          });
          evals++;
        }
      }
    }

    // tests: fx-test-1 winner (agrees with a Playbook lift), fx-test-2..4 inconclusive, fx-test-5 running, fx-test-6 yt winner; planner slots
    const igOwned = owned.filter((p) => p.platform === 'instagram');
    const ytOwned = owned.filter((p) => p.platform === 'youtube');
    const arm = (id: string, label: string, text: string, postId: string | null, reach: number | null, shares: number | null, extra: Partial<LabTestArm> = {}): LabTestArm => ({
      id, label, variantText: text, hookId: null, featureValue: null, postId,
      metrics: { atAgeH: reach === null ? null : 72, reach, views: reach === null ? null : Math.round(reach * 1.3), likes: reach === null ? null : Math.round(reach * 0.05), shares, saved: reach === null ? null : Math.round(reach * 0.01), follows: null, watchTimeSharePct: null, source: reach === null ? null : 'manual' },
      propensity: null, ...extra,
    });
    const test = (t: Partial<LabTest> & Pick<LabTest, 'id' | 'kind' | 'title' | 'status' | 'arms' | 'platform' | 'variable' | 'primaryMetric'>): LabTest => ({
      hypothesis: '', featureKey: null, expectedSign: null, scriptId: null, judgeAgeH: t.kind === 'trial_reels' ? 72 : null, result: null, winnerArm: null, observedSign: null, confirms: null, judgeDetail: {}, notes: '', planWeek: null,
      startedAt: iso(T - 14 * DAY), judgedAt: null, createdAt: iso(T - 15 * DAY), updatedAt: iso(T - 10 * DAY), dry: false, ...t,
    });
    const ig = (i: number) => igOwned[i % Math.max(1, igOwned.length)]?.id ?? null;
    tests.push(
      test({ id: 'fx-test-1', kind: 'trial_reels', title: 'Results-first hook against a question hook', hypothesis: 'A results-first hook earns more shares per reach.', variable: 'hook', featureKey: 'hook_form:results_first', expectedSign: 1, platform: 'instagram', status: 'done', primaryMetric: 'shares_per_reach', result: 'winner', winnerArm: 'a', observedSign: 1, confirms: true, arms: [arm('a', 'Hook A', TEST_HOOKS[0][0], ig(0), 4200, 63, { featureValue: 'results_first' }), arm('b', 'Hook B', TEST_HOOKS[0][1], ig(1), 4050, 32, { featureValue: 'direct_question' })], judgedAt: iso(T - 9 * DAY), judgeDetail: { rule: 'two-proportion', diff: 0.0071 } }),
      ...[1, 2, 3].map((k) => test({ id: `fx-test-${k + 1}`, kind: 'trial_reels', title: `Hook test ${k + 1}`, variable: 'hook', platform: 'instagram', status: 'done', primaryMetric: 'shares_per_reach', result: 'inconclusive', arms: [arm('a', 'Hook A', TEST_HOOKS[k][0], ig(2 * k), 3100, 30), arm('b', 'Hook B', TEST_HOOKS[k][1], ig(2 * k + 1), 2900, 27)], judgedAt: iso(T - (8 - k) * DAY), judgeDetail: { rule: 'two-proportion', reason: 'interval crosses zero' } })),
      test({ id: 'fx-test-5', kind: 'trial_reels', title: 'Browser agents hook test', variable: 'hook', platform: 'instagram', status: 'running', primaryMetric: 'shares_per_reach', arms: [arm('a', 'Hook A', TEST_HOOKS[5][0], ig(8), null, null), arm('b', 'Hook B', TEST_HOOKS[5][1], ig(9), null, null)], startedAt: iso(T - DAY) }),
      test({ id: 'fx-test-6', kind: 'yt_test_compare', title: 'Title test on the local model video', variable: 'title', platform: 'youtube', status: 'done', primaryMetric: 'watch_time_share', result: 'winner', winnerArm: 'b', arms: [arm('a', 'Title A', YT_TITLES[0][0], ytOwned[0]?.id ?? null, null, null, { metrics: { atAgeH: null, reach: null, views: null, likes: null, shares: null, saved: null, follows: null, watchTimeSharePct: 41, source: 'manual' } }), arm('b', 'Title B', YT_TITLES[0][1], ytOwned[0]?.id ?? null, null, null, { metrics: { atAgeH: null, reach: null, views: null, likes: null, shares: null, saved: null, follows: null, watchTimeSharePct: 59, source: 'manual' } })], judgedAt: iso(T - 4 * DAY) }),
    );
    // planner: current ISO week, 4 planned, 2 awaiting_result, 2 done with observedSign
    const week = isoWeek(anchor);
    const slotStatus: LabTest['status'][] = ['planned', 'planned', 'planned', 'planned', 'awaiting_result', 'awaiting_result', 'done', 'done'];
    slotStatus.forEach((status, i) => {
      const hook = PLANNER_DIMENSIONS.hook[i % PLANNER_DIMENSIONS.hook.length];
      tests.push(test({
        id: `fx-plan-${i + 1}`, kind: 'planned_post', title: `Planned post ${i + 1}`, variable: 'hook', platform: i % 2 ? 'tiktok' : 'instagram', status, primaryMetric: 'ratio_72h', planWeek: week,
        arms: [arm('a', 'Plan', `Try a ${hook.replace(/_/g, ' ')} hook`, null, null, null, { featureValue: hook, propensity: Math.round((1 / PLANNER_DIMENSIONS.hook.length) * 1000) / 1000 })],
        observedSign: status === 'done' ? (i === 6 ? 1 : -1) : null, result: status === 'done' ? 'winner' : null, winnerArm: status === 'done' ? 'a' : null, startedAt: status === 'planned' ? null : iso(T - 3 * DAY),
      }));
    });
    for (const t of tests) store.tests.create(t);

    // retention: 4 YouTube curves (100 points), 6 Instagram rows, one with skip rate unavailable
    ytOwned.slice(0, 4).forEach((p, k) => {
      const curve = Array.from({ length: 100 }, (_, i) => {
        const x = (i + 1) / 100;
        return { x, awr: Math.round((0.38 + 0.6 * Math.exp(-x * (5 + k))) * 1000) / 1000, rrp: Math.round(r.between(0.4, 0.7) * 1000) / 1000 };
      });
      store.retention.add({ postId: p.id, platform: 'youtube', source: 'fixture', capturedAt: iso(Date.parse(p.postedAt!) + 7 * DAY), ageH: 168, partial: false, curve, views: r.int(4000, 30000), avgViewDurationS: r.int(20, 240), avgViewPct: Math.round(r.between(30, 60) * 10) / 10, reach: null, likes: null, comments: null, saved: null, shares: null, totalInteractions: null, avgWatchTimeMs: null, totalWatchTimeMs: null, skipRate: null, raw: {}, dry: false });
      retention++;
    });
    igOwned.slice(0, 6).forEach((p, k) => {
      store.retention.add({ postId: p.id, platform: 'instagram', source: 'fixture', capturedAt: iso(Date.parse(p.postedAt!) + 3 * DAY), ageH: 72, partial: false, curve: null, views: r.int(3000, 20000), avgViewDurationS: null, avgViewPct: null, reach: r.int(2000, 15000), likes: r.int(80, 900), comments: r.int(5, 60), saved: r.int(10, 200), shares: r.int(5, 120), totalInteractions: r.int(100, 1200), avgWatchTimeMs: r.int(4000, 14000), totalWatchTimeMs: r.int(1e7, 8e7), skipRate: k === 5 ? null : Math.round(r.between(25, 55) * 10) / 10, raw: {}, dry: false });
      retention++;
    });

    store.priors.set({ key: 'ledger:fit:sh_24h:instagram', value: { kind: 'sh', platform: 'instagram', refAgeH: 24, c: 0.3, n: 26, groups: {}, q: null, nCal: 0, calResiduals: [], fittedAt: iso(T - DAY) }, n: 26, supersedesDefault: false, updatedAt: iso(T - DAY) });
  });
  return { predictions: count, evals, tests: tests.length, retention };
}

/** '2026-W41' for the ISO week containing d (UTC). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
