'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Instant feedback for in-app link clicks (perf). A thin accent bar across the top of the content
 * column from the click until the new URL commits. It holds no data and never blocks: Next keeps
 * navigating exactly as before; this only listens. Hidden for the first 80ms (CSS) so a fast
 * navigation never flashes it, and cleared after 15s whatever happens (a click a handler cancelled).
 *
 * Used instead of a root loading.tsx, which would add React's 300ms fallback throttle to every
 * fast route (components/RouteSkeleton.tsx).
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);

  useEffect(() => setBusy(false), [pathname, search]);

  useEffect(() => {
    if (!busy) return;
    const t = window.setTimeout(() => setBusy(false), 15_000);
    return () => window.clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    // Capture phase: next/link calls preventDefault in its own handler, so a bubbling listener
    // could not tell a Link click from a cancelled one.
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith('/api/') || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setBusy(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return busy ? <div className="nav-progress" aria-hidden="true" /> : null;
}
