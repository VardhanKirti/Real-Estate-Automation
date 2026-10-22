import { resolveLab } from '@/lib/lab/context';
import { json } from '@/lib/lab/api';
import { ledgerView } from '@/lib/lab/ledger/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/ledger[?sample=1] -> { ok, ...LedgerView } (06 13.1). Internal and CLI; the page reads /api/lab?page=ledger. */
export async function GET(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const view = ledgerView(ctx.store, { now: new Date(), dry: Boolean(ctx.flags.dry) && !ctx.flags.filming, filming: Boolean(ctx.flags.filming), sample: Boolean(ctx.flags.sample) });
  return json({ ok: true, ...view });
}
