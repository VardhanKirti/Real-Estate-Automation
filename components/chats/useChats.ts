'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentMessage } from '@/lib/schemas';
import type { ChatMsg, ChatRailRow, ChatRosterRow, ChatThreadView, ChatsView } from '@/lib/chats-view';

/**
 * The /chats state, shared by every tree (GladOS, Classic, and Bennett Legacy
 * later): selection (`?agent=`), search, the New chat roster, the rail
 * collapse (localStorage `glados-chats-rail`, never the app sidebar, C-4), the
 * two-view phone layout, thread loads and sends. Sending goes through the
 * existing POST /api/agents/[id]/chat (C-3: one agent_messages row per turn,
 * same as the agent sheet). With the composer off (no model key, or a
 * Sample/Filming preview) `send` does nothing and no request leaves (C-1).
 */

export const WIZARD = 'conductor';
export const RAIL_KEY = 'glados-chats-rail';

export type PendingLine = { key: string; text: string; state: 'sending' | 'failed'; error?: string };
/** A Wizard turn answered on this page: the reply lives in the routed agent's thread. */
export type RoutedTurn = { key: string; text: string; reply: string; routedTo: string; routedName: string; routedAvatar: string | null; at: string };

type Loaded = { status: 'loading' | 'ready' | 'error'; thread: Omit<ChatThreadView, 'messages' | 'hasMore'> | null; messages: ChatMsg[]; error?: string };

const toMsgs = (rows: AgentMessage[]): ChatMsg[] =>
  rows.map((m) => ({ id: m.id, role: m.role, content: m.content, tools: (m.toolCalls ?? []).map((c) => c.name), createdAt: m.createdAt }));

let seq = 0;
const nextKey = () => `p${Date.now().toString(36)}${(seq += 1)}`;

export function useChats(view: ChatsView, opts: { initialView?: 'rail' | 'thread' } = {}) {
  const [threads, setThreads] = useState<ChatRailRow[]>(view.threads);
  const [roster, setRoster] = useState<ChatRosterRow[]>(view.roster);
  const [selected, setSelected] = useState(view.selected);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>(() =>
    view.open ? { [view.open.agentId]: { status: 'ready', thread: view.open, messages: view.open.messages } } : {},
  );
  const [pending, setPending] = useState<Record<string, PendingLine[]>>({});
  const [routed, setRouted] = useState<RoutedTurn[]>([]);
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<'rail' | 'thread'>(opts.initialView ?? 'rail');
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(view.now);
  const sampleQ = view.mode === 'sample' ? '?sample=1' : '';
  const inflight = useRef(new Set<string>());

  // the rail collapse is this page's own preference (C-4); read after mount so SSR and hydration agree
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(RAIL_KEY) === '1');
    } catch {
      /* storage blocked: the rail stays open */
    }
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const toggleRail = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(RAIL_KEY, c ? '0' : '1');
      } catch {
        /* not persisted */
      }
      return !c;
    });
  }, []);

  const load = useCallback(
    async (id: string) => {
      if (inflight.current.has(id)) return;
      inflight.current.add(id);
      setLoaded((l) => ({ ...l, [id]: { status: 'loading', thread: l[id]?.thread ?? null, messages: l[id]?.messages ?? [] } }));
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(id)}${sampleQ}`);
        if (!res.ok) throw new Error(res.status === 404 ? 'This agent is no longer in the roster.' : `Could not load the thread (${res.status}).`);
        const body = (await res.json()) as {
          agent: { id: string; name: string; description: string; avatar: string | null; source: 'agent' | 'wizard'; projectName: string | null };
          messages: ChatMsg[];
        };
        setLoaded((l) => ({
          ...l,
          [id]: {
            status: 'ready',
            thread: { agentId: body.agent.id, name: body.agent.name, role: body.agent.description, avatar: body.agent.avatar, source: body.agent.source, projectName: body.agent.projectName },
            messages: body.messages,
          },
        }));
      } catch (err) {
        setLoaded((l) => ({ ...l, [id]: { status: 'error', thread: l[id]?.thread ?? null, messages: l[id]?.messages ?? [], error: err instanceof Error ? err.message : String(err) } }));
      } finally {
        inflight.current.delete(id);
      }
    },
    [sampleQ],
  );

  const select = useCallback(
    (id: string) => {
      setSelected(id);
      setPicking(false);
      setMobileView('thread');
      try {
        const u = new URL(window.location.href);
        if (id === WIZARD) u.searchParams.delete('agent');
        else u.searchParams.set('agent', id);
        window.history.replaceState(window.history.state, '', u.pathname + u.search);
      } catch {
        /* the URL stays as it was */
      }
      if (!loaded[id] || loaded[id].status === 'error') void load(id);
    },
    [load, loaded],
  );

  const back = useCallback(() => setMobileView('rail'), []);

  // Esc leaves the roster picker (pages/chats.md §4)
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setPicking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  const refreshRail = useCallback(async () => {
    try {
      const res = await fetch(`/api/chats${sampleQ}`);
      if (!res.ok) return;
      const body = (await res.json()) as { threads: ChatRailRow[]; newChat: ChatRosterRow[] };
      setThreads(body.threads);
      setRoster(body.newChat);
    } catch {
      /* the rail keeps its last good state */
    }
  }, [sampleQ]);

  const post = useCallback(
    async (agentId: string, line: PendingLine) => {
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: line.text }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; reply?: string; routedTo?: string; messages?: AgentMessage[] };
        if (!res.ok) throw new Error(body.error ?? `Send failed (${res.status})`);
        setPending((p) => ({ ...p, [agentId]: (p[agentId] ?? []).filter((x) => x.key !== line.key) }));
        if (agentId === WIZARD && body.routedTo) {
          const target = body.routedTo;
          const known = threads.find((t) => t.agentId === target) ?? roster.find((r) => r.id === target);
          const turn = { key: line.key, text: line.text, reply: body.reply ?? '', routedTo: target, routedName: known?.name ?? target, routedAvatar: known?.avatar ?? null, at: new Date().toISOString() };
          setRouted((r) => [...r, turn]);
          if (body.messages) {
            const msgs = toMsgs(body.messages);
            setLoaded((l) => (l[target] ? { ...l, [target]: { ...l[target], status: 'ready', messages: msgs } } : l));
          }
        } else if (body.messages) {
          const msgs = toMsgs(body.messages);
          setLoaded((l) => ({ ...l, [agentId]: { status: 'ready', thread: l[agentId]?.thread ?? null, messages: msgs } }));
        }
        void refreshRail();
      } catch (err) {
        // a network failure (the server never answered) reads as such, not as the browser's raw TypeError
        const error = err instanceof TypeError ? 'The server did not answer.' : err instanceof Error ? err.message : String(err);
        setPending((p) => ({ ...p, [agentId]: (p[agentId] ?? []).map((x) => (x.key === line.key ? { ...x, state: 'failed', error } : x)) }));
      }
    },
    [refreshRail, roster, threads],
  );

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || !view.composer.enabled) return; // C-1: no key or a preview, no request
      const line: PendingLine = { key: nextKey(), text: t, state: 'sending' };
      setPending((p) => ({ ...p, [selected]: [...(p[selected] ?? []), line] }));
      setDraft('');
      void post(selected, line);
    },
    [post, selected, view.composer.enabled],
  );

  const retry = useCallback(
    (key: string) => {
      const line = (pending[selected] ?? []).find((x) => x.key === key);
      if (!line || !view.composer.enabled) return;
      const again = { ...line, state: 'sending' as const, error: undefined };
      setPending((p) => ({ ...p, [selected]: (p[selected] ?? []).map((x) => (x.key === key ? again : x)) }));
      void post(selected, again);
    },
    [pending, post, selected, view.composer.enabled],
  );

  const q = search.trim().toLowerCase();
  const visibleThreads = useMemo(() => {
    // an agent picked from New chat shows in the rail until it has a thread of its own
    const rows = [...threads];
    if (!rows.some((t) => t.agentId === selected)) {
      const r = roster.find((x) => x.id === selected);
      if (r) rows.splice(1, 0, { agentId: r.id, name: r.name, role: r.description ?? '', pinned: false, lastMessage: null, lastAt: null, lastRole: null, messageCount: 0, avatar: r.avatar });
    }
    return q ? rows.filter((t) => `${t.name} ${t.lastMessage ?? ''}`.toLowerCase().includes(q)) : rows;
  }, [threads, roster, selected, q]);
  const visibleRoster = useMemo(() => (q ? roster.filter((r) => `${r.name} ${r.description ?? ''}`.toLowerCase().includes(q)) : roster), [roster, q]);

  const current = loaded[selected];
  const rowFor = threads.find((t) => t.agentId === selected) ?? null;
  const rosterFor = roster.find((r) => r.id === selected) ?? null;
  const header = {
    agentId: selected,
    name: current?.thread?.name ?? rowFor?.name ?? rosterFor?.name ?? (selected === WIZARD ? 'Wizard' : selected),
    role: current?.thread?.role ?? rowFor?.role ?? rosterFor?.description ?? '',
    avatar: current?.thread?.avatar ?? rowFor?.avatar ?? rosterFor?.avatar ?? null,
    wizard: selected === WIZARD,
    projectName: current?.thread?.projectName ?? null,
  };
  const isNew = !current && !rowFor; // picked from New chat: nothing to load yet

  // a picked agent with no thread is ready at once (empty), not a load
  useEffect(() => {
    if (isNew && rosterFor) setLoaded((l) => (l[selected] ? l : { ...l, [selected]: { status: 'ready', thread: null, messages: [] } }));
  }, [isNew, rosterFor, selected]);

  return {
    view,
    now,
    threads: visibleThreads,
    allThreadsCount: threads.length,
    roster: visibleRoster,
    rosterTotal: roster.length,
    selected,
    select,
    header,
    status: current?.status ?? (isNew ? 'ready' : 'loading'),
    error: current?.error ?? null,
    messages: current?.messages ?? [],
    pending: pending[selected] ?? [],
    routed: selected === WIZARD ? routed : [],
    busy: (pending[selected] ?? []).some((p) => p.state === 'sending'),
    reload: () => load(selected),
    send,
    retry,
    draft,
    setDraft,
    search,
    setSearch,
    picking,
    setPicking,
    collapsed,
    toggleRail,
    mobileView,
    back,
  };
}

export type ChatsState = ReturnType<typeof useChats>;
