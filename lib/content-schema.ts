import { z } from 'zod';
import { findModel } from '@/lib/higgsfield/catalog';

/**
 * Pure content-production schemas, types, and the CREATE_ACTIONS catalog —
 * no node:fs / node:crypto here, so this module is safe to import from
 * client components (CreateStudio, ProductionQueue, MediaLibrary). The
 * file-backed queue store (readQueue/addTask/deleteTask/productionTasks)
 * lives in lib/content-production.ts, which re-exports everything here for
 * server call sites.
 */

export const TASK_TYPES = [
  'thumbnail',
  'clips',
  'upscale',
  'ad-variants',
  'bg-removal',
  'image',
  'video',
  'avatar',
  'enhance',
  'speak',
  'ads',
] as const;
export const TaskTypeSchema = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof TaskTypeSchema>;

/** Real Higgsfield model id per task type. */
export const TASK_MODEL: Record<TaskType, string> = {
  thumbnail: 'nano_banana_pro',
  clips: 'clipify',
  upscale: 'topaz_video',
  'ad-variants': 'ad_multiplier',
  'bg-removal': 'video_background_remover',
  image: 'nano_banana_pro',
  video: 'kling3_0',
  avatar: 'soul_2',
  enhance: 'topaz_video',
  speak: 'text2speech_v2',
  ads: 'ad_multiplier',
};

export const TASK_STATUSES = ['queued', 'generating', 'delivered', 'blocked'] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/**
 * The full fulfillment spec a v3 task carries: the exact model, parameters,
 * and role-typed media references the operator (or a future runner) executes
 * verbatim through the Higgsfield MCP — no re-interpreting prose.
 */
export const SpecMediaSchema = z.object({
  /** Media role on the target model (start_image, image_references, ...). */
  role: z.string().min(1),
  /** Library/upload path under /content-media/, or an external URL. */
  ref: z.string().min(1),
  label: z.string().optional(),
});
export type SpecMedia = z.infer<typeof SpecMediaSchema>;

export const TaskSpecSchema = z.object({
  model: z.string().min(1),
  params: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]))
    .default({}),
  aspectRatio: z.string().nullable().default(null),
  duration: z.number().nullable().default(null),
  prompt: z.string().default(''),
  medias: z.array(SpecMediaSchema).default([]),
  identity: z
    .object({ kind: z.enum(['soul', 'element']), id: z.string().min(1), name: z.string().min(1) })
    .nullable()
    .default(null),
  /** Skill file the operator loads during fulfillment (e.g. thumbnail-generation). */
  skill: z.string().nullable().default(null),
  /** Parallel jobs for this spec (batch protocol). */
  batch: z.number().int().min(1).max(8).default(1),
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export const ProductionTaskSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  type: TaskTypeSchema,
  title: z.string().min(1),
  /** Short description of what goes into the model. */
  inputs: z.string().min(1),
  model: z.string().min(1),
  creditEstimate: z.number().positive(),
  status: TaskStatusSchema,
  /** Path under /content-media/ once the output has landed; null until then. */
  outputRef: z.string().nullable(),
  /** ISO timestamp the task was queued. */
  createdAt: z.string().min(1),
  /** v3 fulfillment spec; absent on legacy rows (they still parse). */
  spec: TaskSpecSchema.optional(),
  /** Set when this task is one node of a pipeline run. */
  pipelineId: z.string().optional(),
  nodeId: z.string().optional(),
  /** Task ids that must deliver before this one can run (derived: blocked). */
  dependsOn: z.array(z.string()).optional(),
});
export type ProductionTask = z.infer<typeof ProductionTaskSchema>;

export const MediaAssetSchema = z.object({
  id: z.string().min(1),
  /** Filename inside public/content-media/. */
  file: z.string().min(1),
  taskId: z.string().min(1),
  model: z.string().min(1),
  credits: z.number().nonnegative(),
  kind: z.enum(['image', 'video']),
  createdAt: z.string().min(1),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const MediaManifestSchema = z.object({ assets: z.array(MediaAssetSchema) });
export type MediaManifest = z.infer<typeof MediaManifestSchema>;

export const EMPTY_MANIFEST: MediaManifest = { assets: [] };

/** Public URL for a manifest asset. */
export function assetUrl(asset: MediaAsset): string {
  return `/content-media/${asset.file}`;
}

/**
 * Derive a task's honest status from the manifest: 'delivered' only when an
 * asset for this task (by taskId, or matching its outputRef) exists in the
 * manifest. A task claiming 'delivered' without a resolvable output is
 * demoted back to 'queued'. 'generating' is preserved — it is set by the
 * operator mid-fulfilment, not invented here.
 */
export function resolveTask(task: ProductionTask, manifest: MediaManifest): ProductionTask {
  const asset = manifest.assets.find(
    (a) => a.taskId === task.id || (task.outputRef !== null && assetUrl(a) === task.outputRef),
  );
  if (asset) return { ...task, status: 'delivered', outputRef: assetUrl(asset) };
  if (task.status === 'delivered') return { ...task, status: 'queued', outputRef: null };
  return { ...task, outputRef: null };
}

/**
 * Resolve a whole queue: per-task manifest derivation, then dependency
 * derivation — a task whose dependsOn ids are not all delivered reads
 * 'blocked' (never stored; recomputed every render, like 'delivered').
 */
export function resolveQueue(tasks: ProductionTask[], manifest: MediaManifest): ProductionTask[] {
  const resolved = tasks.map((t) => resolveTask(t, manifest));
  const delivered = new Set(resolved.filter((t) => t.status === 'delivered').map((t) => t.id));
  return resolved.map((t) => {
    if (t.status !== 'queued' || !t.dependsOn?.length) return t;
    const waiting = t.dependsOn.some((id) => !delivered.has(id));
    return waiting ? { ...t, status: 'blocked' as const } : t;
  });
}

/**
 * The five things the studio can actually make from the CREATE row. "Reel
 * cover" shares the thumbnail model and type — a reel cover IS a thumbnail,
 * just framed for a Reel/Short — so it does not need its own TaskType.
 */
export const CREATE_ACTION_KEYS = ['thumbnail', 'clips', 'upscale', 'ad-variants', 'reel-cover'] as const;
export const CreateActionKeySchema = z.enum(CREATE_ACTION_KEYS);
export type CreateActionKey = z.infer<typeof CreateActionKeySchema>;

export type CreateAction = {
  key: CreateActionKey;
  type: TaskType;
  label: string;
  blurb: string;
  placeholder: string;
  model: string;
  creditEstimate: number;
};

export const CREATE_ACTIONS: CreateAction[] = [
  {
    key: 'thumbnail',
    type: 'thumbnail',
    label: 'Thumbnail',
    blurb: 'A still cover image, composited by the model',
    placeholder: 'Reel cover — money phone',
    model: TASK_MODEL.thumbnail,
    creditEstimate: 2,
  },
  {
    key: 'clips',
    type: 'clips',
    label: 'Clips',
    blurb: 'Cut a raw recording into vertical segments',
    placeholder: 'Vertical clip pass on the build screen capture',
    model: TASK_MODEL.clips,
    creditEstimate: 10,
  },
  {
    key: 'upscale',
    type: 'upscale',
    label: 'Upscale',
    blurb: 'Raise a master cut to 4K before upload',
    placeholder: 'Upscale the master cut',
    model: TASK_MODEL.upscale,
    creditEstimate: 6,
  },
  {
    key: 'ad-variants',
    type: 'ad-variants',
    label: 'Ad variants',
    blurb: 'Re-hook a master cut for paid placement',
    placeholder: 'Two ad variants for the sponsor',
    model: TASK_MODEL['ad-variants'],
    creditEstimate: 48,
  },
  {
    key: 'reel-cover',
    type: 'thumbnail',
    label: 'Reel cover',
    blurb: 'A cover frame sized for a Reel or Short',
    placeholder: 'Reel cover — the one app that prints',
    model: TASK_MODEL.thumbnail,
    creditEstimate: 2,
  },
];

export function findCreateAction(key: string): CreateAction | undefined {
  return CREATE_ACTIONS.find((a) => a.key === key);
}

export const CreateTaskInputSchema = z.object({
  actionKey: CreateActionKeySchema,
  campaignId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  inputs: z.string().trim().min(1).max(2000),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

/**
 * The v3 create surface: eight tools, each a preset of the same composer —
 * a family filter plus a default model, never a separate form implementation.
 */
export type ContentToolKey = 'image' | 'video' | 'thumbnail' | 'avatar' | 'clips' | 'enhance' | 'speak' | 'ads';

export type ContentTool = {
  key: ContentToolKey;
  label: string;
  blurb: string;
  /** Model family the composer's picker filters to. */
  family: 'image' | 'video' | 'clips' | 'enhance' | 'ads' | 'speak';
  defaultModel: string;
  taskType: TaskType;
  /** Skill file pre-selected in the composer, when one applies. */
  skill: string | null;
};

export const CONTENT_TOOLS: ContentTool[] = [
  {
    key: 'image',
    label: 'Image',
    blurb: 'Stills from any image model, text or reference driven',
    family: 'image',
    defaultModel: 'nano_banana_pro',
    taskType: 'image',
    skill: null,
  },
  {
    key: 'video',
    label: 'Video',
    blurb: 'Clips with start and end frames, references, native audio',
    family: 'video',
    defaultModel: 'kling3_0',
    taskType: 'video',
    skill: null,
  },
  {
    key: 'thumbnail',
    label: 'Thumbnail',
    blurb: 'A 4K cover image through the thumbnail skill',
    family: 'image',
    defaultModel: 'nano_banana_pro',
    taskType: 'thumbnail',
    skill: 'thumbnail-generation',
  },
  {
    key: 'avatar',
    label: 'Avatar',
    blurb: 'You, in any scene — Soul identity generation',
    family: 'image',
    defaultModel: 'soul_2',
    taskType: 'avatar',
    skill: null,
  },
  {
    key: 'clips',
    label: 'Clips',
    blurb: 'One YouTube video into subtitled vertical clips',
    family: 'clips',
    defaultModel: 'clipify',
    taskType: 'clips',
    skill: null,
  },
  {
    key: 'enhance',
    label: 'Enhance',
    blurb: 'Upscale, background removal, outpaint, lipsync, motion transfer',
    family: 'enhance',
    defaultModel: 'topaz_video',
    taskType: 'enhance',
    skill: null,
  },
  {
    key: 'speak',
    label: 'Speak',
    blurb: 'Voiceover and speech from text',
    family: 'speak',
    defaultModel: 'text2speech_v2',
    taskType: 'speak',
    skill: null,
  },
  {
    key: 'ads',
    label: 'Ads',
    blurb: 'Ad variants and product creative from a master cut',
    family: 'ads',
    defaultModel: 'ad_multiplier',
    taskType: 'ads',
    skill: null,
  },
];

export function findContentTool(key: string): ContentTool | undefined {
  return CONTENT_TOOLS.find((t) => t.key === key);
}

/**
 * Rough per-run credit estimate, client-safe (used by the composer footer
 * and the pipeline run confirm). Honest basis: Higgsfield does not publish
 * a per-model price table; these are conservative figures from this
 * account's actual spend, scaled by batch. Always rendered with a ~.
 */
export function estimateCredits(spec: Pick<TaskSpec, 'model' | 'batch'>): number {
  const base: Record<string, number> = {
    clipify: 10,
    ad_multiplier: 24,
    topaz_video: 6,
    bytedance_video_upscale: 6,
    nano_banana_pro: 2,
  };
  const model = findModel(spec.model);
  const fallback = model?.output === 'video' ? 8 : model?.output === 'audio' ? 1 : 2;
  return (base[spec.model] ?? fallback) * (spec.batch ?? 1);
}

/** v3 queue submission: a tool, a campaign, a title, and the full spec. */
export const QueueSpecInputSchema = z.object({
  toolKey: z.enum(['image', 'video', 'thumbnail', 'avatar', 'clips', 'enhance', 'speak', 'ads']),
  campaignId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  spec: TaskSpecSchema,
});
export type QueueSpecInput = z.infer<typeof QueueSpecInputSchema>;

/** PATCH /api/content/queue/[id] body — the only field a row can be re-pointed on today. */
export const PatchQueueTaskSchema = z.object({ campaignId: z.string().min(1) });
export type PatchQueueTaskInput = z.infer<typeof PatchQueueTaskSchema>;
