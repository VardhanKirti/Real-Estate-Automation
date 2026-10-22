import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { MANUAL_STEP_IDS } from '@/lib/system-setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  id: z.enum(MANUAL_STEP_IDS),
  done: z.boolean(),
});

/** Manual check-off for the few setup steps no code can verify. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const db = getDb();
  if (parsed.data.done) db.setupChecks.set(parsed.data.id, new Date().toISOString());
  else db.setupChecks.unset(parsed.data.id);
  return NextResponse.json({ ok: true });
}
