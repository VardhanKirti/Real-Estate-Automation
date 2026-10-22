'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UsagePayload } from '@/lib/usage-payload';
import { USAGE_POLL_MS, buildUsageView, type UsageView } from '@/lib/usage-view';

/**
 * The /usage client state shared by every tree: the payload from the first
 * server render, a GET /api/usage poll every 10 s while the tab is visible,
 * the 7 d | 30 d range (kept in ?range=), and the last good reading when a
 * poll fails. The view itself is lib/usage-view.ts, so a tree only renders.
 */
export function useUsage(initial: UsagePayload, initialNow: number, sample: boolean) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(initialNow);
  const [range, setRangeState] = useState<7 | 30>(initial.available ? initial.range : 7);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const poll = useCallback(
    async (r: 7 | 30 = rangeRef.current) => {
      const q = new URLSearchParams({ range: String(r) });
      if (sample) q.set('sample', '1');
      setBusy(true);
      try {
        const res = await fetch(`/api/usage?${q}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as UsagePayload;
        if (r !== rangeRef.current) return;
        setData(next);
        setNow(Date.now());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setNow(Date.now());
      } finally {
        setBusy(false);
      }
    },
    [sample],
  );

  const live = data.available;
  useEffect(() => {
    if (!live) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    const id = window.setInterval(tick, USAGE_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [live, poll]);

  const setRange = useCallback(
    (r: 7 | 30) => {
      setRangeState(r);
      rangeRef.current = r;
      const url = new URL(window.location.href);
      if (r === 7) url.searchParams.delete('range');
      else url.searchParams.set('range', String(r));
      window.history.replaceState(window.history.state, '', url);
      void poll(r);
    },
    [poll],
  );

  const view: UsageView = useMemo(() => buildUsageView(data, now), [data, now]);
  const lastGoodAgo = view.kind === 'ready' ? view.readAgo : null;
  return {
    data,
    view,
    range,
    setRange,
    error,
    lastGoodAgo,
    busy,
    retry: () => void poll(),
  };
}

/** The push endpoint as another machine must call it. */
export function pushUrl(path: string): string {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}
