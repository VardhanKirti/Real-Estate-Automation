'use client';
import { useEffect, type RefObject } from 'react';

/**
 * Writes `data-lab-paused` on the element while it is out of view, while the tab is hidden, or while
 * `forcePause` is true (a sheet is open). The drift CSS reads the attribute (03.6.1).
 */
export function useInViewPause(ref: RefObject<HTMLElement>, forcePause = false): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inView = true;
    const apply = () => {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!inView || hidden || forcePause) el.setAttribute('data-lab-paused', '');
      else el.removeAttribute('data-lab-paused');
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) inView = e.isIntersecting;
        apply();
      }, { threshold: 0 });
      io.observe(el);
    }
    document.addEventListener('visibilitychange', apply);
    apply();
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', apply);
    };
  }, [ref, forcePause]);
}
