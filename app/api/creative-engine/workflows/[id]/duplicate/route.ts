import { NextResponse } from 'next/server';
import { createWorkflow, readWorkflow } from '@/lib/creative-engine/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Duplicate a workflow: same design, " copy" suffix, no run state. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const w = readWorkflow(params.id);
  if (!w) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const name = `${w.name.slice(0, 75)} copy`;
  const copy = createWorkflow({ campaignId: w.campaignId, name, nodes: w.nodes.map((n) => ({ ...n, runId: null, outputAssetId: null, outputText: null, error: null, resolvedAt: null })), edges: w.edges });
  return NextResponse.json({ ok: true, workflow: copy });
}
