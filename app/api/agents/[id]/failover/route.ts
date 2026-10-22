import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { realAgents } from '@/lib/agents/real';
import { isConfirmed } from '@/lib/gates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ model: z.string().trim().min(1).max(120) });

/**
 * Failover (pages/feature-additions.md F9): move an agent onto another model.
 * Needs `confirm: true` (409 without it) and logs the change to the agent's
 * run history (A-2). Applies to agents whose config is stored (db.agents);
 * an agent defined in code (lib/agents/real.ts) has no stored model to move,
 * so it answers 409 and changes nothing rather than pretending.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'model is required' }, { status: 400 });
  const db = getDb();
  const stored = db.agents.get(params.id);
  if (!stored) {
    if (realAgents.some((a) => a.id === params.id)) {
      return NextResponse.json({ error: 'this agent is defined in code (lib/agents/real.ts); its model is not stored here, nothing changed' }, { status: 409 });
    }
    return NextResponse.json({ error: `unknown agent: ${params.id}` }, { status: 404 });
  }
  if (stored.model === parsed.data.model) return NextResponse.json({ ok: true, agentId: stored.id, model: stored.model, changed: false });
  if (!isConfirmed(body)) {
    return NextResponse.json({ error: `Move ${stored.name} from ${stored.model || 'its default model'} to ${parsed.data.model}? Resend with "confirm": true.`, needsConfirm: true }, { status: 409 });
  }
  db.agents.setModel(stored.id, parsed.data.model);
  const at = new Date().toISOString();
  db.agentRuns.insert({
    id: randomUUID(),
    agentId: stored.id,
    startedAt: at,
    finishedAt: at,
    ok: true,
    summary: `Failover: model ${stored.model || '(default)'} → ${parsed.data.model} (by the operator)`,
  });
  return NextResponse.json({ ok: true, agentId: stored.id, from: stored.model, model: parsed.data.model, changed: true });
}
