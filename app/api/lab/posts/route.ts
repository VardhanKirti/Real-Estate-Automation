import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { LabExoReasonSchema } from '@/lib/schemas';
import { writeHypothesis } from '@/lib/lab/view/sheets/post';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.discriminatedUnion('action', [
  z.object({ id: z.string().min(1), action: z.literal('flag_exogenous'), reason: LabExoReasonSchema.optional(), note: z.string().max(280).optional() }),
  z.object({ id: z.string().min(1), action: z.literal('unflag_exogenous') }),
  z.object({ id: z.string().min(1), action: z.literal('hypothesis'), text: z.string().trim().min(10, 'Write 10 to 280 characters.').max(280, 'Write 10 to 280 characters.') }),
]);

/**
 * POST /api/lab/posts (01 14.3, 21; lane V owns the route):
 *   { id, action: 'flag_exogenous', reason?, note? }  mark an outside push (04 3.10: left out of pattern maths from the next recompute)
 *   { id, action: 'unflag_exogenous' }                clear it
 *   { id, action: 'hypothesis', text }                10 to 280 chars, owned posts only
 * -> { ok }; 400 bad body; 404 unknown post; 409 sample (read only); 422 hypothesis on a tracked post.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'bad body' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const b = parsed.data;
  const post = ctx.store.posts.get(b.id);
  if (!post) return json({ ok: false, error: 'This post is no longer in the Lab.' }, 404);
  const now = new Date();
  if (b.action === 'flag_exogenous') {
    ctx.store.posts.flagExo(b.id, b.reason ?? 'other', b.note ?? null, now.toISOString());
    return json({ ok: true });
  }
  if (b.action === 'unflag_exogenous') {
    ctx.store.posts.unflagExo(b.id);
    return json({ ok: true });
  }
  if (!post.isOwned) return json({ ok: false, error: 'A hypothesis is for your own posts.' }, 422);
  writeHypothesis(ctx.store, b.id, b.text, now);
  return json({ ok: true });
}
