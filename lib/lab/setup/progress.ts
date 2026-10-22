/**
 * Live run progress (09.4.2) and Stop (09.4.5). Built from what the store already holds: the
 * runs of one batch (`lab_runs.batch_id`, `lbat-` + 12 hex), each run's `progress_json` (written by
 * advance from the run object's chargedEventCounts, usageTotalUsd and statusMessage), its frozen
 * run_cost forecast (expected items and estimate) and its spend row (the ceiling). No fake
 * progress: a bar is determinate only with a known expected count, and fills to at most 0.99
 * until the run is terminal.
 */
import { randomBytes } from 'node:crypto';
import type { LabJobId, LabPlatform, LabRun } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { liveApifyClient } from '@/lib/lab/apify-live';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { runCostForecast } from '@/lib/lab/setup/forecast-rows';
import { RECORDED_PRICES } from '@/lib/lab/setup/pricing-book';
import { labFetch } from '@/lib/lab/net';

export type RunStage = 'scrape' | 'ingest' | 'transcribe' | 'dissect' | 'measure';

export type RunRowProgress = {
  /** lab_runs id */
  runId: string;
  apifyRunId: string | null;
  platform: LabPlatform | null;
  actorId: string | null;
  /** 'Instagram posts' */
  label: string;
  /** creators or queries */
  targets: number;
  state: 'queued' | 'running' | 'finishing' | 'succeeded' | 'failed' | 'aborted' | 'timed_out' | 'blocked';
  /** known false: indeterminate */
  items: { sofar: number | null; expected: number | null; known: boolean };
  usd: { sofar: number | null; estimate: number | null; ceiling: number | null };
  elapsedS: number;
  /** median duration of this actor's runs at similar size, n >= 5; else null (no ETA) */
  typicalS: number | null;
  statusMessage: string | null;
  polledAt: string | null;
  canStop: boolean;
};

export type BatchProgress = {
  batchId: string;
  origin: 'manual' | 'schedule';
  /** schedule origin */
  job: LabJobId | null;
  startedAt: string;
  rows: RunRowProgress[];
  overall: { finished: number; total: number; items: number; usd: number; estimateUsd: number | null };
  stages: { stage: Exclude<RunStage, 'scrape'>; state: 'waiting' | 'running' | 'done' | 'skipped' | 'failed'; done: number; total: number | null; note: string }[];
  state: 'running' | 'stages' | 'done' | 'failed' | 'stopped';
  dry: boolean;
};

/** Batch id prefix (09.4.2): `lbat-` + 12 hex. */
export const BATCH_PREFIX = 'lbat-';
export const newBatchId = (): string => `${BATCH_PREFIX}${randomBytes(6).toString('hex')}`;
export const isBatchId = (s: string): boolean => /^lbat-[0-9a-z]{6,24}$/.test(s);

const TERMINAL = new Set(['succeeded', 'failed', 'aborted', 'timed_out', 'blocked']);
export const isTerminalRun = (r: Pick<LabRun, 'status'>): boolean => TERMINAL.has(r.status);

const ACTOR_LABEL: Record<string, string> = {
  'apify/instagram-post-scraper': 'Instagram posts',
  'apify/instagram-profile-scraper': 'Instagram profiles',
  'clockworks/tiktok-scraper': 'TikTok',
  'streamers/youtube-scraper': 'YouTube',
  'harvestapi/linkedin-profile-posts': 'LinkedIn',
  'apidojo/tweet-scraper': 'X',
  'apify/instagram-hashtag-scraper': 'Instagram search',
  'apify/instagram-comment-scraper': 'Instagram comments',
  'clockworks/tiktok-comments-scraper': 'TikTok comments',
  'streamers/youtube-comments-scraper': 'YouTube comments',
};
const PLATFORM_OF: Record<string, LabPlatform> = {
  'apify/instagram-post-scraper': 'instagram',
  'apify/instagram-profile-scraper': 'instagram',
  'apify/instagram-hashtag-scraper': 'instagram',
  'clockworks/tiktok-scraper': 'tiktok',
  'streamers/youtube-scraper': 'youtube',
  'harvestapi/linkedin-profile-posts': 'linkedin',
  'apidojo/tweet-scraper': 'twitter',
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median duration of this actor's finished runs at a similar size (items within x0.5 to x2), n >= 5. */
function typicalSeconds(store: LabStore, actor: string | null, size: number | null): number | null {
  if (!actor) return null;
  const durs = store.runs
    .recent(500)
    .filter((r) => r.actor === actor && r.status === 'succeeded' && !r.dry && r.finishedAt && (size === null || r.items === null || (r.items >= size / 2 && r.items <= size * 2)))
    .map((r) => (Date.parse(r.finishedAt!) - Date.parse(r.startedAt)) / 1000)
    .filter((s) => s > 0);
  return durs.length >= 5 ? Math.round(median(durs)!) : null;
}

function rowFor(store: LabStore, r: LabRun, now: Date): RunRowProgress {
  const input = (r.input ?? {}) as { platform?: unknown; sourceIds?: unknown; terms?: unknown; actorInput?: { searchTerms?: unknown } };
  const forecast = store.forecasts.bySubject(r.id).find((f) => f.kind === 'run_cost') ?? null;
  const known = Boolean((forecast?.inputs as { known?: unknown } | undefined)?.known);
  const spend = store.spend.forRun(r.id)[0] ?? null;
  const platform = (typeof input.platform === 'string' ? input.platform : r.actor ? PLATFORM_OF[r.actor] : null) as LabPlatform | null;
  const targets = Array.isArray(input.sourceIds) ? input.sourceIds.length : Array.isArray(input.terms) ? input.terms.length : Array.isArray(input.actorInput?.searchTerms) ? (input.actorInput!.searchTerms as unknown[]).length : 0;
  const terminal = isTerminalRun(r);
  const sofar = terminal ? r.items ?? r.progress?.items ?? 0 : r.progress?.items ?? r.items ?? null;
  const usdSofar = terminal ? r.costUsd ?? r.progress?.usd ?? null : r.progress?.usd ?? null;
  const end = r.finishedAt ? Date.parse(r.finishedAt) : now.getTime();
  const state: RunRowProgress['state'] = r.status === 'running' && r.progress?.statusMessage === 'Stopping' ? 'finishing' : r.status;
  return {
    runId: r.id,
    apifyRunId: r.apifyRunId,
    platform,
    actorId: r.actor,
    label: (r.actor && ACTOR_LABEL[r.actor]) ?? r.actor ?? r.kind,
    targets,
    state,
    items: { sofar, expected: known ? forecast?.expectedItems ?? null : null, known: known && forecast?.expectedItems !== null && forecast?.expectedItems !== undefined },
    usd: { sofar: usdSofar, estimate: forecast?.predicted ?? spend?.estUsd ?? null, ceiling: spend?.reservedUsd ?? null },
    elapsedS: Math.max(0, Math.round((end - Date.parse(r.startedAt)) / 1000)),
    typicalS: typicalSeconds(store, r.actor, forecast?.expectedItems ?? null),
    statusMessage: r.progress?.statusMessage ? r.progress.statusMessage.slice(0, 80) : null,
    polledAt: r.progress?.polledAt ?? null,
    canStop: !r.dry && !terminal && Boolean(r.apifyRunId),
  };
}

/** A determinate row's fill (09.4.4): min(sofar / expected, 0.99) until terminal, 1 on success. Null when indeterminate. */
export function rowFill(row: RunRowProgress): number | null {
  if (!row.items.known || !row.items.expected) return null;
  if (row.state === 'succeeded') return 1;
  const f = (row.items.sofar ?? 0) / row.items.expected;
  return TERMINAL.has(row.state) ? Math.min(1, f) : Math.min(0.99, f);
}

/** One batch's progress, or null when no run carries the id. */
export function batchProgress(store: LabStore, batchId: string, now: Date): BatchProgress | null {
  const runs = store.runs.byBatch(batchId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (!runs.length) return null;
  const rows = runs.map((r) => rowFor(store, r, now));
  const scrapeRuns = runs.filter((r) => r.kind === 'scrape' || r.kind === 'profile' || r.kind === 'search' || r.kind === 'snapshot' || r.kind === 'radar');
  const finished = rows.filter((r) => TERMINAL.has(r.state)).length;
  const allTerminal = finished === rows.length;
  const estimates = rows.map((r) => r.usd.estimate).filter((x): x is number => x !== null);
  const startedAt = runs[0].startedAt;
  const lastFinish = runs.map((r) => r.finishedAt ?? '').sort().pop() ?? '';

  // follow-on stages, counted from rows carrying the batch's sources
  const sourceIds = new Set(scrapeRuns.flatMap((r) => ((r.input as { sourceIds?: unknown })?.sourceIds as string[] | undefined) ?? []));
  const posts = [...sourceIds].flatMap((id) => store.posts.bySource(id));
  const ingested = scrapeRuns.reduce((a, r) => a + (r.status === 'succeeded' || r.status === 'aborted' || r.status === 'timed_out' ? r.items ?? 0 : 0), 0);
  const transcribed = posts.filter((p) => store.transcripts.get(p.id)).length;
  const dissected = posts.filter((p) => store.dissections.get(p.id)).length;
  const measureState = store.priors.get('job:measure.verdicts')?.value as { lastOkAt?: string | null } | null | undefined;
  const measured = Boolean(allTerminal && lastFinish && measureState?.lastOkAt && measureState.lastOkAt >= lastFinish);
  const tickLock = store.priors.get('job:tick')?.value as { lastAt?: string | null; lastOkAt?: string | null } | null | undefined;
  const waitingTick = Boolean(tickLock?.lastAt && tickLock.lastAt !== tickLock.lastOkAt);
  const followOn = (done: number, total: number | null, ran: boolean) => (!allTerminal ? 'waiting' : ran ? 'done' : 'waiting');
  const stages: BatchProgress['stages'] = [
    { stage: 'ingest', state: allTerminal ? 'done' : ingested > 0 ? 'running' : 'waiting', done: ingested, total: null, note: '' },
    { stage: 'transcribe', state: followOn(transcribed, posts.length, transcribed >= posts.length && posts.length > 0), done: transcribed, total: posts.length || null, note: waitingTick ? 'Waiting for the running tick to finish' : '' },
    { stage: 'dissect', state: followOn(dissected, posts.length, dissected >= posts.length && posts.length > 0), done: dissected, total: posts.length || null, note: waitingTick ? 'Waiting for the running tick to finish' : '' },
    { stage: 'measure', state: !allTerminal ? 'waiting' : measured ? 'done' : 'waiting', done: measured ? 1 : 0, total: 1, note: '' },
  ];
  const dry = runs.every((r) => r.dry);
  if (dry || ingested === 0) for (const s of stages) if (s.state === 'waiting' && allTerminal) s.state = 'skipped';

  let state: BatchProgress['state'];
  if (!allTerminal) state = 'running';
  else if (rows.some((r) => r.state === 'aborted')) state = 'stopped';
  else if (rows.every((r) => r.state === 'failed' || r.state === 'blocked')) state = 'failed';
  else if (stages.some((s) => s.state === 'waiting' || s.state === 'running')) state = 'stages';
  else state = 'done';

  const first = runs[0];
  return {
    batchId,
    origin: first.scheduled ? 'schedule' : 'manual',
    job: (first.job ?? null) as LabJobId | null,
    startedAt,
    rows,
    overall: {
      finished,
      total: rows.length,
      items: rows.reduce((a, r) => a + (r.items.sofar ?? 0), 0),
      usd: Math.round(rows.reduce((a, r) => a + (r.usd.sofar ?? 0), 0) * 10_000) / 10_000,
      estimateUsd: estimates.length ? Math.round(estimates.reduce((a, b) => a + b, 0) * 10_000) / 10_000 : null,
    },
    stages,
    state,
    dry,
  };
}

const ACTIVE_WINDOW_MS = 6 * 3_600_000;

/** Newest batch with a run not terminal, or stages not done, within 6 h. */
export function activeBatch(store: LabStore, now: Date = new Date()): string | null {
  const since = new Date(now.getTime() - ACTIVE_WINDOW_MS).toISOString();
  const seen = new Set<string>();
  for (const r of store.runs.recent(300)) {
    if (!r.batchId || seen.has(r.batchId) || r.startedAt < since) continue;
    seen.add(r.batchId);
    const p = batchProgress(store, r.batchId, now);
    if (p && (p.state === 'running' || p.state === 'stages')) return r.batchId;
  }
  return null;
}

export type AbortFn = (apifyRunId: string) => Promise<void>;

/** The live abort: POST /v2/actor-runs/{id}/abort through labFetch (blocked in dry). */
export function liveAbort(): AbortFn | null {
  const token = resolveApifyToken();
  if (!token) return null;
  const client = liveApifyClient(token);
  return async (id) => {
    await client.abortRun(id);
  };
}

/**
 * Abort one run or a whole batch (09.4.5). Each stoppable run is aborted on Apify and marked
 * `Stopping`; the next advance sees ABORTED, ingests the items already in the dataset and settles
 * at usageTotalUsd. Returns the batch's progress, or null when nothing was stoppable.
 */
export async function abortRuns(store: LabStore, target: { runId: string } | { batchId: string }, opts: { now?: Date; abort?: AbortFn | null } = {}): Promise<BatchProgress | null> {
  const now = opts.now ?? new Date();
  const runs = 'runId' in target ? [store.runs.get(target.runId)].filter((r): r is LabRun => Boolean(r)) : store.runs.byBatch(target.batchId);
  const stoppable = runs.filter((r) => !r.dry && !isTerminalRun(r) && r.apifyRunId);
  if (!stoppable.length) return null;
  const abort = opts.abort === undefined ? liveAbort() : opts.abort;
  if (!abort) return null;
  for (const r of stoppable) {
    await abort(r.apifyRunId!);
    store.runs.update(r.id, { progress: { items: r.progress?.items ?? null, usd: r.progress?.usd ?? null, statusMessage: 'Stopping', polledAt: now.toISOString(), backoffUntil: r.progress?.backoffUntil ?? null, events: r.progress?.events ?? null } });
  }
  const batchId = 'batchId' in target ? target.batchId : stoppable[0].batchId;
  if (!batchId) {
    const r = store.runs.get(stoppable[0].id)!;
    const row = rowFor(store, r, now);
    return { batchId: '', origin: r.scheduled ? 'schedule' : 'manual', job: (r.job ?? null) as LabJobId | null, startedAt: r.startedAt, rows: [row], overall: { finished: 0, total: 1, items: row.items.sofar ?? 0, usd: row.usd.sofar ?? 0, estimateUsd: row.usd.estimate }, stages: [], state: 'running', dry: false };
  }
  return batchProgress(store, batchId, now);
}

/** Has this run's frozen estimate (for the advance hook that grades at settle). */
export const hasCostForecast = (store: LabStore, runId: string): boolean => runCostForecast(store, runId) !== null;

/* ── polling (09.4.3): progress_json for non-terminal runs, 3 s throttle, 429 backoff ── */

/** What one poll reads from Apify for a running run (GET /v2/actor-runs/{id}, then the dataset when needed). */
export type ProgressSource = {
  getRun(apifyRunId: string): Promise<{ status: string; chargedEventCounts: Record<string, number> | null; usageTotalUsd: number | null; statusMessage: string | null; defaultDatasetId: string | null }>;
  datasetItemCount(datasetId: string): Promise<number | null>;
};

export class RateLimitedError extends Error {
  constructor() {
    super('Apify answered 429');
    this.name = 'RateLimitedError';
  }
}

/** A run polled less than this ago is not polled again; the cached values are returned. */
export const POLL_THROTTLE_MS = 3_000;

type MiniFetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The live progress source over labFetch (blocked in dry). */
export function liveProgressSource(token: string, fetchImpl: MiniFetch = labFetch as unknown as MiniFetch): ProgressSource {
  const base = 'https://api.apify.com/v2';
  const headers = { Authorization: `Bearer ${token}` };
  const get = async (path: string) => {
    const res = await fetchImpl(`${base}${path}`, { method: 'GET', headers });
    if (res.status === 429) throw new RateLimitedError();
    if (!res.ok) throw new Error(`Apify GET ${path.split('?')[0]} answered ${res.status}`);
    return ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
  };
  return {
    async getRun(id) {
      const d = await get(`/actor-runs/${encodeURIComponent(id)}`);
      return {
        status: typeof d.status === 'string' ? d.status : 'READY',
        chargedEventCounts: d.chargedEventCounts && typeof d.chargedEventCounts === 'object' ? (d.chargedEventCounts as Record<string, number>) : null,
        usageTotalUsd: typeof d.usageTotalUsd === 'number' ? d.usageTotalUsd : null,
        statusMessage: typeof d.statusMessage === 'string' ? d.statusMessage : null,
        defaultDatasetId: typeof d.defaultDatasetId === 'string' ? d.defaultDatasetId : null,
      };
    },
    async datasetItemCount(id) {
      const d = await get(`/datasets/${encodeURIComponent(id)}`);
      return typeof d.itemCount === 'number' ? d.itemCount : null;
    },
  };
}

/** The primary charge event of an actor (items so far). */
export function primaryEventOf(actorId: string | null): string | null {
  if (!actorId) return null;
  const book = RECORDED_PRICES[actorId];
  return book?.events.find((e) => e.primary)?.name ?? null;
}

const RUNNING_STATUS: Record<string, LabRun['status']> = { READY: 'queued', RUNNING: 'running', 'TIMING-OUT': 'running', ABORTING: 'running' };

/**
 * Poll every non-terminal live run once (09.4.3): items so far from chargedEventCounts[primary],
 * else one dataset call for itemCount; cost so far from usageTotalUsd; the actor's statusMessage.
 * A run polled under 3 s ago, or inside its 429 backoff, makes no call. Terminal runs are left to
 * advance (ingest, then settle). Returns how many Apify calls were made.
 */
export async function pollRunProgress(store: LabStore, runs: LabRun[], src: ProgressSource, now: Date = new Date(), rand: () => number = Math.random): Promise<{ calls: number; polled: number }> {
  let calls = 0;
  let polled = 0;
  for (const r of runs) {
    if (r.dry || isTerminalRun(r) || !r.apifyRunId) continue;
    const p = r.progress ?? null;
    if (p?.polledAt && now.getTime() - Date.parse(p.polledAt) < POLL_THROTTLE_MS) continue;
    if (p?.backoffUntil && Date.parse(p.backoffUntil) > now.getTime()) continue;
    try {
      calls++;
      const run = await src.getRun(r.apifyRunId);
      const primary = primaryEventOf(r.actor);
      let items: number | null = primary && run.chargedEventCounts && typeof run.chargedEventCounts[primary] === 'number' ? run.chargedEventCounts[primary] : null;
      const datasetId = run.defaultDatasetId ?? r.datasetId;
      if (items === null && datasetId) {
        calls++;
        items = await src.datasetItemCount(datasetId);
      }
      polled++;
      store.runs.update(r.id, {
        ...(RUNNING_STATUS[run.status] ? { status: RUNNING_STATUS[run.status] } : {}),
        progress: { items, usd: run.usageTotalUsd, statusMessage: p?.statusMessage === 'Stopping' ? 'Stopping' : run.statusMessage, polledAt: now.toISOString(), backoffUntil: null, events: run.chargedEventCounts },
      });
    } catch (err) {
      if (!(err instanceof RateLimitedError)) throw err;
      // Apify's rule: wait a random 500 to 1000 ms, doubled each 429, max 60 s
      const prevWait = p?.backoffUntil && p.polledAt ? Math.max(500, Date.parse(p.backoffUntil) - Date.parse(p.polledAt)) : 0;
      const wait = Math.min(60_000, prevWait ? prevWait * 2 : 500 + Math.floor(rand() * 500));
      store.runs.update(r.id, { progress: { items: p?.items ?? null, usd: p?.usd ?? null, statusMessage: p?.statusMessage ?? null, polledAt: now.toISOString(), backoffUntil: new Date(now.getTime() + wait).toISOString(), events: p?.events ?? null } });
    }
  }
  return { calls, polled };
}
