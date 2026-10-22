/**
 * Deliverables review and failover (pages/feature-additions.md F9).
 *
 * A deliverable is a finished agent run that produced output: ok, with a
 * non-empty summary, and not one of the operator's own failover log lines.
 * It waits for a decision until deliverable_decisions holds one for its run
 * (one per run, A-1). Built on the server and handed to both trees.
 *
 * Failover options are honest: the models already in use across the roster,
 * the gateway default, and `builtin` (the agent's own code path). No model id
 * is invented here; the operator picks among ids this install already runs.
 */
import type { GladosDb } from '@/lib/db';
import type { Agent, AgentRun, DeliverableDecision } from '@/lib/schemas';

export const FAILOVER_PREFIX = 'Failover:';
export const REVIEW_WINDOW_DAYS = 30;
export const REVIEW_LIMIT = 60;

export type Deliverable = {
  runId: string;
  agentId: string;
  agentName: string;
  summary: string;
  finishedAt: string;
};

export type ReviewView = {
  pending: Deliverable[];
  decided: (Deliverable & { decision: DeliverableDecision['decision']; reason: string; at: string })[];
};

/** Is this run something to review? */
export function isDeliverable(run: Pick<AgentRun, 'ok' | 'summary'>): boolean {
  const s = run.summary.trim();
  return run.ok && s.length > 0 && !s.startsWith(FAILOVER_PREFIX);
}

export function reviewView(db: GladosDb, now = Date.now()): ReviewView {
  const names = new Map(db.agents.all().map((a) => [a.id, a.name]));
  const cutoff = now - REVIEW_WINDOW_DAYS * 86_400_000;
  const decisions = new Map(db.deliverableDecisions.all(500).map((d) => [d.runId, d]));
  const runs = db.agentRuns.recent(2000).filter((r) => isDeliverable(r) && Date.parse(r.finishedAt || r.startedAt) >= cutoff);
  const toItem = (r: AgentRun): Deliverable => ({
    runId: r.id,
    agentId: r.agentId,
    agentName: names.get(r.agentId) ?? r.agentId,
    summary: r.summary,
    finishedAt: r.finishedAt || r.startedAt,
  });
  const pending = runs.filter((r) => !decisions.has(r.id)).slice(0, REVIEW_LIMIT).map(toItem);
  const byId = new Map(db.agentRuns.recent(2000).map((r) => [r.id, r]));
  const decided = [...decisions.values()]
    .slice(0, 20)
    .flatMap((d) => {
      const run = byId.get(d.runId);
      return run ? [{ ...toItem(run), decision: d.decision, reason: d.reason, at: d.at }] : [];
    });
  return { pending, decided };
}

/** First line of a run summary, as an output title. */
export function outputTitle(summary: string, max = 90): string {
  const line = summary.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Model choices for an agent's failover select: its own, the roster's, the default, builtin. */
export function failoverModelOptions(agents: Pick<Agent, 'model'>[], current: string, defaultModel: string): string[] {
  const set = new Set<string>();
  if (current) set.add(current);
  set.add(defaultModel);
  for (const a of agents) if (a.model) set.add(a.model);
  set.add('builtin');
  return [...set];
}

/**
 * The model the agent runtime should call for this agent's chat. A stored
 * gateway id ("provider/model") wins; `builtin` or empty means the gateway
 * default (undefined). This is what makes a failover take effect.
 */
export function chatModelFor(model: string | null | undefined): string | undefined {
  const m = (model ?? '').trim();
  return m.includes('/') ? m : undefined;
}
