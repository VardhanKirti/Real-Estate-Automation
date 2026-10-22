'use client';
/**
 * The sheet open and close FLIP (03.12). Origin comes from 02's useSharedOrigin; this hook defines no
 * origin registry. Durations and easings come only from lib/lab/motion.ts.
 */
import { LAB_DUR, LAB_EASE, cornerRadiusAtScale, flipFrom, originUsable, type Rect } from '@/lib/lab/motion';
import { prefersReducedMotion } from './useReducedMotion';

export type FlipParts = {
  layer: HTMLElement;
  panel: HTMLElement;
  content: HTMLElement;
  scrim: HTMLElement;
};

const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const vp = () => ({ w: window.innerWidth, h: window.innerHeight });

export function sharedElement(originId: string | null | undefined): HTMLElement | null {
  if (!originId || typeof document === 'undefined') return null;
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(originId) : originId.replace(/"/g, '\\"');
  return document.querySelector<HTMLElement>(`[data-lab-shared="${esc}"]`);
}

function originRadius(el: HTMLElement | null): number {
  if (!el) return 24;
  const v = parseFloat(getComputedStyle(el).borderTopLeftRadius);
  return Number.isFinite(v) ? v : 24;
}

function sheetRadius(panel: HTMLElement): string {
  return getComputedStyle(panel).borderTopLeftRadius || '28px';
}

/** Where a sheet without a usable origin slides from: the right edge on wide screens, below on phones. */
function slideOffset(): string {
  return window.innerWidth <= 600 ? 'translateY(24px)' : 'translateX(32px)';
}

function makeGhost(parts: FlipParts, target: Rect): HTMLElement {
  const g = document.createElement('div');
  g.className = 'lab2-sheet-ghost';
  g.setAttribute('aria-hidden', 'true');
  Object.assign(g.style, { left: `${target.x}px`, top: `${target.y}px`, width: `${target.w}px`, height: `${target.h}px` });
  parts.layer.appendChild(g);
  return g;
}

/** Run the open motion. Resolves when it has finished (or at once under reduced motion). */
export async function flipOpen(parts: FlipParts, origin: HTMLElement | null): Promise<void> {
  if (prefersReducedMotion() || typeof parts.panel.animate !== 'function') return;
  const target = toRect(parts.panel.getBoundingClientRect());
  const o = origin ? toRect(origin.getBoundingClientRect()) : null;
  const base = { duration: LAB_DUR.m, easing: LAB_EASE.out, fill: 'both' as const };
  if (!o || !originUsable(o, vp())) {
    parts.scrim.animate([{ opacity: 0 }, { opacity: 1 }], { ...base, duration: LAB_DUR.enter });
    await parts.panel.animate([{ opacity: 0, transform: slideOffset() }, { opacity: 1, transform: 'none' }], { ...base, duration: LAB_DUR.enter }).finished.catch(() => {});
    return;
  }
  const f = flipFrom(o, target);
  const ghost = makeGhost(parts, target);
  parts.panel.setAttribute('data-flying', '');
  origin?.style.setProperty('opacity', '0');
  const r0 = cornerRadiusAtScale(originRadius(origin), f.sx, f.sy);
  const anim = ghost.animate(
    [
      { transform: `translate(${f.tx}px, ${f.ty}px) scale(${f.sx}, ${f.sy})`, borderRadius: r0 },
      { transform: 'none', borderRadius: sheetRadius(parts.panel) },
    ],
    base,
  );
  parts.scrim.animate([{ opacity: 0 }, { opacity: 1 }], base);
  parts.content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: LAB_DUR.m - LAB_DUR.xs, delay: LAB_DUR.xs, easing: LAB_EASE.out, fill: 'both' });
  await anim.finished.catch(() => {});
  ghost.remove();
  parts.panel.removeAttribute('data-flying');
  origin?.style.removeProperty('opacity');
}

/** Run the close motion back to the origin when it is still usable, else a plain fade. */
export async function flipClose(parts: FlipParts, origin: HTMLElement | null): Promise<void> {
  if (prefersReducedMotion() || typeof parts.panel.animate !== 'function') return;
  const target = toRect(parts.panel.getBoundingClientRect());
  const o = origin ? toRect(origin.getBoundingClientRect()) : null;
  const ease = { easing: LAB_EASE.in, fill: 'both' as const };
  if (!o || !originUsable(o, vp())) {
    parts.scrim.animate([{ opacity: 1 }, { opacity: 0 }], { ...ease, duration: LAB_DUR.s });
    await parts.panel.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: slideOffset() }], { ...ease, duration: LAB_DUR.s - 20 }).finished.catch(() => {});
    return;
  }
  const f = flipFrom(o, target);
  parts.content.animate([{ opacity: 1 }, { opacity: 0 }], { ...ease, duration: LAB_DUR.xs - 20 });
  const ghost = makeGhost(parts, target);
  parts.panel.setAttribute('data-flying', '');
  parts.scrim.animate([{ opacity: 1 }, { opacity: 0 }], { ...ease, duration: LAB_DUR.s });
  await ghost.animate(
    [
      { transform: 'none', borderRadius: sheetRadius(parts.panel) },
      { transform: `translate(${f.tx}px, ${f.ty}px) scale(${f.sx}, ${f.sy})`, borderRadius: cornerRadiusAtScale(originRadius(origin), f.sx, f.sy) },
    ],
    { ...ease, duration: LAB_DUR.s },
  ).finished.catch(() => {});
  ghost.remove();
}
