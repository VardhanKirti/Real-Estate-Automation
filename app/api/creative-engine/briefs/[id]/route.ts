import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutateCampaign, readCampaigns } from '@/lib/creative-engine/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ status: z.enum(['draft', 'ready', 'sent']) });

/**
 * A brief's lifecycle (SPEC S07 F24): draft, ready, sent. "Sent" means the
 * brief went to a creator or editor. Stored in the campaign JSON, so it
 * survives a reload and a restart. The sample never calls this.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'status must be draft, ready or sent' }, { status: 400 });
  const owner = readCampaigns().find((c) => c.briefs.some((b) => b.id === params.id));
  if (!owner) return NextResponse.json({ ok: false, error: 'brief not found' }, { status: 404 });
  // mutateCampaign bumps updatedAt.
  const campaign = mutateCampaign(owner.id, (c) => ({ ...c, briefs: c.briefs.map((b) => (b.id === params.id ? { ...b, status: parsed.data.status } : b)) }));
  if (!campaign) return NextResponse.json({ ok: false, error: 'brief not found' }, { status: 404 });
  return NextResponse.json({ ok: true, campaign });
}
