'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterThreads, sortThreads, SOURCES, type InboxSource, type InboxThread, type Range, type Sort, type Triage } from '@/lib/inbox';
import { buildStatCards, type WeeklyInput } from '@/lib/inbox-stats';
import type { ReaderHandle } from './InboxReader';
import { useToast } from '@/components/ui/Toast';
import {
  EMPTY_TRIAGE, browserStorage, loadTriage, saveTriage, setDone as setDoneIn, snooze as snoozeIn,
  snoozedKeys, unsnooze, type TriageStore,
} from '@/lib/inbox-triage';

/**
 * The /inbox state and behaviour (filters, selection, Done and Snooze on this
 * browser with Undo toasts, j/k/e/r and / keys), shared by the Classic
 * InboxWorkspace and the GladOS InboxG (glados-ui SPEC X5).
 */
export function useInboxWorkspace({
  threads,
  connected,
  nowISO,
  weekly,
}: {
  threads: InboxThread[];
  connected: Record<InboxSource, boolean>;
  nowISO: string;
  weekly: WeeklyInput | null;
}) {
  const [source, setSource] = useState<InboxSource | 'all'>('all');
  const [triage, setTriage] = useState<Triage | 'all'>('all');
  const [range, setRange] = useState<Range>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { toast } = useToast();
  // Empty on the server and on first paint; read from this browser after mount.
  const [store, setStore] = useState<TriageStore>(EMPTY_TRIAGE);
  const storeRef = useRef<TriageStore>(EMPTY_TRIAGE);
  const done = useMemo(() => new Set(store.done), [store]);
  const snoozed = useMemo(() => snoozedKeys(store, Date.now()), [store]);
  const readerRef = useRef<ReaderHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Local overrides ride on top of the derived triage until the engine persists them.
  const effective = useMemo(
    () =>
      threads
        .filter((t) => !snoozed.has(t.key))
        .map((t) => (done.has(t.key) ? { ...t, triage: 'done' as const } : t)),
    [threads, done, snoozed],
  );
  const now = useMemo(() => new Date(nowISO), [nowISO]);
  const visible = useMemo(
    () => sortThreads(filterThreads(effective, { source, triage, range, query }, now), sort, now),
    [effective, source, triage, range, query, sort, now],
  );
  const current = useMemo(() => effective.find((t) => t.key === selected) ?? null, [effective, selected]);
  const connectedCount = SOURCES.filter((s) => connected[s.id]).length;
  const cards = useMemo(() => buildStatCards(effective, connected, weekly, now), [effective, connected, weekly, now]);
  const replyCount = useMemo(() => effective.filter((t) => t.triage === 'reply').length, [effective]);

  const move = useCallback(
    (dir: 1 | -1) => {
      if (visible.length === 0) return;
      const i = visible.findIndex((t) => t.key === selected);
      const next = i < 0 ? (dir === 1 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, i + dir));
      setSelected(visible[next].key);
    },
    [visible, selected],
  );
  // Load once the thread keys are known; prunes expired snoozes and keys for
  // threads that no longer exist, and writes the pruned store back.
  useEffect(() => {
    const storage = browserStorage();
    const loaded = loadTriage(storage, Date.now(), threads.map((t) => t.key));
    storeRef.current = loaded;
    setStore(loaded);
    saveTriage(storage, loaded);
  }, [threads]);

  /** Apply a change to the latest store and persist it; true when saved. */
  const apply = useCallback((change: (s: TriageStore) => TriageStore): boolean => {
    const next = change(storeRef.current);
    storeRef.current = next;
    setStore(next);
    return saveTriage(browserStorage(), next);
  }, []);

  const toggleDone = useCallback(() => {
    if (!selected) return;
    const key = selected;
    const wasDone = storeRef.current.done.includes(key);
    const saved = apply((s) => setDoneIn(s, key, !wasDone));
    toast({
      text: wasDone
        ? saved ? 'Back in the inbox. Saved on this browser.' : 'Back in the inbox for this session.'
        : saved ? 'Marked done. Saved on this browser.' : 'Marked done for this session.',
      tone: 'ok',
      action: { label: 'Undo', onClick: () => apply((s) => setDoneIn(s, key, wasDone)) },
      ms: 5000,
    });
  }, [selected, apply, toast]);
  const snooze = useCallback(() => {
    if (!selected) return;
    const key = selected;
    const saved = apply((s) => snoozeIn(s, key, Date.now()));
    setSelected(null);
    toast({
      text: saved ? 'Snoozed for 24 hours. Saved on this browser.' : 'Hidden until you reload.',
      tone: 'ok',
      action: {
        label: 'Undo',
        onClick: () => {
          apply((s) => unsnooze(s, key));
          setSelected(key);
        },
      },
      ms: 5000,
    });
  }, [selected, apply, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) {
        if (e.key === 'Escape') (el as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'e') { e.preventDefault(); toggleDone(); }
      else if (e.key === 'r') { e.preventDefault(); readerRef.current?.focusReply(); }
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, toggleDone]);

  return {
    source, setSource, triage, setTriage, range, setRange, sort, setSort, query, setQuery, selected, setSelected,
    done, effective, now, visible, current, connectedCount, cards, replyCount, toggleDone, snooze, readerRef, searchRef,
  };
}
