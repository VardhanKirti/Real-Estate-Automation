import { HF_MODELS } from '@/lib/higgsfield/catalog';
import { PipelineInputSchema, type PipelineInput } from '@/lib/content-pipelines';

/**
 * Everything the pipeline drafting route needs that ISN'T a route export
 * lives here, same split as app/api/workflows/draft/logic.ts (Next's route
 * type-checker rejects extra named exports from route.ts). Tests import
 * from this module and never invoke the real `claude` binary — CLI shelling
 * itself is reused verbatim from the workflow drafting route (runClaude is
 * a generic CLI wrapper with no workflow-specific coupling).
 */
export { runClaude, type CliResult } from '@/app/api/workflows/draft/logic';

/** `id (family, output kind)` for every real catalog model, so the drafting
 *  model can only ever name a model that actually exists. */
function modelList(): string {
  return HF_MODELS.map((m) => `${m.id} (${m.family}, output: ${m.output})`).join('\n');
}

export function buildPipelinePrompt(brief: string, priorError?: string): string {
  const schema = `Reply with STRICT JSON only — no prose, no markdown code fences — matching exactly this shape:
{
  "name": string,
  "description": string,
  "nodes": [
    {
      "id": string,                    // short stable slug, unique within this pipeline
      "kind": "input" | "generate" | "transform" | "output",
      "label": string,
      "model": string | null,          // REQUIRED for "generate"/"transform" — must be one of the model ids listed below; null for "input"/"output"
      "params": object,                // the model's real parameters; an optional reserved "batch" key (1-8) sets a parallel run count
      "aspectRatio": string | null,
      "duration": number | null,
      "prompt": string | null,
      "mediaBindings": [
        {
          "role": string,              // an HfMediaRole: image, start_image, end_image, image_references, video_references, audio_references, mask, input_video, input_audio
          "source": {
            "type": "upload" | "library" | "identity" | "text" | "node",
            "ref": string               // for "node": the id of an EARLIER node in this same array whose output feeds this role
          }
        }
      ],
      "inputKind": "image" | "video" | "audio" | "text" | null   // "input" nodes only — the media kind this input carries
    }
  ],
  "edges": [ { "from": string, "to": string } ]   // the visual graph — one edge per consecutive step, matching mediaBindings topology
}

Rules:
- Every "generate"/"transform" node's "model" must be one of the real model ids below — never invent one.
- A "node"-sourced mediaBinding's role kind (image/start_image/end_image/image_references = image; video_references/input_video = video; audio_references/input_audio = audio) must match the upstream node's actual output kind (an "input" node's inputKind, or a generate/transform node's model output). A text-kind input can never satisfy a media role — thread it through "params" instead (e.g. a YouTube URL into a clipify node's "urls" param), not through mediaBindings.
- "edges" must form a DAG — no cycles, and every from/to must name a real node id in "nodes".
- Keep it small: 2-5 nodes is normal. Every pipeline needs at least one "generate" or "transform" node.`;

  const base = `You are drafting a media generation pipeline (a DAG of Higgsfield model calls) for a content production tool. The operator describes the deliverable; you map it into input -> generate/transform -> output nodes.\n\nDescribe: ${brief}\n\nReal catalog models (id (family, output kind)):\n${modelList()}\n\n${schema}`;
  if (!priorError) return base;
  return `${base}\n\nYour previous reply failed validation with this error:\n${priorError}\nReply again with ONLY corrected strict JSON — nothing else.`;
}

/** Pulls the model's reply text out of a `claude -p ... --output-format
 *  json` envelope, same unwrap as the workflow drafting route. */
function extractReplyText(stdout: string): string {
  const trimmed = stdout.trim();
  try {
    const envelope = JSON.parse(trimmed);
    if (envelope && typeof envelope === 'object') {
      if (typeof (envelope as any).result === 'string') return (envelope as any).result;
      if (typeof (envelope as any).message === 'string') return (envelope as any).message;
    }
  } catch {
    // stdout wasn't a JSON envelope at all — treat it as the reply text itself
  }
  return trimmed;
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Parses + validates one CLI reply into a `PipelineInput`. Pure — no
 *  process spawning. Schema-valid only — the fuller validatePipeline graph
 *  check (acyclicity, catalog/socket typing) runs when the operator saves
 *  the draft through the normal create route, exactly like a hand-built
 *  pipeline would. */
export function parsePipelineDraft(stdout: string): { ok: true; data: PipelineInput } | { ok: false; error: string } {
  const text = stripCodeFence(extractReplyText(stdout));
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `reply was not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = PipelineInputSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, data: parsed.data };
}
