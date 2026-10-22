import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dataPath } from '@/lib/paths';

/**
 * Wizard store — projects. A project IS a conversation with the Wizard:
 * starting a chat creates one, the Wizard's replies create its tasks, and
 * task completion is the only thing that moves its progress. Plain JSON
 * under data/wizard/ (WIZARD_DATA_DIR overrides for tests). A project maps
 * 1:1 to a Claude session id once its first message lands, so resuming a
 * project resumes the actual session.
 */

export const ReceiptSchema = z.object({
  kind: z.string(), // 'task' | 'done' | 'ran-agent' | 'note'
  label: z.string(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const WizardMessageSchema = z.object({
  role: z.enum(['user', 'wizard']),
  text: z.string(),
  at: z.string(),
  receipts: z.array(ReceiptSchema).optional(),
});
export type WizardMessage = z.infer<typeof WizardMessageSchema>;

export const WizardTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerId: z.string().nullable().default(null),
  ownerName: z.string().default('Wizard'),
  state: z.enum(['open', 'done']).default('open'),
  createdAt: z.string(),
  doneAt: z.string().nullable().default(null),
});
export type WizardTask = z.infer<typeof WizardTaskSchema>;

export const WizardUsageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  costUsd: z.number().default(0),
  durationMs: z.number().default(0),
  turns: z.number().default(0),
});
export type WizardUsage = z.infer<typeof WizardUsageSchema>;

export const WizardProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'done']).default('active'),
  /** Claude session id — set after the first exchange; resuming uses it. */
  sessionId: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  messages: z.array(WizardMessageSchema).default([]),
  tasks: z.array(WizardTaskSchema).default([]),
  lastUsage: WizardUsageSchema.nullable().default(null),
  totalCostUsd: z.number().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WizardProject = z.infer<typeof WizardProjectSchema>;

const PROJECT_CAP = 100;
const MESSAGE_CAP = 200;
const FILE = 'projects.json';
const LEGACY_FILE = 'threads.json';
export const UNTITLED = 'New project';

export function wizardDir(): string {
  return process.env.WIZARD_DATA_DIR ?? dataPath('wizard');
}

function parseAll(raw: unknown): WizardProject[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = WizardProjectSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

/** Legacy v1 threads become projects (title → name, messages kept, no tasks). */
function migrateLegacy(): WizardProject[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(wizardDir(), LEGACY_FILE), 'utf8')) as unknown[];
    if (!Array.isArray(raw)) return [];
    const projects = raw.flatMap((r) => {
      const t = r as Record<string, unknown>;
      const p = WizardProjectSchema.safeParse({
        id: t.id,
        name: t.title,
        sessionId: t.sessionId ?? null,
        model: t.model ?? null,
        messages: t.messages ?? [],
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      });
      return p.success ? [p.data] : [];
    });
    if (projects.length) writeAll(projects);
    return projects;
  } catch {
    return [];
  }
}

function writeAll(value: WizardProject[]): void {
  fs.mkdirSync(wizardDir(), { recursive: true });
  fs.writeFileSync(path.join(wizardDir(), FILE), JSON.stringify(value, null, 2) + '\n');
}

export function readProjects(): WizardProject[] {
  let projects: WizardProject[];
  try {
    projects = parseAll(JSON.parse(fs.readFileSync(path.join(wizardDir(), FILE), 'utf8')));
  } catch {
    projects = migrateLegacy();
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readProject(id: string): WizardProject | null {
  return readProjects().find((p) => p.id === id) ?? null;
}

export function createProject(input: { name?: string } = {}): WizardProject {
  const now = new Date().toISOString();
  const project: WizardProject = {
    id: `wp-${randomUUID().slice(0, 8)}`,
    name: input.name?.trim() || UNTITLED,
    status: 'active',
    sessionId: null,
    model: null,
    messages: [],
    tasks: [],
    lastUsage: null,
    totalCostUsd: 0,
    createdAt: now,
    updatedAt: now,
  };
  writeAll([project, ...readProjects()].slice(0, PROJECT_CAP));
  return project;
}

function mutate(id: string, fn: (p: WizardProject) => WizardProject): WizardProject | null {
  const projects = readProjects();
  const i = projects.findIndex((p) => p.id === id);
  if (i < 0) return null;
  projects[i] = { ...fn(projects[i]), updatedAt: new Date().toISOString() };
  writeAll(projects);
  return projects[i];
}

export function updateProject(
  id: string,
  patch: Partial<Pick<WizardProject, 'name' | 'status' | 'sessionId' | 'model' | 'lastUsage'>> & { addCostUsd?: number },
): WizardProject | null {
  const { addCostUsd, ...rest } = patch;
  return mutate(id, (p) => ({ ...p, ...rest, totalCostUsd: p.totalCostUsd + (addCostUsd ?? 0) }));
}

export function appendMessages(id: string, messages: WizardMessage[]): WizardProject | null {
  return mutate(id, (p) => {
    const next = { ...p, messages: [...p.messages, ...messages].slice(-MESSAGE_CAP) };
    // First user line names an untitled project.
    if (next.name === UNTITLED) {
      const firstUser = next.messages.find((m) => m.role === 'user');
      if (firstUser) next.name = firstUser.text.replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    return next;
  });
}

/** Adds tasks and marks others done; auto-completes the project when every
 *  task is done. Titles in `done` match exactly or by case-insensitive prefix. */
export function applyTaskChanges(
  id: string,
  changes: { add?: { title: string; ownerId: string | null; ownerName: string }[]; done?: string[] },
): WizardProject | null {
  return mutate(id, (p) => {
    const now = new Date().toISOString();
    const added: WizardTask[] = (changes.add ?? [])
      .filter((t) => t.title.trim())
      .map((t) => ({
        id: `tk-${randomUUID().slice(0, 6)}`,
        title: t.title.trim().slice(0, 120),
        ownerId: t.ownerId,
        ownerName: t.ownerName,
        state: 'open',
        createdAt: now,
        doneAt: null,
      }));
    let tasks = [...p.tasks, ...added];
    for (const title of changes.done ?? []) {
      const needle = title.trim().toLowerCase();
      if (!needle) continue;
      tasks = tasks.map((t) => {
        if (t.state === 'done') return t;
        const have = t.title.toLowerCase();
        return have === needle || have.startsWith(needle) || needle.startsWith(have) ? { ...t, state: 'done', doneAt: now } : t;
      });
    }
    const allDone = tasks.length > 0 && tasks.every((t) => t.state === 'done');
    return { ...p, tasks, status: allDone ? 'done' : p.status === 'done' && !allDone ? 'active' : p.status };
  });
}

export function setTaskState(id: string, taskId: string, state: WizardTask['state']): WizardProject | null {
  return mutate(id, (p) => {
    const now = new Date().toISOString();
    const tasks = p.tasks.map((t) => (t.id === taskId ? { ...t, state, doneAt: state === 'done' ? now : null } : t));
    const allDone = tasks.length > 0 && tasks.every((t) => t.state === 'done');
    return { ...p, tasks, status: allDone ? 'done' : 'active' };
  });
}

export function deleteProject(id: string): void {
  writeAll(readProjects().filter((p) => p.id !== id));
}
