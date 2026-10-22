import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { CapError } from '@/lib/lab/spend';
import { engineConcept, wizardPrefill } from '@/lib/lab/ideas';
import { generateScript } from '@/lib/lab/scripts';
import { createCampaign } from '@/lib/creative-engine/store';
import { GenerateError, generateBatch } from '@/lib/lab/gen/diversity';
import { createIdea, makeFromEvent } from '@/lib/lab/gen/event-idea';
import { ideaFromSeed } from '@/lib/lab/gen/comments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ActSchema = z.union([
  z.object({
    id: z.string().min(1),
    action: z.enum(['dismiss', 'used', 'reopen', 'write_script', 'send_engine', 'ask_wizard']),
    /** Dismiss reason (feeds ranking, SPEC §4.11). */
    reason: z.string().trim().max(200).optional(),
    /** write_script: target length in seconds (default: your prior, else the niche's). */
    durationS: z.number().positive().max(1800).optional(),
    override: z.boolean().optional(),
  }),
  z.object({ action: z.literal('generate'), override: z.boolean().optional() }),
  z.object({ action: z.literal('from_event'), eventId: z.string().min(1), angle: z.string().min(1).optional(), override: z.boolean().optional() }),
  z.object({ action: z.literal('create'), title: z.unknown(), angle: z.unknown(), eventId: z.unknown().optional(), notes: z.unknown().optional() }),
  z.object({ action: z.literal('from_seed'), seedId: z.string().min(1), override: z.boolean().optional() }),
]);

const failure = (err: unknown) => {
  if (err instanceof CapError) return json({ ok: false, capAsk: err.message, provider: err.provider, spent: err.spent, cap: err.cap }, 402);
  const message = err instanceof Error ? err.message : String(err);
  return json({ ok: false, error: message }, /not on this host/.test(message) ? 503 : 502);
};

/**
 * POST /api/lab/ideas: every user action that creates an idea (07 7.4, 7.16) plus the v1 card actions.
 *   generate                                   07 7.3 diversity engine: 24 written, the 10 most different kept
 *   from_event {eventId, angle?}               Make this (07 7.4.2): {ideaId, href, existing}; 422 under 2 breakouts
 *   create {title, angle, eventId?, notes?}    New idea (07 7.4.3): no model call
 *   from_seed {seedId}                         an audience question as an idea (07 7.13.5)
 *   dismiss {reason} · used · reopen           status changes (the reason feeds ranking)
 *   write_script {durationS?}                  a gated draft through lib/lab/scripts.ts
 *   send_engine · ask_wizard                   hand-offs; the Wizard prefill is never sent
 * Every model call goes through the spend gate; dry and Filming make none; the sample answers 409.
 */
export async function POST(request: Request) {
  const raw = await body(request);
  const parsed = ActSchema.safeParse(raw);
  if (!parsed.success) {
    const action = (raw as { action?: unknown } | null)?.action;
    if (action === 'from_event') return json({ ok: false, error: 'pass eventId (and optionally angle)' }, 400);
    return json({ ok: false, error: 'pass an action: generate, from_event, create, from_seed; or id and one of dismiss, used, reopen, write_script, send_engine, ask_wizard' }, 400);
  }
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const a = parsed.data;
  if (a.action === 'generate') {
    try {
      const r = await generateBatch(ctx.store, { override: a.override });
      return json({ ok: true, dry: ctx.flags.dry, by: r.by, added: r.added, outcome: r.outcome, runIds: r.runIds, line: r.line });
    } catch (err) {
      if (err instanceof GenerateError) return json({ ok: false, error: err.unavailable ? 'The claude CLI is not on this host. Generate needs it.' : err.message, outcome: err.outcome }, err.unavailable ? 503 : 502);
      return failure(err);
    }
  }
  if (a.action === 'from_event') {
    try {
      const r = await makeFromEvent(ctx.store, { eventId: a.eventId, angle: a.angle ?? null }, { override: a.override });
      return r.ok ? json({ ok: true, ideaId: r.ideaId, href: r.href, existing: r.existing }) : json({ ok: false, error: r.error }, r.status);
    } catch (err) {
      return failure(err);
    }
  }
  if (a.action === 'create') {
    const r = createIdea(ctx.store, { title: a.title, angle: a.angle, eventId: a.eventId, notes: a.notes });
    return r.ok ? json({ ok: true, ideaId: r.ideaId, href: r.href }) : json({ ok: false, error: r.error }, r.status);
  }
  if (a.action === 'from_seed') {
    try {
      const r = await ideaFromSeed(ctx.store, a.seedId, { override: a.override });
      return r.ok ? json({ ok: true, idea: r.idea, existing: r.existing, ideaId: r.idea.id, href: `/lab/studio?idea=${encodeURIComponent(r.idea.id)}` }) : json({ ok: false, error: r.error }, r.status);
    } catch (err) {
      return failure(err);
    }
  }
  const idea = ctx.store.ideas.get(a.id);
  if (!idea) return json({ ok: false, error: 'no such idea' }, 404);
  const clusterLabel = idea.clusterId ? (ctx.store.clusters.all().find((c) => c.id === idea.clusterId)?.label ?? null) : null;
  switch (a.action) {
    case 'dismiss':
      ctx.store.ideas.setStatus(idea.id, 'dismissed', { reason: a.reason ?? null });
      break;
    case 'used':
      ctx.store.ideas.setStatus(idea.id, 'used');
      break;
    case 'reopen':
      ctx.store.ideas.setStatus(idea.id, 'open');
      break;
    case 'write_script':
      try {
        const r = await generateScript(ctx.store, idea.id, { durationS: a.durationS, override: a.override });
        return json({ ok: true, dry: ctx.flags.dry, scriptId: r.scriptId, href: `/lab?script=${encodeURIComponent(r.scriptId)}`, gatePassed: r.version.gate.passed, attempts: r.attempts });
      } catch (err) {
        return failure(err);
      }
    case 'send_engine': {
      // a local write into the Engine's own store (no paid call); Engine angles never flow back as Lab evidence
      const campaign = createCampaign(engineConcept(idea, clusterLabel));
      return json({ ok: true, campaignId: campaign.id, href: '/creative-engine' });
    }
    case 'ask_wizard':
      return json({ ok: true, wizard: wizardPrefill(idea, clusterLabel) });
  }
  return json({ ok: true, idea: ctx.store.ideas.get(idea.id) });
}
