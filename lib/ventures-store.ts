import fs from 'node:fs';
import { z } from 'zod';
import { dataPath } from '@/lib/paths';
import { agentsOfVenture, findVenture, type Venture } from '@/lib/ventures';

/**
 * The operator's ventures, read from ventures.json in the current data
 * directory: the real one on the operator's instance, demo-data/ while
 * filming, none on a fresh install. Read per call, so an edit or a Filming
 * switch shows on the next request. A missing or malformed file reads as no
 * ventures, never as a crash. Server-only (node:fs).
 */
const VentureSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.string(),
  color: z.string().min(1),
  detail: z.string(),
  brainTag: z.string().min(1),
  focus: z.array(z.string()),
  areaAgents: z.record(z.array(z.string())),
});

export function readVentures(file: string = dataPath('ventures.json')): Venture[] {
  try {
    return z.array(VentureSchema).parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
}

export function getVenture(id: string): Venture | null {
  return findVenture(readVentures(), id);
}

/** Every agent serving a venture, across all its life areas. */
export function ventureAgentSet(ventureId: string): Set<string> {
  return agentsOfVenture(getVenture(ventureId));
}

/** Which ventures an agent works for (shared infra agents serve all). */
export function venturesForAgent(agentId: string): Venture[] {
  return readVentures().filter((v) => agentsOfVenture(v).has(agentId));
}

/** Agents on one life area for one venture. */
export function ventureAreaAgents(ventureId: string, areaId: string): string[] {
  return getVenture(ventureId)?.areaAgents[areaId] ?? [];
}
