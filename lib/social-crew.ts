import type { Agent, AgentRun, Department } from '@/lib/schemas';
import { relAge } from '@/lib/home-summary';

/**
 * The content crew card on /social (founderos-ui pages/feature-additions.md
 * F12, from FounderOS `/content`'s ContentAgentCard): the Growth department's
 * agents, their runs in the last 30 days, the busiest one, and how long ago
 * the last post went out. Pure; app/social/page.tsx reads the rows once.
 */

export const CREW_WINDOW_DAYS = 30;
export const CREW_HREF = '/agents?dept=growth';

export type CrewAgent = { id: string; name: string; role: string; status: Agent['status']; runs: number; failed: number };

export type ContentCrew = {
  /** the Growth department, or null when this install has none */
  department: { id: string; name: string } | null;
  agents: CrewAgent[];
  /** runs by the crew in the window */
  runs: number;
  failed: number;
  /** the agent with the most runs in the window; null when none ran */
  busiest: CrewAgent | null;
  /** newest published post we know of, and its age ("3h"); null when unknown */
  lastPostAt: string | null;
  lastPostAge: string | null;
  href: string;
};

/** The Growth department: its slug or name says growth (seeded as "Marketing/Growth"). */
export function growthDepartment(departments: Department[]): Department | null {
  return departments.find((d) => /growth/i.test(d.slug) || /growth/i.test(d.name)) ?? null;
}

/**
 * Newest post time from what /social already has: Zernio's recent posts
 * (exact time), else the posting history's newest day with a post (date
 * only, read as that day's start), else a post published from this OS.
 */
export function lastPostAt(
  sources: { live?: { publishedAt: string | null }[]; days?: { date: string; platforms: string[] }[]; local?: { status: string; createdAt: string; scheduledFor: string | null }[] },
  now: Date = new Date(),
): string | null {
  // a scheduled or future-dated entry is not a post that went out
  const newest = (xs: (string | null | undefined)[]) =>
    xs
      .filter((x): x is string => !!x && Number.isFinite(Date.parse(x)) && Date.parse(x) <= now.getTime())
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const live = newest((sources.live ?? []).map((p) => p.publishedAt));
  if (live) return live;
  const day = newest((sources.days ?? []).filter((d) => d.platforms.length > 0).map((d) => `${d.date}T00:00:00`));
  if (day) return new Date(day).toISOString();
  return newest((sources.local ?? []).filter((p) => p.status === 'published').map((p) => p.scheduledFor ?? p.createdAt));
}

export function contentCrew(input: {
  departments: Department[];
  agents: Agent[];
  runsByAgent: (agentId: string) => AgentRun[];
  lastPostAt: string | null;
  now?: Date;
}): ContentCrew {
  const now = input.now ?? new Date();
  const dept = growthDepartment(input.departments);
  const from = now.getTime() - CREW_WINDOW_DAYS * 86_400_000;
  const agents: CrewAgent[] = dept
    ? input.agents
        .filter((a) => a.departmentId === dept.id)
        .map((a) => {
          const win = input.runsByAgent(a.id).filter((r) => {
            const t = Date.parse(r.startedAt);
            return Number.isFinite(t) && t >= from && t <= now.getTime();
          });
          return { id: a.id, name: a.name, role: a.role, status: a.status, runs: win.length, failed: win.filter((r) => !r.ok).length };
        })
        .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
    : [];
  const runs = agents.reduce((s, a) => s + a.runs, 0);
  return {
    department: dept ? { id: dept.id, name: dept.name } : null,
    agents,
    runs,
    failed: agents.reduce((s, a) => s + a.failed, 0),
    busiest: agents[0] && agents[0].runs > 0 ? agents[0] : null,
    lastPostAt: input.lastPostAt,
    lastPostAge: input.lastPostAt ? relAge(input.lastPostAt, now) : null,
    href: CREW_HREF,
  };
}

/** "3h ago" / "just now" for the last-post line. */
export function postAgeText(age: string | null): string {
  if (!age) return 'No post on record';
  return age === 'now' ? 'just now' : `${age} ago`;
}
