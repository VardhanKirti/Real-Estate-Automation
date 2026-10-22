import { NextResponse } from 'next/server';
import { contentCampaigns } from '@/lib/content-campaigns';
import {
  CreateTaskInputSchema,
  QueueSpecInputSchema,
  addSpecTask,
  addTask,
  productionTasks,
} from '@/lib/content-production';

export const dynamic = 'force-dynamic';

/** The current queue, statuses derived against the media manifest. */
export async function GET() {
  return NextResponse.json({ tasks: productionTasks() });
}

/**
 * Appends a real task to the production queue store. Accepts either the v3
 * Composer submission (a `spec` field — the full fulfillment contract) or
 * the legacy free-text CREATE-row submission (an `inputs` field), so the
 * old surface keeps working while the Composer ships the honest spec path.
 * Either way the new task is on disk (data/content-queue.json) before this
 * returns, so the very next render shows it in the queue.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const validCampaignIds = new Set(contentCampaigns().map((c) => c.id));

  if (body && typeof body === 'object' && 'spec' in body) {
    const parsed = QueueSpecInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'That production spec is not valid.' }, { status: 400 });
    }
    if (!validCampaignIds.has(parsed.data.campaignId)) {
      return NextResponse.json({ error: `Unknown campaign: ${parsed.data.campaignId}` }, { status: 400 });
    }
    const task = addSpecTask(parsed.data);
    return NextResponse.json({ task }, { status: 201 });
  }

  const parsed = CreateTaskInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Fill in a title, campaign, and creative direction.' }, { status: 400 });
  }
  if (!validCampaignIds.has(parsed.data.campaignId)) {
    return NextResponse.json({ error: `Unknown campaign: ${parsed.data.campaignId}` }, { status: 400 });
  }
  const task = addTask(parsed.data);
  return NextResponse.json({ task }, { status: 201 });
}
