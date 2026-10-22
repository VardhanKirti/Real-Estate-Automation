import { NextResponse } from 'next/server';
import { ConceptSchema } from '@/lib/creative-engine/schemas';
import { createCampaign, readCampaigns } from '@/lib/creative-engine/store';
import { isDry } from '@/lib/creative-engine/dry';
import { toSummary } from '@/lib/creative-engine/pick';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Campaign list (newest first, summaries only) and creation from a concept. */
export async function GET() {
  const campaigns = readCampaigns().map(toSummary);
  return NextResponse.json({ ok: true, dry: isDry(), campaigns });
}

export async function POST(request: Request) {
  const parsed = ConceptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'a concept (3-300 chars) is required' }, { status: 400 });
  const campaign = createCampaign(parsed.data);
  return NextResponse.json({ ok: true, campaign });
}
