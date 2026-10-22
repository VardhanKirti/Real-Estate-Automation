import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Confirm = z.object({
  /** an Attio record id, or omitted for a hand-added client (one is minted) */
  clientId: z.string().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200),
  company: z.string().max(200).optional(),
  source: z.enum(['attio', 'manual']).default('manual'),
  retainer: z.boolean().optional(),
  slackChannel: z.string().trim().max(120).nullable().optional(),
  supersetProject: z.string().trim().max(200).nullable().optional(),
});
const Unconfirm = z.object({ clientId: z.string().min(1).max(200), confirmed: z.literal(false) });

/**
 * Confirm a client, edit a confirmation, or unconfirm one (pages/clients.md
 * §4). Only confirmed clients reach the roster (CL-1). Local write only.
 *
 *   { name, source: 'manual' }                 add a client by hand
 *   { clientId, name, source: 'attio', ... }   confirm an Attio deal
 *   { clientId, retainer, slackChannel, ... }  edit (name required)
 *   { clientId, confirmed: false }             unconfirm (work rows stay)
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const db = getDb();

  const un = Unconfirm.safeParse(body);
  if (un.success) {
    if (!db.clientConfirmations.get(un.data.clientId)) return NextResponse.json({ error: 'not a confirmed client' }, { status: 404 });
    db.clientConfirmations.remove(un.data.clientId);
    return NextResponse.json({ ok: true, clientId: un.data.clientId, confirmed: false });
  }

  const parsed = Confirm.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid confirmation', issues: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  if (d.source === 'attio' && !d.clientId) return NextResponse.json({ error: 'an Attio confirmation needs the deal id (clientId)' }, { status: 400 });
  const clientId = d.clientId ?? `manual-${randomUUID()}`;
  const existing = db.clientConfirmations.get(clientId);
  const saved = db.clientConfirmations.upsert({
    clientId,
    name: d.name,
    company: d.company ?? existing?.company ?? '',
    source: existing?.source ?? d.source,
    retainer: d.retainer ?? existing?.retainer ?? false,
    slackChannel: d.slackChannel !== undefined ? d.slackChannel || null : (existing?.slackChannel ?? null),
    supersetProject: d.supersetProject !== undefined ? d.supersetProject || null : (existing?.supersetProject ?? null),
    confirmedAt: existing?.confirmedAt ?? new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, client: saved, created: !existing }, { status: existing ? 200 : 201 });
}
