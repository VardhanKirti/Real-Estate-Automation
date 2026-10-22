import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runResearch } from '@/lib/creative-engine/research';
import { DEPTHS, DEPTH_BUDGET } from '@/lib/creative-engine/schemas';
import { failRun, finishRun, startRun } from '@/lib/creative-engine/runs';
import { mutateCampaign, readCampaign } from '@/lib/creative-engine/store';
import { isDry } from '@/lib/creative-engine/dry';
import { createForeplayClient } from '@/lib/foreplay/client';
import { filmingMode } from '@/lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const Body = z.object({ campaignId: z.string(), depth: z.enum(DEPTHS).default('standard') });

/** Research: AI plans the probes → Foreplay answers → duplicates → pool. Explicit credit spend, capped by depth. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'campaignId required' }, { status: 400 });
  const campaign = readCampaign(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  if (!isDry() && !createForeplayClient()) {
    return NextResponse.json({ ok: false, error: 'Foreplay not configured — set FOREPLAY_API_KEY in .env.local', setup: 'foreplay' }, { status: 503 });
  }
  const run = startRun({ campaignId: campaign.id, kind: 'research', title: `Research · ${parsed.data.depth} · ${campaign.name.slice(0, 40)}`, outputRef: `campaign:${campaign.id}#research`, dry: isDry() });
  try {
    const research = await runResearch(campaign, parsed.data.depth);
    const updated = mutateCampaign(campaign.id, (c) => ({ ...c, research, angles: [], scripts: c.scripts, adsWanted: 0, origin: researchOrigin(c.origin) }));
    finishRun(run.id, { foreplay: { apiCalls: research.apiCalls } });
    return NextResponse.json({ ok: true, campaign: updated, budget: DEPTH_BUDGET[parsed.data.depth], runId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'research failed';
    failRun(run.id, message);
    return NextResponse.json({ ok: false, error: message, runId: run.id }, { status: 502 });
  }
}

/** S03 FR-1/FR-5: research decides provenance. A live run makes the campaign live; a dry one marks it dry; Filming keeps its own. */
function researchOrigin(current: 'live' | 'dry' | 'filming'): 'live' | 'dry' | 'filming' {
  if (filmingMode()) return current;
  return isDry() ? 'dry' : 'live';
}
