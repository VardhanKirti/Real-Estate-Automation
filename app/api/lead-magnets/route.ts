import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/data';
import { trakyoKey } from '@/lib/connectors/trakyo';
import { foMode, sampleLeadMagnets } from '@/lib/fo-sample';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { leadMagnetsView } from '@/lib/lead-magnets';
import { LeadMagnetInputSchema, LeadMagnetStatusSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Lead magnets (pages/lead-magnets.md §2). GET lists them (`?status=` filters)
 * with the derived figures; it reads SQLite only. POST registers one; the
 * content-gen skill posts the same body (LM-4):
 *   { name, offer?, liveUrl (https), destination: email|booking, campaign?,
 *     status?: draft|live|paused|archived, wentLiveAt?: YYYY-MM-DD, notes? }
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawStatus = url.searchParams.get('status');
  const status = rawStatus ? LeadMagnetStatusSchema.safeParse(rawStatus) : null;
  if (status && !status.success) return NextResponse.json({ error: 'status must be draft, live, paused or archived' }, { status: 400 });
  const db = getDb();
  const all = db.leadMagnets.all();
  const mode = foMode(req.url, all.length === 0);
  const source = mode === 'live' ? all : sampleLeadMagnets();
  const magnets = status?.success ? source.filter((m) => m.status === status.data) : source;
  const view = leadMagnetsView(source, { trakyoConfigured: mode === 'live' && Boolean(trakyoKey()), trakyoSetupHref: setupHrefFor('trakyo') });
  return NextResponse.json({ magnets, view, mode, sample: mode !== 'live' });
}

export async function POST(req: Request) {
  const parsed = LeadMagnetInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid lead magnet', issues: parsed.error.flatten() }, { status: 400 });
  const now = new Date().toISOString();
  const magnet = getDb().leadMagnets.insert({ ...parsed.data, id: randomUUID(), createdAt: now, updatedAt: now });
  return NextResponse.json({ ok: true, magnet }, { status: 201 });
}
