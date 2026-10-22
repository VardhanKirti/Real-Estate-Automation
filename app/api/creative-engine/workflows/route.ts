import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createWorkflow, readCampaign, readWorkflows } from '@/lib/creative-engine/store';
import { TEMPLATES, templateSummary } from '@/lib/creative-engine/workflow';
import type { Campaign } from '@/lib/creative-engine/schemas';
import { engineDry } from '@/lib/creative-engine/workflow-run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The script a template builds from: the approved one, else the first. */
function scriptContext(campaign: Campaign | null) {
  const script = campaign?.scripts.find((s) => s.approvedVersion !== null) ?? campaign?.scripts[0] ?? null;
  const version = script?.versions.find((v) => v.n === script.approvedVersion) ?? script?.versions.at(-1);
  return { scriptId: script?.id ?? null, beats: version?.beats ?? [], approved: !!script && script.approvedVersion !== null };
}

/** List a campaign's workflows plus the start-card templates: paid-request count and a mini diagram each (S05b FR-46). */
export async function GET(request: Request) {
  const campaignId = new URL(request.url).searchParams.get('campaignId');
  const campaign = campaignId ? readCampaign(campaignId) : null;
  const ctx = scriptContext(campaign);
  return NextResponse.json({ ok: true, workflows: readWorkflows(campaignId), templates: TEMPLATES.map((t) => templateSummary(t, ctx)), approvedScript: ctx.approved, dry: engineDry() });
}

const Body = z.object({ campaignId: z.string(), name: z.string().min(1).max(80).default('New workflow'), template: z.string().optional() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const campaign = readCampaign(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  let graph: { nodes: never[]; edges: never[] } | ReturnType<(typeof TEMPLATES)[number]['build']> = { nodes: [], edges: [] };
  if (parsed.data.template) {
    const t = TEMPLATES.find((x) => x.id === parsed.data.template);
    if (!t) return NextResponse.json({ ok: false, error: 'unknown template' }, { status: 400 });
    const { scriptId, beats } = scriptContext(campaign);
    graph = t.build({ scriptId, beats });
  }
  const w = createWorkflow({ campaignId: campaign.id, name: parsed.data.template ? (TEMPLATES.find((x) => x.id === parsed.data.template)?.name ?? parsed.data.name) : parsed.data.name, nodes: graph.nodes, edges: graph.edges });
  return NextResponse.json({ ok: true, workflow: w });
}
