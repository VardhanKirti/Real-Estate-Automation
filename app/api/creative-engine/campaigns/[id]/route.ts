import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteCampaign, mutateCampaign, readCampaign } from '@/lib/creative-engine/store';
import { listRuns } from '@/lib/creative-engine/runs';
import { saveAd } from '@/lib/foreplay/saved';
import type { WallAd } from '@/lib/foreplay/wall';
import { CAMPAIGN_NAME_MAX } from '@/lib/creative-engine/campaign-name';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(CAMPAIGN_NAME_MAX).optional(),
  /** angle ids that are selected; picks are also saved so the For-you feed learns */
  selectedAngleIds: z.array(z.string()).optional(),
  adsWanted: z.number().int().min(0).max(50).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const campaign = readCampaign(params.id);
  if (!campaign) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, campaign, runs: listRuns(campaign.id) });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const patch = parsed.data;
  const campaign = mutateCampaign(params.id, (c) => {
    let next = { ...c };
    if (patch.name) next.name = patch.name;
    if (patch.selectedAngleIds) {
      const set = new Set(patch.selectedAngleIds);
      next.angles = c.angles.map((a) => ({ ...a, selected: set.has(a.id) }));
      if (patch.adsWanted === undefined) next.adsWanted = next.angles.filter((a) => a.selected).length;
      // a pick is a save: the proof ads of a newly selected angle join the swipe file
      const pool = c.research?.pool ?? [];
      for (const a of next.angles) {
        if (!a.selected || c.angles.find((x) => x.id === a.id)?.selected) continue;
        for (const id of a.proofAdIds) {
          const ad = pool.find((p) => p.id === id);
          if (ad) {
            const { probes: _p, duplicates: _d, ...wall } = ad;
            try {
              saveAd(wall as WallAd);
            } catch {
              /* saving is a courtesy, never a blocker */
            }
          }
        }
      }
    }
    if (patch.adsWanted !== undefined) next.adsWanted = patch.adsWanted;
    return next;
  });
  if (!campaign) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, campaign });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  deleteCampaign(params.id);
  return NextResponse.json({ ok: true });
}
