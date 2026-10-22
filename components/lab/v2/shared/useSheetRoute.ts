'use client';
/**
 * Sheets in the URL (01 2.2, 13). One open at a time; opening pushes history (back closes), inner tab
 * and version use replaceState, `pushState`/`replaceState` are called with null state (v1 lesson).
 * Any click on a same-page link that carries a sheet param is intercepted here (capture phase, so a
 * Tile's own router.push never runs), the opener's `data-lab-shared` id is kept for the FLIP, and the
 * sheet body is read from `GET /api/lab/sheet` (01 D14). A sheet the server already resolved (refresh,
 * deep link, or a router.refresh() after a write) arrives as `initial` and replaces the payload.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SheetPayload } from '@/lib/lab/view/index';
import { SHEET_PRECEDENCE } from '@/lib/lab/view/shared';
import type { SheetKind } from '@/lib/lab/view/shared';

export const SHEET_PARAMS: readonly SheetKind[] = SHEET_PRECEDENCE;
const INNER = ['st', 'ver'] as const;

export type SheetState = {
  kind: SheetKind;
  id: string;
  payload: SheetPayload | null;
  loading: boolean;
  error: string | null;
  originId: string | null;
  /** Title from the clicked element's data-sheet-title, shown while loading (01 13.2). */
  title: string | null;
};

/** URLs the Lab pushed in this document (01 2.2: tracked in a module Set, not history.state). */
const pushedHere = new Set<string>();

/** The winning sheet param of a URL (01 D4). */
export function sheetFromUrl(u: URL): { kind: SheetKind; id: string } | null {
  for (const k of SHEET_PRECEDENCE) {
    const v = u.searchParams.get(k);
    if (v !== null && v !== '') return { kind: k, id: v };
  }
  return null;
}

/** Studio at 768px and wider treats ?idea= as a selection, not a sheet (01 D5). */
function isStudioSelection(u: URL, kind: SheetKind): boolean {
  if (kind !== 'idea' || !u.pathname.startsWith('/lab/studio')) return false;
  try {
    return window.matchMedia('(min-width: 768px)').matches;
  } catch {
    return true;
  }
}

function sheetFetchUrl(kind: SheetKind, id: string, u: URL): string {
  const q = new URLSearchParams();
  q.set(kind, id);
  for (const k of INNER) {
    const v = u.searchParams.get(k);
    if (v) q.set(k, v);
  }
  if (kind === 'test' && u.searchParams.get('post')) q.set('post', u.searchParams.get('post') as string);
  if (kind === 'setup' && u.searchParams.get('focus')) q.set('focus', u.searchParams.get('focus') as string);
  if (u.searchParams.get('sample') === '1') q.set('sample', '1');
  return `/api/lab/sheet?${q.toString()}`;
}

export function useSheetRoute(initial: SheetPayload | null) {
  const [state, setState] = useState<SheetState | null>(() =>
    initial ? { kind: initial.kind, id: initial.id, payload: initial, loading: false, error: null, originId: null, title: null } : null,
  );
  const seq = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // A server re-render (router.refresh after a write, or a deep link) brings the sheet's fresh payload.
  useEffect(() => {
    if (!initial) return;
    setState((s) =>
      s && s.kind === initial.kind && s.id === initial.id
        ? { ...s, payload: initial, loading: false, error: null }
        : s ?? { kind: initial.kind, id: initial.id, payload: initial, loading: false, error: null, originId: null, title: null },
    );
  }, [initial]);

  const load = useCallback(async (kind: SheetKind, id: string, u: URL) => {
    const n = ++seq.current;
    try {
      const res = await fetch(sheetFetchUrl(kind, id, u), { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { sheet?: SheetPayload; error?: string };
      if (n !== seq.current) return; // a newer sheet opened since (01 13.2)
      if (!res.ok || !data.sheet) {
        setState((s) => (s && s.kind === kind && s.id === id ? { ...s, loading: false, error: data.error ?? `HTTP ${res.status}` } : s));
        return;
      }
      setState((s) => (s && s.kind === kind && s.id === id ? { ...s, payload: data.sheet as SheetPayload, loading: false, error: null } : s));
    } catch (err) {
      if (n !== seq.current) return;
      setState((s) => (s && s.kind === kind && s.id === id ? { ...s, loading: false, error: err instanceof Error ? err.message : String(err) } : s));
    }
  }, []);

  const open = useCallback(
    (kind: SheetKind, id: string, opts: { originId?: string | null; title?: string | null; extra?: Record<string, string> } = {}) => {
      const u = new URL(window.location.href);
      for (const k of SHEET_PARAMS) u.searchParams.delete(k);
      for (const k of INNER) u.searchParams.delete(k);
      u.searchParams.delete('focus');
      u.searchParams.set(kind, id);
      for (const [k, v] of Object.entries(opts.extra ?? {})) u.searchParams.set(k, v);
      const href = u.pathname + u.search + u.hash;
      window.history.pushState(null, '', href);
      pushedHere.add(href);
      setState({ kind, id, payload: null, loading: true, error: null, originId: opts.originId ?? null, title: opts.title ?? null });
      void load(kind, id, u);
    },
    [load],
  );

  const close = useCallback(() => {
    const here = window.location.pathname + window.location.search + window.location.hash;
    seq.current++;
    setState(null);
    if (pushedHere.has(here)) {
      pushedHere.delete(here);
      window.history.back();
      return;
    }
    const u = new URL(window.location.href);
    for (const k of SHEET_PARAMS) u.searchParams.delete(k);
    for (const k of INNER) u.searchParams.delete(k);
    u.searchParams.delete('focus');
    u.searchParams.delete('oauth');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  }, []);

  /** Inner tab (`st`) and version (`ver`): replaceState, no history entry (01 D2). */
  const setInner = useCallback((key: 'st' | 'ver', value: string | null) => {
    const u = new URL(window.location.href);
    if (value === null) u.searchParams.delete(key);
    else u.searchParams.set(key, value);
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  }, []);

  const reload = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    setState({ ...s, loading: true, error: null });
    void load(s.kind, s.id, new URL(window.location.href));
  }, [load]);

  // Back and forward: a sheet param opens that sheet, none closes it (no further history call).
  useEffect(() => {
    const onPop = () => {
      const u = new URL(window.location.href);
      const s = sheetFromUrl(u);
      if (!s || isStudioSelection(u, s.kind)) {
        seq.current++;
        setState(null);
        return;
      }
      const cur = stateRef.current;
      if (cur && cur.kind === s.kind && cur.id === s.id) return;
      setState({ kind: s.kind, id: s.id, payload: null, loading: true, error: null, originId: null, title: null });
      void load(s.kind, s.id, u);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [load]);

  // D4: extra sheet params on mount are dropped with replaceState.
  useEffect(() => {
    const u = new URL(window.location.href);
    const win = sheetFromUrl(u);
    if (!win) return;
    let changed = false;
    for (const k of SHEET_PARAMS) {
      if (k !== win.kind && u.searchParams.has(k) && !(win.kind === 'test' && k === 'post')) {
        u.searchParams.delete(k);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  }, []);

  // Same-page links carrying a sheet param open the sheet in place.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download') || a.closest('[data-lab-no-sheet]')) return;
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('?') && !href.startsWith(window.location.pathname)) return;
      const u = new URL(href, window.location.href);
      if (u.origin !== window.location.origin || u.pathname !== window.location.pathname) return;
      const s = sheetFromUrl(u);
      if (!s || isStudioSelection(u, s.kind)) return;
      e.preventDefault();
      const extra: Record<string, string> = {};
      for (const [k, v] of u.searchParams) if (!SHEET_PARAMS.includes(k as SheetKind) && k !== 'sample') extra[k] = v;
      // ?test=new&post=<id> pre-fills arm A; D4 keeps `test` as the open sheet and passes `post` on.
      if (s.kind === 'test' && u.searchParams.get('post')) extra.post = u.searchParams.get('post') as string;
      const origin = a.closest('[data-lab-shared]')?.getAttribute('data-lab-shared') ?? null;
      open(s.kind, s.id, { originId: origin, title: a.getAttribute('data-sheet-title'), extra });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [open]);

  return { state, open, close, setInner, reload };
}

/**
 * Open a sheet from code (search submit, a form) through the same path a link click takes, so history,
 * the origin and the loader stay in one place.
 */
export function openSheetHref(href: string, opts: { title?: string; originId?: string } = {}): void {
  const a = document.createElement('a');
  a.href = href;
  if (opts.title) a.setAttribute('data-sheet-title', opts.title);
  a.style.display = 'none';
  const origin = opts.originId ? document.querySelector(`[data-lab-shared="${CSS.escape(opts.originId)}"]`) : null;
  const host = origin ?? document.querySelector('.lab2-page') ?? document.body;
  host.appendChild(a);
  a.click();
  a.remove();
}
