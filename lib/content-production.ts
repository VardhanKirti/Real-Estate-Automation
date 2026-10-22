import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import {
  CreateTaskInputSchema,
  EMPTY_MANIFEST,
  MediaManifestSchema,
  ProductionTaskSchema,
  QueueSpecInputSchema,
  estimateCredits,
  findContentTool,
  findCreateAction,
  resolveQueue,
  type CreateTaskInput,
  type MediaManifest,
  type ProductionTask,
  type QueueSpecInput,
} from '@/lib/content-schema';
import { dataPath } from '@/lib/paths';

/**
 * The production queue behind the campaign board. Tasks are fulfilled by the
 * operator through the Higgsfield MCP — nothing here runs on its own, and a
 * task only reads "delivered" when its output actually exists in the media
 * library manifest (public/content-media/manifest.json). Status is DERIVED
 * from that manifest at render time, never hardcoded.
 *
 * The queue itself lives in a JSON-file-backed store (data/content-queue.json
 * by default, overridable via CONTENT_QUEUE_PATH or the `file` param on every
 * function below) so the studio's "Queue production" action appends a real
 * row that shows up on the very next render.
 *
 * This module is server-only (node:fs / node:crypto) — client components
 * import the pure schemas/types/CREATE_ACTIONS from lib/content-schema
 * instead, so nothing here ends up in a browser bundle.
 */

// Re-export the client-safe surface so existing server call sites and tests
// can keep importing everything from '@/lib/content-production'.
export * from '@/lib/content-schema';

/**
 * Read public/content-media/manifest.json. A missing, empty, or malformed
 * file is an empty library, never a crash — the page renders its empty state.
 */
export function readMediaManifest(dir = path.join(process.cwd(), 'public', 'content-media')): MediaManifest {
  try {
    const raw = readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    return MediaManifestSchema.parse(JSON.parse(raw));
  } catch {
    return EMPTY_MANIFEST;
  }
}

/** A fresh install ships no production tasks; the queue fills from /content. */
const SEED_TASKS: ProductionTask[] = [];

const QueueFileSchema = z.object({ tasks: z.array(ProductionTaskSchema) });

/** Where the queue lives — CONTENT_QUEUE_PATH lets tests point at a temp file. */
export function queueStorePath(): string {
  return process.env.CONTENT_QUEUE_PATH ?? dataPath('content-queue.json');
}

function ensureSeeded(file: string): void {
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ tasks: SEED_TASKS }, null, 2)}\n`, 'utf8');
}

/** Raw queue rows (status not yet derived against the manifest). */
export function readQueue(file: string = queueStorePath()): ProductionTask[] {
  ensureSeeded(file);
  try {
    const raw = readFileSync(file, 'utf8');
    return QueueFileSchema.parse(JSON.parse(raw)).tasks;
  } catch {
    return SEED_TASKS;
  }
}

export function writeQueue(tasks: ProductionTask[], file: string = queueStorePath()): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ tasks }, null, 2)}\n`, 'utf8');
}

/** Append a real task to the queue store from a CREATE-row submission. */
export function addTask(input: CreateTaskInput, file: string = queueStorePath()): ProductionTask {
  const parsed = CreateTaskInputSchema.parse(input);
  const action = findCreateAction(parsed.actionKey);
  if (!action) throw new Error(`unknown action: ${parsed.actionKey}`);
  const task: ProductionTask = ProductionTaskSchema.parse({
    id: `task-${randomUUID()}`,
    campaignId: parsed.campaignId,
    type: action.type,
    title: parsed.title,
    inputs: parsed.inputs,
    model: action.model,
    creditEstimate: action.creditEstimate,
    status: 'queued',
    outputRef: null,
    createdAt: new Date().toISOString(),
  });
  const tasks = readQueue(file);
  tasks.push(task);
  writeQueue(tasks, file);
  return task;
}

/** Remove a task from the store. Returns false if the id was not found. */
export function deleteTask(id: string, file: string = queueStorePath()): boolean {
  const tasks = readQueue(file);
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) return false;
  writeQueue(next, file);
  return true;
}

/**
 * The production queue with statuses derived against the given manifest
 * (defaults to the one on disk) — including dependency-blocked pipeline
 * nodes. Schema-validated on the way out.
 */
export function productionTasks(
  manifest: MediaManifest = readMediaManifest(),
  file: string = queueStorePath(),
): ProductionTask[] {
  return resolveQueue(readQueue(file), manifest).map((t) => ProductionTaskSchema.parse(t));
}

/**
 * Append a v3 spec-carrying task. The spec is the fulfillment contract: the
 * operator executes exactly this model + params + media bindings via the
 * Higgsfield MCP. Credit estimate is an honest rough figure per family —
 * Higgsfield prices per configuration and does not publish a table.
 */
export function addSpecTask(
  input: QueueSpecInput,
  extras: Partial<Pick<ProductionTask, 'pipelineId' | 'nodeId' | 'dependsOn'>> = {},
  file: string = queueStorePath(),
): ProductionTask {
  const parsed = QueueSpecInputSchema.parse(input);
  const tool = findContentTool(parsed.toolKey);
  if (!tool) throw new Error(`unknown tool: ${parsed.toolKey}`);
  const task: ProductionTask = ProductionTaskSchema.parse({
    id: `task-${randomUUID()}`,
    campaignId: parsed.campaignId,
    type: tool.taskType,
    title: parsed.title,
    inputs: parsed.spec.prompt || parsed.title,
    model: parsed.spec.model,
    creditEstimate: estimateCredits(parsed.spec),
    status: 'queued',
    outputRef: null,
    createdAt: new Date().toISOString(),
    spec: parsed.spec,
    ...extras,
  });
  const tasks = readQueue(file);
  tasks.push(task);
  writeQueue(tasks, file);
  return task;
}

/**
 * Re-points a task's campaignId — the "Add to campaign" verb on the
 * delivered feed. Returns null (never throws) when the id is not found so
 * the route can answer 404 honestly.
 */
export function updateTaskCampaign(
  id: string,
  campaignId: string,
  file: string = queueStorePath(),
): ProductionTask | null {
  const tasks = readQueue(file);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated = ProductionTaskSchema.parse({ ...tasks[idx], campaignId });
  tasks[idx] = updated;
  writeQueue(tasks, file);
  return updated;
}
