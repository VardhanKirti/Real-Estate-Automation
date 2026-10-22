import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { READ_RETENTION_DAYS } from '@/lib/comms-digest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** `entryKey` omitted = the whole digest (clears the unread dot); else one entry (lib/comms-digest.ts entryKey). */
const Body = z.object({ digestId: z.string().min(1), entryKey: z.string().max(400).optional() });

/** POST marks read; DELETE is the undo. Local writes only. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'digestId required' }, { status: 400 });
  const db = getDb();
  if (!db.commsDigests.get(parsed.data.digestId)) return NextResponse.json({ error: 'unknown digest' }, { status: 404 });
  const mark = db.commsDigests.reads.mark(parsed.data.digestId, parsed.data.entryKey ?? '');
  // Must outlive the carry window, or an answered entry would be carried back.
  db.commsDigests.reads.prune(new Date(Date.now() - READ_RETENTION_DAYS * 86_400_000).toISOString());
  return NextResponse.json({ ok: true, read: mark });
}

export async function DELETE(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'digestId required' }, { status: 400 });
  getDb().commsDigests.reads.unmark(parsed.data.digestId, parsed.data.entryKey ?? '');
  return NextResponse.json({ ok: true });
}
