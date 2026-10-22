'use client';
/**
 * Every Lab v2 write (01 4.4), moved from v1's components/lab/g/actions.ts with its status handling,
 * plus: 422 shows the server's reason as an info toast; 402 opens the tree's CapDialog everywhere
 * ("Pass the cap once" re-sends the same body with `override: true`), fixing v1's Run-now-only gap;
 * 501 says nothing changed. Success refreshes the server view unless told not to.
 */
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useToast } from '@/components/g';
import { LAB_COPY } from '@/lib/lab/view/copy';

export type LabPostResult = { ok: boolean; status: number; data: Record<string, unknown> };
export type LabPostOpts = {
  key?: string;
  okText?: string | ((data: Record<string, unknown>) => string | null);
  /** 503 copy (scripts vs generate). */
  cliText?: string;
  /** 402 handler that replaces the CapDialog. */
  onCap?: (retry: () => void, data: Record<string, unknown>) => void;
  refresh?: boolean;
  method?: 'POST' | 'PATCH' | 'DELETE';
  /** 402 opens the CapDialog with a re-send (default true). Set false for a cap of 0 (no pass-once, 07 7.19). */
  capRetry?: boolean;
  /** Errors the caller shows inline instead of a toast (e.g. the New idea form's 422). */
  inline?: number[];
  /** No error toast at all except 501; a 402 still opens the CapDialog (the caller reads the result). */
  quiet?: boolean;
  onOk?: (r: LabPostResult) => void;
};

export type CapAsk = { text: string; retry: () => void } | null;
export type CapRequest = { capAsk: string; retry: () => Promise<LabPostResult> };
type CapHost = { openCap: (req: CapRequest) => void };
const CapCtx = createContext<CapHost | null>(null);

/** The tree renders its CapDialog and passes `openCap` down through this provider. */
export function LabCapProvider({ openCap, children }: { openCap: CapHost['openCap']; children: ReactNode }) {
  return <CapCtx.Provider value={{ openCap }}>{children}</CapCtx.Provider>;
}

export function isSampleUrl(): boolean {
  return typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('sample') === '1';
}

function withSample(path: string): string {
  try {
    const sample = new URL(window.location.href).searchParams.get('sample') === '1';
    if (!sample) return path;
    return `${path}${path.includes('?') ? '&' : '?'}sample=1`;
  } catch {
    return path;
  }
}

export function useLabPost() {
  const router = useRouter();
  const { toast } = useToast();
  const cap = useContext(CapCtx);
  const [busy, setBusy] = useState<string | null>(null);
  const [capAsk, setCapAsk] = useState<CapAsk>(null);

  const post = useCallback(
    async (path: string, body: Record<string, unknown> | null, opts: LabPostOpts = {}): Promise<LabPostResult> => {
      const key = opts.key ?? path;
      setBusy(key);
      try {
        const res = await fetch(withSample(path), {
          method: opts.method ?? 'POST',
          headers: { 'content-type': 'application/json' },
          body: body === null ? undefined : JSON.stringify(body),
        });
        const data = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
        const msg = typeof data.error === 'string' ? data.error : null;
        const result: LabPostResult = { ok: res.ok && data.ok !== false, status: res.status, data };
        if (result.ok) {
          const t = typeof opts.okText === 'function' ? opts.okText(data) : opts.okText;
          if (t) toast({ text: t, tone: 'ok' });
          opts.onOk?.(result);
          if (opts.refresh !== false) router.refresh();
        } else if (opts.inline?.includes(res.status)) {
          /* the caller shows it */
        } else if (res.status === 501) {
          toast({ text: LAB_COPY.notBuiltToast, tone: 'info', ms: 6000 });
        } else if (res.status === 402) {
          const capAsk = typeof data.capAsk === 'string' ? data.capAsk : msg ?? 'This would pass the monthly cap.';
          if (opts.onCap) {
            opts.onCap(() => void post(path, { ...(body ?? {}), override: true }, opts), data);
          } else if (cap && opts.capRetry !== false && body !== null) {
            cap.openCap({ capAsk, retry: () => post(path, { ...body, override: true }, { ...opts, capRetry: false }) });
          } else if (opts.capRetry !== false && body !== null) {
            setCapAsk({ text: capAsk, retry: () => void post(path, { ...body, override: true }, { ...opts, capRetry: false }) });
          } else {
            toast({ text: capAsk, tone: 'err', ms: 6000 });
          }
        } else if (opts.quiet) {
          /* the caller reads the result */
        } else if (res.status === 503) {
          toast({ text: opts.cliText ?? LAB_COPY.cliMissing, tone: 'info', ms: 6000 });
        } else if (res.status === 422) {
          toast({ text: msg ?? `Request refused (${res.status})`, tone: 'info', ms: 6000 });
        } else {
          const setup = typeof data.setupHref === 'string' ? data.setupHref : null;
          toast({ text: msg ?? `Request failed (${res.status})`, tone: 'err', ms: 6000, action: setup ? { label: 'Set up', onClick: () => router.push(setup) } : undefined });
        }
        return result;
      } catch (err) {
        if (!opts.quiet) toast({ text: `Could not reach the Lab: ${err instanceof Error ? err.message : String(err)}`, tone: 'err' });
        return { ok: false, status: 0, data: {} };
      } finally {
        setBusy(null);
      }
    },
    [router, toast, cap],
  );

  /** `cap`/`closeCap` serve a tree that renders no LabCapProvider (it shows its own CapDialog). */
  return { post, busy, cap: capAsk, closeCap: () => setCapAsk(null) };
}
