import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readWorkflow, readWorkflowVersions, writeWorkflowVersion } from '@/lib/creative-engine/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A workflow's saved versions, newest first (S05b FR-63). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!readWorkflow(params.id)) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, versions: readWorkflowVersions(params.id) });
}

const Body = z.object({ note: z.string().max(120).optional() });

/** Save version: snapshot the design as stored now. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const w = readWorkflow(params.id);
  if (!w) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const version = writeWorkflowVersion(w, { note: parsed.data.note, reason: 'save' });
  return NextResponse.json({ ok: true, version, versions: readWorkflowVersions(params.id) });
}
