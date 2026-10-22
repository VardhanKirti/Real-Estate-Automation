'use client';
/**
 * Count-up of hero and Pipeline numbers (03.4). Every frame's text comes from COUNT_FORMAT (01's
 * formatters), so the last frame equals the resting text. Server render and reduced motion show the
 * formatted target; a hook that starts more than 250 ms after the intro began skips the count, so the
 * page never shows real value, then 0, then counting.
 */
import { useEffect, useRef, useState } from 'react';
import { COUNT_FORMAT, countUpFrame, type CountKind } from '@/lib/lab/motion';
import { prefersReducedMotion } from './useReducedMotion';

export const LATE_HYDRATION_MS = 250;

export type CountUpOpts = {
  kind: CountKind;
  durationMs: number;
  delayMs?: number;
  /** Start value; default 0 on the first run, then the value last shown (Pipeline tick-up). */
  from?: number;
  enabled: boolean;
  /** performance.now() at intro start, for the late-hydration rule. */
  introT0?: number | null;
};

export function useLabCountUp(target: number | null, opts: CountUpOpts): string {
  const fmt = COUNT_FORMAT[opts.kind];
  const rest = target === null || !Number.isFinite(target) ? '' : fmt(target);
  const [text, setText] = useState(rest);
  const shown = useRef<number | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (target === null || !Number.isFinite(target)) {
      setText('');
      return;
    }
    const late = typeof opts.introT0 === 'number' && performance.now() - opts.introT0 > LATE_HYDRATION_MS;
    const from = opts.from ?? shown.current ?? 0;
    if (!opts.enabled || late || prefersReducedMotion() || from === target) {
      shown.current = target;
      setText(fmt(target));
      return;
    }
    const start = performance.now() + (opts.delayMs ?? 0);
    setText(fmt(from));
    const step = (now: number) => {
      const p = Math.max(0, (now - start) / opts.durationMs);
      setText(countUpFrame(from, target, p, fmt));
      if (p < 1) raf.current = requestAnimationFrame(step);
      else shown.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, opts.enabled, opts.kind, opts.durationMs]);

  return text;
}
