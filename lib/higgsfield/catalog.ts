import rawCatalog from './models.json';

/**
 * The Higgsfield model catalog — real account data, synced by the operator
 * from the Higgsfield MCP (models_explore). The composer renders its
 * parameter panel directly from these schemas: adding a model Higgsfield
 * ships next month is a JSON refresh, never new UI work. Client-safe (JSON
 * is bundled; the account snapshot, which changes at runtime, lives in
 * lib/higgsfield/account.ts and is server-only).
 */

export type HfParamType = 'string' | 'number' | 'bool' | 'string_array';

export type HfParam = {
  name: string;
  type: HfParamType;
  description?: string;
  required?: boolean;
  options?: (string | number)[];
  min?: number;
  max?: number;
  default?: string | number | boolean;
};

export type HfMediaRole =
  | 'image'
  | 'start_image'
  | 'end_image'
  | 'image_references'
  | 'video_references'
  | 'audio_references'
  | 'mask'
  | 'input_video'
  | 'input_audio';

export type HfMediaSlot = {
  role: HfMediaRole;
  type: 'image' | 'video' | 'audio';
  max?: number;
  required?: boolean;
};

export const MODEL_FAMILIES = ['image', 'video', 'clips', 'enhance', 'ads', 'speak'] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

export type HfModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  output: 'image' | 'video' | 'audio';
  family: ModelFamily;
  parameters: HfParam[];
  medias: HfMediaSlot[];
  aspectRatios: string[];
  durations?: number[];
  durationRange?: { min: number; max: number };
  unlim: boolean;
};

const catalog = rawCatalog as { syncedAt: string; source: string; models: HfModel[] };

export const HF_CATALOG_SYNCED_AT: string = catalog.syncedAt;
export const HF_MODELS: HfModel[] = catalog.models;

export function findModel(id: string): HfModel | undefined {
  return HF_MODELS.find((m) => m.id === id);
}

export function modelsByFamily(family: ModelFamily): HfModel[] {
  return HF_MODELS.filter((m) => m.family === family);
}

/**
 * Identity routing, mirroring the real MCP rules exactly: trained Souls work
 * ONLY with soul_2 / soul_cinematic; reference Elements work only with the
 * element-capable models. Everything else honestly gets 'none'.
 */
export const SOUL_MODELS = new Set(['soul_2', 'soul_cinematic']);

export const ELEMENT_MODELS = new Set([
  'nano_banana_pro',
  'nano_banana_2',
  'gpt_image_2',
  'seedream_v4_5',
  'seedream_v5_lite',
  'cinematic_studio_2_5',
  'cinematic_studio_video_v2',
  'cinematic_studio_3_0',
  'seedance_2_0',
  'kling3_0',
]);

export type IdentitySupport = 'soul' | 'element' | 'none';

export function identitySupport(modelId: string): IdentitySupport {
  if (SOUL_MODELS.has(modelId)) return 'soul';
  if (ELEMENT_MODELS.has(modelId)) return 'element';
  return 'none';
}

/** Human labels for the role-typed reference slots — never a bare upload box. */
export const ROLE_LABELS: Record<HfMediaRole, string> = {
  image: 'Reference image',
  start_image: 'Start frame',
  end_image: 'End frame',
  image_references: 'Reference images',
  video_references: 'Video reference',
  audio_references: 'Audio reference',
  mask: 'Mask',
  input_video: 'Source video',
  input_audio: 'Audio track',
};

/** Media kind accepted by each role, for type-checked pipeline sockets. */
export const ROLE_KIND: Record<HfMediaRole, 'image' | 'video' | 'audio'> = {
  image: 'image',
  start_image: 'image',
  end_image: 'image',
  image_references: 'image',
  video_references: 'video',
  audio_references: 'audio',
  mask: 'image',
  input_video: 'video',
  input_audio: 'audio',
};

/**
 * Parameter surfacing: hidden params are controlled elsewhere in the UI
 * (identity chip owns soul_id) or are internal; advanced params collapse
 * behind a disclosure — split by usage frequency, not technical category.
 */
export const HIDDEN_PARAMS = new Set(['folder_id', 'soul_id', 'avatar_ids', 'product_ids', 'assets']);

export const ADVANCED_PARAMS = new Set([
  'seed',
  'cfg_scale',
  'bitrate_mode',
  'thinking',
  'enable_thinking',
  'is_inpaint',
  'sample_rate',
  'format',
  'max_height',
  'speech_rate',
  'loudness_rate',
  'pitch_rate',
  'volume',
  'sync_mode',
  'model_version',
  'autoprompt',
  'track_face_crop',
  'segment_seconds',
  'width',
  'height',
]);

export function visibleParams(model: HfModel): { primary: HfParam[]; advanced: HfParam[] } {
  const primary: HfParam[] = [];
  const advanced: HfParam[] = [];
  for (const p of model.parameters) {
    if (HIDDEN_PARAMS.has(p.name)) continue;
    (ADVANCED_PARAMS.has(p.name) ? advanced : primary).push(p);
  }
  return { primary, advanced };
}

/** Default parameter values for a model, from its schema. */
export function defaultParams(model: HfModel): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const p of model.parameters) {
    if (HIDDEN_PARAMS.has(p.name)) continue;
    if (p.default !== undefined) out[p.name] = p.default;
  }
  return out;
}
