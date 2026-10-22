import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/creative-engine/runs';
import { nodeStatus, validateGraph } from '@/lib/creative-engine/workflow';
import { stopWorkflow } from '@/lib/creative-engine/workflow-run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Stop a run (S05b FR-61): abandon in-flight runs, mark unresolved nodes stopped. Arcads keeps (and charges) what it already received. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const w = stopWorkflow(params.id);
  if (!w) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const runs = listRuns(w.campaignId);
  const st = (runId: string) => runs.find((r) => r.id === runId)?.status ?? null;
  return NextResponse.json({ ok: true, workflow: w, status: Object.fromEntries(w.nodes.map((n) => [n.id, nodeStatus(w, n, st)])), problems: validateGraph(w), runs: runs.filter((r) => w.nodes.some((n) => n.runId === r.id)) });
}
