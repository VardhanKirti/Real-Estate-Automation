/**
 * Section 04's job bodies for section 08's one scheduler (08.5.1 LAB_JOBS rows `advance`,
 * `measure.verdicts`, `snapshots`, `analyse`). Lane S wires them into LAB_JOBS with their cadence,
 * `needs` and pause scope; these functions only do the work and report it. They never pass a cap
 * (scheduled), honour dry (fixtures, no network) and never throw on a cap stop.
 */
import type { LabStore } from '@/lib/lab/store';
import type { ApifyClient } from '@/lib/lab/apify-client';
import { liveApifyClient } from '@/lib/lab/apify-live';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { sttClientFromCreds } from '@/lib/connectors/openai-stt';
import { advanceRuns } from '@/lib/lab/sync';
import { recomputeMeasures } from '@/lib/lab/compute';
import { analyse } from '@/lib/lab/pipeline';
import { assignVerdicts } from '@/lib/lab/measure/case-control';
import { planSnapshots, startSnapshots } from '@/lib/lab/measure/scheduler';

/** The shape of 08's JobCtx and JobResult (lib/lab/setup/jobs.ts), restated so this module stays free of the scheduler. */
export type MeasureJobCtx = { store: LabStore; now: Date; scheduled: true; dry: boolean; batchId?: string | null; paused?: boolean; client?: ApifyClient | null };
export type MeasureJobResult = { ok: boolean; detail: string; items?: number };

function clientFor(ctx: MeasureJobCtx): ApifyClient | null {
  if (ctx.dry) return null;
  if (ctx.client !== undefined) return ctx.client;
  const token = resolveApifyToken();
  return token ? liveApifyClient(token) : null;
}

/** `advance` (every tick): move open Apify runs on; ingest, settle, then verdicts and measures when items landed. */
export async function advanceJob(ctx: MeasureJobCtx): Promise<MeasureJobResult> {
  const client = clientFor(ctx);
  if (!client) return { ok: true, detail: ctx.dry ? 'Dry: nothing to advance' : 'Apify is not configured', items: 0 };
  const r = await advanceRuns(ctx.store, client, { now: ctx.now });
  return { ok: r.errors.length === 0, detail: `Checked ${r.checked}, finished ${r.finished}, failed ${r.failed}, ${r.items} items${r.errors.length ? `; ${r.errors[0]}` : ''}`, items: r.items };
}

/** `measure.verdicts` (after advance reported items): case-control verdicts, then the measure recompute. */
export async function verdictsJob(ctx: MeasureJobCtx): Promise<MeasureJobResult> {
  const v = assignVerdicts(ctx.store, ctx.now);
  const m = recomputeMeasures(ctx.store, ctx.now);
  return { ok: true, detail: `${v.cases} cases and ${v.controls} controls drawn; ${m.measured} of ${m.posts} posts measured, ${m.breakouts} breakouts`, items: v.cases + v.controls };
}

/** `snapshots` (every 30 minutes): owned discovery, X reads and due fixed-age reads. */
export async function snapshotsJob(ctx: MeasureJobCtx): Promise<MeasureJobResult> {
  const plan = planSnapshots(ctx.store, ctx.now, { paused: ctx.paused });
  if (plan.discover.length === 0 && plan.reads.length === 0) {
    const skipped = plan.skipped.map((s) => `${s.platform} ${s.reason}`).join(', ');
    return { ok: true, detail: skipped ? `Nothing run: ${skipped}` : 'Nothing due', items: 0 };
  }
  const client = clientFor(ctx);
  if (!ctx.dry && !client) return { ok: false, detail: 'Apify is not configured', items: 0 };
  const deferred: string[] = [];
  const runs = await startSnapshots(ctx.store, client, plan, { scheduled: true, now: ctx.now, batchId: ctx.batchId ?? null, onDefer: (_p, why) => deferred.push(why) });
  const due = plan.reads.reduce((a, r) => a + r.posts.length, 0);
  return { ok: true, detail: `${runs.length} run(s): ${plan.discover.length} discovery, ${due} fixed-age read(s)${plan.thinned ? ', thinned' : ''}${deferred.length ? `. ${deferred[0]}` : ''}`, items: runs.reduce((a, r) => a + (r.items ?? 0), 0) };
}

/** `analyse` (after a sync or snapshots ingest): transcribe (cases on stt, controls on stt.controls), dissect, measure. */
export async function analyseJob(ctx: MeasureJobCtx): Promise<MeasureJobResult> {
  const a = await analyse({ store: ctx.store, dry: ctx.dry, stt: ctx.dry ? null : sttClientFromCreds(), now: ctx.now, scheduled: true });
  return { ok: a.dissect.failed === 0, detail: `Transcribed ${a.transcribe.done}, dissected ${a.dissect.done} of ${a.dissect.considered}${a.transcribe.blocked ? `; ${a.transcribe.blocked}` : ''}`, items: a.transcribe.done + a.dissect.done };
}
