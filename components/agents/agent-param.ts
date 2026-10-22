'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * `?agent=<id>` opens the AgentSheet on any workforce page (glados-ui SPEC
 * S04 F0.3, §7). The URL is written with replaceState so opening a profile
 * never adds a history entry and never refetches the page; the sheet keeps
 * its own back stack for "Works with" hops (edge 6).
 */
export const AGENT_PARAM = 'agent';
const EVENT = 'agent-sheet:change';

function readParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URL(window.location.href).searchParams.get(AGENT_PARAM);
}

/** Open (or switch) the sheet to this agent. */
export function openAgentSheet(id: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(AGENT_PARAM, id);
  else url.searchParams.delete(AGENT_PARAM);
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** The agent id in the URL, kept current across openAgentSheet calls and back/forward. */
export function useAgentParam(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setId(readParam());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  const set = useCallback((next: string | null) => openAgentSheet(next), []);
  return [id, set];
}
