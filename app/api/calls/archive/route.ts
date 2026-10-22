import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { fathomKey, pullFathomMeetings } from '@/lib/connectors/fathom';
import { plaudIngestConfigured } from '@/lib/connectors/plaud';
import { foMode, sampleRecordings } from '@/lib/fo-sample';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { CallRecordingSourceSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The recordings archive (pages/feature-additions.md F4): Plaud (pushed) and
 * Fathom (pulled) in one list, newest first, `?source=plaud|fathom` filters.
 * The Fathom pull is a free read, at most once per 10 minutes per process,
 * and is upserted into call_recordings; without FATHOM_API_KEY nothing leaves
 * the box. A Fathom failure is reported per source and never blanks the list.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawSource = url.searchParams.get('source');
  const source = rawSource ? CallRecordingSourceSchema.safeParse(rawSource) : null;
  if (source && !source.success) return NextResponse.json({ error: 'source must be plaud or fathom' }, { status: 400 });
  const db = getDb();
  const mode = foMode(req.url, db.callRecordings.count() === 0 && !fathomKey());
  const sources = {
    plaud: { configured: plaudIngestConfigured(), error: null as string | null, setupHref: setupHrefFor('plaud') },
    fathom: { configured: Boolean(fathomKey()), error: null as string | null, setupHref: setupHrefFor('fathom') },
  };
  if (mode !== 'live') {
    const all = sampleRecordings();
    return NextResponse.json({ recordings: source?.success ? all.filter((r) => r.source === source.data) : all, sources, mode, sample: true });
  }
  if (sources.fathom.configured) {
    try {
      for (const m of await pullFathomMeetings()) db.callRecordings.upsert({ ...m, source: 'fathom' });
    } catch (err) {
      sources.fathom.error = err instanceof Error ? err.message : String(err);
    }
  }
  return NextResponse.json({ recordings: db.callRecordings.recent(200, source?.success ? source.data : undefined), sources, mode, sample: false });
}
