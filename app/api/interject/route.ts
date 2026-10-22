import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { realAgents } from '@/lib/agents/real';
import { ingestBrainDump } from '@/lib/brain-dump';
import { createGBrainProvider, type CaptureInput } from '@/lib/connectors/gbrain';
import { INTERJECT_UNDO_MS, routeInterject } from '@/lib/interject';
import { taskHref } from '@/lib/home-today';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ text: z.string().min(1).max(8000) });
const Undo = z.object({ id: z.string().min(1) });

/**
 * Home's interject composer (pages/feature-additions.md F2). Rule-based, no
 * LLM (lib/interject.ts): a task, an agent relay (a task assigned to that
 * agent) or a note (written to the brain inbox, embedded when Optimal Engine is
 * up). Answers `{ kind, id, href }`.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'text is required' }, { status: 400 });
  const route = routeInterject(parsed.data.text, realAgents.map((a) => ({ id: a.id, name: a.name })));
  if (!route) return NextResponse.json({ error: 'nothing to add' }, { status: 400 });

  if (route.kind === 'note') {
    try {
      const result = await ingestBrainDump(
        { text: route.text, folder: 'inbox', tags: ['interject'] },
        { capture: process.env.BRAIN_PROVIDER === 'stub' ? undefined : (input: CaptureInput) => createGBrainProvider().capture(input) },
      );
      return NextResponse.json({ ok: true, kind: 'note', id: result.relPath, href: '/brain', embedded: result.embedded, undo: false }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: `note not saved: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  getDb().agentTasks.insert({
    id,
    agentId: route.kind === 'relay' ? route.agentId : null,
    title: route.title,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    detail: route.detail,
    ownerKind: route.kind === 'relay' ? 'agent' : 'me',
  });
  return NextResponse.json(
    { ok: true, kind: route.kind, id, href: taskHref(id), ...(route.kind === 'relay' ? { agentId: route.agentId } : {}), undo: true },
    { status: 201 },
  );
}

/** Undo (H-4): removes a task this composer created, within the toast's window. */
export async function DELETE(req: Request) {
  const parsed = Undo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const tasks = getDb().agentTasks;
  const task = tasks.get(parsed.data.id);
  if (!task) return NextResponse.json({ error: 'unknown task' }, { status: 404 });
  if (Date.now() - Date.parse(task.createdAt) > INTERJECT_UNDO_MS + 5_000) {
    return NextResponse.json({ error: 'too late to undo; delete it from Tasks' }, { status: 409 });
  }
  tasks.remove(task.id);
  return NextResponse.json({ ok: true, id: task.id });
}
