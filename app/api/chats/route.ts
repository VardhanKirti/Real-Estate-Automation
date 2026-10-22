import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { buildChatsView } from '@/lib/chats-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The /chats rail (pages/chats.md §2): Wizard pinned first, then one thread
 * per agent newest first, the "New chat" roster, and whether the model key the
 * agent chat uses is configured (no key: composer disabled with a Set up link,
 * never a fake reply). Reads SQLite, the Wizard project store and the key only;
 * no model call. Same builder as the page (lib/chats-view.ts). `?sample=1` on a
 * blank install shows badged fixture threads; Filming shows the demo database's
 * threads (or the fixture) with the Sample badge.
 */
export async function GET(req: Request) {
  const view = await buildChatsView(getDb(), req.url);
  return NextResponse.json({
    threads: view.threads,
    newChat: view.roster,
    model: view.model,
    composer: view.composer,
    mode: view.mode,
    sample: view.sample,
  });
}
