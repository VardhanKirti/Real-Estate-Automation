'use client';
/**
 * Classic tree client plumbing: the 17.5 discard guard, the shared-element origin, replace-only params,
 * and the run progress poller (09.4.3, C20). Writes and the sheet URL contract are the shared
 * components/lab/v2/shared/{useLabPost,useSheetRoute} both trees use (01 1).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BatchProgress } from '@/lib/lab/setup/progress';

export type { LabPostResult } from '@/components/lab/v2/shared/useLabPost';

/**
 * 01 17.5: a sheet with unsaved edits registers a guard. Close calls it with the close itself; the guard
 * returns false to hold the close (it shows its Discard dialog and calls `proceed` on Discard).
 */
export const sheetGuard: { fn: null | ((proceed: () => void) => boolean) } = { fn: null };

/** The data-lab-shared id of the element the viewer last clicked (02 13, 03.12.1). */
export function useLastOrigin() {
  const last = useRef<string | null>(null);
  useEffect(() => {
    const on = (e: MouseEvent | KeyboardEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-lab-shared]');
      if (el) last.current = el.getAttribute('data-lab-shared');
      else if (e.type === 'click') last.current = null;
    };
    document.addEventListener('click', on, true);
    document.addEventListener('keydown', on, true);
    return () => {
      document.removeEventListener('click', on, true);
      document.removeEventListener('keydown', on, true);
    };
  }, []);
  return last;
}

/** D3: filters, period, hero platform and segment replace the URL and never add history. */
export function useReplaceParams() {
  const router = useRouter();
  return useCallback(
    (set: Record<string, string | null>, opts: { rerender?: boolean } = {}) => {
      const u = new URL(window.location.href);
      for (const [k, v] of Object.entries(set)) {
        if (v === null) u.searchParams.delete(k);
        else u.searchParams.set(k, v);
      }
      if (opts.rerender === false) window.history.replaceState(null, '', u);
      else router.replace(u.pathname + u.search, { scroll: false });
    },
    [router],
  );
}

/** True at >= the given width; false on the server. */
export function useMinWidth(px: number): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(min-width: ${px}px)`);
    const on = () => setOk(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [px]);
  return ok;
}

/** 09.4.3 and C20: 4 s, then 8 s after 2 minutes, 15 s after 10 minutes; never while hidden. */
export function pollDelay(elapsedMs: number, failures: number): number {
  const base = elapsedMs >= 600_000 ? 15_000 : elapsedMs >= 120_000 ? 8_000 : 4_000;
  return failures > 0 ? Math.min(60_000, base * 2 ** failures) : base;
}

export function useRunProgress(batchId: string | null, opts: { onDone?: () => void } = {}) {
  const router = useRouter();
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const done = useRef(opts.onDone);
  done.current = opts.onDone;
  useEffect(() => {
    if (!batchId) { setBatch(null); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const t0 = Date.now();
    const tick = async () => {
      timer = null;
      if (!live) return;
      if (document.visibilityState === 'hidden') return;
      try {
        const sample = new URL(window.location.href).searchParams.get('sample') === '1';
        const res = await fetch(`/api/lab/runs?batch=${encodeURIComponent(batchId)}${sample ? '&sample=1' : ''}`);
        const data = (await res.json()) as { batch?: BatchProgress | null };
        if (!live) return;
        failures = 0;
        const b = data.batch ?? null;
        setBatch(b);
        if (b && (b.state === 'done' || b.state === 'failed' || b.state === 'stopped')) {
          done.current?.();
          router.refresh();
          return;
        }
      } catch {
        failures += 1;
      }
      if (live) timer = setTimeout(tick, pollDelay(Date.now() - t0, failures));
    };
    const onVis = () => {
      if (document.visibilityState === 'visible' && !timer && live) void tick();
      else if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; }
    };
    document.addEventListener('visibilitychange', onVis);
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [batchId, router]);
  return batch;
}

/** localStorage, wrapped (01 7.8, 8.4): every access in try/catch. */
export const store = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string | null): void {
    try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* storage blocked */ }
  },
};
