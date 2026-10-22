import { resolveLab } from '@/lib/lab/context';
import { body, json } from '@/lib/lab/api';
import { ALL_HEALTH_IDS, healthResults, isNetworkCheck, runNetworkCheck } from '@/lib/lab/setup/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/lab/setup/health { id } (08.4.1, "Check again"; 09 adds `apify.prices`, which forces
 * a price book refresh). A network check runs once (free; `dry` in dry, no call); a local check is
 * recomputed. Returns the result.
 */
export async function POST(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  if (ctx.readOnly) return json({ ok: false, error: 'read_only' }, 409);
  const b = (await body(request)) as { id?: unknown } | null;
  const id = typeof b?.id === 'string' ? b.id : '';
  if (!(ALL_HEALTH_IDS as readonly string[]).includes(id)) return json({ ok: false, error: 'unknown_check' }, 400);
  if (isNetworkCheck(id)) {
    if (id === 'apify.prices') for (const p of ctx.store.priors.byPrefix('pricing:')) ctx.store.priors.set({ ...p, value: { ...(p.value as object), fetchedAt: null } });
    return json({ ok: true, result: await runNetworkCheck(ctx.store, id) });
  }
  return json({ ok: true, result: healthResults(ctx.store).find((h) => h.id === id) ?? null });
}
