import type { ConsoleControls, VideoModel } from '@/lib/creative-engine/schemas';
import { DURATION_RULES } from '@/lib/creative-engine/duration';

/**
 * Per-model request rules for POST /v2/videos/generate, encoded from the
 * field descriptions of CreateVideoDto in the Arcads OpenAPI document
 * (docs/projects/creative-engine/reference/arcads-openapi-2026-10-01.json) so
 * the gating table is executable and tested, not prose. `validateRequest`
 * runs BEFORE any credit is charged and returns lints; `error` lints block
 * submit.
 *
 * Where the document is silent (seedance-2.0-mini's aspect/resolution/
 * duration, happy-horse's everything, which models speak) the row inherits
 * its closest sibling and is listed in UNVERIFIED_MODELS. One rule is from
 * observed behaviour, not the document: kling-3.0 with an end frame alone
 * is accepted, billed, then fails. That stays off until a probe proves it.
 */

export type ModelRule = {
  aspects: readonly ConsoleControls['aspectRatio'][];
  /** empty = the document says "not applicable": the field is never sent */
  resolutions: readonly ConsoleControls['resolution'][];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  startFrame: boolean;
  endFrame: boolean;
  /** CreateVideoDto.audioEnabled applies only here */
  audioToggle: boolean;
  /** start/end frame OR reference media per generation, never both */
  framesXorRefs: boolean;
  /** model produces speech from prompt dialogue (observed; the document does not say) */
  speaks: boolean;
};

const STD = ['1:1', '16:9', '9:16'] as const;
const SEEDANCE_ASPECTS = ['9:16', '4:3', '16:9'] as const;
const MINIMAX_ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

export const MODEL_RULES: Record<VideoModel, ModelRule> = {
  'seedance-2.0': { aspects: SEEDANCE_ASPECTS, resolutions: ['480p', '720p', '1080p', '4K'], maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, startFrame: false, endFrame: false, audioToggle: true, framesXorRefs: false, speaks: true },
  'seedance-2.0-mini': { aspects: SEEDANCE_ASPECTS, resolutions: ['480p', '720p', '1080p', '4K'], maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, startFrame: false, endFrame: false, audioToggle: true, framesXorRefs: false, speaks: true },
  'seedance-2.5': { aspects: SEEDANCE_ASPECTS, resolutions: ['480p', '720p', '1080p'], maxReferenceImages: 30, maxReferenceVideos: 10, maxReferenceAudios: 10, startFrame: true, endFrame: true, audioToggle: true, framesXorRefs: true, speaks: true },
  seedance: { aspects: STD, resolutions: ['480p', '720p', '1080p'], maxReferenceImages: 1, maxReferenceVideos: 0, maxReferenceAudios: 0, startFrame: false, endFrame: true, audioToggle: false, framesXorRefs: false, speaks: false },
  veo31: { aspects: ['16:9', '9:16'], resolutions: ['720p', '1080p', '4K'], maxReferenceImages: 3, maxReferenceVideos: 0, maxReferenceAudios: 0, startFrame: true, endFrame: true, audioToggle: false, framesXorRefs: false, speaks: true },
  'kling-3.0': { aspects: STD, resolutions: [], maxReferenceImages: 0, maxReferenceVideos: 0, maxReferenceAudios: 0, startFrame: true, endFrame: true, audioToggle: false, framesXorRefs: false, speaks: false },
  'kling-2.6': { aspects: STD, resolutions: [], maxReferenceImages: 0, maxReferenceVideos: 0, maxReferenceAudios: 0, startFrame: true, endFrame: true, audioToggle: false, framesXorRefs: false, speaks: false },
  'grok-video': { aspects: ['auto', ...STD], resolutions: ['480p', '720p'], maxReferenceImages: 0, maxReferenceVideos: 0, maxReferenceAudios: 0, startFrame: true, endFrame: false, audioToggle: false, framesXorRefs: false, speaks: false },
  'minimax-h3': { aspects: MINIMAX_ASPECTS, resolutions: ['480p', '720p', '1080p', '4K'], maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, startFrame: true, endFrame: true, audioToggle: false, framesXorRefs: true, speaks: false },
  'minimax-h3-max': { aspects: MINIMAX_ASPECTS, resolutions: ['480p', '720p'], maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, startFrame: true, endFrame: true, audioToggle: false, framesXorRefs: true, speaks: false },
  'happy-horse': { aspects: STD, resolutions: [], maxReferenceImages: 1, maxReferenceVideos: 0, maxReferenceAudios: 0, startFrame: false, endFrame: false, audioToggle: false, framesXorRefs: false, speaks: false },
};

/** Rows the document does not fully describe; the UI captions them. */
export const UNVERIFIED_MODELS: readonly VideoModel[] = ['seedance-2.0-mini', 'happy-horse', 'seedance'];

/** The cheapest honest request per model, for the paid probe and the first-run check. */
export function cheapestRequest(model: VideoModel): Pick<ConsoleControls, 'model' | 'duration' | 'aspectRatio' | 'resolution' | 'variations' | 'audioEnabled' | 'enhance'> {
  const d = DURATION_RULES[model];
  const rule = MODEL_RULES[model];
  const duration = d.kind === 'range' ? d.min : d.kind === 'enum' ? d.values[0] : 4;
  return { model, duration, aspectRatio: rule.aspects.includes('9:16') ? '9:16' : rule.aspects[0], resolution: rule.resolutions[0] ?? '480p', variations: 1, audioEnabled: false, enhance: false };
}

export type ValidationLint = { level: 'warn' | 'error'; field: keyof ConsoleControls | 'request'; message: string };

/** What a host-local reference path check found (GET /api/creative-engine/arcads/assets?check=). */
export type RefCheck = { exists: boolean; kind: 'image' | 'video' | 'audio' | null };

type RefField = 'referenceImages' | 'referenceVideos' | 'referenceAudios' | 'startFrame' | 'endFrame';
const REF_LABEL: Record<RefField, string> = { referenceImages: 'reference images', referenceVideos: 'reference video', referenceAudios: 'reference audio', startFrame: 'start frame', endFrame: 'end frame' };
const REF_KIND: Record<RefField, RefCheck['kind']> = { referenceImages: 'image', referenceVideos: 'video', referenceAudios: 'audio', startFrame: 'image', endFrame: 'image' };

/**
 * Reference fields the current model takes none of (S05a Q-MC-4: switching to
 * such a model keeps the paths, with a warning, and never sends them). A
 * model that takes SOME but fewer still errors in validateRequest.
 */
export function ignoredRefs(c: Pick<ConsoleControls, 'model' | RefField>): RefField[] {
  const rule = MODEL_RULES[c.model];
  const out: RefField[] = [];
  if (c.referenceImages.length && rule.maxReferenceImages === 0) out.push('referenceImages');
  if (c.referenceVideos.length && rule.maxReferenceVideos === 0) out.push('referenceVideos');
  if (c.referenceAudios.length && rule.maxReferenceAudios === 0) out.push('referenceAudios');
  if (c.startFrame && !rule.startFrame) out.push('startFrame');
  if (c.endFrame && !rule.endFrame) out.push('endFrame');
  return out;
}

/** The controls as they are sent: fields the model ignores are emptied, so they are neither uploaded nor counted. */
export function stripIgnoredRefs<T extends Pick<ConsoleControls, 'model' | RefField>>(c: T): T {
  const ignored = ignoredRefs(c);
  if (!ignored.length) return c;
  const out = { ...c };
  for (const f of ignored) {
    if (f === 'startFrame' || f === 'endFrame') out[f] = null;
    else out[f] = [];
  }
  return out;
}

/** Every reference path in the controls, with the kind it must be. */
export function referencePaths(c: Pick<ConsoleControls, RefField>): { field: RefField; path: string; kind: RefCheck['kind'] }[] {
  const out: { field: RefField; path: string; kind: RefCheck['kind'] }[] = [];
  for (const f of ['referenceImages', 'referenceVideos', 'referenceAudios'] as const) for (const p of c[f]) out.push({ field: f, path: p, kind: REF_KIND[f] });
  if (c.startFrame) out.push({ field: 'startFrame', path: c.startFrame, kind: 'image' });
  if (c.endFrame) out.push({ field: 'endFrame', path: c.endFrame, kind: 'image' });
  return out;
}

/**
 * Lints for one request. `checks` (path -> what the host found) is optional:
 * the console passes what it has checked so far, and a missing file or a file
 * of the wrong kind becomes an error before any credit is charged.
 */
export function validateRequest(input: ConsoleControls, checks?: Record<string, RefCheck | undefined>): ValidationLint[] {
  const out: ValidationLint[] = [];
  for (const f of ignoredRefs(input)) out.push({ level: 'warn', field: f, message: `${REF_LABEL[f]} ignored by ${input.model}: kept for another model, not sent` });
  const c = stripIgnoredRefs(input);
  const rule = MODEL_RULES[c.model];
  if (checks) {
    for (const r of referencePaths(c)) {
      const k = checks[r.path];
      if (!k) continue;
      if (!k.exists) out.push({ level: 'error', field: r.field, message: `reference file not found: ${r.path}` });
      else if (k.kind !== r.kind) out.push({ level: 'error', field: r.field, message: `${r.path} is ${k.kind ?? 'not a known media type'}; ${REF_LABEL[r.field]} must be ${r.kind === 'image' ? 'an image' : r.kind === 'audio' ? 'audio' : 'a video'}` });
    }
  }
  if (!rule.aspects.includes(c.aspectRatio)) out.push({ level: 'error', field: 'aspectRatio', message: `${c.model} does not accept ${c.aspectRatio} (allowed: ${rule.aspects.join(', ')})` });
  if (rule.resolutions.length && !rule.resolutions.includes(c.resolution)) out.push({ level: 'error', field: 'resolution', message: `${c.model} does not accept ${c.resolution} (allowed: ${rule.resolutions.join(', ')})` });

  const d = DURATION_RULES[c.model];
  if (d.kind === 'enum' && !d.values.includes(c.duration)) out.push({ level: 'error', field: 'duration', message: `${c.model} duration must be one of ${d.values.join('/')}` });
  if (d.kind === 'range' && (c.duration < d.min || c.duration > d.max)) out.push({ level: 'error', field: 'duration', message: `${c.model} duration must be ${d.min}–${d.max}s` });

  if (c.referenceImages.length > rule.maxReferenceImages) out.push({ level: 'error', field: 'referenceImages', message: rule.maxReferenceImages === 0 ? `${c.model} takes no reference images` : `${c.model} takes at most ${rule.maxReferenceImages} reference image(s)` });
  if (c.referenceVideos.length > rule.maxReferenceVideos) out.push({ level: 'error', field: 'referenceVideos', message: rule.maxReferenceVideos === 0 ? `${c.model} takes no reference video` : `${c.model} takes at most ${rule.maxReferenceVideos} reference video(s)` });
  if (c.referenceAudios.length > rule.maxReferenceAudios) out.push({ level: 'error', field: 'referenceAudios', message: rule.maxReferenceAudios === 0 ? `${c.model} takes no reference audio` : `${c.model} takes at most ${rule.maxReferenceAudios} reference audio file(s)` });
  const refs = c.referenceImages.length + c.referenceVideos.length + c.referenceAudios.length;
  if ((c.model === 'minimax-h3' || c.model === 'minimax-h3-max') && refs > 12) out.push({ level: 'error', field: 'request', message: `${c.model} takes 12 reference files combined` });
  if (c.startFrame && !rule.startFrame) out.push({ level: 'error', field: 'startFrame', message: `${c.model} has no start frame` });
  if (c.endFrame && !rule.endFrame) out.push({ level: 'error', field: 'endFrame', message: `${c.model} has no end frame` });
  if (c.model === 'seedance-2.5' && c.endFrame && !c.startFrame) out.push({ level: 'error', field: 'endFrame', message: 'seedance-2.5 end frame requires a start frame' });
  if (rule.framesXorRefs && (c.startFrame || c.endFrame) && refs > 0) out.push({ level: 'error', field: 'request', message: `${c.model} takes either start/end frames or reference media per generation, not both` });
  if (c.model === 'kling-3.0' && c.endFrame && !c.startFrame) out.push({ level: 'error', field: 'endFrame', message: 'kling-3.0 end frame alone: accepted, charged, then fails (observed). Add a start frame or remove it' });
  if (c.model === 'seedance-2.5' && c.startFrame) out.push({ level: 'warn', field: 'aspectRatio', message: 'seedance-2.5 takes the start frame\'s shape; the aspect sent is ignored' });
  if (c.variations > 1) out.push({ level: 'warn', field: 'variations', message: `${c.variations} separate requests, each charged, each with its own reference upload` });
  if (c.enhance) out.push({ level: 'warn', field: 'enhance', message: 'prompt enhancement costs 8 extra credits per request' });
  if (!rule.speaks && c.dialogue.trim() && !c.omitDialogue) out.push({ level: 'warn', field: 'dialogue', message: `${c.model} is silent; dialogue is ignored` });
  if (UNVERIFIED_MODELS.includes(c.model)) out.push({ level: 'warn', field: 'request', message: `${c.model}: the document does not list all of its limits; this row inherits a sibling's. A probe is the truth` });
  return out;
}

export type UploadedRefs = { referenceImages: string[]; referenceVideos: string[]; referenceAudios: string[]; startFrame: string | null; endFrame: string | null };

/** The exact CreateVideoDto body, given already-uploaded file paths. */
export function buildVideoBody(c: ConsoleControls, prompt: string, productId: string, uploaded: UploadedRefs, projectId?: string | null): Record<string, unknown> {
  const rule = MODEL_RULES[c.model];
  const d = DURATION_RULES[c.model];
  const body: Record<string, unknown> = { model: c.model, productId, prompt };
  if (projectId) body.projectId = projectId;
  if (rule.aspects.includes(c.aspectRatio)) body.aspectRatio = c.aspectRatio;
  if (d.kind !== 'auto') body.duration = c.duration;
  if (rule.resolutions.includes(c.resolution)) body.resolution = c.resolution;
  if (uploaded.referenceImages.length && rule.maxReferenceImages) body.referenceImages = uploaded.referenceImages;
  if (uploaded.referenceVideos.length && rule.maxReferenceVideos) body.referenceVideos = uploaded.referenceVideos;
  if (uploaded.referenceAudios.length && rule.maxReferenceAudios) body.referenceAudios = uploaded.referenceAudios;
  if (rule.audioToggle) body.audioEnabled = c.audioEnabled;
  if (uploaded.startFrame && rule.startFrame) body.startFrame = uploaded.startFrame;
  if (uploaded.endFrame && rule.endFrame) body.endFrame = uploaded.endFrame;
  if (c.bitrateMode === 'high') body.bitrateMode = 'high';
  if (c.enhance) body.enhance = true;
  return body;
}
