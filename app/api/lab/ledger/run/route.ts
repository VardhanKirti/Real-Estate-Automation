import { resolveLab } from '@/lib/lab/context';
import { json, readOnlyRefusal } from '@/lib/lab/api';
import { runLedgerCycle } from '@/lib/lab/ledger/job';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/lab/ledger/run -> { ok, runs } : grade, backtest and evals now (06 13.1). Dry under LAB_DRY=1 and Filming. */
export async function POST(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const { runs } = await runLedgerCycle(ctx.store, { now: new Date(), dry: Boolean(ctx.flags.dry) });
  return json({ ok: true, dry: Boolean(ctx.flags.dry), runs });
}
