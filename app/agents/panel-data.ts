/**
 * Pure derivations for the agent glass panel — no React, no DB access.
 * Everything here reads only the fields already on the seeded rows (Agent,
 * AgentRun, Skill) so it is trivially unit-testable and never invents data
 * that isn't actually there.
 */
import type { Agent, AgentRun, Skill } from '@/lib/schemas';

export type StepSource = 'description' | 'run' | 'skill';

export type AgentStep = {
  id: string;
  label: string;
  source: StepSource;
};

/** Splits a description into its sentences — each one becomes a step. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Splits a run summary into its clauses. Every real.ts run() and every
 * seeded historical run reports in the same "X · Y · Z" shape, so this is
 * the honest way to turn one summary line into several workflow steps.
 */
function splitClauses(summary: string): string[] {
  return summary
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds the "What it does" step tree from data that actually exists for
 * this agent: its seeded description, the clause shape of its latest
 * recorded run summary, and the skill(s) it owns. An agent with a thin
 * record (no run history, no owned skill) legitimately gets a shorter
 * tree — steps are never padded to hit a target count.
 */
export function buildStepTree(
  agent: Pick<Agent, 'description'>,
  latestRun: AgentRun | null,
  ownedSkills: Skill[],
): AgentStep[] {
  const steps: AgentStep[] = [];

  splitSentences(agent.description).forEach((sentence, i) => {
    steps.push({ id: `desc-${i}`, label: sentence, source: 'description' });
  });

  if (latestRun) {
    splitClauses(latestRun.summary).forEach((clause, i) => {
      steps.push({ id: `run-${i}`, label: clause, source: 'run' });
    });
  }

  if (ownedSkills.length === 1) {
    steps.push({ id: 'skill-0', label: `Draws on its "${ownedSkills[0].name}" skill`, source: 'skill' });
  } else if (ownedSkills.length > 1) {
    steps.push({
      id: 'skill-0',
      label: `Draws on ${ownedSkills.length} owned skills: ${ownedSkills.map((s) => s.name).join(', ')}`,
      source: 'skill',
    });
  }

  return steps;
}

export type WorksWithRelation = 'parent' | 'child';
export type WorksWithEntry = { agent: Agent; relation: WorksWithRelation };

/**
 * Resolves "works with" from the real parentId/children edges in the seeded
 * roster — the agent this one reports to, plus the agents that report to
 * it. Never siblings or department-mates, only a direct parent/child edge.
 */
export function resolveWorksWith(agent: Agent, allAgents: Agent[]): WorksWithEntry[] {
  const entries: WorksWithEntry[] = [];

  if (agent.parentId) {
    const parent = allAgents.find((a) => a.id === agent.parentId);
    if (parent) entries.push({ agent: parent, relation: 'parent' });
  }

  const children = allAgents
    .filter((a) => a.parentId === agent.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) entries.push({ agent: child, relation: 'child' });

  return entries;
}

/**
 * Systems/skills this agent is wired to: the skills it owns by name, plus
 * every connector tool referenced either directly on the agent or by a
 * skill it owns. Deduped, order-preserving.
 */
export function connectedChips(agent: Agent, ownedSkills: Skill[]): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();
  const add = (label: string) => {
    if (!seen.has(label)) {
      seen.add(label);
      chips.push(label);
    }
  };

  for (const skill of ownedSkills) add(skill.name);
  for (const tool of agent.tools) add(tool);
  for (const skill of ownedSkills) for (const tool of skill.tools) add(tool);

  return chips;
}

/**
 * 2-4 plain-language rules describing what actually routes or gates this
 * agent, built only from real structural data: its parent/child edges, the
 * skill(s) it owns, and its latest recorded run outcome. Falls back to the
 * latest run's own summary line — never an invented rule — when nothing
 * else is derivable.
 */
export function buildLogicRules(
  agent: Agent,
  worksWith: WorksWithEntry[],
  ownedSkills: Skill[],
  latestRun: AgentRun | null,
): string[] {
  const rules: string[] = [];
  const parent = worksWith.find((w) => w.relation === 'parent');
  const children = worksWith.filter((w) => w.relation === 'child');

  if (parent) {
    rules.push(`Reports to ${parent.agent.name} — its output rolls up into that agent's directive.`);
  }
  if (children.length > 0) {
    rules.push(
      `Coordinates ${children.length} sub-agent${children.length === 1 ? '' : 's'}: ${children
        .map((c) => c.agent.name)
        .join(', ')}.`,
    );
  }
  if (ownedSkills.length > 0) {
    rules.push(
      `Backed by ${ownedSkills.length} owned skill${ownedSkills.length === 1 ? '' : 's'}: ${ownedSkills
        .map((s) => s.name)
        .join(', ')}.`,
    );
  }
  if (latestRun) {
    rules.push(`Last recorded run reported ${latestRun.ok ? 'success' : 'failure'}: "${latestRun.summary}".`);
  }

  if (rules.length === 0) return [agent.description];
  return rules.slice(0, 4);
}
