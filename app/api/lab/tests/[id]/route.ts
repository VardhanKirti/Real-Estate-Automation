import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { PatchTestBody, TestWriteError, patchTest } from '@/lib/lab/ledger/tests';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/tests/[id] -> { ok, test } (06 10.7). */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const test = ctx.store.tests.get(params.id);
  if (!test) return json({ ok: false, error: 'unknown test' }, 404);
  return json({ ok: true, test });
}

/**
 * PATCH /api/lab/tests/[id] { title?, hypothesis?, notes?, status?, arms? (metrics and postId), result?, winnerArm? } -> { ok, test }.
 * result and winnerArm only for yt_test_compare; changing a variant while running answers 409. Stop = status 'abandoned'.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = PatchTestBody.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'bad body' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  try {
    return json({ ok: true, test: patchTest(ctx.store, params.id, parsed.data, new Date()) });
  } catch (err) {
    if (err instanceof TestWriteError) return json({ ok: false, error: err.message }, err.status);
    throw err;
  }
}
