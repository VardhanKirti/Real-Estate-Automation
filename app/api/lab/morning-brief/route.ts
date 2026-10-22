import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { morningBriefFor } from '@/lib/lab/radar/view';
import { composeMorningBrief } from '@/lib/lab/radar/morning-brief';
import { sendMorningBriefToWizard } from '@/lib/lab/radar/wizard';
import { labTz } from '@/lib/lab/setup/tz';
import { localParts } from '@/lib/lab/radar/util';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/morning-brief?day=YYYY-MM-DD -> MorningBriefView (default today; empty when none composed). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const day = url.searchParams.get('day');
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ ok: false, error: 'day is YYYY-MM-DD' }, 400);
  return json({ ok: true, state: ctx.store.morningBrief.latest() ? 'ok' : 'never_run', ...morningBriefFor(ctx.store, day, new Date()) });
}

const Body = z.object({ action: z.enum(['compose', 'send']) });

/** POST {action:'compose'} composes now; {action:'send'} sends today's brief to the Wizard when the switch is on. */
export async function POST(request: Request) {
  const raw = await body(request);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: 'unknown action' }, 400);
  const now = new Date();
  const tz = labTz();
  if (parsed.data.action === 'compose') {
    composeMorningBrief(ctx.store, { now, tz, dry: Boolean(ctx.flags.dry) });
    return json({ ok: true, ...morningBriefFor(ctx.store, null, now) });
  }
  const brief = ctx.store.morningBrief.get(localParts(now, tz).day);
  if (!brief) return json({ ok: false, sent: false, reason: 'No morning brief composed today.' }, 409);
  return json({ ok: true, ...sendMorningBriefToWizard(ctx.store, brief, { now, tz, dry: Boolean(ctx.flags.dry) }) });
}
