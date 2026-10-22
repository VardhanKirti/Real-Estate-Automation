import { getDb } from '@/lib/data';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { buildChatsView } from '@/lib/chats-view';
import { ChatsG } from '@/components/chats/ChatsG';
import { ChatsClassic } from '@/components/chats/ChatsClassic';
import { ChatsLegacy } from '@/components/chats/ChatsLegacy';

export const dynamic = 'force-dynamic';

/**
 * Chats (founderos-ui pages/chats.md): every conversation with every agent in
 * one place. One server read (lib/chats-view.ts: SQLite, the Wizard project
 * store, the model key; no network) feeds whichever tree the appearance picks.
 * The Bennett Legacy tree reuses the same view model.
 */
export default async function ChatsPage({ searchParams = {} }: { searchParams?: { agent?: string; sample?: string } }) {
  const qs = new URLSearchParams();
  if (searchParams.sample) qs.set('sample', searchParams.sample);
  const view = await buildChatsView(getDb(), `http://localhost/chats?${qs}`, { agent: searchParams.agent ?? null });
  // at phone width a deep link (?agent=) opens straight on the thread; otherwise the rail comes first
  const initialView = searchParams.agent ? 'thread' : 'rail';
  const tree = treeFor(getAppearance(), '/chats');
  if (tree === 'glados') return <ChatsG view={view} initialView={initialView} />;
  if (tree === 'legacy') return <ChatsLegacy view={view} initialView={initialView} />;
  return <ChatsClassic view={view} initialView={initialView} />;
}
