'use client';

import { useRef, type MouseEvent } from 'react';
import { formatFull } from '@/lib/format-number';
import { colorVar, type VizColor } from './viz-shared';

export type GLegendItem = { id: string; label: string; count?: number; color: VizColor; on: boolean };

export type GLegendProps = {
  items: readonly GLegendItem[];
  /** a click toggles one item (each item is an `aria-pressed` button: a legend here is a control, not decoration) */
  onToggle: (id: string) => void;
  /** Alt-click or a 500ms long press shows only this item */
  onIsolate?: (id: string) => void;
  /** `inline` (wraps in a row, default) or `stack` (one per line: a HUD rail) */
  layout?: 'inline' | 'stack';
  label: string;
  className?: string;
};

const LONG_PRESS_MS = 500;

/**
 * GLegend (S00 §5.3, GP3 API from S05 §12.1): 8px round swatches with 11.5
 * muted labels and optional counts. Every item toggles its series; Alt-click
 * or a long press isolates it when `onIsolate` is set.
 */
export function GLegend({ items, onToggle, onIsolate, layout = 'inline', label, className = '' }: GLegendProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef<string | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const onClick = (e: MouseEvent, id: string) => {
    if (pressed.current === id) { pressed.current = null; return; } // a long press already isolated
    if (e.altKey && onIsolate) onIsolate(id);
    else onToggle(id);
  };
  return (
    <ul data-g="GLegend" aria-label={label} className={`g-legend ${className}`} data-layout={layout}>
      {items.map((it) => (
        <li key={it.id}>
          <button
            type="button"
            className="g-legend-item"
            aria-pressed={it.on}
            title={`${it.on ? 'Hide' : 'Show'} ${it.label}${onIsolate ? '. Alt-click or hold to show only this.' : ''}`}
            onClick={(e) => onClick(e, it.id)}
            onPointerDown={onIsolate ? () => {
              cancel();
              pressed.current = null;
              timer.current = setTimeout(() => { pressed.current = it.id; onIsolate(it.id); }, LONG_PRESS_MS);
            } : undefined}
            onPointerUp={cancel}
            onPointerLeave={cancel}
            onPointerCancel={cancel}
          >
            <i style={{ background: colorVar(it.color) }} />
            <span className="g-legend-label">{it.label}</span>
            {it.count !== undefined && <span className="g-legend-count">{formatFull(it.count)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
