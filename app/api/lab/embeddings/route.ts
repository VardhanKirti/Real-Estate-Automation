import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { CapError } from '@/lib/lab/spend';
import { activeEmbedder, backfill } from '@/lib/lab/gen/embed';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/embeddings -> { ok, model, dim, counts: { post, idea, comment }, total } for the active model (07 7.11). */
export async function GET(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const e = activeEmbedder({ store: ctx.store });
  const counts = { post: ctx.store.embeddings.count('post', e.model), idea: ctx.store.embeddings.count('idea', e.model), comment: ctx.store.embeddings.count('comment', e.model) };
  return json({ ok: true, sample: ctx.flags.sample, model: e.model, dim: e.dim, counts, total: counts.post + counts.idea + counts.comment });
}

const PostSchema = z.object({ action: z.literal('backfill'), override: z.boolean().optional() });

/** POST {action:'backfill', override?} -> { ok, embedded, skipped, model }; local is free, OpenAI is gated on the embed line. */
export async function POST(request: Request) {
  const parsed = PostSchema.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: "pass action 'backfill'" }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  try {
    const r = await backfill(ctx.store, { override: parsed.data.override });
    return json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof CapError) return json({ ok: false, capAsk: err.message, provider: err.provider, spent: err.spent, cap: err.cap }, 402);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
