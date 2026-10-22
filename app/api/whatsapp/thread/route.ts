import { NextResponse } from 'next/server';
import { threadHistory } from '@/lib/connectors/whatsapp';

export const dynamic = 'force-dynamic';

/**
 * One chat's history, loaded on demand. The inbox page renders every thread at
 * once, so pulling history for all of them up front would read the whole
 * message table on every page load — the reader asks for just the open thread.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jid = url.searchParams.get('jid') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? 60);
  if (!jid) return NextResponse.json({ ok: false, error: 'jid required', messages: [] }, { status: 400 });
  const messages = await threadHistory(jid, Number.isFinite(limit) ? limit : 60);
  return NextResponse.json({ ok: true, messages });
}
