import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contentCampaigns } from '@/lib/content-campaigns';
import { compilePipeline, getPipeline, validatePipeline } from '@/lib/content-pipelines';

export const dynamic = 'force-dynamic';

const RunRequestSchema = z.object({ campaignId: z.string().min(1) });

/**
 * Compiles a saved pipeline into real production-queue tasks. This is the
 * confirm step behind the cost-gated Run dialog — nothing queues, and no
 * credits are implied spent, until this route is called. Re-validates the
 * pipeline server-side even though the builder already gates saves, so a
 * pipeline that goes stale after the catalog changes still fails honestly
 * instead of queuing a broken spec.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const pipeline = getPipeline(params.id);
  if (!pipeline) return NextResponse.json({ error: `unknown pipeline: ${params.id}` }, { status: 404 });

  const parsed = RunRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'a campaignId is required' }, { status: 400 });

  const validCampaignIds = new Set(contentCampaigns().map((c) => c.id));
  if (!validCampaignIds.has(parsed.data.campaignId)) {
    return NextResponse.json({ error: `unknown campaign: ${parsed.data.campaignId}` }, { status: 400 });
  }

  const problems = validatePipeline(pipeline);
  if (problems.length > 0) return NextResponse.json({ error: 'pipeline is invalid', problems }, { status: 400 });

  const tasks = compilePipeline(pipeline, parsed.data.campaignId);
  const totalCredits = tasks.reduce((n, t) => n + t.creditEstimate, 0);
  return NextResponse.json({ tasks, totalCredits }, { status: 201 });
}
