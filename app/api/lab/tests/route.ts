import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { LabTestKindSchema, LabTestStatusSchema } from '@/lib/schemas';
import { CreateTestBody, TestWriteError, createTest } from '@/lib/lab/ledger/tests';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/tests?kind=&status= -> { ok, tests } (06 10.7). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const kind = url.searchParams.get('kind') ? LabTestKindSchema.safeParse(url.searchParams.get('kind')) : null;
  const status = url.searchParams.get('status') ? LabTestStatusSchema.safeParse(url.searchParams.get('status')) : null;
  if ((kind && !kind.success) || (status && !status.success)) return json({ ok: false, error: 'unknown kind or status' }, 400);
  return json({ ok: true, tests: ctx.store.tests.all({ kind: kind?.data, status: status?.data }) });
}

/** POST /api/lab/tests { kind, title, hypothesis, variable, featureKey?, expectedSign?, scriptId?, platform, arms[] } -> 201 { test }. */
export async function POST(request: Request) {
  const parsed = CreateTestBody.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'bad body' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  try {
    return json({ ok: true, test: createTest(ctx.store, parsed.data, { now: new Date(), dry: Boolean(ctx.flags.dry) }) }, 201);
  } catch (err) {
    if (err instanceof TestWriteError) return json({ ok: false, error: err.message }, err.status);
    throw err;
  }
}
