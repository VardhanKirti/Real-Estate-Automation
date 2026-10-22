import { resolveLab } from '@/lib/lab/context';
import { json, readOnlyRefusal } from '@/lib/lab/api';
import { TestWriteError, judgeTest } from '@/lib/lab/ledger/tests';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/lab/tests/[id]/judge -> { ok, test } (trial_reels only; 400 otherwise; 06 10.3). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  try {
    return json({ ok: true, test: judgeTest(ctx.store, params.id, new Date()) });
  } catch (err) {
    if (err instanceof TestWriteError) return json({ ok: false, error: err.message }, err.status);
    throw err;
  }
}
