'use client';
/**
 * Keeps a popover or menu mounted for its close motion. `mounted` stays true for `exitMs` after `open`
 * goes false and `closing` is true in that window, so the element can carry `data-lab-closing` and play
 * the lab2-pop-out keyframe (components/lab/v2/shared/lab-motion.css). Reduced motion unmounts at once.
 */
import { useEffect, useState } from 'react';
import { LAB_POP } from '@/lib/lab/motion';
import { prefersReducedMotion } from './useReducedMotion';

export function usePresence(open: boolean, exitMs: number = LAB_POP.out): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}
