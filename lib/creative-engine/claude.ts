import type { ZodTypeAny, z } from 'zod';
import { extractReplyText } from '@/app/api/workflows/draft/logic';

/**
 * Strict-JSON exchanges with the local `claude` CLI, the same engine the
 * rest of Adpilot uses (app/api/adscout/*). One retry that feeds the parse
 * error back, copied from the workflows draft logic. Never throws: an
 * absent binary, a timeout, or two bad replies all come back as
 * `{ ok: false }` for the caller to degrade against honestly.
 */

export type ClaudeJson<T> = { ok: true; data: T } | { ok: false; unavailable: boolean; error: string };

async function run(prompt: string, timeoutMs: number, model?: string): Promise<{ ok: true; stdout: string } | { ok: false; unavailable: boolean; error: string }> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = execFile(
      'claude',
      ['-p', prompt, '--output-format', 'json', '--max-turns', '1', ...(model ? ['--model', model] : [])],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          const unavailable = code === 'ENOENT' || /command not found/i.test(String(stderr));
          resolve({ ok: false, unavailable, error: (stderr?.trim() || err.message).slice(0, 400) });
          return;
        }
        resolve({ ok: true, stdout });
      },
    );
    child.on('error', (err) => resolve({ ok: false, unavailable: true, error: err.message }));
  });
}

function stripFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

export function parseJsonReply<S extends ZodTypeAny>(stdout: string, schema: S): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  const text = stripFence(extractReplyText(stdout));
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `reply was not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.message.slice(0, 600) };
  return { ok: true, data: parsed.data };
}

export async function claudeJson<S extends ZodTypeAny>(prompt: string, schema: S, opts: { timeoutMs?: number; retry?: boolean; model?: string } = {}): Promise<ClaudeJson<z.infer<S>>> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const first = await run(prompt, timeoutMs, opts.model);
  if (!first.ok) return first;
  const parsed = parseJsonReply(first.stdout, schema);
  if (parsed.ok) return parsed;
  if (opts.retry === false) return { ok: false, unavailable: false, error: parsed.error };
  const second = await run(`${prompt}\n\nYour previous reply failed validation with this error:\n${parsed.error}\nReply again with ONLY corrected strict JSON — nothing else.`, timeoutMs, opts.model);
  if (!second.ok) return second;
  const again = parseJsonReply(second.stdout, schema);
  return again.ok ? again : { ok: false, unavailable: false, error: again.error };
}

export const ANTI_INVENTION_RULE =
  'Days-running-while-live is the only spend proxy available (no engagement, spend, CTR or revenue numbers exist for these ads); never invent any figure, never cite an ad id that is not in the list above.';
