/**
 * The /chats hub (pages/chats.md §2): a reader over agent_messages. No new
 * table. The Wizard (the `conductor` agent) is always the first row; every
 * other agent with messages follows, newest message first (C-2). Sending goes
 * through the existing POST /api/agents/[id]/chat.
 */
import type { AgentMessage } from '@/lib/schemas';

export const WIZARD_ID = 'conductor';
export const PREVIEW_MAX = 120;
export const THREAD_PAGE = 50;

export type RosterAgent = { id: string; name: string; description?: string; departmentId?: string };

export type ChatThread = {
  agentId: string;
  name: string;
  role: string;
  pinned: boolean;
  lastMessage: string | null;
  lastAt: string | null;
  lastRole: AgentMessage['role'] | null;
  messageCount: number;
};

const preview = (s: string) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
};

type Msg = Pick<AgentMessage, 'agentId' | 'role' | 'content' | 'createdAt'>;

/** The rail. `recent` is newest first (db.agentMessages.recent). */
export function chatThreads(recent: Msg[], roster: RosterAgent[]): { threads: ChatThread[]; newChat: RosterAgent[] } {
  const byId = new Map(roster.map((a) => [a.id, a]));
  const seen = new Map<string, { last: Msg; count: number }>();
  for (const m of recent) {
    const cur = seen.get(m.agentId);
    if (cur) cur.count += 1;
    else seen.set(m.agentId, { last: m, count: 1 });
  }
  const thread = (agentId: string, pinned: boolean): ChatThread => {
    const a = byId.get(agentId);
    const s = seen.get(agentId);
    return {
      agentId,
      name: agentId === WIZARD_ID ? 'Wizard' : (a?.name ?? agentId),
      role: agentId === WIZARD_ID ? 'Your conductor' : (a?.description ?? ''),
      pinned,
      lastMessage: s ? preview(s.last.content) : null,
      lastAt: s?.last.createdAt ?? null,
      lastRole: s?.last.role ?? null,
      messageCount: s?.count ?? 0,
    };
  };
  const others = [...seen.keys()]
    .filter((id) => id !== WIZARD_ID)
    .map((id) => thread(id, false))
    .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  return {
    threads: [thread(WIZARD_ID, true), ...others],
    newChat: roster.filter((a) => a.id !== WIZARD_ID && !seen.has(a.id)),
  };
}

/** One page of a thread, oldest first. `before` pages back from an ISO time. */
export function threadPage<T extends Pick<AgentMessage, 'createdAt'>>(all: T[], opts: { before?: string | null; limit?: number } = {}): { messages: T[]; hasMore: boolean } {
  const limit = Math.max(1, Math.min(opts.limit ?? THREAD_PAGE, 200));
  const scoped = opts.before ? all.filter((m) => m.createdAt < opts.before!) : all;
  const start = Math.max(0, scoped.length - limit);
  return { messages: scoped.slice(start), hasMore: start > 0 };
}
