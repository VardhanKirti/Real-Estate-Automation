/**
 * Agent operations storage for the FounderOS merge:
 *
 *   deliverable_decisions  approve or reject a finished agent run's output
 *                          (pages/feature-additions.md F9). One decision per
 *                          run: run_id is the primary key and a second
 *                          decision is refused, not overwritten (A-1).
 *   cron_runs              the cron runner's audit trail (F10), ported from
 *                          the parts bin: one row per firing, success or
 *                          failure, so a job that keeps erroring is visible
 *                          and a slot is never served twice.
 */
import type Database from 'better-sqlite3';
import {
  CronRunSchema,
  DeliverableDecisionSchema,
  type CronRun,
  type CronRunInput,
  type DeliverableDecision,
} from '@/lib/schemas';

export class DecisionExistsError extends Error {
  constructor(public runId: string) {
    super(`run ${runId} already has a decision`);
  }
}

export function deliverableDecisionsRepo(db: InstanceType<typeof Database>) {
  type Raw = { run_id: string; decision: string; reason: string; at: string };
  const toDecision = (r: Raw): DeliverableDecision =>
    DeliverableDecisionSchema.parse({ runId: r.run_id, decision: r.decision, reason: r.reason, at: r.at });
  return {
    /** Throws DecisionExistsError when the run was already decided. */
    record(input: { runId: string; decision: DeliverableDecision['decision']; reason?: string; at?: string }): DeliverableDecision {
      const d = DeliverableDecisionSchema.parse({ ...input, at: input.at ?? new Date().toISOString() });
      const res = db
        .prepare('INSERT OR IGNORE INTO deliverable_decisions (run_id, decision, reason, at) VALUES (?, ?, ?, ?)')
        .run(d.runId, d.decision, d.reason, d.at);
      if (res.changes === 0) throw new DecisionExistsError(d.runId);
      return d;
    },
    get(runId: string): DeliverableDecision | null {
      const r = db.prepare('SELECT * FROM deliverable_decisions WHERE run_id = ?').get(runId) as Raw | undefined;
      return r ? toDecision(r) : null;
    },
    all(limit = 200): DeliverableDecision[] {
      return (db.prepare('SELECT * FROM deliverable_decisions ORDER BY at DESC LIMIT ?').all(limit) as Raw[]).map(toDecision);
    },
    /** Run ids that have a decision, for "awaiting review" filtering. */
    decidedRunIds(): Set<string> {
      return new Set((db.prepare('SELECT run_id FROM deliverable_decisions').all() as { run_id: string }[]).map((r) => r.run_id));
    },
  };
}

export type CronRunStat = { runs: number; ok: number; lastRunAt: string | null; lastOk: boolean | null };

export function cronRunsRepo(db: InstanceType<typeof Database>) {
  type Raw = { id: string; cron_id: string; agent_id: string; started_at: string; finished_at: string; ok: number; summary: string; trigger: string };
  const toRun = (r: Raw): CronRun =>
    CronRunSchema.parse({
      id: r.id, cronId: r.cron_id, agentId: r.agent_id, startedAt: r.started_at, finishedAt: r.finished_at,
      ok: r.ok === 1, summary: r.summary, trigger: r.trigger,
    });
  return {
    insert(run: CronRunInput): CronRun {
      const v = CronRunSchema.parse(run);
      db.prepare(
        'INSERT OR REPLACE INTO cron_runs (id, cron_id, agent_id, started_at, finished_at, ok, summary, trigger) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(v.id, v.cronId, v.agentId, v.startedAt, v.finishedAt, v.ok ? 1 : 0, v.summary, v.trigger);
      return v;
    },
    /** Most recent first. */
    byCron(cronId: string, limit = 20): CronRun[] {
      return (
        db.prepare('SELECT * FROM cron_runs WHERE cron_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(cronId, limit) as Raw[]
      ).map(toRun);
    },
    recent(limit = 50): CronRun[] {
      return (db.prepare('SELECT * FROM cron_runs ORDER BY started_at DESC, rowid DESC LIMIT ?').all(limit) as Raw[]).map(toRun);
    },
    /** Per cron: how many runs, how many ok, and the latest one. */
    statsByCron(): Record<string, CronRunStat> {
      const rows = db
        .prepare(
          `SELECT cron_id, COUNT(*) AS runs, SUM(ok) AS ok_runs, MAX(started_at) AS last_at,
             (SELECT ok FROM cron_runs r2 WHERE r2.cron_id = r.cron_id ORDER BY started_at DESC, rowid DESC LIMIT 1) AS last_ok
           FROM cron_runs r GROUP BY cron_id`,
        )
        .all() as { cron_id: string; runs: number; ok_runs: number | null; last_at: string | null; last_ok: number | null }[];
      const out: Record<string, CronRunStat> = {};
      for (const r of rows) {
        out[r.cron_id] = { runs: r.runs, ok: r.ok_runs ?? 0, lastRunAt: r.last_at, lastOk: r.last_ok === null ? null : r.last_ok === 1 };
      }
      return out;
    },
  };
}
