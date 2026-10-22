'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { getCursor, setCursor, subscribeCursor } from '@/lib/chart-sync';
import { GButton } from './Controls';
import { GEmpty } from './States';

/**
 * Internals shared by the kit's data viz (components/g, lane 1e). Not
 * exported from the kit barrel: pages use the primitives, not these.
 */

/** Every colour a viz primitive accepts: a token slot, never a literal (S00 AC00.13). */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6;
export type CatSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type VizColor =
  | `series-${SeriesSlot}`
  | `cat-${CatSlot}`
  | 'accent'
  | 'accent-2'
  | 'ink'
  | 'muted'
  | 'dim'
  | 'ok'
  | 'warn'
  | 'err'
  | 'track'
  | 'track-soft'
  | 'on-hero';

/** `var(--g-<token>)` for a VizColor. */
export function colorVar(c: VizColor): string {
  return `var(--g-${c})`;
}

/** Default categorical colour for the n-th item: series 1 to 6, then categorical 7 to 11 (X2), never cycled silently. */
export function slotColor(i: number): VizColor {
  if (i < 6) return `series-${(i + 1) as SeriesSlot}`;
  return `cat-${Math.min(11, i + 1) as CatSlot}`;
}

export type VizStateKind = 'ready' | 'loading' | 'empty' | 'error';

/** The shared state props every chart takes (S00 §5.3: loading skeleton, empty inside the card, error line). */
export type VizStateProps = {
  /** default 'ready' */
  state?: VizStateKind;
  /** what the empty state says; a page passes its own `GEmpty` (with a SetupLink when unconfigured) through `empty` */
  emptyText?: string;
  empty?: ReactNode;
  /** the error message (state 'error') */
  error?: string;
  onRetry?: () => void;
};

/**
 * Loading, empty and error bodies at the chart's final height, so a state
 * change never shifts layout. Returns null for 'ready'.
 */
export function VizStateBody({ state = 'ready', emptyText = 'No data in this range.', empty, error, onRetry, height }: VizStateProps & { height: number }) {
  if (state === 'ready') return null;
  if (state === 'loading') return <div className="g-viz-skel" style={{ height }} aria-busy="true" aria-label="Loading" />;
  if (state === 'error') {
    return (
      <div className="g-viz-state" style={{ minHeight: height }} role="alert">
        <span className="g-viz-error">{error || 'Could not load this chart.'}</span>
        {onRetry && <GButton variant="sm" className="g-viz-act" onClick={onRetry}>Retry</GButton>}
      </div>
    );
  }
  return <div className="g-viz-state" style={{ minHeight: height }}>{empty ?? <GEmpty inline title={emptyText} />}</div>;
}

export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Width of an element, tracked with ResizeObserver. `fallback` until measured (and on the server). */
export function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w || fallback];
}

const noopSub = () => () => {};

/**
 * The chart cursor: shared through `lib/chart-sync.ts` when `syncId` is set
 * (GP3, ACGP3.5), local state otherwise.
 */
export function useCursor(syncId: string | undefined, sourceId: string): [number | null, (i: number | null) => void] {
  const [local, setLocal] = useState<number | null>(null);
  const subscribe = useCallback((fn: () => void) => (syncId ? subscribeCursor(syncId, fn) : noopSub()), [syncId]);
  const shared = useSyncExternalStore(subscribe, () => (syncId ? getCursor(syncId).index : null), () => null);
  const set = useCallback((i: number | null) => {
    if (syncId) setCursor(syncId, i, i === null ? null : sourceId);
    else setLocal(i);
  }, [syncId, sourceId]);
  return [syncId ? shared : local, set];
}

/** A hydration-stable id for SVG defs (gradients), safe inside `url(#…)`. */
export function useVizId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
