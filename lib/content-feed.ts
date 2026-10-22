import { findModel } from '@/lib/higgsfield/catalog';
import type { ContentToolKey, MediaAsset, ProductionTask, TaskSpec, TaskType } from '@/lib/content-schema';

/**
 * Pure helpers behind the Production and Library UIs — spec digests, the
 * rendering-strip pipeline collapse, the delivered-feed session grouping,
 * and the library filter/search. No DOM, no fs: everything here is a plain
 * function over the props those components already receive, so it is
 * testable without mounting anything.
 */

// ---------------------------------------------------------------------------
// Spec digest — the params line on a task card ("9:16 · 10s · 1080p · audio").
// ---------------------------------------------------------------------------

function truthyParam(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v.length > 0 && v !== 'off' && v !== 'none' && v !== 'false' && v !== '0';
  }
  return false;
}

/**
 * Builds the compact params line from a task's spec. Clipify gets its own
 * shape (clip count + clip aspect) since it has neither a duration nor a
 * resolution param; every other model reads aspect/duration/resolution/audio
 * off the spec in that fixed order. A legacy task with no spec digests to ''
 * — the caller falls back to showing the model chip alone.
 */
export function specDigest(task: Pick<ProductionTask, 'spec'>): string {
  const spec = task.spec;
  if (!spec) return '';
  const parts: string[] = [];

  if (spec.model === 'clipify') {
    const count = spec.params.clips_num;
    if (typeof count === 'number') parts.push(`${count} clip${count === 1 ? '' : 's'}`);
    const aspect = spec.params.clip_aspect;
    if (typeof aspect === 'string' && aspect) parts.push(aspect);
    return parts.join(' · ');
  }

  if (spec.aspectRatio) parts.push(spec.aspectRatio);
  if (spec.duration) parts.push(`${spec.duration}s`);

  const resolution = spec.params.resolution;
  if (typeof resolution === 'string' && resolution) {
    parts.push(resolution);
  } else {
    const w = spec.params.output_width;
    const h = spec.params.output_height;
    if (typeof w === 'number' && typeof h === 'number') parts.push(`${w}x${h}`);
  }

  if (truthyParam(spec.params.sound) || truthyParam(spec.params.generate_audio)) parts.push('audio');

  return parts.join(' · ');
}

/** Real Higgsfield display name for a model id, falling back to the id. */
export function modelDisplayName(modelId: string): string {
  return findModel(modelId)?.name ?? modelId;
}

export function isVideoRef(ref: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(ref);
}

// ---------------------------------------------------------------------------
// Rendering strip — active tasks, pipeline runs collapsed into one card.
// ---------------------------------------------------------------------------

export type PipelineNodeStatus = {
  taskId: string;
  nodeId: string | null;
  title: string;
  status: ProductionTask['status'];
  /** Set only when this node is blocked on an upstream node's title. */
  waitingOn: string | null;
};

export type RenderingItem =
  | { kind: 'task'; task: ProductionTask }
  | { kind: 'pipeline'; pipelineId: string; nodes: PipelineNodeStatus[] };

/**
 * Splits the active (non-delivered) tasks into standalone cards and
 * pipeline groups. A blocked node's `waitingOn` resolves against the FULL
 * task list (including delivered upstream tasks), since an upstream task
 * that already delivered should no longer read as "waiting" — resolveQueue
 * already demotes it out of 'blocked' once its dependsOn are satisfied, so
 * a node only carries waitingOn while genuinely blocked.
 */
export function buildRenderingItems(allTasks: ProductionTask[]): RenderingItem[] {
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const active = allTasks.filter((t) => t.status !== 'delivered');

  const items: RenderingItem[] = [];
  const pipelineOrder: string[] = [];
  const byPipeline = new Map<string, ProductionTask[]>();

  for (const t of active) {
    if (!t.pipelineId) {
      items.push({ kind: 'task', task: t });
      continue;
    }
    if (!byPipeline.has(t.pipelineId)) {
      byPipeline.set(t.pipelineId, []);
      pipelineOrder.push(t.pipelineId);
    }
    byPipeline.get(t.pipelineId)!.push(t);
  }

  for (const pipelineId of pipelineOrder) {
    const group = byPipeline.get(pipelineId)!;
    const nodes: PipelineNodeStatus[] = group.map((t) => {
      let waitingOn: string | null = null;
      if (t.status === 'blocked' && t.dependsOn?.length) {
        const upstreamTitle = t.dependsOn
          .map((id) => byId.get(id)?.title)
          .find((title): title is string => Boolean(title));
        waitingOn = upstreamTitle ?? null;
      }
      return { taskId: t.id, nodeId: t.nodeId ?? null, title: t.title, status: t.status, waitingOn };
    });
    items.push({ kind: 'pipeline', pipelineId, nodes });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Delivered feed — session grouping (pipeline groups, else day+type groups).
// ---------------------------------------------------------------------------

export type DeliveredGroup = {
  key: string;
  kind: 'pipeline' | 'day';
  label: string;
  tasks: ProductionTask[];
};

const TYPE_LABEL: Record<TaskType, string> = {
  thumbnail: 'Thumbnails',
  clips: 'Clips',
  upscale: 'Upscales',
  'ad-variants': 'Ad variants',
  'bg-removal': 'Background removals',
  image: 'Images',
  video: 'Videos',
  avatar: 'Avatars',
  enhance: 'Enhancements',
  speak: 'Voiceovers',
  ads: 'Ad variants',
};

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function latestTimestamp(tasks: ProductionTask[]): number {
  return Math.max(...tasks.map((t) => new Date(t.createdAt).getTime()));
}

/**
 * Groups delivered tasks into sessions: tasks sharing a pipelineId collapse
 * into one pipeline session; everything else groups by (calendar day, task
 * type). Groups are ordered newest first by the latest createdAt inside them.
 */
export function groupDeliveredTasks(tasks: ProductionTask[]): DeliveredGroup[] {
  const delivered = tasks.filter((t) => t.status === 'delivered');
  const groups = new Map<string, DeliveredGroup>();

  for (const t of delivered) {
    const key = t.pipelineId ? `pipeline:${t.pipelineId}` : `day:${dayKey(t.createdAt)}:${t.type}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        kind: t.pipelineId ? 'pipeline' : 'day',
        label: t.pipelineId ? `Pipeline · ${t.pipelineId}` : `${dayLabel(t.createdAt)} · ${TYPE_LABEL[t.type]}`,
        tasks: [],
      };
      groups.set(key, group);
    }
    group.tasks.push(t);
  }

  return [...groups.values()].sort((a, b) => latestTimestamp(b.tasks) - latestTimestamp(a.tasks));
}

// ---------------------------------------------------------------------------
// Verb dispatch — Upscale / Vary / Reuse settings build a TaskSpec to
// requestCompose(); every one degrades honestly for a legacy task with no
// stored spec instead of throwing.
// ---------------------------------------------------------------------------

/** Which composer tool a task's type reopens into. */
export const TASK_TYPE_TOOL_KEY: Record<TaskType, ContentToolKey> = {
  thumbnail: 'thumbnail',
  clips: 'clips',
  upscale: 'enhance',
  'ad-variants': 'ads',
  'bg-removal': 'enhance',
  image: 'image',
  video: 'video',
  avatar: 'avatar',
  enhance: 'enhance',
  speak: 'speak',
  ads: 'ads',
};

/**
 * Best-effort spec reconstruction for a delivered task that predates v3
 * specs. Honest degrade: carries the real model and output ref forward
 * instead of failing the verb entirely.
 */
export function taskSpecOrFallback(task: ProductionTask): TaskSpec {
  if (task.spec) return task.spec;
  const video = task.outputRef ? isVideoRef(task.outputRef) : false;
  return {
    model: task.model,
    params: {},
    aspectRatio: null,
    duration: null,
    prompt: task.inputs,
    medias: task.outputRef ? [{ role: video ? 'video_references' : 'image_references', ref: task.outputRef }] : [],
    identity: null,
    skill: null,
    batch: 1,
  };
}

/** The enhance-tool spec an "Upscale" verb dispatches for a delivered task. */
export function upscaleSpec(task: ProductionTask): TaskSpec {
  const video = task.outputRef ? isVideoRef(task.outputRef) : false;
  return {
    model: video ? 'topaz_video' : 'topaz_image_generative',
    params: {},
    aspectRatio: null,
    duration: null,
    prompt: '',
    medias: task.outputRef ? [{ role: video ? 'video_references' : 'image_references', ref: task.outputRef }] : [],
    identity: null,
    skill: null,
    batch: 1,
  };
}

// ---------------------------------------------------------------------------
// Library filter / search — pure over (assets, tasksById).
// ---------------------------------------------------------------------------

export type MediaFilterState = {
  kind: 'all' | 'image' | 'video';
  campaignId: string;
  model: string;
  query: string;
};

export const DEFAULT_MEDIA_FILTER: MediaFilterState = { kind: 'all', campaignId: 'all', model: 'all', query: '' };

/** Filters manifest assets by kind/campaign/model and a title+prompt search. */
export function filterMediaAssets(
  assets: MediaAsset[],
  filter: MediaFilterState,
  taskById: Map<string, ProductionTask>,
): MediaAsset[] {
  const q = filter.query.trim().toLowerCase();
  return assets.filter((a) => {
    if (filter.kind !== 'all' && a.kind !== filter.kind) return false;
    const task = taskById.get(a.taskId);
    if (filter.campaignId !== 'all' && task?.campaignId !== filter.campaignId) return false;
    if (filter.model !== 'all' && a.model !== filter.model) return false;
    if (q) {
      const haystack = `${task?.title ?? ''} ${task?.spec?.prompt ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Filter option lists — only values that actually exist in the manifest. */
export function mediaFilterOptions(
  assets: MediaAsset[],
  taskById: Map<string, ProductionTask>,
): { campaignIds: string[]; models: string[] } {
  const campaignIds = new Set<string>();
  const models = new Set<string>();
  for (const a of assets) {
    models.add(a.model);
    const campaignId = taskById.get(a.taskId)?.campaignId;
    if (campaignId) campaignIds.add(campaignId);
  }
  return { campaignIds: [...campaignIds].sort(), models: [...models].sort() };
}

/** Shared timestamp format for detail overlays and rendering-strip rows. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
