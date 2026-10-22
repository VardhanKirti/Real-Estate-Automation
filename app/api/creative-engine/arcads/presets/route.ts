import { NextResponse } from 'next/server';
import { createArcadsClient, explainArcadsError } from '@/lib/arcads/client';
import { isDry } from '@/lib/creative-engine/dry';
import { readCache, writeCache } from '@/lib/creative-engine/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPES = ['camera-movement', 'gestures', 'showyourapp', 'unboxing-pov', 'gameplay-ad'];

/** Preset templates for one preset type (the situations a preset node can pick), cached ten minutes. */
export async function GET(request: Request) {
  const type = new URL(request.url).searchParams.get('type') ?? 'gestures';
  if (!TYPES.includes(type)) return NextResponse.json({ ok: false, error: 'unknown preset type' }, { status: 400 });
  if (isDry()) return NextResponse.json({ ok: true, state: 'dry', templates: [{ id: `dry-${type}-1`, tags: ['dry fixture'], imageUrl: '', previewUrl: '', talkingActorEnabled: false }] });
  const client = createArcadsClient();
  if (!client) return NextResponse.json({ ok: true, state: 'not_configured', templates: [] });
  const cached = readCache<unknown[]>(`presets-${type}`, 10 * 60_000);
  if (cached) return NextResponse.json({ ok: true, state: 'connected', templates: cached });
  try {
    const templates = await client.presetTemplates(type);
    writeCache(`presets-${type}`, templates);
    return NextResponse.json({ ok: true, state: 'connected', templates });
  } catch (err) {
    return NextResponse.json({ ok: true, state: 'error', error: explainArcadsError(err).message, templates: [] });
  }
}
