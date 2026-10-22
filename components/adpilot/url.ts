'use client';

/**
 * AdPilot keeps its selection in the URL (S01 F9 `?campaign=`, G2 `?ad=` and
 * `?brand=`). Updates replace the current entry without a server round trip:
 * Next 14.2 syncs `history.replaceState` into `useSearchParams`, so the deck
 * and the library both see the change. Each update starts from the live
 * location, so two writers never overwrite each other's parameter.
 */
export function patchUrlParams(patch: Record<string, string | null>): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.replaceState(null, '', next);
}

/** Read and write a per-viewer convenience; storage can be missing or throw. */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private window or blocked storage: the page works without it */
  }
}

/** True when the viewer asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
