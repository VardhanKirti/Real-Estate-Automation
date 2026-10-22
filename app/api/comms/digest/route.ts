import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { runAndStoreCommsDigest } from '@/lib/comms-digest-run';
import { DIGEST_SCHEDULE } from '@/lib/cron-runner';
import { foMode, sampleDigestBody } from '@/lib/fo-sample';
import { cronEnabled } from '@/lib/gates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The morning digest (pages/feature-additions.md F3).
 *
 * GET   the stored digest (the 07:00 cron writes it, so opening /inbox never
 *       re-reads every connector), its read marks, and whether the runner is
 *       on here. Reads SQLite only. No digest yet answers `digest: null`.
 * POST  build one now from the comms feed (free reads, nothing sent) and store it.
 */
export async function GET(req: Request) {
  const db = getDb();
  const latest = db.commsDigests.latest();
  const mode = foMode(req.url, latest === null);
  const cron = { enabled: cronEnabled(), schedule: DIGEST_SCHEDULE, setupHint: 'GLADOS_CRON=1 on the always-on host' };
  if (mode !== 'live') {
    const now = new Date();
    return NextResponse.json({ digest: { id: 'sample-digest', date: now.toISOString().slice(0, 10), body: sampleDigestBody(now), createdAt: now.toISOString() }, read: false, readKeys: [], cron, mode, sample: true });
  }
  if (!latest) return NextResponse.json({ digest: null, read: false, readKeys: [], cron, mode, sample: false });
  const reads = db.commsDigests.reads.forDigest(latest.id);
  return NextResponse.json({
    digest: latest,
    read: reads.some((r) => r.entryKey === ''),
    readKeys: db.commsDigests.reads.clearedKeys(),
    cron,
    mode,
    sample: false,
  });
}

export async function POST() {
  try {
    const row = await runAndStoreCommsDigest();
    return NextResponse.json({ ok: true, digest: row }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
