import { getDb } from '@/lib/data';
import type { PaperclipAgent, PaperclipIssue, PaperclipOrgNode, PaperclipRun } from '@/founderos/lib/connectors/paperclip';

/**
 * The Agents board in demo mode: the demo company's own roster, tasks and run
 * history in the Paperclip board's shapes, so /agents shows the same company
 * as every other screen instead of an unreachable board.
 */
const STATUS_FOR: Record<string, PaperclipAgent['status']> = { active: 'running', idle: 'idle', training: 'paused', planned: 'paused' };
const LANE_FOR: Record<string, string> = { open: 'todo', doing: 'in_progress', blocked: 'in_review', done: 'done' };

export function demoBoardAgents(): PaperclipAgent[] {
  const db = getDb();
  return db.agents.all().map((a) => ({
    id: a.id,
    name: a.name,
    status: STATUS_FOR[a.status] ?? 'idle',
    adapterType: 'claude_local',
    model: a.model,
    lastHeartbeatAt: db.agentRuns.byAgent(a.id)[0]?.finishedAt ?? null,
  }));
}

export function demoBoardOrg(): PaperclipOrgNode[] {
  const agents = getDb().agents.all();
  const conductor = agents.find((a) => a.id === 'conductor');
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    status: STATUS_FOR[a.status] ?? 'idle',
    depth: a.id === conductor?.id ? 0 : 1,
    parentId: a.id === conductor?.id ? null : (conductor?.id ?? null),
  }));
}

export function demoBoardIssues(limit: number): PaperclipIssue[] {
  const db = getDb();
  const names = new Map(db.agents.all().map((a) => [a.id, a.name]));
  return db
    .agentTasks.all()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((t, i) => ({
      id: t.id,
      identifier: `FOS-${String(100 + i)}`,
      title: t.title,
      status: LANE_FOR[t.status] ?? 'todo',
      assigneeName: t.agentId ? (names.get(t.agentId) ?? null) : null,
      updatedAt: t.updatedAt,
    }));
}

export function demoBoardRuns(limit: number): PaperclipRun[] {
  const db = getDb();
  const names = new Map(db.agents.all().map((a) => [a.id, a.name]));
  return db.agentRuns.recent(limit).map((r) => ({
    id: r.id,
    agentId: r.agentId,
    agentName: names.get(r.agentId) ?? null,
    status: r.ok ? 'succeeded' : 'failed',
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  }));
}
