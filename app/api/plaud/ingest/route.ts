import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { authorizePush } from '@/lib/push-auth';
import { PlaudIngestSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Plaud recordings in (pages/feature-additions.md F4). A relay POSTs
 *   { recordings: [{ externalId, title, startedAt, durationS?, participants?, summary?, transcriptUrl? }] }
 * with `Authorization: Bearer <PLAUD_INGEST_TOKEN>` (or the operator session).
 * Upserts on (plaud, externalId), so a replay never duplicates. Validated
 * whole before any write.
 */
export async function POST(req: Request) {
  const auth = authorizePush(req, 'PLAUD_INGEST_TOKEN');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = PlaudIngestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid ingest', issues: parsed.error.flatten() }, { status: 400 });
  const repo = getDb().callRecordings;
  const ids = parsed.data.recordings.map((r) => repo.upsert({ ...r, source: 'plaud' }).id);
  return NextResponse.json({ ok: true, stored: ids.length, ids });
}
