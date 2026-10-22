/**
 * Thin server-side proxy to the n8n Lead Management workflow — keeps
 * SKYESCRAPER_N8N_LEAD_WEBHOOK out of the browser bundle. The real estate
 * dashboard's chat box posts here; this just forwards the message and
 * returns the workflow's reply.
 */
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const webhookUrl = process.env.SKYESCRAPER_N8N_LEAD_WEBHOOK;
  if (!webhookUrl) {
    return NextResponse.json({ reply: 'The n8n Lead Management webhook is not configured — set SKYESCRAPER_N8N_LEAD_WEBHOOK in .env.local.' }, { status: 200 });
  }
  const { message } = (await req.json()) as { message?: string };
  if (!message || !message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
    const body = (await res.json()) as { output?: string; reply?: string };
    return NextResponse.json({ reply: body.output ?? body.reply ?? JSON.stringify(body) });
  } catch (err) {
    return NextResponse.json({ reply: `Could not reach the Lead Management workflow: ${err instanceof Error ? err.message : String(err)}` });
  }
}
