import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildBrief } from '@/lib/creative-engine/briefs';
import { failRun, finishRun, startRun } from '@/lib/creative-engine/runs';
import { mutateCampaign, readCampaign } from '@/lib/creative-engine/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ campaignId: z.string(), scriptId: z.string(), version: z.number().int().min(1).optional() });

/** A brief from an approved (or latest) script version. Deterministic, no model. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const campaign = readCampaign(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  const script = campaign.scripts.find((s) => s.id === parsed.data.scriptId);
  if (!script) return NextResponse.json({ ok: false, error: 'script not found' }, { status: 404 });
  const n = parsed.data.version ?? script.approvedVersion ?? script.versions.at(-1)?.n;
  const version = script.versions.find((v) => v.n === n);
  const angle = campaign.angles.find((a) => a.id === script.angleId);
  if (!version || !angle) return NextResponse.json({ ok: false, error: 'no version or angle to brief' }, { status: 409 });
  const run = startRun({ campaignId: campaign.id, kind: 'brief', title: `Brief · ${angle.title.slice(0, 40)}` });
  try {
    const brief = buildBrief(campaign, script, version, angle);
    const updated = mutateCampaign(campaign.id, (c) => ({ ...c, briefs: [...c.briefs.filter((b) => b.scriptId !== script.id), brief] }));
    finishRun(run.id, { outputRef: `campaign:${campaign.id}#brief:${brief.id}` });
    return NextResponse.json({ ok: true, campaign: updated, briefId: brief.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'brief failed';
    failRun(run.id, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
