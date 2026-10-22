import { z } from 'zod';
import { extractReplyText } from '@/app/api/workflows/draft/logic';

/**
 * Everything the prompt-refinement route needs that isn't a route export —
 * same split as app/api/workflows/draft/logic.ts, and it reuses that
 * module's extractReplyText/runClaude so the "shell `claude -p`, parse a
 * strict JSON envelope, degrade honestly on failure" behavior stays in one
 * place. Tests import from this module and never invoke the real CLI.
 */

export const RefineReplySchema = z.object({ prompt: z.string().min(1) });
export type RefineReply = z.infer<typeof RefineReplySchema>;

const SCHEMA_INSTRUCTIONS = `Reply with STRICT JSON only — no prose, no markdown code fences — matching exactly this shape:\n{ "prompt": string }`;

export function buildRefinePrompt(args: {
  direction: string;
  modelName: string;
  campaignBrief?: string | null;
  priorError?: string;
}): string {
  const briefLine = args.campaignBrief
    ? `\n\nCampaign brief context — stay consistent with it:\n${args.campaignBrief}`
    : '';
  const base = `You are the creative director rewriting a content generation prompt for the "${args.modelName}" model.\n\nRewrite the creative direction below into one sharp, production-ready prompt for that model — concrete and visual, no meta-commentary, no explanation of what changed.${briefLine}\n\nCurrent direction:\n${args.direction}\n\n${SCHEMA_INSTRUCTIONS}`;
  if (!args.priorError) return base;
  return `${base}\n\nYour previous reply failed validation with this error:\n${args.priorError}\nReply again with ONLY corrected strict JSON — nothing else.`;
}

/** Strips ```json … ``` / ``` … ``` fences a model sometimes wraps its reply in. */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Parses + validates one CLI reply into a RefineReply. Pure — the route's
 *  tests exercise this directly instead of mocking execFile every time. */
export function parseRefineReply(stdout: string): { ok: true; data: RefineReply } | { ok: false; error: string } {
  const text = stripCodeFence(extractReplyText(stdout));
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `reply was not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = RefineReplySchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, data: parsed.data };
}
