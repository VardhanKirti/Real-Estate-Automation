import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ActSchema = z.object({ id: z.string().min(1), action: z.enum(['accept', 'dismiss']) });

/** POST /api/lab/suggestions — accept (it becomes tracked) or dismiss (never suggested again, SPEC §4.8). */
export async function POST(request: Request) {
  const parsed = ActSchema.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: 'pass id and action (accept or dismiss)' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const s = ctx.store.sources.get(parsed.data.id);
  if (!s || s.kind !== 'suggested') return json({ ok: false, error: 'no such suggestion' }, 404);
  if (parsed.data.action === 'accept') ctx.store.sources.setKind(s.id, 'tracked');
  else ctx.store.sources.setStatus(s.id, 'dismissed');
  return json({ ok: true, source: ctx.store.sources.get(s.id) });
}
