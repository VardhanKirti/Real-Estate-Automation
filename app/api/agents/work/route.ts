import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { isValidCron } from '@/lib/cron';
import {
  AgentTaskHorizonSchema,
  AgentTaskPrioritySchema,
  AgentTaskStatusSchema,
} from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** Tasks + cron jobs for one agent (or all agents when no id given). */
export async function GET(request: Request) {
  const agentId = new URL(request.url).searchParams.get('agentId');
  const db = getDb();
  return NextResponse.json({
    tasks: agentId ? db.agentTasks.byAgent(agentId) : db.agentTasks.all(),
    crons: agentId ? db.agentCrons.byAgent(agentId) : db.agentCrons.all(),
  });
}

const CreateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('task'),
    // omitted for a task in the operator's own lane
    agentId: z.string().min(1).nullish(),
    title: z.string().min(1),
    detail: z.string().optional(),
    dueAt: z.string().nullish(),
    priority: AgentTaskPrioritySchema.optional(),
    ownerKind: z.enum(['agent', 'me']).optional(),
    horizon: AgentTaskHorizonSchema.nullish(),
  }),
  z.object({
    kind: z.literal('cron'),
    agentId: z.string().min(1),
    schedule: z.string().min(1),
    description: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb();
  const now = new Date().toISOString();

  if (parsed.data.kind === 'task') {
    const d = parsed.data;
    // the lane follows the agent unless it is named outright
    const ownerKind = d.ownerKind ?? (d.agentId ? 'agent' : 'me');
    if (ownerKind === 'agent' && !d.agentId) {
      return NextResponse.json({ error: 'agent-owned tasks must name an agent' }, { status: 400 });
    }
    const id = randomUUID();
    db.agentTasks.insert({
      id,
      agentId: d.agentId ?? null,
      title: d.title,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      detail: d.detail ?? '',
      dueAt: d.dueAt ?? null,
      priority: d.priority ?? 'normal',
      ownerKind,
      horizon: d.horizon ?? null,
    });
    return NextResponse.json({ ok: true, task: db.agentTasks.get(id) });
  }

  if (!isValidCron(parsed.data.schedule)) {
    return NextResponse.json({ error: `invalid cron schedule: ${parsed.data.schedule} — use 5 fields like "0 9 * * 1-5"` }, { status: 400 });
  }
  const cron = { id: randomUUID(), agentId: parsed.data.agentId, schedule: parsed.data.schedule, description: parsed.data.description, enabled: true, createdAt: now };
  db.agentCrons.insert(cron);
  return NextResponse.json({ ok: true, cron });
}

const PatchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('task'),
    id: z.string().min(1),
    status: AgentTaskStatusSchema.optional(),
    title: z.string().min(1).optional(),
    detail: z.string().optional(),
    dueAt: z.string().nullish(),
    priority: AgentTaskPrioritySchema.optional(),
    horizon: AgentTaskHorizonSchema.nullish(),
    /** moving a task between lanes: pass the agent to delegate, null to take it back */
    agentId: z.string().min(1).nullish(),
    ownerKind: z.enum(['agent', 'me']).optional(),
  }),
  z.object({ kind: z.literal('cron'), id: z.string().min(1), enabled: z.boolean() }),
]);

export async function PATCH(request: Request) {
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb();
  const now = new Date().toISOString();
  if (parsed.data.kind === 'task') {
    const { kind, id, status, ...rest } = parsed.data;
    if (status) db.agentTasks.setStatus(id, status, now);
    // only the keys actually sent — an absent field must not be nulled out
    const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length > 0) {
      if ('agentId' in patch) patch.ownerKind = patch.ownerKind ?? (patch.agentId ? 'agent' : 'me');
      db.agentTasks.update(id, patch, now);
    }
    if (!status && Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, task: db.agentTasks.get(id) });
  }
  db.agentCrons.setEnabled(parsed.data.id, parsed.data.enabled);
  return NextResponse.json({ ok: true });
}

const DeleteSchema = z.object({ kind: z.enum(['task', 'cron']), id: z.string().min(1) });

export async function DELETE(request: Request) {
  const parsed = DeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb();
  if (parsed.data.kind === 'task') db.agentTasks.remove(parsed.data.id);
  else db.agentCrons.remove(parsed.data.id);
  return NextResponse.json({ ok: true });
}
