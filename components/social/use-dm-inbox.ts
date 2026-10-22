'use client';

import { useMemo, useState } from 'react';
import type { DmThread } from '@/lib/social';
import type { SocialDmMessage } from '@/lib/schemas';

/**
 * The Instagram DM inbox state, shared by both UI styles (glados-ui SPEC X5).
 * Replies send for real via ManyChat (POST /api/social/dm/reply); a failed or
 * unconfigured send shows inline and appends nothing.
 */

/** Compact relative time (mirrors the /comms feed style). */
export function relativeTime(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Regroup a flat message list into conversations, newest thread first — the
    client-side twin of lib/social dmThreads(), so a sent reply reflows the
    inbox without a round trip. */
export function groupThreads(messages: SocialDmMessage[]): DmThread[] {
  const groups = new Map<string, SocialDmMessage[]>();
  for (const m of messages) {
    const arr = groups.get(m.subscriberId) ?? [];
    arr.push(m);
    groups.set(m.subscriberId, arr);
  }
  const threads: DmThread[] = [];
  for (const [subscriberId, list] of groups) {
    const chrono = [...list].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const last = chrono[chrono.length - 1];
    threads.push({ subscriberId, name: last.name, handle: last.handle, messages: chrono, last, unreplied: last.direction === 'in' });
  }
  threads.sort((a, b) => (a.last.ts < b.last.ts ? 1 : a.last.ts > b.last.ts ? -1 : 0));
  return threads;
}

export function useDmInbox(initial: DmThread[]) {
  const [messages, setMessages] = useState<SocialDmMessage[]>(() => initial.flatMap((t) => t.messages));
  const threads = useMemo(() => groupThreads(messages), [messages]);

  const [selected, setSelected] = useState<string | null>(initial[0]?.subscriberId ?? null);
  const active = threads.find((t) => t.subscriberId === selected) ?? threads[0] ?? null;

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLive = messages.some((m) => m.source === 'manychat');

  async function send() {
    if (!active || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/social/dm/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriberId: active.subscriberId, text: draft.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Send failed — connect ManyChat (MANYCHAT_API_KEY) to reply.');
        return;
      }
      setMessages((prev) => [body.message as SocialDmMessage, ...prev]);
      setDraft('');
    } catch {
      setError('Network error while sending.');
    } finally {
      setSending(false);
    }
  }

  return { threads, active, setSelected, draft, setDraft, sending, error, isLive, send };
}
