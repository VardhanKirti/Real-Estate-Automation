import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { PredictionWriteError, voidPrediction } from '@/lib/lab/ledger/freeze';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VoidBody = z.object({ reason: z.string().min(3).max(280) });

/** POST /api/lab/predictions/[id]/void { reason } -> { ok, prediction }; 404 unknown, 409 already void, 400 on a backtest row (06 2.7). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const parsed = VoidBody.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: 'give a reason of 3 to 280 characters' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  try {
    return json({ ok: true, prediction: voidPrediction(ctx.store, params.id, parsed.data.reason, new Date()) });
  } catch (err) {
    if (err instanceof PredictionWriteError) return json({ ok: false, error: err.code }, err.status);
    throw err;
  }
}
