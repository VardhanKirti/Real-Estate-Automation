import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { wizardDir } from './store';

/**
 * "Designed agents" — the plus-button drawer files an agent spec here
 * (name, department, purpose, tools) without wiring anything live. Honest
 * by construction: nothing in this store ever claims a runtime exists.
 * Same JSON-under-WIZARD_DATA_DIR pattern as threads/projects.
 */

export const DesignedAgentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  departmentId: z.string().min(1),
  purpose: z.string().min(1),
  tools: z.array(z.string()),
  createdAt: z.string(),
});
export type DesignedAgent = z.infer<typeof DesignedAgentSchema>;

const FILE = 'designed.json';

function readAll(): DesignedAgent[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(wizardDir(), FILE), 'utf8')) as unknown[];
    return raw.flatMap((r) => {
      const p = DesignedAgentSchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  } catch {
    return [];
  }
}

function writeAll(value: DesignedAgent[]): void {
  fs.mkdirSync(wizardDir(), { recursive: true });
  fs.writeFileSync(path.join(wizardDir(), FILE), JSON.stringify(value, null, 2) + '\n');
}

export function readDesignedAgents(): DesignedAgent[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createDesignedAgent(input: {
  name: string;
  departmentId: string;
  purpose: string;
  tools: string[];
}): DesignedAgent {
  const agent: DesignedAgent = {
    id: `da-${randomUUID().slice(0, 8)}`,
    name: input.name.trim(),
    departmentId: input.departmentId,
    purpose: input.purpose.trim(),
    tools: input.tools,
    createdAt: new Date().toISOString(),
  };
  writeAll([agent, ...readAll()]);
  return agent;
}
