/**
 * `claudeJsonWithImage` (07 7.14.4): the dissect call with a contact sheet, through the same
 * local `claude` CLI v1 uses. Primary path: stream-json input with one user message holding a
 * base64 image block and the prompt. Fallback, only when the primary fails on the input format:
 * the prompt names the sheet's absolute path and the CLI may Read inside that one directory.
 * Which path this host's CLI takes is LC-07-9. Never throws: failures come back as `{ ok: false }`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ZodTypeAny, z } from 'zod';
import { parseJsonReply, type ClaudeJson } from '@/lib/creative-engine/claude';

export type SpawnLike = (cmd: string, args: string[], stdin: string | null, timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string; spawnError: string | null }>;

const defaultSpawn: SpawnLike = async (cmd, args, stdin, timeoutMs) => {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, spawnError: err.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, spawnError: null });
    });
    if (stdin !== null) child.stdin.end(stdin);
    else child.stdin.end();
  });
};

const stripFence = (t: string) => {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : t).trim();
};

/** The final `{"type":"result"}` line's `result` text, or null. */
export function streamResult(stdout: string): string | null {
  let out: string | null = null;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t) as { type?: string; result?: unknown };
      if (o.type === 'result' && typeof o.result === 'string') out = o.result;
    } catch {
      /* partial line */
    }
  }
  return out;
}

export function imageMessage(prompt: string, b64: string, mediaType = 'image/jpeg'): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } }, { type: 'text', text: prompt }] } });
}

export async function claudeJsonWithImage<S extends ZodTypeAny>(prompt: string, imagePath: string, schema: S, opts: { timeoutMs?: number; model?: string; spawn?: SpawnLike } = {}): Promise<ClaudeJson<z.infer<S>> & { path?: 'primary' | 'fallback' }> {
  const run = opts.spawn ?? defaultSpawn;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const model = opts.model ? ['--model', opts.model] : [];
  let b64: string;
  try {
    b64 = fs.readFileSync(imagePath).toString('base64');
  } catch (e) {
    return { ok: false, unavailable: false, error: `no contact sheet at ${path.basename(imagePath)}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const primary = await run('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--max-turns', '1', ...model], `${imageMessage(prompt, b64)}\n`, timeoutMs);
  if (primary.spawnError) return { ok: false, unavailable: /ENOENT/.test(primary.spawnError), error: primary.spawnError };
  if (primary.code === 0) {
    const text = streamResult(primary.stdout);
    if (text !== null) {
      let candidate: unknown;
      try {
        candidate = JSON.parse(stripFence(text));
      } catch (e) {
        return { ok: false, unavailable: false, error: `reply was not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
      }
      const parsed = schema.safeParse(candidate);
      return parsed.success ? { ok: true, data: parsed.data, path: 'primary' } : { ok: false, unavailable: false, error: parsed.error.message.slice(0, 600) };
    }
  }
  const inputFormatError = /input[- ]format|stream-json|image/i.test(`${primary.stderr}\n${primary.stdout}`) || (primary.code === 0 && streamResult(primary.stdout) === null);
  if (!inputFormatError) return { ok: false, unavailable: /command not found/i.test(primary.stderr), error: (primary.stderr.trim() || `claude exited ${primary.code}`).slice(0, 400) };
  const abs = path.resolve(imagePath);
  const fallback = await run('claude', ['-p', `${prompt}\n\nThe contact sheet image is at ${abs}. Read it first.`, '--output-format', 'json', '--max-turns', '2', '--allowedTools', 'Read', '--add-dir', path.dirname(abs), ...model], null, timeoutMs);
  if (fallback.spawnError) return { ok: false, unavailable: /ENOENT/.test(fallback.spawnError), error: fallback.spawnError };
  if (fallback.code !== 0) return { ok: false, unavailable: false, error: (fallback.stderr.trim() || `claude exited ${fallback.code}`).slice(0, 400) };
  const parsed = parseJsonReply(fallback.stdout, schema);
  return parsed.ok ? { ok: true, data: parsed.data, path: 'fallback' } : { ok: false, unavailable: false, error: parsed.error };
}
