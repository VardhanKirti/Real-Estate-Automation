import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { ClientWorkStatusSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  status: ClientWorkStatusSchema,
  detail: z.string().max(8000).optional(),
});

/** Status change on a work request (mark done or failed, re-queue). Local write only. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'status must be draft, queued, running, done or failed' }, { status: 400 });
  const work = getDb().clientWork.setStatus(params.id, parsed.data.status, { detail: parsed.data.detail });
  if (!work) return NextResponse.json({ error: 'unknown work request' }, { status: 404 });
  return NextResponse.json({ ok: true, work });
}
