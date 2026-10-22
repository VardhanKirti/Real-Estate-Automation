'use client';

import { useEffect, useState } from 'react';

/**
 * Counts a stat card up to its value on mount (docs/TASKS-REDESIGN.md §6).
 * Honours prefers-reduced-motion by landing on the number immediately, and
 * returns 0 for an absent target so callers can render their own placeholder.
 */
export function useCountUp(target: number | undefined, durationMs = 600): number {
  // Seeded with the real value, not 0: this renders on the server, and a card
  // that shipped "0" in its HTML would be lying to anyone whose JS is slow,
  // blocked, or absent. The climb starts from 0 only once we know we are on a
  // client that can finish it.
  const [n, setN] = useState(target ?? 0);

  useEffect(() => {
    if (target == null) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || target === 0) {
      setN(target);
      return;
    }
    let raf = 0;
    setN(0);
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      // ease-out cubic — fast then settling, like the reference
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return target == null ? 0 : n;
}
