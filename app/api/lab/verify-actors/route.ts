import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { CapError } from '@/lib/lab/spend';
import { liveApifyClient } from '@/lib/lab/apify-live';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { actorReports, planVerification, startActorVerification } from '@/lib/lab/measure/actors';
import { runRow } from '@/lib/lab/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Schema = z.object({ override: z.boolean().optional() });

/**
 * POST /api/lab/verify-actors {override?} -> { runs, pending } (04 2.3). One tiny run per actor on
 * the owned handles only, on line `apify.verify` (default cap $1). Live runs are advanced on read
 * like any run and file their report into lab_priors `actor_fields`; dry and Filming file fixture
 * reports at once. Past the cap: 402 `{capAsk, spent, cap, line}`.
 */
export async function POST(request: Request) {
  const parsed = Schema.safeParse((await body(request)) ?? {});
  if (!parsed.success) return json({ ok: false, error: 'override must be true or false' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const dry = Boolean(ctx.flags.dry);
  if (!ctx.flags.configured && !dry) return json({ ok: false, error: 'Apify is not configured', setupHref: ctx.flags.setupHref }, 409);
  if (planVerification(ctx.store.sources.all('owned')).length === 0) return json({ ok: false, error: 'Add your own accounts first: the check reads only your posts' }, 409);
  try {
    const token = dry ? undefined : resolveApifyToken();
    const runs = await startActorVerification(ctx.store, token ? liveApifyClient(token) : null, { override: parsed.data.override });
    const pending = runs.filter((r) => r.status === 'running').length;
    return json({ ok: true, dry, runs: runs.map(runRow), pending, reports: actorReports(ctx.store) });
  } catch (err) {
    if (err instanceof CapError) return json({ ok: false, capAsk: err.message, spent: err.spent, cap: err.cap, line: err.line ?? 'apify.verify' }, 402);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
