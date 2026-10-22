/**
 * Everything the GladOS AgentSheet needs, built once on the server and handed
 * to the client as plain props (glados-ui SPEC S04 F0.3: every place an agent
 * appears opens the same sheet through `?agent=<id>`). /agents, /tasks, /org
 * and /wizard build it with the same call so the sheet reads the same facts
 * everywhere.
 *
 * Runs are capped per agent: the sheet's Run feed shows 20 and the roster
 * card's strip 12, so nothing larger crosses the server/client boundary.
 */
import type { getDb } from '@/lib/data';
import { agentAvatars } from '@/lib/agent-avatars';
import { needsSetup } from '@/lib/agent-setup';
import { LLM_DEFAULT_MODEL } from '@/lib/connectors/llm';
import type { Agent, AgentCron, AgentMessage, AgentRun, AgentTask, Department, Skill } from '@/lib/schemas';

export const RUNS_PER_AGENT = 20;

export type AgentDirectory = {
  agents: Agent[];
  departments: Department[];
  skills: Skill[];
  avatars: Record<string, string>;
  /** Agent ids whose roster card shows "Set up" (lib/agent-setup needsSetup). */
  setupIds: string[];
  runsByAgent: Record<string, AgentRun[]>;
  tasksByAgent: Record<string, AgentTask[]>;
  cronsByAgent: Record<string, AgentCron[]>;
  messagesByAgent: Record<string, AgentMessage[]>;
  /** The gateway model an agent without a stored model id runs on (failover options, F9). */
  defaultModel: string;
};

type Db = ReturnType<typeof getDb>;

export function buildAgentDirectory(db: Db): AgentDirectory {
  const agents = db.agents.all();
  const allTasks = db.agentTasks.all();
  const allCrons = db.agentCrons.all();
  const runsByAgent: Record<string, AgentRun[]> = {};
  const tasksByAgent: Record<string, AgentTask[]> = {};
  const cronsByAgent: Record<string, AgentCron[]> = {};
  const messagesByAgent: Record<string, AgentMessage[]> = {};
  for (const a of agents) {
    runsByAgent[a.id] = db.agentRuns.byAgent(a.id).slice(0, RUNS_PER_AGENT);
    tasksByAgent[a.id] = allTasks.filter((t) => t.agentId === a.id);
    cronsByAgent[a.id] = allCrons.filter((c) => c.agentId === a.id);
    messagesByAgent[a.id] = db.agentMessages.byAgent(a.id);
  }
  return {
    agents,
    departments: db.departments.all(),
    skills: db.skills.all(),
    avatars: Object.fromEntries(agentAvatars()),
    setupIds: agents.filter((a) => needsSetup(a)).map((a) => a.id),
    runsByAgent,
    tasksByAgent,
    cronsByAgent,
    messagesByAgent,
    defaultModel: LLM_DEFAULT_MODEL,
  };
}
