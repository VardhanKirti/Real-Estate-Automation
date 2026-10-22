import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { INTEL_STEPS, runLabIntel } from '@/lib/lab/intel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RunSchema = z.object({ steps: z.array(z.enum(INTEL_STEPS)).optional(), override: z.boolean().optional() });

/**
 * POST /api/lab/intel — run the intelligence half of a cycle now (SPEC §10 phases 4-7):
 * clusters, distill, trends, feeds, ideas, priors, brain. `steps` limits it. POST only:
 * reads go through GET /api/lab. Dry/Filming makes zero paid or network calls.
 */
export async function POST(request: Request) {
  const parsed = RunSchema.safeParse((await body(request)) ?? {});
  if (!parsed.success) return json({ ok: false, error: `steps must be a list of ${INTEL_STEPS.join(', ')}` }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  if (ctx.store.isEmpty()) return json({ ok: false, error: 'Add your accounts first' }, 409);
  const report = await runLabIntel(ctx.store, { steps: parsed.data.steps, override: parsed.data.override });
  return json({ ok: report.ok, report }, report.ok ? 200 : 207);
}
