import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { CapError } from '@/lib/lab/spend';
import { commentsCapCopy, intentScore, runComments } from '@/lib/lab/gen/comments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/comments?postId=<id> -> { ok, comments, intent } (07 7.13): never a hash or a handle.
 * Without postId: 200 with an empty list and the stored count (the layer's health read).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const postId = url.searchParams.get('postId');
  if (!postId) return json({ ok: true, sample: ctx.flags.sample, comments: [], total: ctx.store.comments.count(), intent: null });
  const rows = ctx.store.comments.forPost(postId, 200);
  const s = intentScore(ctx.store, postId);
  return json({
    ok: true,
    sample: ctx.flags.sample,
    comments: rows.map((c) => ({ id: c.id, text: c.text, likes: c.likes, intent: c.intent, byCreator: c.byCreator, postedAt: c.postedAt })),
    intent: { requestRate: s.requestRate, ratio: s.ratio, n: s.n, shown: s.shown, text: s.text },
  });
}

const PostSchema = z.object({ action: z.literal('run'), postIds: z.array(z.string().min(1)).max(50).optional(), override: z.boolean().optional() });

/** POST {action:'run', postIds?, override?} -> { ok, runId, runIds, posts, comments, pending }; 402 when the comments cap is 0 or reached. */
export async function POST(request: Request) {
  const parsed = PostSchema.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: "pass action 'run' (and optionally postIds)" }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  try {
    const r = await runComments(ctx.store, { postIds: parsed.data.postIds, override: parsed.data.override });
    return json({ ok: true, dry: ctx.flags.dry, runId: r.runIds[0] ?? null, runIds: r.runIds, posts: r.posts, comments: r.comments, pending: r.pending });
  } catch (err) {
    if (err instanceof CapError) return json({ ok: false, capAsk: commentsCapCopy(err), reason: err.reason, provider: err.provider, spent: err.spent, cap: err.cap }, 402);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
