import type { AgentRun, AgentTask } from '@/lib/schemas';
import { relAge } from '@/lib/home-summary';

/**
 * Home's "Needs you" and "Done today" (founderos-ui pages/feature-additions.md
 * F2). Pure: Home6Console reads the tasks and runs once and both trees render
 * the result.
 *
 * Needs you is the same set as the Tasks board's "Needs you" tile
 * (lib/tasks-metrics.ts `taskStats().needsYou`: status `blocked`, waiting on
 * the operator), highest priority first, then the one waiting longest.
 * Done today counts runs and tasks that finished since local midnight.
 */

export const NEEDS_YOU_LIMIT = 5;
export const DONE_TODAY_LIMIT = 3;

const PRIORITY_RANK: Record<AgentTask['priority'], number> = { high: 0, normal: 1, low: 2 };

export type NeedsYouRow = {
  id: string;
  title: string;
  /** who the task belongs to: an agent id, or null for the operator's own */
  agentId: string | null;
  priority: AgentTask['priority'];
  /** how long it has waited, from its last update ("3h", "2d") */
  age: string;
  at: string;
  href: string;
};

export type NeedsYou = { total: number; rows: NeedsYouRow[] };

export function taskHref(id: string): string {
  return `/tasks?task=${encodeURIComponent(id)}`;
}

export function needsYou(tasks: AgentTask[], now: Date = new Date(), limit = NEEDS_YOU_LIMIT): NeedsYou {
  const waiting = tasks
    .filter((t) => t.status === 'blocked')
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  return {
    total: waiting.length,
    rows: waiting.slice(0, limit).map((t) => ({
      id: t.id,
      title: t.title,
      agentId: t.agentId,
      priority: t.priority,
      age: relAge(t.updatedAt, now),
      at: t.updatedAt,
      href: taskHref(t.id),
    })),
  };
}

/** Local midnight of `now`'s day (the server's clock), as epoch ms. */
export function localMidnight(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type DoneRow = {
  kind: 'task' | 'run';
  id: string;
  title: string;
  /** a run's outcome; a finished task is always ok */
  ok: boolean;
  age: string;
  at: string;
  href: string;
};

export type DoneToday = { count: number; tasks: number; runs: number; failed: number; rows: DoneRow[] };

export function doneToday(tasks: AgentTask[], runs: AgentRun[], now: Date = new Date(), limit = DONE_TODAY_LIMIT): DoneToday {
  const from = localMidnight(now);
  const to = now.getTime();
  const inDay = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= from && t <= to;
  };
  const doneTasks: DoneRow[] = tasks
    .filter((t) => t.status === 'done' && inDay(t.updatedAt))
    .map((t) => ({ kind: 'task', id: t.id, title: t.title, ok: true, age: relAge(t.updatedAt, now), at: t.updatedAt, href: taskHref(t.id) }));
  const doneRuns: DoneRow[] = runs
    .filter((r) => inDay(r.finishedAt))
    .map((r) => ({
      kind: 'run',
      id: r.id,
      title: r.summary.trim() ? `${r.agentId} · ${r.summary.split('\n')[0]}` : r.agentId,
      ok: r.ok,
      age: relAge(r.finishedAt, now),
      at: r.finishedAt,
      href: `/agents?agent=${encodeURIComponent(r.agentId)}`,
    }));
  const all = [...doneTasks, ...doneRuns].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    count: all.length,
    tasks: doneTasks.length,
    runs: doneRuns.length,
    failed: doneRuns.filter((r) => !r.ok).length,
    rows: all.slice(0, limit),
  };
}

/** The Done today caption: what the count is made of. */
export function doneCaption(d: DoneToday): string {
  if (d.count === 0) return 'Since midnight';
  const parts = [];
  if (d.tasks > 0) parts.push(`${d.tasks} ${d.tasks === 1 ? 'task' : 'tasks'}`);
  if (d.runs > 0) parts.push(`${d.runs} ${d.runs === 1 ? 'run' : 'runs'}`);
  return `${parts.join(' · ')} since midnight`;
}

/** Copy for the empty states (F2 States). */
export const NEEDS_YOU_EMPTY = 'Nothing waiting on you.';
export const DONE_TODAY_EMPTY = 'Nothing finished yet today.';
