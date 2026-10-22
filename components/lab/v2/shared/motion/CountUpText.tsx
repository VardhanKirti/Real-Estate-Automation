'use client';
/**
 * Count-up of an already formatted hero value ('1.2', '17', '$8.20') on page load (03.4, polish pass).
 *
 * No flash, no shift: the server prints the real value twice, once as an invisible ghost that holds the
 * width and once as the live text laid over it. While `data-count='arm'` the live text is held at opacity 0
 * by CSS for at most LAB_COUNT.hideMax (lab-motion.css), so a numeral is never shown real, then 0, then
 * counting. If hydration lands inside that window the count runs from 0; if it lands later (or the
 * viewer prefers reduced motion, or the tab is hidden) the value simply rests. Later prop changes (the
 * platform pager) swap the text without a count. Every frame comes from countUpText, whose last frame is
 * the printed text.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { LAB_COUNT, countUpText, splitNumber } from '@/lib/lab/motion';
import { prefersReducedMotion } from './useReducedMotion';

export function CountUpText({ text, delayMs = 0 }: { text: string; delayMs?: number }) {
  const live = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<'arm' | 'run' | 'done'>('arm');
  const [frame, setFrame] = useState(text);

  useLayoutEffect(() => {
    const el = live.current;
    const held = !!el && getComputedStyle(el).opacity === '0';
    if (!held || prefersReducedMotion() || document.visibilityState === 'hidden' || !splitNumber(text)) {
      setPhase('done');
      return;
    }
    setFrame(countUpText(text, 0));
    setPhase('run');
    const t0 = performance.now() + delayMs;
    let raf = 0;
    const step = () => {
      // performance.now(), not the rAF timestamp: the two clocks part when the document timeline is scaled.
      const p = Math.max(0, (performance.now() - t0) / LAB_COUNT.duration);
      setFrame(countUpText(text, p));
      if (p < 1) raf = requestAnimationFrame(step);
      else setPhase('done');
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // first mount only: a later text change rests at once (no count on the pager)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="lab2-count" data-count={phase}>
      <span className="lab2-count-ghost" aria-hidden="true">{text}</span>
      <span ref={live} className="lab2-count-live">{phase === 'run' ? frame : text}</span>
    </span>
  );
}
