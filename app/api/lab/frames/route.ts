import fs from 'node:fs';
import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { CapError } from '@/lib/lab/spend';
import { FRAMES_OFF_COPY, buildFramesFor, fixtureSheetPng, framesOn, resolveSheet } from '@/lib/lab/gen/frames';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/frames?post=<id>: the contact sheet image for the Post sheet's <img> (07 7.16, C16).
 * A real sheet is served from lab_dissections.sheet_path (JPEG, as ffmpeg writes it); a fixture
 * world (sample, Filming, FounderOS fixtures) has markers without files and gets a placeholder
 * PNG built in memory. 404 { ok:false } when the post has no sheet.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const postId = url.searchParams.get('post');
  if (!postId) return json({ ok: false, error: 'post is required' }, 400);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const rel = ctx.store.dissections.get(postId)?.sheetPath ?? null;
  if (!rel) return json({ ok: false }, 404);
  const abs = resolveSheet(rel);
  if (fs.existsSync(abs)) return new Response(new Uint8Array(fs.readFileSync(abs)), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=60' } });
  const fixtureWorld = ctx.flags.sample || ctx.flags.filming || Boolean(ctx.store.priors.get('__fixtures'));
  if (!fixtureWorld) return json({ ok: false }, 404);
  return new Response(new Uint8Array(fixtureSheetPng(postId)), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=60' } });
}

const PostSchema = z.object({ action: z.literal('build'), postId: z.string().min(1), override: z.boolean().optional() });

/** POST {action:'build', postId, override?} -> { ok, sheetPath }; 409 when LAB_FRAMES is not 1. */
export async function POST(request: Request) {
  const parsed = PostSchema.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: "pass action 'build' and postId" }, 400);
  if (!framesOn()) return json({ ok: false, error: FRAMES_OFF_COPY }, 409);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  try {
    const r = await buildFramesFor(ctx.store, parsed.data.postId, { override: parsed.data.override });
    return json({ ok: true, sheetPath: r.sheetPath });
  } catch (err) {
    if (err instanceof CapError) return json({ ok: false, capAsk: err.message, provider: err.provider, spent: err.spent, cap: err.cap }, 402);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, message === 'no such post' ? 404 : /ENOENT|ffmpeg|ffprobe/.test(message) ? 503 : 422);
  }
}
