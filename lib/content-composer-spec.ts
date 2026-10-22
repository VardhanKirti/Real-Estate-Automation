import {
  defaultParams,
  identitySupport,
  type HfMediaRole,
  type HfModel,
} from '@/lib/higgsfield/catalog';
import {
  CONTENT_TOOLS,
  QueueSpecInputSchema,
  TaskSpecSchema,
  type ContentTool,
  type ContentToolKey,
  type QueueSpecInput,
  type SpecMedia,
  type TaskSpec,
} from '@/lib/content-schema';

/**
 * Pure spec-assembly helpers behind the Composer — no DOM, no fetch, so this
 * is unit-testable without mounting the component. The Composer only calls
 * these functions and writes the result into React state; the functions
 * themselves never read or write anything.
 */

function resolveDuration(model: HfModel, current: number | null): number | null {
  if (model.durations && model.durations.length > 0) {
    return current !== null && model.durations.includes(current) ? current : model.durations[0];
  }
  if (model.durationRange) {
    const { min, max } = model.durationRange;
    if (current !== null) return Math.min(Math.max(current, min), max);
    return min;
  }
  return null;
}

/** A fresh default spec for a model, seeded from its own schema. */
export function buildDefaultSpec(model: HfModel, tool?: ContentTool | null): TaskSpec {
  return TaskSpecSchema.parse({
    model: model.id,
    params: defaultParams(model),
    aspectRatio: model.aspectRatios[0] ?? null,
    duration: resolveDuration(model, null),
    prompt: '',
    medias: [],
    identity: null,
    skill: tool?.skill ?? null,
    batch: 1,
  });
}

/**
 * Re-derive a spec for a newly selected model: params reset to the new
 * model's defaults, aspect ratio and duration snapped into its range, media
 * references dropped for any role the new model doesn't declare, and an
 * identity reference cleared unless the new model still takes that kind.
 * Never carries over something the new model honestly can't use.
 */
export function applyModelChange(spec: TaskSpec, model: HfModel): TaskSpec {
  const validRoles = new Set(model.medias.map((m) => m.role));
  const medias = spec.medias.filter((m) => validRoles.has(m.role as HfMediaRole));
  const support = identitySupport(model.id);
  const identity = spec.identity && spec.identity.kind === support ? spec.identity : null;
  return TaskSpecSchema.parse({
    ...spec,
    model: model.id,
    params: defaultParams(model),
    aspectRatio: model.aspectRatios.includes(spec.aspectRatio ?? '')
      ? spec.aspectRatio
      : (model.aspectRatios[0] ?? null),
    duration: resolveDuration(model, spec.duration),
    medias,
    identity,
  });
}

/**
 * Merge a partial spec (the "reuse settings" / "vary" loop from a delivered
 * task) onto a fresh default for its target model, then run it through
 * applyModelChange so anything the model can't actually take is dropped
 * rather than silently carried over.
 */
export function specFromPartial(partial: Partial<TaskSpec>, model: HfModel, tool?: ContentTool | null): TaskSpec {
  const base = buildDefaultSpec(model, tool);
  const merged = TaskSpecSchema.parse({
    ...base,
    ...partial,
    model: model.id,
    params: { ...base.params, ...(partial.params ?? {}) },
  });
  return applyModelChange(merged, model);
}

/** The composer preset tool for a given model — used when the composer
 *  opens from a spec (reuse/vary) rather than a tool card. Prefers the tool
 *  whose default model is an exact match, falls back to the first tool
 *  sharing the model's family, honest null if nothing lines up. */
export function toolForModel(model: HfModel): ContentTool | null {
  return (
    CONTENT_TOOLS.find((t) => t.defaultModel === model.id) ??
    CONTENT_TOOLS.find((t) => t.family === model.family) ??
    null
  );
}

/** Add (or replace) a media reference on a role, respecting the model's
 *  declared slot max — single-slot roles replace, multi-slot roles append
 *  and trim to the newest `max` refs. */
export function setMedia(spec: TaskSpec, model: HfModel, role: HfMediaRole, media: SpecMedia): TaskSpec {
  const slot = model.medias.find((m) => m.role === role);
  const max = slot?.max ?? 1;
  const existing = spec.medias.filter((m) => m.role === role);
  const nextForRole = max <= 1 ? [media] : [...existing, media].slice(-max);
  const others = spec.medias.filter((m) => m.role !== role);
  return TaskSpecSchema.parse({ ...spec, medias: [...others, ...nextForRole] });
}

/** Remove one media reference from a role by its ref value. */
export function removeMedia(spec: TaskSpec, role: HfMediaRole, ref: string): TaskSpec {
  return TaskSpecSchema.parse({
    ...spec,
    medias: spec.medias.filter((m) => !(m.role === role && m.ref === ref)),
  });
}

/** Set (or clear, passing null) the identity reference — refuses a kind the
 *  model's identitySupport doesn't allow rather than writing a spec the
 *  operator can't honestly fulfil. */
export function setIdentity(spec: TaskSpec, model: HfModel, identity: TaskSpec['identity']): TaskSpec {
  if (identity && identitySupport(model.id) !== identity.kind) return spec;
  return TaskSpecSchema.parse({ ...spec, identity });
}

/** Set one parameter value by name. */
export function setParam(spec: TaskSpec, name: string, value: TaskSpec['params'][string]): TaskSpec {
  return TaskSpecSchema.parse({ ...spec, params: { ...spec.params, [name]: value } });
}

/** Toggle a skill on/off — writes the tool's skill file when turning on, null when off. */
export function toggleSkill(spec: TaskSpec, skill: string | null): TaskSpec {
  return TaskSpecSchema.parse({ ...spec, skill: spec.skill ? null : skill });
}

/** Assemble + validate the final POST body for /api/content/queue. */
export function buildQueueInput(
  toolKey: ContentToolKey,
  campaignId: string,
  title: string,
  spec: TaskSpec,
): QueueSpecInput {
  return QueueSpecInputSchema.parse({ toolKey, campaignId, title, spec });
}
