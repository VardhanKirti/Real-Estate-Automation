import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { LeadMagnetPatchSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Edit a lead magnet (status change inline, or the edit form). Validated whole. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const parsed = LeadMagnetPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid change', issues: parsed.error.flatten() }, { status: 400 });
  if (Object.keys(parsed.data).length === 0) return NextResponse.json({ error: 'nothing to change' }, { status: 400 });
  const magnet = getDb().leadMagnets.update(params.id, parsed.data);
  if (!magnet) return NextResponse.json({ error: 'unknown lead magnet' }, { status: 404 });
  return NextResponse.json({ ok: true, magnet });
}

/** Delete the record only, never the page it points at (LM-2; the UI confirms first). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!getDb().leadMagnets.remove(params.id)) return NextResponse.json({ error: 'unknown lead magnet' }, { status: 404 });
  return NextResponse.json({ ok: true, id: params.id });
}
