import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CapError } from '@/lib/creative-engine/generate';
import { listRuns } from '@/lib/creative-engine/runs';
import { nodeStatus, validateGraph } from '@/lib/creative-engine/workflow';
import { planWorkflow, startWorkflow, WorkflowError } from '@/lib/creative-engine/workflow-run';
import { explainArcadsError } from '@/lib/arcads/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const Body = z.object({
  override: z.boolean().optional(),
  scope: z.enum(['all', 'failed', 'from']).optional(),
  nodeId: z.string().nullable().optional(),
  /** true: answer what the run would do (the gate's list), start nothing */
  dryRunPlan: z.boolean().optional(),
});

/**
 * Run the graph, or a scope of it (all, failed only, from a node): validate,
 * then resolve or submit every node whose inputs are ready. The poll clock
 * carries on from there. With `dryRunPlan` it only answers what would be
 * submitted, from the same scope rule the engine uses (S05b FR-58, FR-60).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  if (b.dryRunPlan) {
    const plan = planWorkflow(params.id, b.scope ?? 'all', b.nodeId ?? null);
    if (!plan) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, plan });
  }
  try {
    const w = await startWorkflow(params.id, { override: !!b.override, scope: b.scope ?? 'all', nodeId: b.nodeId ?? null });
    const runs = listRuns(w.campaignId);
    const st = (runId: string) => runs.find((r) => r.id === runId)?.status ?? null;
    return NextResponse.json({ ok: true, workflow: w, status: Object.fromEntries(w.nodes.map((n) => [n.id, nodeStatus(w, n, st)])), problems: validateGraph(w) });
  } catch (err) {
    if (err instanceof WorkflowError) return NextResponse.json({ ok: false, error: err.message, kind: 'graph', problems: err.problems }, { status: 422 });
    if (err instanceof CapError) return NextResponse.json({ ok: false, error: err.message, kind: 'cap', spent: err.spent, cap: err.cap }, { status: 409 });
    const message = err instanceof Error ? err.message : 'run failed';
    if (/not configured/i.test(message)) return NextResponse.json({ ok: false, error: message, kind: 'not-configured' }, { status: 503 });
    if (/not found/.test(message)) return NextResponse.json({ ok: false, error: message }, { status: 404 });
    const ex = explainArcadsError(err);
    return NextResponse.json({ ok: false, error: ex.message, kind: ex.kind }, { status: ex.httpStatus });
  }
}
