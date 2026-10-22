'use client';

import { useEffect, useRef, useState } from 'react';
import { countFrame, formatCount, type CountKind } from './format';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * 900 ms ease-out count (FO v1 CountUp). The server and the first client
 * render show the final value (no hydration mismatch, no flash to zero); a
 * later change counts from the number on screen. Reduced motion lands instantly.
 */
export function CountUp({ value, kind = 'int', ms = 900 }: { value: number; kind?: CountKind; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced() || typeof requestAnimationFrame !== 'function') {
      setShown(value);
      from.current = value;
      return;
    }
    const start = from.current;
    if (start === value) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const next = countFrame(start, value, (now - t0) / ms);
      setShown(next);
      if (next !== value) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{formatCount(kind, shown)}</>;
}
