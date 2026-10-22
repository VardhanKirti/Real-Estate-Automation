import { NextResponse } from 'next/server';
import { BRAND } from '@/lib/brand';
import { getDb } from '@/lib/data';
import { compileBlueprint } from '@/lib/blueprint/compile';
import { buildHierarchy, describeScope, indexHierarchy } from '@/lib/blueprint/hierarchy';
import { wizardExchange } from '@/lib/wizard/claude';
import { plainText } from '@/lib/wizard/protocol';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SYSTEM = [
  `You are ${BRAND.name}'s Blueprint analyst. The operator is looking at a live map of the system and asked a question about the SELECTED scope.`,
  'Answer ONLY from the CONTEXT. It was compiled from the running system a moment ago. If the context does not say, say so plainly. Never invent numbers, files, keys or status.',
  'Be direct, specific and short: 90 words max unless asked for a list. Plain text only — no markdown, no headers, no bullet symbols. Name components by their names.',
].join('\n');

/**
 * POST { question, selected } → the ask bar's answer, grounded in the
 * selected scope (its chain, members and relations) from the graph
 * compiled right now. Same engine as the Wizard: one headless claude
 * exchange; an honest 503 when the binary is missing on this host.
 */
export async function POST(req: Request) {
  let body: { question?: unknown; selected?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const question = String(body.question ?? '')
    .trim()
    .slice(0, 600);
  if (question.length < 3) return NextResponse.json({ ok: false, error: 'ask a real question' }, { status: 400 });
  const selected = typeof body.selected === 'string' ? body.selected : null;

  const graph = await compileBlueprint(getDb());
  const h = buildHierarchy(graph);
  const idx = indexHierarchy(h);
  const ctx = describeScope(h, idx, selected);
  const prompt = `CONTEXT (selected scope):\n${JSON.stringify(ctx)}\n\nQUESTION: ${question}`;

  const r = await wizardExchange(prompt, SYSTEM);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.unavailable ? 'Claude engine unavailable on this host' : r.error }, { status: r.unavailable ? 503 : 502 });
  }
  return NextResponse.json({ ok: true, text: plainText(r.text), model: r.model, scope: String(ctx.scope) });
}
