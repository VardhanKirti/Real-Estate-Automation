import { z } from 'zod';
import type { WizardUsage } from './store';

/**
 * The Wizard's engine — one exchange against the local `claude` binary.
 * `--output-format json` returns an envelope carrying the reply, the
 * session id (spike-proven 2026-09-15), the model, usage and cost, so a
 * project that stores session_id genuinely resumes the same session next
 * message. Honest degrade: `unavailable` when the binary is missing/times out.
 */

const EnvelopeSchema = z
  .object({
    result: z.string(),
    session_id: z.string().optional(),
    modelUsage: z.record(z.string(), z.unknown()).optional(),
    usage: z
      .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
      .passthrough()
      .optional(),
    total_cost_usd: z.number().optional(),
    duration_ms: z.number().optional(),
    num_turns: z.number().optional(),
  })
  .passthrough();

export type WizardExchange =
  | { ok: true; text: string; sessionId: string | null; model: string | null; usage: WizardUsage | null }
  | { ok: false; unavailable: boolean; error: string };

export async function wizardExchange(
  prompt: string,
  systemAppend: string,
  sessionId?: string | null,
  timeoutMs = 120_000,
): Promise<WizardExchange> {
  const { execFile } = await import('node:child_process');
  const args = ['-p', prompt, '--output-format', 'json', '--append-system-prompt', systemAppend];
  if (sessionId) args.push('--resume', sessionId);
  return new Promise((resolve) => {
    execFile('claude', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const unavailable = code === 'ENOENT' || code === 'ETIMEDOUT' || /command not found/i.test(String(stderr));
        resolve({ ok: false, unavailable, error: (stderr || err.message).slice(0, 300) });
        return;
      }
      try {
        const env = EnvelopeSchema.parse(JSON.parse(stdout.trim()));
        // modelUsage can list helper models too — the one that wrote the reply is the one with the most output.
        const model = env.modelUsage
          ? (Object.entries(env.modelUsage)
              .map(([k, v]) => [k, Number((v as { outputTokens?: number } | null)?.outputTokens ?? 0)] as const)
              .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
          : null;
        const usage: WizardUsage | null = env.usage
          ? {
              inputTokens: env.usage.input_tokens ?? 0,
              outputTokens: env.usage.output_tokens ?? 0,
              costUsd: env.total_cost_usd ?? 0,
              durationMs: env.duration_ms ?? 0,
              turns: env.num_turns ?? 0,
            }
          : null;
        resolve({ ok: true, text: env.result, sessionId: env.session_id ?? null, model, usage });
      } catch {
        const text = stdout.trim();
        if (text) resolve({ ok: true, text, sessionId: null, model: null, usage: null });
        else resolve({ ok: false, unavailable: false, error: 'empty reply from claude' });
      }
    });
  });
}

/** `claude --version`, 2 s timeout — for the Sessions tab engine card. */
let engineCache: { at: number; value: { present: boolean; version: string | null } } | null = null;
export async function engineStatus(): Promise<{ present: boolean; version: string | null }> {
  if (engineCache && Date.now() - engineCache.at < 60_000) return engineCache.value;
  const { execFile } = await import('node:child_process');
  const value = await new Promise<{ present: boolean; version: string | null }>((resolve) => {
    execFile('claude', ['--version'], { timeout: 2_000 }, (err, stdout) => {
      if (err) resolve({ present: false, version: null });
      else resolve({ present: true, version: stdout.trim().split('\n')[0] || null });
    });
  });
  engineCache = { at: Date.now(), value };
  return value;
}
