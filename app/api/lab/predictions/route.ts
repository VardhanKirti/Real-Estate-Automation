import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { LabPredictionOriginSchema, LabPredictionStatusSchema } from '@/lib/schemas';
import { PredictionActionBody, PredictionWriteError, bodyProblem, freezePrediction, logExternal } from '@/lib/lab/ledger/freeze';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/predictions?origin=live&status=&predictor=&scriptId=&limit= -> { ok, predictions } (06 2.7). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const ctx = resolveLab({ sample: q('sample') === '1' });
  const origin = LabPredictionOriginSchema.safeParse(q('origin') ?? 'live');
  const status = q('status') ? LabPredictionStatusSchema.safeParse(q('status')) : null;
  if (!origin.success || (status && !status.success)) return json({ ok: false, error: 'origin is live or backtest; status is frozen, graded, ungradable or void' }, 400);
  const limit = Math.max(1, Math.min(1000, Number(q('limit') ?? 200) || 200));
  const predictions = ctx.store.predictions.list({ origin: origin.data, status: status?.data, predictor: q('predictor'), scriptId: q('scriptId'), limit });
  return json({ ok: true, predictions });
}

/**
 * POST /api/lab/predictions, the only write route for live predictions (06 2.7):
 *   { action:'freeze', scriptId, version, band, ratioLo?, ratioHi?, variantRanking?, hypothesis?, featureKey?, expectedSign?, note? }
 *   { action:'log_external', postId | scriptId, tool, toolLabel?, score, scaleMax, note? }
 * -> 201 PredictionWriteResponse; 400 validation; 404 unknown script, version or post; 409 { error:'already_frozen' }.
 */
export async function POST(request: Request) {
  const parsed = PredictionActionBody.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'bad body', issues: parsed.error.issues.map((i) => i.path.join('.')) }, 400);
  const problem = bodyProblem(parsed.data);
  if (problem) return json({ ok: false, error: problem }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const opts = { now: new Date(), dry: Boolean(ctx.flags.dry) };
  try {
    const res = parsed.data.action === 'freeze' ? freezePrediction(ctx.store, parsed.data, opts) : logExternal(ctx.store, parsed.data, opts);
    return json({ ok: true, ...res }, 201);
  } catch (err) {
    if (err instanceof PredictionWriteError) return json({ ok: false, error: err.code }, err.status);
    throw err;
  }
}
