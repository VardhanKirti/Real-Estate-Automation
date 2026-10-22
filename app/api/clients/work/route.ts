import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  clientId: z.string().min(1).max(200),
  brief: z.string().trim().min(1).max(8000),
});

/**
 * Save a draft work request for a confirmed client (pages/clients.md, CL-2):
 * one `client_work` row with status draft. No outbound call of any kind;
 * starting it in Superset is a separate, gated POST (…/[id]/launch).
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'clientId and brief are required', issues: parsed.error.flatten() }, { status: 400 });
  const db = getDb();
  if (!db.clientConfirmations.get(parsed.data.clientId)) {
    return NextResponse.json({ error: 'confirm this client first' }, { status: 404 });
  }
  const work = db.clientWork.insert({
    id: randomUUID(),
    clientId: parsed.data.clientId,
    brief: parsed.data.brief,
    status: 'draft',
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, work }, { status: 201 });
}
