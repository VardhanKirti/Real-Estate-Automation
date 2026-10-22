import { resolveLab } from '@/lib/lab/context';
import { json } from '@/lib/lab/api';
import { CapError } from '@/lib/lab/spend';
import { askView } from '@/lib/lab/gen/view';
import { ASK_MAX_LIMIT } from '@/lib/lab/gen/ask';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/ask?q=<1 to 300 chars>[&limit=1..48][&sample=1] -> { ok, ask: AskView } (07 7.12).
 * Internal: the UI reads Ask through /api/lab/sheet?ask=. Deterministic, no LLM call; a query is
 * embedded locally (free) unless the OpenAI embedder is on, which is gated on the embed line.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return json({ ok: false, error: 'q is required' }, 400);
  if (q.length > 300) return json({ ok: false, error: 'q is at most 300 characters' }, 400);
  const limitRaw = Number(url.searchParams.get('limit') ?? '');
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= ASK_MAX_LIMIT ? limitRaw : undefined;
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  try {
    const ask = await askView(ctx.store, q, { limit, dry: ctx.flags.dry, sample: ctx.flags.sample, readOnly: ctx.readOnly });
    return json({ ok: true, sample: ctx.flags.sample, ask });
  } catch (err) {
    if (err instanceof CapError) return json({ ok: false, capAsk: err.message, provider: err.provider, spent: err.spent, cap: err.cap }, 402);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
