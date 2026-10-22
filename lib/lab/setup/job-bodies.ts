/**
 * The body of every LAB_JOBS row (08.5.1, Body column). Sections 04 to 07 own the bodies; this
 * file only adapts each to `(ctx: JobCtx) => Promise<JobResult>`.
 */
import { resolveApifyToken } from '@/lib/connectors/apify';
import { sttClientFromCreds } from '@/lib/connectors/openai-stt';
import { liveApifyClient } from '@/lib/lab/apify-live';
import { CapError } from '@/lib/lab/spend';
import { buildFramesFor, selectForFrames } from '@/lib/lab/gen/frames';
import { runComments } from '@/lib/lab/gen/comments';
import { labFetch } from '@/lib/lab/net';
import { advanceRuns } from '@/lib/lab/sync';
import { analyse, discover, scrape } from '@/lib/lab/pipeline';
import { recomputeMeasures } from '@/lib/lab/compute';
import { runLabIntel } from '@/lib/lab/intel';
import { assignVerdicts } from '@/lib/lab/measure/compute';
import { planSnapshots, startSnapshots } from '@/lib/lab/measure/scheduler';
import { earlyForecastDue, runLedgerCycle } from '@/lib/lab/ledger/job';
import { backfill } from '@/lib/lab/gen/embed';
import type { FetchLike } from '@/lib/lab/apify-client';
import type { LabStore } from '@/lib/lab/store';
import type { JobCtx, JobResult } from '@/lib/lab/setup/jobs';
import { NETWORK_CHECKS, runNetworkChecks } from '@/lib/lab/setup/health';
import { freezeScheduledForecasts } from '@/lib/lab/setup/forecasts';
import { labTz } from '@/lib/lab/setup/tz';
import { radarCtx, runBrief, runRadarEvents, runSource } from '@/lib/lab/radar/run';
import { composeMorningBrief } from '@/lib/lab/radar/morning-brief';
import { wizardAlive } from '@/lib/lab/radar/wizard';
import type { LabRadarSource } from '@/lib/schemas';

const ok = (detail: string, items?: number): JobResult => ({ ok: true, detail, ...(items !== undefined ? { items } : {}) });
const liveClient = (ctx: JobCtx) => {
  if (ctx.dry) return null;
  const token = resolveApifyToken();
  return token ? liveApifyClient(token) : null;
};

/* ── 04 (lane D): advance, verdicts, snapshots, sync, analyse, discover ── */

export async function advanceBody(ctx: JobCtx): Promise<JobResult> {
  const client = liveClient(ctx);
  if (!client) return ok(ctx.dry ? 'Dry: runs finish in the request that starts them.' : 'No Apify key: nothing to advance.', 0);
  if (!ctx.store.runs.open().some((r) => r.apifyRunId && !r.dry)) return ok('No open runs.', 0);
  const r = await advanceRuns(ctx.store, client, { now: ctx.now });
  return { ok: r.errors.length === 0, detail: `${r.finished} finished, ${r.failed} failed, ${r.items} items${r.errors.length ? `; ${r.errors[0]}` : ''}`, items: r.items };
}

export async function verdictsBody(ctx: JobCtx): Promise<JobResult> {
  const v = assignVerdicts(ctx.store, ctx.now);
  const m = recomputeMeasures(ctx.store, ctx.now);
  return ok(`${v.cases} cases, ${v.controls} controls; ${m.measured} of ${m.posts} measured`, m.measured);
}

export async function snapshotsBody(ctx: JobCtx): Promise<JobResult> {
  const plan = planSnapshots(ctx.store, ctx.now);
  const client = liveClient(ctx);
  if (!client && !ctx.dry) return { ok: false, detail: 'Add an Apify key' };
  const runs = await startSnapshots(ctx.store, client!, plan, { scheduled: ctx.scheduled, now: ctx.now, override: ctx.override });
  return ok(`${runs.length} snapshot run(s)`, runs.reduce((a, r) => a + (r.items ?? 0), 0));
}

export async function syncBody(ctx: JobCtx): Promise<JobResult> {
  const s = await scrape({ store: ctx.store, client: liveClient(ctx), now: ctx.now, scheduled: ctx.scheduled, override: ctx.override });
  const ingested = s.runs.reduce((a, r) => a + (r.ingest?.posts ?? 0), 0);
  return ok(s.runs.length ? `Started ${s.runs.length} run(s)` : 'Nothing due.', ingested);
}

export async function analyseBody(ctx: JobCtx): Promise<JobResult> {
  const a = await analyse({ store: ctx.store, dry: ctx.dry, stt: ctx.dry ? null : sttClientFromCreds(), now: ctx.now, scheduled: ctx.scheduled });
  return ok(`Transcribed ${a.transcribe.done}, dissected ${a.dissect.done}, measured ${a.measures.measured}`, a.transcribe.done + a.dissect.done);
}

export async function discoverBody(ctx: JobCtx): Promise<JobResult> {
  const d = await discover({ store: ctx.store, client: liveClient(ctx), now: ctx.now, scheduled: ctx.scheduled, override: ctx.override });
  return ok(d.terms.length ? `Searched ${d.groups.length} platform(s)` : 'Nothing to search for yet.', d.runs.length);
}

/* ── 08 (lane S): health ── */

export async function healthBody(ctx: JobCtx, fetchImpl?: FetchLike): Promise<JobResult> {
  if (ctx.dry) return ok('Dry: not checked.');
  const res = await runNetworkChecks(ctx.store, NETWORK_CHECKS, { now: ctx.now, fetch: fetchImpl ?? (labFetch as unknown as FetchLike) });
  const f = freezeScheduledForecasts(ctx.store, ctx.now, { dry: ctx.dry });
  const failed = res.filter((r) => r.state === 'fail');
  return { ok: true, detail: `${res.filter((r) => r.state === 'ok').length} ok, ${failed.length} failing${f.month || f.gates ? `; froze ${f.month + f.gates} forecasts` : ''}`, items: res.length };
}

/* ── 05 (lane R): radar sources, events, brief ── */

export type RadarSourceBody = (ctx: JobCtx) => Promise<JobResult>;
const radarCtxOf = (ctx: JobCtx, job: string) => radarCtx(ctx.store, { now: ctx.now, dry: ctx.dry, scheduled: ctx.scheduled, override: ctx.override, job });

/** One radar source's body (05 section 4), through lib/lab/radar/run.ts runSource. */
export function radarSourceBody(source: LabRadarSource): RadarSourceBody {
  return async (ctx) => {
    const r = await runSource(radarCtxOf(ctx, `radar.${source}`), source);
    return { ok: r.status === 'ran' || r.status === 'deferred' || r.status === 'skipped', detail: r.detail, items: r.items };
  };
}
/** 05: name, attach, confirm, expire, novelty, class, window, coverage, angles (runRadarEvents). */
export async function radarEventsBody(ctx: JobCtx): Promise<JobResult> {
  const r = await runRadarEvents(radarCtxOf(ctx, 'radar.events'));
  return ok(`${r.created} created, ${r.confirmed} confirmed, ${r.coverage} coverage rows`, r.created + r.confirmed);
}

/** The brief job (08.9): always composes and writes the brief; sends only when LAB_BRIEF_TELEGRAM=1 and the Wizard is alive. */
export type BriefDeps = {
  compose: (store: LabStore, now: Date, dry: boolean) => Promise<{ items: number }> | { items: number };
  send: (store: LabStore, now: Date, dry: boolean) => Promise<void> | void;
  wizardAlive: () => boolean;
  telegramOn: () => boolean;
};
export const BRIEF_DEPS: BriefDeps = {
  compose: (store, now, dry) => ({ items: composeMorningBrief(store, { now, tz: labTz(), dry }).items.length }),
  // runBrief recomposes (one row per day, idempotent) and hands it to sendMorningBriefToWizard; dry logs a dry `brief` run
  send: async (store, now, dry) => {
    await runBrief(radarCtx(store, { now, dry, scheduled: true, job: 'brief' }));
  },
  wizardAlive: () => wizardAlive(),
  telegramOn: () => (process.env.LAB_BRIEF_TELEGRAM ?? '').trim() === '1',
};
export async function briefBody(ctx: JobCtx, deps: BriefDeps = BRIEF_DEPS): Promise<JobResult> {
  const b = await deps.compose(ctx.store, ctx.now, ctx.dry);
  if (!deps.telegramOn()) return ok(`Composed ${b.items} items; Telegram off.`, b.items);
  if (!deps.wizardAlive()) return ok(`Composed ${b.items} items; the Wizard is not running, nothing sent.`, b.items);
  await deps.send(ctx.store, ctx.now, ctx.dry);
  return ok(`Composed and sent ${b.items} items.`, b.items);
}

/* ── 06 (lane L): ledger ── */

export async function ledgerEarlyBody(ctx: JobCtx): Promise<JobResult> {
  const r = earlyForecastDue(ctx.store, ctx.now);
  return ok(`${r.frozen} early forecasts frozen`, r.frozen);
}
export async function ledgerBody(ctx: JobCtx): Promise<JobResult> {
  const r = await runLedgerCycle(ctx.store, { now: ctx.now, dry: ctx.dry });
  return ok(`${r.runs.length} ledger steps`, r.runs.length);
}

/* ── 07 (lane G): embeddings, frames, comments, intel ── */

export async function embedBody(ctx: JobCtx): Promise<JobResult> {
  const r = await backfill(ctx.store, { limit: 500, scheduled: ctx.scheduled });
  return ok(`Embedded ${r.embedded} (${r.model})`, r.embedded);
}
/** 07 7.14.2: contact sheets for up to FRAMES_PER_CYCLE posts; one post's failure does not stop the rest. */
export async function framesBody(ctx: JobCtx): Promise<JobResult> {
  const ids = selectForFrames(ctx.store);
  let built = 0;
  let firstError: string | null = null;
  for (const id of ids) {
    try {
      await buildFramesFor(ctx.store, id, { now: ctx.now, override: ctx.override });
      built++;
    } catch (err) {
      if (err instanceof CapError) throw err;
      firstError ??= err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: built > 0 || ids.length === 0 || firstError === null, detail: `${built} of ${ids.length} contact sheets${firstError ? `; ${firstError}` : ''}`, items: built };
}
/** 07 7.13: selectForComments, then one comment actor run per platform (live runs finish in advance). */
export async function commentsBody(ctx: JobCtx): Promise<JobResult> {
  const r = await runComments(ctx.store, { now: ctx.now, scheduled: ctx.scheduled, override: ctx.override });
  return ok(`${r.posts} posts, ${r.comments} comments${r.pending ? '; runs pending' : ''}`, r.comments);
}
export async function intelBody(ctx: JobCtx): Promise<JobResult> {
  const r = await runLabIntel(ctx.store, { now: ctx.now, scheduled: ctx.scheduled });
  return ok(`Intel: ${r.summary}`);
}
