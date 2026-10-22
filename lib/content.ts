import type { Agent } from '@/lib/schemas';

/**
 * The content pillar: Marketing/Growth, home of the @yourhandle content
 * engine (lead-run; agents here are the briefing lanes). The lead comes
 * first, then the workers alphabetically.
 */
export const CONTENT_DEPT_ID = 'dept-marketing-growth';

export function contentAgents(agents: Agent[]): Agent[] {
  const isLead = (a: Agent) => (a.tier === 'lead' || a.parentId === null ? 0 : 1);
  return agents
    .filter((a) => a.departmentId === CONTENT_DEPT_ID)
    .sort((a, b) => isLead(a) - isLead(b) || a.name.localeCompare(b.name));
}
