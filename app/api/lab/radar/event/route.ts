import { resolveLab } from '@/lib/lab/context';
import { json } from '@/lib/lab/api';
import { eventSheetView } from '@/lib/lab/radar/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/radar/event?id=lev-... -> EventSheetView; 404 `{ error: 'No such event' }` (05 17.3). Internal. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const id = url.searchParams.get('id') ?? '';
  const view = id ? eventSheetView(ctx.store, id, new Date(), { sample: ctx.flags.sample, dry: ctx.flags.dry }) : null;
  if (!view) return json({ ok: false, error: 'No such event' }, 404);
  return json({ ok: true, ...view });
}
