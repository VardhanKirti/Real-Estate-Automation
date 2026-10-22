import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { createRuntime } from '@/lib/agents/runtime';
import { realAgents } from '@/lib/agents/real';
import { appendMessages, applyTaskChanges, readProject, updateProject, type Receipt } from '@/lib/wizard/store';
import { wizardExchange } from '@/lib/wizard/claude';
import { parseWizardBlock, plainText, resolveOwner, systemAppend } from '@/lib/wizard/protocol';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // shells the local claude binary
export const maxDuration = 180;

/**
 * One Wizard exchange: append the user message, run the (resumed) Claude
 * session, apply the wizard block (tasks / done / run) to the project, run
 * any requested agents for real, append the reply with its receipts.
 * Honest 503 when the engine is unavailable.
 */

const SendSchema = z.object({ projectId: z.string().min(1), text: z.string().min(1).max(8000) });

export async function POST(request: Request) {
  const parsed = SendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'projectId and text required' }, { status: 400 });
  const project = readProject(parsed.data.projectId);
  if (!project) return NextResponse.json({ ok: false, error: 'no such project' }, { status: 404 });

  const db = getDb();
  const roster = db.agents.all().map((a) => ({ id: a.id, name: a.name, role: a.role }));

  appendMessages(project.id, [{ role: 'user', text: parsed.data.text, at: new Date().toISOString() }]);

  const exchange = await wizardExchange(parsed.data.text, systemAppend(roster), project.sessionId);
  if (!exchange.ok) {
    return NextResponse.json(
      { ok: false, unavailable: exchange.unavailable, error: exchange.unavailable ? 'Wizard engine unavailable on this host' : exchange.error },
      { status: exchange.unavailable ? 503 : 502 },
    );
  }

  updateProject(project.id, {
    ...(exchange.sessionId && exchange.sessionId !== project.sessionId ? { sessionId: exchange.sessionId } : {}),
    ...(exchange.model ? { model: exchange.model } : {}),
    lastUsage: exchange.usage,
    addCostUsd: exchange.usage?.costUsd ?? 0,
  });

  const { text: rawText, block } = parseWizardBlock(exchange.text);
  const text = plainText(rawText);
  const receipts: Receipt[] = [];

  if (block.tasks.length || block.done.length) {
    const add = block.tasks.map((t) => ({ title: t.title, ...resolveOwner(t.owner, roster) }));
    applyTaskChanges(project.id, { add, done: block.done });
    if (add.length) receipts.push({ kind: 'task', label: `${add.length} task${add.length === 1 ? '' : 's'} created` });
    if (block.done.length) receipts.push({ kind: 'done', label: `${block.done.length} marked done` });
  }

  if (block.run.length) {
    const rt = createRuntime(db, realAgents);
    for (const id of block.run.slice(0, 4)) {
      const agent = roster.find((a) => a.id === id) ?? roster.find((a) => a.name.toLowerCase() === id.toLowerCase());
      if (!agent) continue;
      try {
        const run = await rt.run(agent.id);
        receipts.push({ kind: 'ran-agent', label: `Ran ${agent.name} · ${run.summary.slice(0, 80)}` });
      } catch (err) {
        receipts.push({ kind: 'note', label: `${agent.name} has no runtime here` });
      }
    }
  }

  const updated = appendMessages(project.id, [{ role: 'wizard', text, at: new Date().toISOString(), receipts }]);
  return NextResponse.json({ ok: true, project: updated });
}
