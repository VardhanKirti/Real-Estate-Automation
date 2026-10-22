import { resolveLab } from '@/lib/lab/context';
import { json } from '@/lib/lab/api';
import { plannerGate, plannerView } from '@/lib/lab/ledger/planner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/planner -> { ok, planner: PlannerView | null, gate: { n, need } } (06 11). Closed until 20 owned posts have 72 h results. */
export async function GET(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const gate = plannerGate(ctx.store);
  return json({ ok: true, planner: gate.open ? plannerView(ctx.store, new Date()) : null, gate: { n: gate.n, need: gate.need } });
}
