import { NextResponse } from 'next/server';
import { contentCampaigns } from '@/lib/content-campaigns';
import { QueueSpecInputSchema, addSpecTask } from '@/lib/content-production';

export const dynamic = 'force-dynamic';

/**
 * Appends a v3 spec-carrying task straight to the queue store. Used by
 * anything that already has a full fulfillment spec in hand rather than a
 * CREATE-row action key — today that is the Library's "Train new avatar"
 * card (spec: { model: 'soul_2', prompt: 'Train a new Soul: <name>' }), and
 * will be the Composer's "Queue production" footer once it lands.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = QueueSpecInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A tool, campaign, title, and spec model are required.' }, { status: 400 });
  }
  const validCampaignIds = new Set(contentCampaigns().map((c) => c.id));
  if (!validCampaignIds.has(parsed.data.campaignId)) {
    return NextResponse.json({ error: `Unknown campaign: ${parsed.data.campaignId}` }, { status: 400 });
  }
  const task = addSpecTask(parsed.data);
  return NextResponse.json({ task }, { status: 201 });
}
