import { JobConfigSchema, LabJobIdSchema, providerOf, type JobConfig } from '@/lib/schemas';
import { resolveLab } from '@/lib/lab/context';
import { body, json } from '@/lib/lab/api';
import { headroom } from '@/lib/lab/spend';
import { LAB_JOBS } from '@/lib/lab/setup/jobs';
import { DEFAULT_JOB_CONFIG, describeConfig, isPresetJob, jobConfig } from '@/lib/lab/setup/schedule';
import { newBatchId } from '@/lib/lab/setup/progress';
import { spawnTick } from '@/lib/lab/setup/run-now';
import { setupView } from '@/lib/lab/setup/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/lab/setup/schedule (09.5.5)
 *   { job, config }                         -> 200 { row }      save `jobcfg:<job>`; the next tick reads it
 *   { job, action: 'run_now', override? }   -> 202 { batchId }  `lab-sync tick --only <job> --force --manual`, detached
 * 400 an invalid config (everyMin under 15, more than 24 times, a bad HH:MM, a param out of range) or
 *     a free job's edit other than pause; 402 { capAsk, spent, cap, scope } Run now over a cap;
 * 409 sample (read only), dry Run now, or the same job already running.
 */
export async function POST(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  if (ctx.readOnly) return json({ ok: false, error: 'read_only' }, 409);
  const b = (await body(request)) as { job?: unknown; config?: unknown; action?: unknown; override?: unknown } | null;
  const job = LabJobIdSchema.safeParse(b?.job);
  if (!job.success) return json({ ok: false, error: 'unknown_job' }, 400);
  const id = job.data;
  const now = new Date();

  if (b?.action === 'run_now') {
    if (ctx.flags.dry) return json({ ok: false, error: 'dry', detail: 'Run now makes paid calls, so it is off in dry runs.' }, 409);
    if (ctx.store.runs.open().some((r) => r.job === id && !r.dry)) return json({ ok: false, error: 'running', detail: 'This job is already running.' }, 409);
    const spec = LAB_JOBS.find((j) => j.id === id)!;
    const override = b.override === true;
    if (!override) {
      for (const line of spec.lines.filter((l) => providerOf(l) !== 'llm')) {
        const h = headroom(ctx.store, line, now);
        if (h.line !== null && h.line <= 0) return json({ ok: false, capAsk: `${line} monthly cap reached: $${h.lineSpent.toFixed(2)} of $${(h.lineCap ?? 0).toFixed(2)} spent. Pass the cap once, or raise it.`, spent: h.lineSpent, cap: h.lineCap, scope: 'line' }, 402);
        if (h.provider !== null && h.provider <= 0) return json({ ok: false, capAsk: `${providerOf(line)} monthly cap reached: $${h.providerSpent.toFixed(2)} of $${(h.providerCap ?? 0).toFixed(2)} spent. Pass the cap once, or raise it.`, spent: h.providerSpent, cap: h.providerCap, scope: 'provider' }, 402);
      }
    }
    const batchId = newBatchId();
    spawnTick({ only: [id], force: true, manual: true, override, batchId });
    return json({ ok: true, batchId }, 202);
  }

  if (!b?.config || typeof b.config !== 'object') return json({ ok: false, error: 'bad_request', detail: 'Send { job, config } or { job, action: "run_now" }.' }, 400);
  const prev = jobConfig(ctx.store, id);
  const raw = b.config as Partial<JobConfig>;
  const candidate = { ...DEFAULT_JOB_CONFIG, ...raw, v: 1 as const, updatedAt: now.toISOString(), history: prev.history };
  const parsed = JobConfigSchema.safeParse(candidate);
  if (!parsed.success) return json({ ok: false, error: 'bad_config', detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  const cfg = parsed.data;
  if (cfg.mode === 'times' && !cfg.times?.length) return json({ ok: false, error: 'bad_config', detail: 'times: add at least one time.' }, 400);
  if (cfg.mode === 'interval' && !cfg.everyMin) return json({ ok: false, error: 'bad_config', detail: 'everyMin: set an interval.' }, 400);
  if (!isPresetJob(id)) {
    const onlyPause = cfg.mode === 'default' && !cfg.quiet && !cfg.weekdays?.length && !cfg.params && cfg.everyMin === undefined && cfg.times === undefined;
    if (!onlyPause) return json({ ok: false, error: 'free_job', detail: 'Free jobs can only be paused.' }, 400);
  }
  if (cfg.params && id !== 'sync') return json({ ok: false, error: 'bad_config', detail: 'params apply to the sync only.' }, 400);
  const saved: JobConfig = { ...cfg, history: [{ at: cfg.updatedAt, summary: describeConfig(cfg, id) }, ...prev.history].slice(0, 10) };
  ctx.store.priors.set({ key: `jobcfg:${id}`, value: saved, n: 0, supersedesDefault: false, updatedAt: saved.updatedAt });
  const view = setupView(ctx.store, { dry: Boolean(ctx.flags.dry), dryLabel: ctx.flags.dryLabel ?? null, filming: Boolean(ctx.flags.filming), now });
  return json({ ok: true, row: view.schedule.jobs.find((j) => j.id === id) ?? null });
}
