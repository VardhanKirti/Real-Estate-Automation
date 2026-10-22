import { NextResponse } from 'next/server';
import { z } from 'zod';
import { editedVersion, writeScript } from '@/lib/creative-engine/scripts';
import { BeatSchema } from '@/lib/creative-engine/schemas';
import { failRun, finishRun, startRun } from '@/lib/creative-engine/runs';
import { mutateCampaign, readCampaign } from '@/lib/creative-engine/store';
import { isDry } from '@/lib/creative-engine/dry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const Body = z.object({
  campaignId: z.string(),
  action: z.enum(['approve', 'edit', 'regenerate']),
  version: z.number().int().min(1).optional(), // approve
  beats: z.array(BeatSchema).optional(), // edit
  cta: z.string().max(140).optional(), // edit
  instruction: z.string().max(400).optional(), // regenerate (whole or "beat N")
  beatIndex: z.number().int().min(0).optional(), // regenerate one beat
});

/** Approve a version, save a manual edit as a new version, or regenerate (all beats or one) as a new version. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  const campaign = readCampaign(b.campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  const script = campaign.scripts.find((s) => s.id === params.id);
  if (!script) return NextResponse.json({ ok: false, error: 'script not found' }, { status: 404 });
  const latest = script.versions.at(-1);
  if (!latest) return NextResponse.json({ ok: false, error: 'script has no versions' }, { status: 409 });

  if (b.action === 'approve') {
    const n = b.version ?? latest.n;
    if (!script.versions.some((v) => v.n === n)) return NextResponse.json({ ok: false, error: 'no such version' }, { status: 404 });
    const updated = mutateCampaign(campaign.id, (c) => ({ ...c, scripts: c.scripts.map((s) => (s.id === script.id ? { ...s, approvedVersion: n } : s)) }));
    return NextResponse.json({ ok: true, campaign: updated });
  }

  if (b.action === 'edit') {
    if (!b.beats?.length) return NextResponse.json({ ok: false, error: 'beats required' }, { status: 400 });
    const v = editedVersion(latest, b.beats, b.cta ?? latest.cta);
    const updated = mutateCampaign(campaign.id, (c) => ({ ...c, scripts: c.scripts.map((s) => (s.id === script.id ? { ...s, versions: [...s.versions, { ...v, n: latest.n + 1 }] } : s)) }));
    return NextResponse.json({ ok: true, campaign: updated });
  }

  const angle = campaign.angles.find((a) => a.id === script.angleId);
  if (!angle) return NextResponse.json({ ok: false, error: 'angle no longer exists' }, { status: 409 });
  const instruction = b.beatIndex !== undefined && latest.beats[b.beatIndex]
    ? `Rewrite ONLY the "${latest.beats[b.beatIndex].name}" beat; keep every other beat's spoken line word for word. ${b.instruction ?? ''}`.trim()
    : b.instruction;
  const run = startRun({ campaignId: campaign.id, kind: 'script', title: `Rewrite · ${angle.title.slice(0, 40)}`, outputRef: `campaign:${campaign.id}#script:${script.id}`, dry: isDry() });
  try {
    const { version } = await writeScript(campaign, angle, script.framework, script.controls, { instruction, priorVersion: latest });
    const updated = mutateCampaign(campaign.id, (c) => ({ ...c, scripts: c.scripts.map((s) => (s.id === script.id ? { ...s, versions: [...s.versions, { ...version, n: latest.n + 1 }] } : s)) }));
    finishRun(run.id);
    return NextResponse.json({ ok: true, campaign: updated, runId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'rewrite failed';
    failRun(run.id, message);
    return NextResponse.json({ ok: false, error: message, runId: run.id }, { status: /not present/i.test(message) ? 503 : 502 });
  }
}
