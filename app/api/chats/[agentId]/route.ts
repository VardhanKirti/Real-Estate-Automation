import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { buildThread } from '@/lib/chats-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One thread, oldest first, 50 a page (`?before=<ISO>` pages back). The Wizard
 * (`conductor`) reads the latest Wizard project; every other agent reads
 * agent_messages. Unknown agent: 404. Reads local stores only.
 */
export async function GET(req: Request, { params }: { params: { agentId: string } }) {
  const url = new URL(req.url);
  const t = buildThread(getDb(), params.agentId, req.url, {
    before: url.searchParams.get('before'),
    limit: Number(url.searchParams.get('limit')) || undefined,
  });
  if (!t) return NextResponse.json({ error: `unknown agent: ${params.agentId}` }, { status: 404 });
  const { messages, hasMore, mode, sample, ...agent } = t;
  return NextResponse.json({ agent: { id: agent.agentId, name: agent.name, description: agent.role, avatar: agent.avatar, source: agent.source, projectName: agent.projectName }, messages, hasMore, mode, sample });
}
