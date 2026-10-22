import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { CapError, lineCapFor, lineSpend } from '@/lib/lab/spend';
import { liveApifyClient } from '@/lib/lab/apify-live';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { dueReads, planSnapshots, snapshotHitRate, startSnapshots } from '@/lib/lab/measure/scheduler';
import { runRow } from '@/lib/lab/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The `snapshots` job runs every 30 minutes inside the one tick (08.5.1). */
const TICK_MIN = 30;
const nextTick = (now: Date) => new Date(Math.ceil((now.getTime() + 1) / (TICK_MIN * 60_000)) * TICK_MIN * 60_000).toISOString();

/**
 * GET /api/lab/snapshots[?sample=1] -> { due, hitRate, nextTickAt, thinned } (04 4.2). Reads only:
 * no Apify call, no write.
 */
export async function GET(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const now = new Date();
  const plan = planSnapshots(ctx.store, now);
  return json({ ok: true, sample: ctx.flags.sample, due: dueReads(ctx.store, now), hitRate: snapshotHitRate(ctx.store, now), nextTickAt: nextTick(now), thinned: plan.thinned });
}

const PostSchema = z.object({ preview: z.boolean().optional(), override: z.boolean().optional() });

/**
 * POST /api/lab/snapshots {preview?, override?} (04 4.2). `preview` returns the plan and this month's
 * line spend and starts nothing. Otherwise one snapshot tick by hand: through the gate (line
 * `apify.snapshots`, X on `apify.x`); dry and Filming re-read fixtures. A cap stop answers 402
 * `{capAsk, spent, cap, line}`; the SpendGate re-POSTs with override to pass it once.
 */
export async function POST(request: Request) {
  const parsed = PostSchema.safeParse((await body(request)) ?? {});
  if (!parsed.success) return json({ ok: false, error: 'preview and override must be true or false' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const store = ctx.store;
  const now = new Date();
  const dry = Boolean(ctx.flags.dry);
  const plan = planSnapshots(store, now);
  const spend = { line: 'apify.snapshots', spent: lineSpend(store, 'apify.snapshots', now), cap: lineCapFor('apify.snapshots'), x: { spent: lineSpend(store, 'apify.x', now), cap: lineCapFor('apify.x') } };
  if (parsed.data.preview) return json({ ok: true, dry, plan, spend });
  if (!ctx.flags.configured && !dry) return json({ ok: false, error: 'Apify is not configured', setupHref: ctx.flags.setupHref }, 409);
  if (plan.discover.length === 0 && plan.reads.length === 0) return json({ ok: true, dry, runs: [], plan });
  try {
    const token = dry ? undefined : resolveApifyToken();
    const runs = await startSnapshots(store, token ? liveApifyClient(token) : null, plan, { override: parsed.data.override, scheduled: false, now });
    return json({ ok: true, dry, runs: runs.map(runRow), pending: runs.filter((r) => r.status === 'running').length, plan });
  } catch (err) {
    if (err instanceof CapError) return json({ ok: false, capAsk: err.message, spent: err.spent, cap: err.cap, line: err.line ?? 'apify.snapshots' }, 402);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
