import { z } from 'zod';
import { LabNoveltySchema, LabRadarSourceSchema, LaunchAngleSchema } from '@/lib/schemas';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { radarView } from '@/lib/lab/radar/view';
import { runRadarNow, setSourceEnabled, addManualEvent } from '@/lib/lab/radar/run';
import { mergeEvents, renameEvent } from '@/lib/lab/radar/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/radar[?sample=1] -> RadarView (05 17.3). 200 on a blank install (`never_run`).
 * Internal: the UI reads the Radar through `/api/lab?page=radar` (01 D14).
 */
export async function GET(request: Request) {
  const sample = new URL(request.url).searchParams.get('sample') === '1';
  const ctx = resolveLab({ sample });
  const now = new Date();
  return json({ ok: true, ...radarView(ctx.store, now, { sample: ctx.flags.sample, dry: ctx.flags.dry }) });
}

const KNOWN_ACTIONS: readonly string[] = ['run', 'dismiss', 'merge', 'rename', 'add', 'novelty', 'coverage', 'angle', 'disable', 'enable'];
const Iso = z.string().refine((s) => Number.isFinite(Date.parse(s)), 'an ISO time');
const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('run'), override: z.boolean().optional() }),
  z.object({ action: z.literal('dismiss'), id: z.string().min(1), reason: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal('merge'), id: z.string().min(1), into: z.string().min(1) }),
  z.object({ action: z.literal('rename'), id: z.string().min(1), name: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal('add'), name: z.string().trim().min(1).max(60), t0: Iso.optional() }),
  z.object({ action: z.literal('novelty'), id: z.string().min(1), novelty: LabNoveltySchema }),
  z.object({ action: z.literal('coverage'), eventId: z.string().min(1), postId: z.string().min(1), keep: z.boolean() }),
  z.object({ action: z.literal('angle'), eventId: z.string().min(1), postId: z.string().min(1), angle: LaunchAngleSchema }),
  z.object({ action: z.enum(['disable', 'enable']), source: LabRadarSourceSchema }),
]);

/**
 * POST /api/lab/radar (05 17.3): run, dismiss, merge, rename, add, novelty, coverage, angle,
 * disable, enable. No `make` (idea creation is 07's `POST /api/lab/ideas {action:'from_event'}`).
 * 409 in the sample world; 402 when a paid line is at its cap and `override` is not set.
 */
export async function POST(request: Request) {
  const raw = await body(request);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const action = (raw as { action?: unknown } | null)?.action;
  const parsed = ActionSchema.safeParse(raw);
  if (!parsed.success) {
    if (typeof action !== 'string' || !KNOWN_ACTIONS.includes(action)) return json({ ok: false, error: `unknown action${typeof action === 'string' ? `: ${action}` : ''}` }, 400);
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'bad request' }, 400);
  }
  const a = parsed.data;
  const now = new Date();
  const store = ctx.store;
  try {
    switch (a.action) {
      case 'run': {
        const r = await runRadarNow(store, { now, override: a.override });
        if (r.blocked.length && !a.override) {
          const b = r.blocked[0];
          return json({ ok: false, cap: true, line: b.cap?.line ?? null, spent: b.cap?.spent ?? null, capUsd: b.cap?.cap ?? null, ...r }, 402);
        }
        return json({ ok: true, ...r });
      }
      case 'dismiss': {
        if (!store.events.setStatus(a.id, 'dismissed', { dismissReason: a.reason, at: now.toISOString() })) return json({ ok: false, error: 'No such event' }, 404);
        return json({ ok: true, event: store.events.get(a.id) });
      }
      case 'merge':
        return json({ ok: true, event: mergeEvents(store, a.id, a.into, now) });
      case 'rename':
        return json({ ok: true, event: renameEvent(store, a.id, a.name, now) });
      case 'add':
        return json({ ok: true, event: addManualEvent(store, a.name, a.t0 ? new Date(a.t0).toISOString() : null, now) }, 201);
      case 'novelty': {
        const e = store.events.get(a.id);
        if (!e) return json({ ok: false, error: 'No such event' }, 404);
        store.events.upsert({ ...e, novelty: a.novelty, noveltySource: 'manual', updatedAt: now.toISOString() });
        return json({ ok: true, event: store.events.get(a.id) });
      }
      case 'coverage':
      case 'angle': {
        const c = store.eventCoverage.forEvent(a.eventId).find((x) => x.postId === a.postId);
        if (!c) return json({ ok: false, error: 'No such coverage row' }, 404);
        if (a.action === 'coverage') store.eventCoverage.upsert({ ...c, confirmed: a.keep, computedAt: now.toISOString() });
        else store.eventCoverage.upsert({ ...c, angle: a.angle, angleSource: 'manual', computedAt: now.toISOString() });
        return json({ ok: true, coverage: store.eventCoverage.forEvent(a.eventId).find((x) => x.postId === a.postId) });
      }
      case 'disable':
      case 'enable':
        return json({ ok: true, disabled: setSourceEnabled(store, a.source, a.action === 'enable', now) });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, /No such event/.test(msg) ? 404 : 400);
  }
}
