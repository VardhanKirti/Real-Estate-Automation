'use client';
/**
 * Live run state for the whole /lab tree (03.8, 09.4). `LabRunProvider` lives in the /lab layout (via
 * LabRoot) so polling survives navigation between the six pages; each page's frame calls
 * `useResumeRun(frame.run.activeBatch)` so a reload resumes the batch the server says is open.
 * The UI reads progress only through `GET /api/lab/runs?batch=` (01 D14).
 */
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BatchProgress } from '@/lib/lab/setup/progress';
import { RunPoller } from './runPoller';

/** What the Run now pill shows after a batch ends, for a few seconds (03.8). */
export type RunFlash =
  | { kind: 'done'; items: number; usd: number; estimate: number | null }
  | { kind: 'dry' }
  | { kind: 'failed' }
  | { kind: 'stopped'; items: number; usd: number };

export type LabRunState = {
  batchId: string | null;
  batch: BatchProgress | null;
  flash: RunFlash | null;
  start: (batchId: string) => void;
  resume: (batchId: string | null) => void;
  dryDone: () => void;
  clearFlash: () => void;
};

const Ctx = createContext<LabRunState | null>(null);

const FLASH_MS: Record<RunFlash['kind'], number> = { done: 3000, dry: 3000, stopped: 3000, failed: 10_000 };

function sampleSuffix(): string {
  try {
    return new URL(window.location.href).searchParams.get('sample') === '1' ? '&sample=1' : '';
  } catch {
    return '';
  }
}

export function LabRunProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [flash, setFlash] = useState<RunFlash | null>(null);
  const finished = useRef(0);
  const flashTimer = useRef<number | null>(null);

  const showFlash = useCallback((f: RunFlash | null) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash(f);
    if (f) flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS[f.kind]);
  }, []);

  const poller = useMemo(
    () =>
      typeof window === 'undefined'
        ? null
        : new RunPoller({
            fetchBatch: async (id) => {
              const res = await fetch(`/api/lab/runs?batch=${encodeURIComponent(id)}${sampleSuffix()}`, { cache: 'no-store' });
              if (!res.ok) throw new Error(String(res.status));
              const data = (await res.json()) as { batch?: BatchProgress | null };
              return data.batch ?? null;
            },
            now: () => performance.now(),
            setTimer: (fn, ms) => window.setTimeout(fn, ms),
            clearTimer: (t) => window.clearTimeout(t as number),
            hidden: () => document.visibilityState === 'hidden',
            onUpdate: (b) => {
              setBatch(b);
              // New finished runs: refresh so Pipeline numbers tick up to the stored values (03.8).
              if (b.overall.finished > finished.current) {
                finished.current = b.overall.finished;
                router.refresh();
              }
            },
            onEnd: (b) => {
              setBatch(null);
              setBatchId(null);
              finished.current = 0;
              if (b?.state === 'done') showFlash({ kind: 'done', items: b.overall.items, usd: b.overall.usd, estimate: b.overall.estimateUsd });
              else if (b?.state === 'failed') showFlash({ kind: 'failed' });
              else if (b?.state === 'stopped') showFlash({ kind: 'stopped', items: b.overall.items, usd: b.overall.usd });
              router.refresh();
            },
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!poller) return;
    const on = () => poller.visibilityChanged();
    document.addEventListener('visibilitychange', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      poller.stop();
    };
  }, [poller]);

  const resume = useCallback(
    (id: string | null) => {
      if (!id || !poller || poller.active === id) return;
      setBatchId(id);
      finished.current = 0;
      poller.resume(id);
    },
    [poller],
  );

  const value = useMemo<LabRunState>(
    () => ({
      batchId,
      batch,
      flash,
      start: (id) => {
        showFlash(null);
        resume(id);
      },
      resume,
      dryDone: () => showFlash({ kind: 'dry' }),
      clearFlash: () => showFlash(null),
    }),
    [batchId, batch, flash, resume, showFlash],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The provider's state. Pages rendered outside a LabRoot get an inert state (no polling). */
export function useLabRun(): LabRunState {
  const v = useContext(Ctx);
  return (
    v ?? {
      batchId: null,
      batch: null,
      flash: null,
      start: () => {},
      resume: () => {},
      dryDone: () => {},
      clearFlash: () => {},
    }
  );
}

export function useHasLabRunProvider(): boolean {
  return useContext(Ctx) !== null;
}

/** Resume the server's open batch (frame.run.activeBatch) after a reload or a page change. */
export function useResumeRun(activeBatch: string | null): void {
  const { resume } = useLabRun();
  useEffect(() => {
    if (activeBatch) resume(activeBatch);
  }, [activeBatch, resume]);
}
