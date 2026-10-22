import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkflowEdgeSchema, WorkflowNodeSchema } from '@/lib/creative-engine/schemas';
import { deleteWorkflow, designStamp, mutateWorkflow, readWorkflow, WorkflowConflictError } from '@/lib/creative-engine/store';
import { listRuns } from '@/lib/creative-engine/runs';
import { nodeStatus, validateGraph } from '@/lib/creative-engine/workflow';
import { LayoutError, LayoutSchema, mergeLayout, toLayout } from '@/lib/creative-engine/workflow-edit';
import { resetWorkflow, restoreResetSnapshot } from '@/lib/creative-engine/workflow-run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function withStatus(id: string) {
  const w = readWorkflow(id);
  if (!w) return null;
  const runs = listRuns(w.campaignId);
  const st = (runId: string) => runs.find((r) => r.id === runId)?.status ?? null;
  return { workflow: w, status: Object.fromEntries(w.nodes.map((n) => [n.id, nodeStatus(w, n, st)])), problems: validateGraph(w), runs: runs.filter((r) => w.nodes.some((n) => n.runId === r.id)) };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const r = withStatus(params.id);
  if (!r) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}

/**
 * The client sends `layout` (ids, types, titles, positions, settings, edges).
 * Runtime fields are never taken from the body, `force` included: the merge
 * keeps the stored runId/outputs so a stale autosave can't make the engine
 * submit a paid node twice (S05b R10). The legacy whole-node `nodes`/`edges`
 * body is still accepted for one release and goes through the same merge.
 */
const Patch = z.object({
  name: z.string().min(1).max(80).optional(),
  layout: LayoutSchema.optional(),
  /** legacy body: runtime fields in it are ignored */
  nodes: z.array(WorkflowNodeSchema).optional(),
  edges: z.array(WorkflowEdgeSchema).optional(),
  baseUpdatedAt: z.string().optional(),
  force: z.boolean().optional(),
  reset: z.boolean().optional(),
  /** undo the last Reset: put back the runtime fields it cleared (S05b FR-62) */
  restoreRunSnapshot: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const p = parsed.data;
  const current = readWorkflow(params.id);
  if (!current) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const layout = p.layout ?? (p.nodes || p.edges ? toLayout({ nodes: p.nodes ?? current.nodes, edges: p.edges ?? current.edges }) : null);
  const expect = { stampLayout: true, ...(p.baseUpdatedAt !== undefined && !p.force ? { expectUpdatedAt: p.baseUpdatedAt } : {}) };
  try {
    if (layout || p.name !== undefined) mutateWorkflow(params.id, (x) => ({ ...(layout ? mergeLayout(x, layout) : x), name: p.name ?? x.name }), expect);
    else if (expect.expectUpdatedAt !== undefined && expect.expectUpdatedAt !== designStamp(current) && expect.expectUpdatedAt !== current.updatedAt) throw new WorkflowConflictError(current);
  } catch (err) {
    if (err instanceof WorkflowConflictError) return NextResponse.json({ ok: false, kind: 'conflict', error: err.message, workflow: err.current }, { status: 409 });
    if (err instanceof LayoutError) return NextResponse.json({ ok: false, kind: 'layout', error: err.message }, { status: 400 });
    throw err;
  }
  if (p.reset) resetWorkflow(params.id);
  if (p.restoreRunSnapshot && !restoreResetSnapshot(params.id)) return NextResponse.json({ ok: false, error: 'nothing to restore: the run results were already restored or a new run started' }, { status: 410 });
  const view = withStatus(params.id);
  if (!view) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...view });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!readWorkflow(params.id)) return NextResponse.json({ ok: true, alreadyGone: true });
  deleteWorkflow(params.id);
  if (readWorkflow(params.id)) return NextResponse.json({ ok: false, error: 'the workflow file could not be removed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
