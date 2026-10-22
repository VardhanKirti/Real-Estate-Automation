import { NextResponse } from 'next/server';
import { z } from 'zod';
import { newScript, writeScript } from '@/lib/creative-engine/scripts';
import { FRAMEWORKS, ScriptControlsSchema } from '@/lib/creative-engine/schemas';
import { failRun, finishRun, startRun } from '@/lib/creative-engine/runs';
import { mutateCampaign, readCampaign } from '@/lib/creative-engine/store';
import { isDry } from '@/lib/creative-engine/dry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const Body = z.object({ campaignId: z.string(), angleId: z.string(), framework: z.enum(FRAMEWORKS), controls: ScriptControlsSchema.partial().default({}) });

/** Create a script for a selected angle and write its first version. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const { campaignId, angleId, framework } = parsed.data;
  const controls = ScriptControlsSchema.parse(parsed.data.controls);
  const campaign = readCampaign(campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  const angle = campaign.angles.find((a) => a.id === angleId);
  if (!angle) return NextResponse.json({ ok: false, error: 'angle not found' }, { status: 404 });
  const script = newScript(angle.id, framework, controls);
  const run = startRun({ campaignId, kind: 'script', title: `Script · ${angle.title.slice(0, 40)}`, outputRef: `campaign:${campaignId}#script:${script.id}`, dry: isDry() });
  try {
    const { version } = await writeScript(campaign, angle, framework, controls);
    const updated = mutateCampaign(campaignId, (c) => ({ ...c, scripts: [...c.scripts, { ...script, versions: [{ ...version, n: 1 }] }] }));
    finishRun(run.id);
    return NextResponse.json({ ok: true, campaign: updated, scriptId: script.id, runId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'script failed';
    failRun(run.id, message);
    return NextResponse.json({ ok: false, error: message, runId: run.id }, { status: /not present/i.test(message) ? 503 : 502 });
  }
}
