import type { GladosDb } from '@/lib/db';
import type { Agent, Department } from '@/lib/schemas';
import { readDesignedAgents, type DesignedAgent } from './designed';

/**
 * Crew performance — real run history per agent, nothing derived beyond
 * ratios of counts. `dots` is the last RUN_DOTS runs oldest→newest so the
 * heatmap reads left to right; `okRate` is null until an agent has run.
 */

import { RUN_DOTS } from './ui';
export { RUN_DOTS };

export type CrewRun = { startedAt: string; finishedAt: string; ok: boolean; summary: string };
export type CrewRow = {
  agent: Agent;
  runs: CrewRun[]; // newest first, capped at RUN_DOTS
  okRate: number | null; // 0..1 over the capped window
};
export type CrewSnapshot = {
  rows: CrewRow[];
  designed: DesignedAgent[];
  departments: Department[];
  totalRuns: number;
  okRate: number | null;
  windowDays: number;
};

export function buildCrew(db: GladosDb, windowDays = 60): CrewSnapshot {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const agents = db.agents.all();
  const rows: CrewRow[] = agents.map((agent) => {
    const runs = db.agentRuns
      .byAgent(agent.id)
      .filter((r) => Date.parse(r.startedAt) >= cutoff)
      .slice(0, RUN_DOTS)
      .map((r) => ({ startedAt: r.startedAt, finishedAt: r.finishedAt, ok: r.ok, summary: r.summary }));
    const okRate = runs.length ? runs.filter((r) => r.ok).length / runs.length : null;
    return { agent, runs, okRate };
  });
  const all = rows.flatMap((r) => r.runs);
  return {
    rows,
    designed: readDesignedAgents(),
    departments: db.departments.all(),
    totalRuns: all.length,
    okRate: all.length ? all.filter((r) => r.ok).length / all.length : null,
    windowDays,
  };
}
