/**
 * Thin server-side proxy to the Lead Management LangGraph agent — kept for
 * any caller that still posts here directly. The dashboard itself links to
 * /chats, which goes through lib/agents/chat.ts the normal way; this route
 * runs the same in-process agent (lib/agents/sky-agents.ts) as a one-off
 * turn, with no stored history.
 */
import { NextResponse } from 'next/server';
import { chatWithSkyAgent, skyAgentConfigured } from '@/lib/agents/sky-agents';

export async function POST(req: Request) {
  if (!skyAgentConfigured()) {
    return NextResponse.json({ reply: 'Skyescraper agents are not configured — set SKYESCRAPER_API_TOKEN and AI_GATEWAY_API_KEY in .env.local.' }, { status: 200 });
  }
  const { message } = (await req.json()) as { message?: string };
  if (!message || !message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  const result = await chatWithSkyAgent('lead-management', [{ role: 'user', content: message }]);
  return NextResponse.json({ reply: result.text });
}
