import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BUILTIN_PRESETS } from '@/lib/creative-engine/compose';
import { ConsoleControlsSchema } from '@/lib/creative-engine/schemas';
import { readPresets, writePresets } from '@/lib/creative-engine/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ ok: true, presets: [...BUILTIN_PRESETS, ...readPresets()] });
}

const Body = z.object({ name: z.string().min(1).max(60), controls: ConsoleControlsSchema.partial() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const preset = { id: `pre-${randomUUID().slice(0, 6)}`, name: parsed.data.name, builtin: false, controls: parsed.data.controls, at: new Date().toISOString() };
  writePresets([preset, ...readPresets()]);
  return NextResponse.json({ ok: true, preset });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  writePresets(readPresets().filter((p) => p.id !== id));
  return NextResponse.json({ ok: true });
}
