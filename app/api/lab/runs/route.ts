import { NextResponse } from 'next/server';
import { runRow } from '@/lib/lab/view';
import { resolveLab } from '@/lib/lab/context';
import { body } from '@/lib/lab/api';
import { spendMeter } from '@/lib/lab/spend';
import { liveApifyClient } from '@/lib/lab/apify-live';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { advanceRuns } from '@/lib/lab/sync';
import { POLL_THROTTLE_MS, abortRuns, batchProgress, isTerminalRun, liveProgressSource, pollRunProgress } from '@/lib/lab/setup/progress';
import { spawnTick } from '@/lib/lab/setup/run-now';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/runs[?limit=50&sample=1] -> { ok, advanced, finished, runs: RunRow[], spend } (v1).
 * GET /api/lab/runs?batch=<id>             -> { ok, batch: BatchProgress | null } (09.4.3, the UI's
 *   run progress read): advances first (a run polled under 3 s ago makes no Apify call), then
 *   reads the batch. `?batch=none` answers batch null (smoke). When every scrape run of a live
 *   manual batch is terminal, the follow-on stages start detached once:
 *   `lab-sync tick --only analyse --only measure.verdicts --batch <id>`.
 * Advance-on-read: never in the sample world, never when dry, never without a token.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const batchParam = url.searchParams.get('batch');
  const now = new Date();
  const token = !ctx.readOnly && !ctx.flags.dry ? resolveApifyToken() : undefined;

  if (batchParam !== null) {
    if (batchParam === 'none' || !batchParam) return NextResponse.json({ ok: true, batch: null });
    const open = ctx.store.runs.byBatch(batchParam).filter((r) => !isTerminalRun(r) && r.apifyRunId && !r.dry);
    if (token && open.length) {
      const stale = open.some((r) => !r.progress?.polledAt || now.getTime() - Date.parse(r.progress.polledAt) >= POLL_THROTTLE_MS);
      if (stale) {
        await advanceRuns(ctx.store, liveApifyClient(token), { now, minAgeS: 0 });
        await pollRunProgress(ctx.store, ctx.store.runs.byBatch(batchParam), liveProgressSource(token), now).catch(() => null);
      }
    }
    const batch = batchProgress(ctx.store, batchParam, now);
    if (batch && !batch.dry && batch.origin === 'manual' && batch.state === 'stages' && !ctx.readOnly) {
      const key = `batch:${batchParam}:stages`;
      if (!ctx.store.priors.get(key)) {
        ctx.store.priors.set({ key, value: { startedAt: now.toISOString() }, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
        spawnTick({ only: ['analyse', 'measure.verdicts'], force: true, manual: true, batchId: batchParam });
      }
    }
    return NextResponse.json({ ok: true, batch });
  }

  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50) || 50));
  let advanced = 0;
  let finished = 0;
  let errors: string[] = [];
  if (token && ctx.store.runs.open().some((r) => r.apifyRunId && !r.dry)) {
    const res = await advanceRuns(ctx.store, liveApifyClient(token));
    advanced = res.advanced;
    finished = res.finished;
    errors = res.errors;
  }
  return NextResponse.json({ ok: true, sample: ctx.flags.sample, advanced, finished, errors, runs: ctx.store.runs.recent(limit).map(runRow), spend: spendMeter(ctx.store) });
}

/**
 * POST /api/lab/runs { action: 'abort', runId | batchId } -> 200 { batch } (09.4.5). Stops the run
 * (or every stoppable run of the batch) on Apify at once; the next advance ingests the items
 * already read and settles at usageTotalUsd. 409 when nothing is running, and in sample.
 */
export async function POST(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  if (ctx.readOnly) return NextResponse.json({ ok: false, error: 'read_only' }, { status: 409 });
  const b = (await body(request)) as { action?: unknown; runId?: unknown; batchId?: unknown } | null;
  if (b?.action !== 'abort') return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  const target = typeof b.runId === 'string' ? { runId: b.runId } : typeof b.batchId === 'string' ? { batchId: b.batchId } : null;
  if (!target) return NextResponse.json({ ok: false, error: 'bad_request', detail: 'Send runId or batchId.' }, { status: 400 });
  if (ctx.flags.dry) return NextResponse.json({ ok: false, error: 'nothing_running' }, { status: 409 });
  const batch = await abortRuns(ctx.store, target);
  if (!batch) return NextResponse.json({ ok: false, error: 'nothing_running' }, { status: 409 });
  return NextResponse.json({ ok: true, batch });
}
