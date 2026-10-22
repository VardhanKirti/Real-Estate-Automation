import { resolveLab } from '@/lib/lab/context';
import { json } from '@/lib/lab/api';
import { setupView } from '@/lib/lab/setup/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/setup[?section=<checklist|keys|sources|schedule|spend>&sample=1&scenario=<name>] -> SetupView
 * (08.3.1, with 09's planner, gates and forecastRecord). Internal: the UI reads it through
 * /api/lab/sheet?setup=. Never makes a network call (AC-08-9); never carries a raw key (AC-08-2).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1', scenario: url.searchParams.get('scenario') });
  const view = setupView(ctx.store, {
    dry: Boolean(ctx.flags.dry),
    dryLabel: ctx.flags.dryLabel ?? null,
    sample: Boolean(ctx.flags.sample),
    filming: Boolean(ctx.flags.filming),
    readOnly: ctx.readOnly,
    section: url.searchParams.get('section'),
  });
  return json({ ok: true, ...view });
}
