import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { DecisionExistsError } from '@/lib/db-ext/agent-ops';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  runId: z.string().min(1).max(200),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).optional(),
});

/**
 * Approve or reject a finished agent run's output (pages/feature-additions.md
 * F9). One decision per run (A-1): a second is a 409, never an overwrite. A
 * rejection needs a reason. Local write only; nothing is sent.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'runId and decision (approved|rejected) are required' }, { status: 400 });
  const db = getDb();
  const run = db.agentRuns.get(parsed.data.runId);
  if (!run) return NextResponse.json({ error: 'unknown run' }, { status: 404 });
  if (parsed.data.decision === 'rejected' && !parsed.data.reason?.trim()) {
    return NextResponse.json({ error: 'a rejection needs a reason' }, { status: 400 });
  }
  try {
    const decision = db.deliverableDecisions.record({ runId: run.id, decision: parsed.data.decision, reason: parsed.data.reason ?? '' });
    return NextResponse.json({ ok: true, decision }, { status: 201 });
  } catch (err) {
    if (err instanceof DecisionExistsError) {
      return NextResponse.json({ error: 'this run already has a decision', decision: db.deliverableDecisions.get(run.id) }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
