import { z } from 'zod';
import {
  LabBeatTypeSchema,
  LabCtaTypeSchema,
  LabFormatSchema,
  LabHookChannelSchema,
  LabHookFormSchema,
  LabPacingSchema,
  LabPillarSchema,
  LabStructureSchema,
  LabTriggerSchema,
  LAB_BEAT_TYPES,
  LAB_FORMATS,
  LAB_HOOK_FORMS,
  LAB_STRUCTURES,
  LAB_TRIGGERS,
  type LabDissection,
  type LabPost,
  type LabPostTopic,
  type LabTranscript,
} from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { CapError, gatedCall } from '@/lib/lab/spend';
import { normalizeBeats } from '@/lib/lab/measures';
import { redactOutcomeCues } from '@/lib/lab/measure/leakage';
import { claudeJson, type ClaudeJson } from '@/lib/creative-engine/claude';
import { dryDissectionReply } from '@/lib/lab/dry-items';
import { sheetExists, sheetRelPath } from '@/lib/lab/gen/frames';
import { claudeJsonWithImage } from '@/lib/lab/gen/claude-image';

/**
 * Dissection (SPEC §4.5): one LLM call per post through `claudeJson` (the local `claude`
 * CLI, strict JSON, one retry; reused from lib/creative-engine/claude.ts) against the
 * zod schema below. Every row stores `model_id` and `prompt_version`; every enum carries
 * `other` and a `_confidence` (0-1).
 *
 * Honest inputs: the model sees the caption, platform, format hints and the transcript
 * when one exists, never the post's metrics (so it cannot pattern-match "viral"). Without
 * a transcript it is told to return no beats, and the stored beats are forced empty
 * whatever it says; `confidences.transcript` is 0 so pattern mining can exclude the hook
 * and beats of caption-only posts (§4.4).
 *
 * The local CLI is uncapped (LAB llm cap null) but every call still goes through the spend
 * gate for the run log and the 0-cost ledger row. Dry (LAB_DRY=1 or Filming) answers
 * with a deterministic fixture reply and never spawns the CLI.
 */

/** v1.1 (04 6.3): the caption reaches the model through redactOutcomeCues. */
export const DISSECT_PROMPT_VERSION = 'dissect-v1.1';
/** 07 7.14.4: used when the post has a frame contact sheet. */
export const DISSECT_FRAMES_PROMPT_VERSION = 'dissect-v2-frames';
export const FRAMES_PROMPT_ADDITION = 'The image is a contact sheet: the top row is the first 3 seconds (0, 0.5, 1, 1.5, 2, 2.75 s), the bottom row is spread over the rest. Read on-screen text and the first frame from the image, not from the caption.';
export const DISSECT_PER_CYCLE = 40;
/** The CLI's default model unless LAB_DISSECT_MODEL names one (then passed as --model and recorded). */
export const dissectModelId = (): string => process.env.LAB_DISSECT_MODEL?.trim() || 'claude-cli-default';

const conf = z.number().min(0).max(1);
/** The model's reply, snake_case as SPEC §4.5 names the fields. */
export const DissectReplySchema = z.object({
  format: LabFormatSchema,
  format_confidence: conf,
  hook_form: LabHookFormSchema,
  hook_form_confidence: conf,
  emotional_trigger: LabTriggerSchema,
  emotional_trigger_confidence: conf,
  hook_channel: LabHookChannelSchema,
  hook_channel_confidence: conf,
  hook_text: z.string().max(400),
  first_frame_text: z.string().max(400),
  structure_type: LabStructureSchema,
  structure_type_confidence: conf,
  beats: z.array(z.object({ start_pct: z.number().min(0).max(100), end_pct: z.number().min(0).max(100), type: LabBeatTypeSchema, summary: z.string().max(240) })).max(24),
  pacing: LabPacingSchema,
  pacing_confidence: conf,
  topics: z.array(z.object({ topic: z.string().min(1).max(80), angle: z.string().max(160), is_primary: z.boolean() })).min(1).max(4),
  pillar: LabPillarSchema,
  pillar_confidence: conf,
  cta_type: LabCtaTypeSchema,
  cta_type_confidence: conf,
  tension: z.object({ false_belief: z.string().max(240), reframe: z.string().max(240) }).nullable(),
  quality_notes: z.string().max(400),
  /* 07 7.14.4, read from the contact sheet; absent on caption-only posts */
  on_screen_text_density: z.number().int().min(0).max(3).nullable().optional(),
  face_first_frame: z.boolean().nullable().optional(),
});
export type DissectReply = z.infer<typeof DissectReplySchema>;

const TRANSCRIPT_CHARS = 6000;

export function buildDissectPrompt(post: Pick<LabPost, 'platform' | 'contentType' | 'durationS' | 'caption'>, transcript: Pick<LabTranscript, 'text' | 'status'> | null, opts: { frames?: boolean } = {}): string {
  const hasT = Boolean(transcript && transcript.status === 'done' && transcript.text.trim());
  return [
    'You dissect one short or long-form social post for a content analysis lab. Reply with ONLY strict JSON, no prose, no code fence.',
    '',
    'POST',
    `platform: ${post.platform}`,
    `content type: ${post.contentType}`,
    `duration seconds: ${post.durationS ?? 'unknown'}`,
    `caption: ${JSON.stringify(redactOutcomeCues(post.caption).slice(0, 2000))}`,
    hasT ? `transcript: ${JSON.stringify(transcript!.text.slice(0, TRANSCRIPT_CHARS))}` : 'transcript: none (analyse the caption only; return "beats": [] and base the hook on the caption)',
    '',
    'RULES',
    '- Describe only what is in the caption and transcript. Never invent numbers, names or events.',
    '- Every enum allows "other"; use it rather than forcing a poor fit. Each *_confidence is 0 to 1.',
    '- Hook types that are really structures (story, list, POV) go in structure_type, not hook_form.',
    '- beats: percentages of the runtime (0-100), sorted, non-overlapping, the last ending at 100. The first beat is the hook.',
    '- topics: 1 to 4; the angle is the specific take that makes the topic usable. Exactly one is_primary true.',
    '- tension: the false belief the post corrects and its reframe, or null when there is none.',
    '',
    'JSON SHAPE',
    JSON.stringify({
      format: LAB_FORMATS.join('|'),
      format_confidence: 0.8,
      hook_form: LAB_HOOK_FORMS.join('|'),
      hook_form_confidence: 0.8,
      emotional_trigger: LAB_TRIGGERS.join('|'),
      emotional_trigger_confidence: 0.8,
      hook_channel: 'spoken|on_screen_text|visual|audio|mixed',
      hook_channel_confidence: 0.8,
      hook_text: 'the opening line as said or shown',
      first_frame_text: 'text on the first frame, or empty',
      structure_type: LAB_STRUCTURES.join('|'),
      structure_type_confidence: 0.8,
      beats: [{ start_pct: 0, end_pct: 8, type: LAB_BEAT_TYPES.join('|'), summary: 'one line' }],
      pacing: 'rapid_fire|conversational|slow_build|punchy',
      pacing_confidence: 0.8,
      topics: [{ topic: 'short topic', angle: 'the specific take', is_primary: true }],
      pillar: 'educational|entertainment|inspirational|promotional|community|behind_scenes',
      pillar_confidence: 0.8,
      cta_type: 'follow|comment_keyword|link|product|none|other',
      cta_type_confidence: 0.8,
      tension: { false_belief: '...', reframe: '...' },
      quality_notes: 'short',
    }),
    ...(opts.frames ? ['', FRAMES_PROMPT_ADDITION, 'Also return "on_screen_text_density" (0 none, 1 a label, 2 captions, 3 text-led) and "face_first_frame" (true or false) from the image.'] : []),
    `prompt_version: ${opts.frames ? DISSECT_FRAMES_PROMPT_VERSION : DISSECT_PROMPT_VERSION}`,
  ].join('\n');
}

/** Reply → the stored dissection and topics. Beats are normalised; without a transcript they are dropped. Pure. */
export function toDissection(reply: DissectReply, postId: string, opts: { modelId: string; hasTranscript: boolean; now: Date; sheetPath?: string | null }): { dissection: LabDissection; topics: LabPostTopic[] } {
  const beats = opts.hasTranscript ? normalizeBeats(reply.beats.map((b) => ({ startPct: b.start_pct, endPct: b.end_pct, type: b.type, summary: b.summary }))) : [];
  const primaryIdx = Math.max(0, reply.topics.findIndex((t) => t.is_primary));
  return {
    dissection: {
      postId,
      format: reply.format,
      hookForm: reply.hook_form,
      emotionalTrigger: reply.emotional_trigger,
      hookChannel: reply.hook_channel,
      hookText: reply.hook_text,
      firstFrameText: reply.first_frame_text,
      structureType: reply.structure_type,
      beats,
      pacing: reply.pacing,
      pillar: reply.pillar,
      ctaType: reply.cta_type,
      tension: reply.tension ? { falseBelief: reply.tension.false_belief, reframe: reply.tension.reframe } : null,
      confidences: {
        format: reply.format_confidence,
        hook_form: reply.hook_form_confidence,
        emotional_trigger: reply.emotional_trigger_confidence,
        hook_channel: reply.hook_channel_confidence,
        structure_type: reply.structure_type_confidence,
        pacing: reply.pacing_confidence,
        pillar: reply.pillar_confidence,
        cta_type: reply.cta_type_confidence,
        transcript: opts.hasTranscript ? 1 : 0,
      },
      qualityNotes: `${opts.hasTranscript ? '' : 'caption-only. '}${reply.quality_notes}`.trim(),
      modelId: opts.modelId,
      promptVersion: opts.sheetPath ? DISSECT_FRAMES_PROMPT_VERSION : DISSECT_PROMPT_VERSION,
      analysedAt: opts.now.toISOString(),
      framesUsed: opts.sheetPath ? 1 : 0,
      onScreenTextDensity: opts.sheetPath ? (reply.on_screen_text_density ?? null) : null,
      faceFirstFrame: opts.sheetPath ? (reply.face_first_frame ?? null) : null,
      sheetPath: opts.sheetPath ?? null,
    },
    // exactly one primary topic, whatever the model marked
    topics: reply.topics.map((t, i) => ({ postId, topic: t.topic.trim(), angle: t.angle.trim(), isPrimary: i === primaryIdx, clusterId: null })),
  };
}

/**
 * Undissected posts, owned first, then those with a transcript, then newest. Pure over the store.
 * v2 (04 5.2): only owned posts, cases and drawn controls are dissected (the profile's sample).
 */
export function dissectTargets(store: LabStore, limit = DISSECT_PER_CYCLE, opts: { hasSheet?: (postId: string) => boolean } = {}): LabPost[] {
  // 07 7.14.4: a post dissected without frames that now has a sheet is re-dissected once
  const hasSheet = opts.hasSheet ?? ((id: string) => Boolean(sheetExists(store, id)));
  const done = new Set(store.dissections.all().filter((d) => !(d.promptVersion !== DISSECT_FRAMES_PROMPT_VERSION && !(d.framesUsed ?? 0) && hasSheet(d.postId))).map((d) => d.postId));
  const transcribed = new Set(store.transcripts.all().filter((t) => t.status === 'done').map((t) => t.postId));
  const sampled = new Set(store.controls.all().map((c) => c.postId));
  return store.posts
    .all()
    .filter((p) => !done.has(p.id) && (p.isOwned || sampled.has(p.id)))
    .sort((a, b) => Number(b.isOwned) - Number(a.isOwned) || Number(transcribed.has(b.id)) - Number(transcribed.has(a.id)) || String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? '')))
    .slice(0, limit);
}

export type DissectRunner = (prompt: string, schema: typeof DissectReplySchema, opts: { model?: string }) => Promise<ClaudeJson<DissectReply>>;
/** The dissect call with a contact sheet (07 7.14.4): claudeJsonWithImage by default. */
export type DissectImageRunner = (prompt: string, imagePath: string, schema: typeof DissectReplySchema, opts: { model?: string }) => Promise<ClaudeJson<DissectReply>>;

export type DissectDeps = { store: LabStore; now?: Date; override?: boolean; scheduled?: boolean; limit?: number; runner?: DissectRunner; imageRunner?: DissectImageRunner; sheetOf?: (postId: string) => string | null };
export type DissectResult = { considered: number; done: number; failed: number; errors: string[]; blocked: string | null };

export async function dissectCycle(deps: DissectDeps): Promise<DissectResult> {
  const { store } = deps;
  const now = deps.now ?? new Date();
  const runner: DissectRunner = deps.runner ?? ((prompt, schema, o) => claudeJson(prompt, schema, { model: o.model, timeoutMs: 180_000 }));
  const imageRunner: DissectImageRunner = deps.imageRunner ?? ((prompt, imagePath, schema, o) => claudeJsonWithImage(prompt, imagePath, schema, { model: o.model, timeoutMs: 180_000 }));
  const sheetOf = deps.sheetOf ?? ((id: string) => sheetExists(store, id));
  const targets = dissectTargets(store, deps.limit ?? DISSECT_PER_CYCLE, { hasSheet: (id) => Boolean(sheetOf(id)) });
  const res: DissectResult = { considered: targets.length, done: 0, failed: 0, errors: [], blocked: null };
  if (targets.length === 0) return res;
  const modelId = dissectModelId();
  const save = (post: LabPost, reply: DissectReply, hasTranscript: boolean, id: string, sheetPath: string | null = null) => {
    const { dissection, topics } = toDissection(reply, post.id, { modelId: id, hasTranscript, now, sheetPath });
    store.transaction(() => {
      store.dissections.upsert(dissection);
      store.topics.replaceForPost(post.id, topics);
      // a case or control moves on through the pipeline (04 5.2); caption-only rows keep their status
      const cc = store.controls.get(post.id);
      if (cc && cc.status !== 'caption_only') store.controls.setStatus(post.id, 'dissected');
    });
    res.done++;
  };
  const transcriptOf = (post: LabPost) => {
    const t = store.transcripts.get(post.id);
    return { t, has: Boolean(t && t.status === 'done' && t.text.trim()) };
  };

  // one gated run per cycle batch, like the fixture world's run log (the local CLI is uncapped; the gate still logs it)
  try {
    await gatedCall<null>(store, { provider: 'llm', line: 'llm', kind: 'dissect', actor: modelId, input: { postIds: targets.map((p) => p.id), promptVersion: DISSECT_PROMPT_VERSION }, override: deps.override, scheduled: deps.scheduled, now }, {
      dry: () => {
        for (const post of targets) {
          const { has } = transcriptOf(post);
          save(post, DissectReplySchema.parse(dryDissectionReply(post, has)), has, 'dry-fixture');
        }
        return { result: null, units: targets.length, items: targets.length };
      },
      live: async () => {
        for (const post of targets) {
          const { t, has } = transcriptOf(post);
          const sheet = sheetOf(post.id);
          const model = process.env.LAB_DISSECT_MODEL?.trim() || undefined;
          const r = sheet ? await imageRunner(buildDissectPrompt(post, t, { frames: true }), sheet, DissectReplySchema, { model }) : await runner(buildDissectPrompt(post, t), DissectReplySchema, { model });
          if (r.ok) {
            save(post, r.data, has, modelId, sheet ? sheetRelPath(post.id) : null);
            continue;
          }
          res.failed++;
          res.errors.push(`${post.id}: ${r.unavailable ? `claude CLI unavailable: ${r.error}` : r.error}`.slice(0, 300));
          // the CLI is missing: every other post would fail the same way
          if (r.unavailable) break;
        }
        if (res.done === 0) throw new Error(res.errors[0] ?? 'no dissection');
        // the local CLI bills nothing per call: 0 actual, so the meter never shows it unsettled
        return { result: null, units: res.done, actualUsd: 0, items: res.done };
      },
    });
  } catch (err) {
    if (err instanceof CapError) res.blocked = err.message;
  }
  return res;
}
