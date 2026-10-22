import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/creative-engine/runs';
import { mutateWorkflow, readWorkflow, readWorkflowVersions, writeWorkflowVersion } from '@/lib/creative-engine/store';
import { nodeStatus, validateGraph } from '@/lib/creative-engine/workflow';
import { LayoutError, LayoutSchema, mergeLayout } from '@/lib/creative-engine/workflow-edit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Restore version n: the current design is saved as a version first, then
 * the old layout goes through the same merge as autosave, so runtime fields
 * of nodes that still exist are kept and nothing is ever re-charged.
 */
export async function POST(_req: Request, { params }: { params: { id: string; n: string } }) {
  const w = readWorkflow(params.id);
  if (!w) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const v = readWorkflowVersions(params.id).find((x) => x.n === Number(params.n));
  if (!v) return NextResponse.json({ ok: false, error: 'that version is gone' }, { status: 404 });
  const layout = LayoutSchema.safeParse({ nodes: v.nodes, edges: v.edges });
  if (!layout.success) return NextResponse.json({ ok: false, error: 'that version no longer parses' }, { status: 400 });
  try {
    writeWorkflowVersion(w, { reason: 'restore', note: `Before restoring v${v.n}` });
    mutateWorkflow(params.id, (x) => ({ ...mergeLayout(x, layout.data), name: v.name }), { stampLayout: true });
  } catch (err) {
    if (err instanceof LayoutError) return NextResponse.json({ ok: false, kind: 'layout', error: err.message }, { status: 400 });
    throw err;
  }
  const next = readWorkflow(params.id)!;
  const runs = listRuns(next.campaignId);
  const st = (runId: string) => runs.find((r) => r.id === runId)?.status ?? null;
  return NextResponse.json({ ok: true, workflow: next, status: Object.fromEntries(next.nodes.map((n) => [n.id, nodeStatus(next, n, st)])), problems: validateGraph(next), runs: runs.filter((r) => next.nodes.some((n) => n.runId === r.id)) });
}
