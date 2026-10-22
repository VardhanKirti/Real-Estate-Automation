'use client';

/**
 * State shared by the GladOS and Classic presentations of the Comms additions
 * (F3, F4): read marks on the digest and the on-demand recordings refresh.
 * Both trees call these, so behaviour cannot drift between styles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { entryKey, type DigestEntry } from '@/lib/comms-digest';
import type { DigestPanelData, RecordingsData } from '@/lib/comms-extras';
import { useToast } from '@/components/ui/Toast';

/** Fired when the digest is marked read, so the sidebar's unread dot clears at once. */
export const DIGEST_READ_EVENT = 'glados:digest-read';

export function useDigestReads(data: DigestPanelData) {
  const { toast } = useToast();
  const [read, setRead] = useState(data.read);
  const [cleared, setCleared] = useState<string[]>(data.clearedKeys);
  const id = data.digest?.id ?? null;

  const post = useCallback(
    async (method: 'POST' | 'DELETE', key?: string) => {
      if (!id || data.sample) return true; // a fixture is never written
      const res = await fetch('/api/comms/digest/read', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ digestId: id, ...(key ? { entryKey: key } : {}) }),
      }).catch(() => null);
      return Boolean(res?.ok);
    },
    [id, data.sample],
  );

  /** Opening the digest marks the whole report read (clears the unread dot). */
  const markRead = useCallback(async () => {
    if (read || !id) return;
    setRead(true);
    if (await post('POST')) window.dispatchEvent(new Event(DIGEST_READ_EVENT));
    else setRead(false);
  }, [read, id, post]);

  const clear = useCallback(
    async (e: DigestEntry) => {
      const key = entryKey(e);
      setCleared((c) => [...c, key]);
      const ok = await post('POST', key);
      if (!ok) {
        setCleared((c) => c.filter((k) => k !== key));
        toast({ text: 'Could not clear that entry. Try again.', tone: 'err' });
        return;
      }
      toast({
        text: data.sample ? `Cleared ${e.sender} (sample, not saved)` : `Cleared ${e.sender}`,
        action: {
          label: 'Undo',
          onClick: async () => {
            setCleared((c) => c.filter((k) => k !== key));
            await post('DELETE', key);
          },
        },
      });
    },
    [post, toast, data.sample],
  );

  return { read, cleared, markRead, clear };
}

/**
 * Recordings: the server render shows what SQLite holds; opening the tab asks
 * GET /api/calls/archive once, which pulls Fathom (a free read, at most every
 * 10 minutes) and reports a per-source error without blanking the list.
 */
export function useRecordings(initial: RecordingsData, active: boolean) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/calls/archive${initial.sample ? '?sample=1' : ''}`);
      if (res.ok) {
        const body = (await res.json()) as { recordings: RecordingsData['rows']; sources: RecordingsData['sources']; sample: boolean };
        setData({ rows: body.recordings, sources: body.sources, sample: body.sample });
      }
    } catch {
      /* keep the last good list */
    } finally {
      setBusy(false);
    }
  }, [initial.sample]);

  useEffect(() => {
    if (!active || asked.current || !initial.sources.fathom.configured) return;
    asked.current = true;
    void refresh();
  }, [active, initial.sources.fathom.configured, refresh]);

  return { data, busy, refresh };
}

/** "07:12" in the viewer's clock. */
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
/** "Mon 12 Oct" */
export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
/** Slack ts ("1712345678.000100") to ISO. */
export const slackIso = (ts: string) => new Date(Number(ts) * 1000).toISOString();
