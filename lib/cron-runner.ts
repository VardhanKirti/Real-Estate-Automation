/**
 * The cron RUNNER (pages/feature-additions.md F3, F10; SPEC O7). agent_crons
 * held schedules nothing fired; this fires them. Adapted from the 2026-10-06
 * parts bin (app/api/cron/tick). Due logic: lib/cron-scheduler.ts (catch-up
 * after a restart, never twice in one window).
 *
 * Two kinds of job:
 *   - agent crons (db.agentCrons): run through the normal agent runtime, so a
 *     scheduled run lands in agent_runs like a manual one;
 *   - system jobs: the 07:00 morning digest (built from free reads, stored).
 * Every firing, success or failure, writes one cron_runs row.
 *
 * The runner itself is gated by GLADOS_CRON (lib/gates.ts), checked by the
 * routes that call it. An agent run may call a paid model, so "Run now" also
 * needs an explicit confirm (app/api/cron/run).
 */
import { randomUUID } from 'node:crypto';
import type { GladosDb } from '@/lib/db';
import { dueCrons, lastScheduledOccurrence, nextScheduledOccurrence, type SchedulableCron } from '@/lib/cron-scheduler';

export const DIGEST_CRON_ID = 'system:comms-digest';
export const DIGEST_SCHEDULE = '0 7 * * *';

/**
 * `spends`: firing this job can cost money (F10 "confirm when the job can
 * spend money, flagged per cron"). The digest only reads free sources; an
 * agent run may call a paid model, so every agent cron is flagged.
 */
export type CronJob = SchedulableCron & { system: boolean; spends: boolean };

export type CronJobRunner = (job: CronJob) => Promise<{ ok: boolean; summary: string }>;

/** Every schedulable job with its last run, system jobs first. */
export function cronJobs(db: GladosDb): CronJob[] {
  const stats = db.cronRuns.statsByCron();
  const system: CronJob = {
    id: DIGEST_CRON_ID,
    agentId: 'daily-briefing',
    schedule: DIGEST_SCHEDULE,
    description: 'Morning digest: what came in overnight, what needs a reply',
    enabled: true,
    lastRunAt: stats[DIGEST_CRON_ID]?.lastRunAt ?? null,
    system: true,
    spends: false,
  };
  const agentJobs: CronJob[] = db.agentCrons.all().map((c) => ({
    id: c.id,
    agentId: c.agentId,
    schedule: c.schedule,
    description: c.description,
    enabled: c.enabled,
    lastRunAt: stats[c.id]?.lastRunAt ?? null,
    system: false,
    spends: true,
  }));
  return [system, ...agentJobs];
}

/** The dry run: what exists, when it last and next fires, what is due now. */
export function cronPlan(db: GladosDb, now: Date = new Date()) {
  const jobs = cronJobs(db);
  const stats = db.cronRuns.statsByCron();
  return {
    now: now.toISOString(),
    jobs: jobs.map((j) => ({
      ...j,
      lastScheduled: lastScheduledOccurrence(j.schedule, now)?.toISOString() ?? null,
      next: nextScheduledOccurrence(j.schedule, now)?.toISOString() ?? null,
      stats: stats[j.id] ?? { runs: 0, ok: 0, lastRunAt: null, lastOk: null },
    })),
    due: dueCrons(jobs, now).map((j) => j.id),
  };
}

/** The real job bodies. Imported lazily so the dry run never loads the agent roster. */
export async function defaultJobRunner(db: GladosDb): Promise<CronJobRunner> {
  return async (job) => {
    if (job.id === DIGEST_CRON_ID) {
      const { runAndStoreCommsDigest, digestSummary } = await import('@/lib/comms-digest-run');
      const row = await runAndStoreCommsDigest();
      return { ok: true, summary: digestSummary(row.body as never) };
    }
    const [{ createRuntime }, { realAgents }] = await Promise.all([import('@/lib/agents/runtime'), import('@/lib/agents/real')]);
    const run = await createRuntime(db, realAgents).run(job.agentId);
    return { ok: run.ok, summary: run.summary };
  };
}

/** Jobs mid-run in this process: a slow job must not be fired again by the next tick. */
const inFlight = new Set<string>();

/** Fire one job and record it. Never throws: a failure is a cron_runs row with ok false. */
export async function fireJob(db: GladosDb, job: CronJob, runner: CronJobRunner, trigger: 'schedule' | 'manual') {
  if (inFlight.has(job.id)) return { cronId: job.id, agentId: job.agentId, ok: false, summary: 'already running', skipped: true as const };
  inFlight.add(job.id);
  const startedAt = new Date().toISOString();
  let ok = false;
  let summary = '';
  try {
    const r = await runner(job);
    ok = r.ok;
    summary = r.summary;
  } catch (err) {
    summary = err instanceof Error ? err.message : String(err);
  } finally {
    inFlight.delete(job.id);
  }
  db.cronRuns.insert({ id: randomUUID(), cronId: job.id, agentId: job.agentId, startedAt, finishedAt: new Date().toISOString(), ok, summary: summary.slice(0, 2000), trigger });
  return { cronId: job.id, agentId: job.agentId, ok, summary };
}

/** One tick: fire every due job in order. */
export async function runDue(db: GladosDb, runner: CronJobRunner, now: Date = new Date()) {
  const due = dueCrons(cronJobs(db), now) as CronJob[];
  const ran = [];
  for (const job of due) ran.push(await fireJob(db, job, runner, 'schedule'));
  return { due: due.length, ran };
}
