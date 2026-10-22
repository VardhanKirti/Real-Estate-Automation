import { NextResponse } from 'next/server';
import { z } from 'zod';
import { probeFree } from '@/lib/creative-engine/health';
import { readHealth } from '@/lib/creative-engine/store';
import { buildHealthSnapshot } from '@/lib/creative-engine/snapshot';
import { explainArcadsError } from '@/lib/arcads/client';
import { CapError, submitModelProbe } from '@/lib/creative-engine/generate';
import { VIDEO_MODELS } from '@/lib/creative-engine/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/** Credits & Health: everything the widget shows, from stored facts only. */
export async function GET() {
  return NextResponse.json(await buildHealthSnapshot());
}

const ProbeBody = z.object({ model: z.enum(VIDEO_MODELS).optional(), override: z.boolean().optional() });

/** POST with no body: the free probes. POST {model}: the paid per-model probe (one cheapest request, recorded on delivery). */
export async function POST(request: Request) {
  const body = ProbeBody.safeParse(await request.json().catch(() => ({})));
  if (body.success && body.data.model) {
    try {
      const { run, failed } = await submitModelProbe(body.data.model, body.data.override);
      if (!run || failed.length) return NextResponse.json({ ok: false, error: failed[0]?.reason ?? 'probe did not start', kind: failed[0]?.kind ?? 'unknown' }, { status: 502 });
      return NextResponse.json({ ok: true, runId: run.id, health: readHealth() });
    } catch (err) {
      if (err instanceof CapError) return NextResponse.json({ ok: false, error: err.message, kind: 'cap' }, { status: 409 });
      const ex = explainArcadsError(err);
      return NextResponse.json({ ok: false, error: ex.message, kind: ex.kind }, { status: ex.httpStatus });
    }
  }
  const { health, credits } = await probeFree();
  return NextResponse.json({ ok: true, health, credits });
}
