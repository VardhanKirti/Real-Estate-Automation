import { resolveLab } from '@/lib/lab/context';
import { json, readOnlyRefusal } from '@/lib/lab/api';
import { retentionDue } from '@/lib/lab/ledger/retention/due';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/lab/retention/run -> { ok, youtube, instagram, runs }: fetch due retention now (06 9.2). Fixtures only under Dry and Filming. */
export async function POST(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const r = await retentionDue(ctx.store, new Date(), { dry: Boolean(ctx.flags.dry) });
  return json({ ok: true, dry: Boolean(ctx.flags.dry), ...r });
}
