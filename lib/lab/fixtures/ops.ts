/**
 * Operations fixture layer (08.7.2 "Ops"): runs and spend on every v2 line, job states for every
 * LAB_JOBS id, health results, the Apify plan, a schedule config, checklist evidence and the
 * Lab's own forecasts. Run kinds and spend lines are 08.6's. S0 wrote it; lane S owns this file
 * (and tunes the month to the exact 08.7.2 dollar targets once its spend view lands).
 */
import { LAB_JOB_IDS, LAB_RADAR_SOURCES, type LabRunKind, type LabSpendLine } from '@/lib/schemas';
import { providerOf } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { stream } from '@/lib/lab/fixtures/rand';

/** 08.7.2 Ops: this calendar month's spend per line (USD; month spend = actual ?? est ?? reserve). */
export const OPS_MONTH_TARGETS: Partial<Record<LabSpendLine, number>> = {
  'apify.sync': 4.1,
  'apify.snapshots': 2.6,
  'apify.x': 0.9,
  'apify.radar_x': 0.5,
  'apify.radar_tiktok': 0.08,
  'apify.radar_producthunt': 0.02,
  'apify.verify': 0,
  stt: 1.3,
  'stt.controls': 0.1,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

/** v2 lines the v1 world does not already spend on, with this month's charges. */
const V2_LINE_RUNS: { line: LabSpendLine; kind: LabRunKind; actor: string; job: string; runs: number[] }[] = [
  { line: 'apify.snapshots', kind: 'snapshot', actor: 'apify/instagram-post-scraper', job: 'snapshots', runs: [0.62, 0.71, 0.58, 0.69] },
  { line: 'apify.x', kind: 'snapshot', actor: 'apidojo/tweet-scraper', job: 'snapshots', runs: [0.45, 0.45] },
  { line: 'apify.radar_x', kind: 'radar', actor: 'apidojo/tweet-scraper', job: 'radar.x', runs: [0.25, 0.25] },
  { line: 'apify.radar_tiktok', kind: 'radar', actor: 'rastriq/tiktok-trends-scraper', job: 'radar.tiktok_cc', runs: [0.04, 0.04] },
  { line: 'apify.radar_producthunt', kind: 'radar', actor: 's-r/producthunt-launches', job: 'radar.producthunt', runs: [0.02] },
  { line: 'stt.controls', kind: 'transcribe', actor: 'whisper-1', job: 'analyse', runs: [0.06, 0.04] },
];

export function seedOps(store: LabStore, anchor: Date): { runs: number; forecasts: number } {
  const T = anchor.getTime();
  const M = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1);
  /** An instant inside this calendar month, `frac` of the way from its start to the anchor (never after it). */
  const inMonth = (frac: number) => Math.min(T - 60_000, M + Math.max(0, Math.min(1, frac)) * Math.max(0, T - M - 60_000));
  const r = stream('ops');
  let runs = 0;
  let forecasts = 0;
  store.transaction(() => {
    V2_LINE_RUNS.forEach((def, li) => {
      def.runs.forEach((usd, k) => {
        const started = inMonth((k * 7 + li + 1) / 40);
        const id = `fx-run-v2-${li}-${k}`;
        const apify = providerOf(def.line) === 'apify';
        store.runs.insert({ id, kind: def.kind, apifyRunId: apify ? `fxApifyV2${li}${k}` : null, datasetId: apify ? `fxDsV2${li}${k}` : null, actor: def.actor, input: {}, status: 'succeeded', items: r.int(10, 120), costUsd: usd, dry: false, startedAt: iso(started), finishedAt: iso(started + r.int(30, 300) * 1000), error: null, line: def.line, job: def.job, scheduled: true, batchId: null, progress: null });
        store.spend.add({ runId: id, provider: providerOf(def.line), line: def.line, units: r.int(10, 120), estUsd: Math.round(usd * 1.05 * 100) / 100, actualUsd: usd, dry: false, at: iso(started + 60_000), reservedUsd: apify ? Math.max(0.05, Math.round(usd * 1.5 * 100) / 100) : null, actualSource: apify ? 'provider' : 'published_price', events: apify ? { 'apify-default-dataset-item': 50 } : null, settledAt: iso(started + 400_000) });
        runs++;
      });
    });
    // one manual batch of three runs (09.4.2), finished, and one pending run with a reserve
    const batch = 'lbat-fx0000000001';
    ['apify/instagram-post-scraper', 'clockworks/tiktok-scraper', 'streamers/youtube-scraper'].forEach((actor, k) => {
      const started = Math.max(inMonth(0.5), T - 26 * HOUR) + k * 60_000;
      const id = `fx-run-batch-${k}`;
      store.runs.insert({ id, kind: 'scrape', apifyRunId: `fxBatch${k}`, datasetId: `fxBatchDs${k}`, actor, input: {}, status: 'succeeded', items: 40 + k * 10, costUsd: 0.1 + k * 0.05, dry: false, startedAt: iso(started), finishedAt: iso(started + 90_000), error: null, line: 'apify.sync', job: null, scheduled: false, batchId: batch, progress: { items: 40 + k * 10, usd: 0.1 + k * 0.05, statusMessage: null, polledAt: iso(started + 90_000) } });
      store.spend.add({ runId: id, provider: 'apify', line: 'apify.sync', units: 40 + k * 10, estUsd: 0.12 + k * 0.05, actualUsd: 0.1 + k * 0.05, dry: false, at: iso(started), reservedUsd: 0.5, actualSource: 'provider', events: { post: 40 + k * 10 }, settledAt: iso(started + 90_000) });
      runs++;
    });
    store.runs.insert({ id: 'fx-run-pending', kind: 'scrape', apifyRunId: 'fxPending', datasetId: 'fxPendingDs', actor: 'apify/instagram-post-scraper', input: {}, status: 'running', items: null, costUsd: null, dry: false, startedAt: iso(T - 5 * 60_000), finishedAt: null, error: null, line: 'apify.sync', job: 'sync', scheduled: true, batchId: null, progress: { items: 12, usd: 0.03, statusMessage: 'Scraping profile 2 of 5', polledAt: iso(T - 60_000) } });
    store.spend.add({ runId: 'fx-run-pending', provider: 'apify', line: 'apify.sync', units: 0, estUsd: 0.18, actualUsd: null, dry: false, at: iso(T - 5 * 60_000), reservedUsd: 0.27, actualSource: null, events: null, settledAt: null });
    runs++;

    // every LAB_JOBS state ok; the tick heartbeat; health all ok
    for (const id of [...LAB_JOB_IDS, 'tick'] as const) {
      store.priors.set({ key: `job:${id}`, value: { lastAt: iso(T - 10 * 60_000), lastOkAt: iso(T - 10 * 60_000), lastDetail: 'ok', fails: 0, skippedReason: null }, n: 0, supersedesDefault: false, updatedAt: iso(T - 10 * 60_000) });
    }
    for (const id of ['apify.auth', 'apify.prices', 'openai.auth', 'youtube.token', 'instagram.token', 'producthunt.auth', 'github.auth', ...LAB_RADAR_SOURCES.map((s) => `radar.${s}`)]) {
      store.priors.set({ key: `health:${id}`, value: { id, state: 'ok', detail: 'ok', checkedAt: iso(T - 2 * HOUR), network: !id.startsWith('radar.') }, n: 0, supersedesDefault: false, updatedAt: iso(T - 2 * HOUR) });
    }
    store.priors.set({ key: 'apify:plan', value: { tier: 'BRONZE', planId: 'STARTER', maxConcurrentActorRuns: 32, checkedAt: iso(T - 2 * HOUR) }, n: 0, supersedesDefault: false, updatedAt: iso(T - 2 * HOUR) });
    store.priors.set({ key: 'jobcfg:sync', value: { v: 1, paused: false, mode: 'times', times: ['07:00', '19:00'], updatedAt: iso(T - 5 * DAY), history: [{ at: iso(T - 5 * DAY), summary: 'Twice a day (07:00, 19:00)' }] }, n: 0, supersedesDefault: false, updatedAt: iso(T - 5 * DAY) });
    store.priors.set({ key: 'checklist:plan_previewed', value: { at: iso(T - 20 * DAY) }, n: 0, supersedesDefault: false, updatedAt: iso(T - 20 * DAY) });

    // the Lab's own forecasts (09.3.6): 6 graded run costs, 2 month costs, 3 gate etas (met, open, late)
    for (let k = 0; k < 6; k++) {
      const predicted = Math.round(r.between(0.1, 0.6) * 100) / 100;
      store.forecasts.insert({ id: `lfc-${(k + 1).toString(16).padStart(16, '0')}`, kind: 'run_cost', subject: `fx-run-batch-${k % 3}`, frozenAt: iso(T - (k + 2) * DAY), inputs: { actorId: 'apify/instagram-post-scraper' }, predicted, lo: Math.round(predicted * 0.7 * 100) / 100, hi: Math.round(predicted * 1.4 * 100) / 100, expectedItems: 50, actual: Math.round(predicted * r.between(0.85, 1.15) * 100) / 100, actualItems: r.int(40, 60), status: 'graded', gradedAt: iso(T - (k + 1) * DAY), dry: false });
      forecasts++;
    }
    const month = iso(T).slice(0, 7);
    for (const [k, line] of (['apify.sync', 'apify.snapshots'] as const).entries()) {
      store.forecasts.insert({ id: `lfc-${(k + 7).toString(16).padStart(16, '0')}`, kind: 'month_cost', subject: `${line}:${month}`, frozenAt: `${month}-01T06:00:00.000Z`, inputs: {}, predicted: line === 'apify.sync' ? 37.33 : 16.19, lo: line === 'apify.sync' ? 30 : 12, hi: line === 'apify.sync' ? 45.82 : 19.71, expectedItems: null, actual: null, actualItems: null, status: 'open', gradedAt: null, dry: false });
      forecasts++;
    }
    const gates: { gate: string; status: 'graded' | 'open' | 'late'; actual: number | null }[] = [
      { gate: 'baseline_24h:instagram', status: 'graded', actual: 11 },
      { gate: 'breakouts_week:all', status: 'open', actual: null },
      { gate: 'profile_family:all', status: 'late', actual: null },
    ];
    gates.forEach((g, k) => {
      store.forecasts.insert({ id: `lfc-${(k + 9).toString(16).padStart(16, '0')}`, kind: 'gate_eta', subject: g.gate, frozenAt: iso(T - 21 * DAY), inputs: {}, predicted: 9 + k * 5, lo: 6 + k * 4, hi: 14 + k * 3, expectedItems: null, actual: g.actual, actualItems: null, status: g.status, gradedAt: g.status === 'open' ? null : iso(T - 3 * DAY), dry: false });
      forecasts++;
    });
    normalizeMonth(store, anchor);
  });
  return { runs, forecasts };
}

/**
 * Scale this month's settled spend per line so the month matches OPS_MONTH_TARGETS exactly (the
 * v1 world's 28 days of history keep their shape; only this month's dollars are set). Pending
 * rows count their estimate; a line with no settled row this month gets one fixture run.
 */
function normalizeMonth(store: LabStore, anchor: Date): void {
  const since = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)).toISOString();
  const rows = store.spend.since(since).filter((r) => !r.dry);
  let extra = 0;
  for (const [line, target] of Object.entries(OPS_MONTH_TARGETS) as [LabSpendLine, number][]) {
    const lr = rows.filter((r) => r.line === line);
    const pending = lr.filter((r) => r.actualUsd === null).reduce((a, r) => a + (r.estUsd ?? r.reservedUsd ?? 0), 0);
    const settled = lr.filter((r) => r.actualUsd !== null && r.runId).sort((a, b) => a.at.localeCompare(b.at));
    const need = Math.round((target - pending) * 100) / 100;
    if (!settled.length) {
      if (need <= 0) continue;
      const id = `fx-run-month-${line.replace('.', '-')}-${++extra}`;
      const at = new Date(Math.max(Date.parse(since), anchor.getTime() - 3_600_000)).toISOString();
      const provider = providerOf(line);
      store.runs.insert({ id, kind: provider === 'stt' ? 'transcribe' : 'scrape', apifyRunId: provider === 'apify' ? `fxMonth${extra}` : null, datasetId: null, actor: provider === 'stt' ? 'whisper-1' : 'apify/instagram-post-scraper', input: {}, status: 'succeeded', items: 10, costUsd: need, dry: false, startedAt: at, finishedAt: at, error: null, line, job: null, scheduled: true, batchId: null, progress: null });
      store.spend.add({ runId: id, provider, line, units: 10, estUsd: null, actualUsd: need, dry: false, at, actualSource: provider === 'apify' ? 'provider' : 'published_price', settledAt: at });
      continue;
    }
    const sum = settled.reduce((a, r) => a + (r.actualUsd ?? 0), 0);
    let left = need;
    settled.forEach((r, i) => {
      const usd = i === settled.length - 1 ? Math.round(left * 100) / 100 : Math.round((sum > 0 ? ((r.actualUsd ?? 0) * need) / sum : need / settled.length) * 100) / 100;
      left -= usd;
      store.spend.settle(r.runId!, usd, undefined, { source: r.actualSource === 'published_price' ? 'published_price' : 'provider', at: r.settledAt ?? r.at, events: r.events ?? null });
      store.runs.update(r.runId!, { costUsd: usd });
    });
  }
}
