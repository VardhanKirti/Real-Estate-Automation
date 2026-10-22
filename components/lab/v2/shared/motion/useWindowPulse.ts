'use client';
/**
 * The once-per-event Window ring (03.6.3). When the Window card's event differs from the last one this
 * viewer saw, one `.lab2-narr-pulse` span contracts once (WAAPI, 900 ms, after the 280 ms cross-fade)
 * and is removed on finish. First visit ever, during the intro, and under reduced motion: the id is
 * stored with no pulse.
 */
import { useEffect, type RefObject } from 'react';
import { LAB_DUR, LAB_EASE } from '@/lib/lab/motion';
import { prefersReducedMotion } from './useReducedMotion';

export const WINDOW_SEEN_KEY = 'lab.window.seen';
let memorySeen: string | null = null;

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(WINDOW_SEEN_KEY) ?? memorySeen;
  } catch {
    return memorySeen;
  }
}

function writeSeen(id: string | null) {
  memorySeen = id;
  try {
    if (id === null) window.localStorage.removeItem(WINDOW_SEEN_KEY);
    else window.localStorage.setItem(WINDOW_SEEN_KEY, id);
  } catch {
    /* module memory keeps it to once per document */
  }
}

/** `ref` is the Window card, an element inside it, or a wrapper around it. */
export function useWindowPulse(ref: RefObject<HTMLElement>, eventId: string | null, introPlaying: boolean): void {
  useEffect(() => {
    if (!eventId) return;
    const seen = readSeen();
    if (seen === eventId) return;
    const card = ref.current?.closest<HTMLElement>('.lab2-narr') ?? ref.current?.querySelector<HTMLElement>(".lab2-narr[data-kind='window']") ?? null;
    const pulse = seen !== null && !introPlaying && !prefersReducedMotion() && !!card && typeof card.animate === 'function';
    writeSeen(eventId);
    if (!pulse || !card) return;
    const span = document.createElement('span');
    span.className = 'lab2-narr-pulse';
    span.setAttribute('aria-hidden', 'true');
    card.appendChild(span);
    const anim = span.animate(
      [
        { opacity: 0.6, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.97)' },
      ],
      { duration: LAB_DUR.pulse, easing: LAB_EASE.out, iterations: 1, delay: 280 },
    );
    let done = false;
    anim.finished.catch(() => {}).finally(() => {
      done = true;
      span.remove();
    });
    return () => {
      // Unmounted before the ring played (a re-mount, React's dev double effect): give the event back so
      // the next mount still pulses once, instead of marking it seen with nothing shown.
      if (!done && anim.playState !== 'finished') writeSeen(seen);
      anim.cancel();
      span.remove();
    };
  }, [ref, eventId, introPlaying]);
}
