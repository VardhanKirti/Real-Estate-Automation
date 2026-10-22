import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateAngles } from '@/lib/creative-engine/angles';
import { failRun, finishRun, startRun } from '@/lib/creative-engine/runs';
import { mutateCampaign, readCampaign } from '@/lib/creative-engine/store';
import { isDry } from '@/lib/creative-engine/dry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const Body = z.object({ campaignId: z.string() });

/** Angles grounded on the research pool; every angle cites real ad ids or is dropped. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'campaignId required' }, { status: 400 });
  const campaign = readCampaign(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  if (!campaign.research || campaign.research.pool.length === 0) return NextResponse.json({ ok: false, error: 'run research first' }, { status: 409 });
  const run = startRun({ campaignId: campaign.id, kind: 'angles', title: `Angles · ${campaign.name.slice(0, 40)}`, outputRef: `campaign:${campaign.id}#angles`, dry: isDry() });
  try {
    const { angles, dropped, by } = await generateAngles(campaign);
    const updated = mutateCampaign(campaign.id, (c) => ({ ...c, angles, adsWanted: 0 }));
    finishRun(run.id);
    return NextResponse.json({ ok: true, campaign: updated, dropped, by, runId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'angle generation failed';
    failRun(run.id, message);
    const unavailable = /not present/i.test(message);
    return NextResponse.json({ ok: false, error: message, runId: run.id }, { status: unavailable ? 503 : 502 });
  }
}
