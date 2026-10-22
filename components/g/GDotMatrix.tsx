'use client';

import { useState } from 'react';
import { dotFill, heatAlpha, peakIndex } from '@/lib/chart-geometry';
import { GChartTooltip } from './GChartTooltip';
import { colorVar, useWidth, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

export type DotColumn = {
  id: string;
  /** label under the column: "M", "2-3" */
  label: string;
  value: number;
  /** what the column means, for its label and tip: "Sundays · 24 leads" */
  title: string;
  /** alpha mode: one value per row, top to bottom */
  cells?: readonly (number | null)[];
};

export type GDotMatrixProps = VizStateProps & {
  columns: readonly DotColumn[];
  /** dots per column, default 6 */
  rows?: number;
  /** scale; default the busiest column */
  max?: number;
  color?: VizColor;
  /** the peak column in full ink (default on) */
  peakInk?: boolean;
  /** `alpha`: each dot's alpha encodes its cell value (rows mode) */
  mode?: 'count' | 'alpha';
  /** 4px dots instead of 6 */
  compact?: boolean;
  selected?: string | null;
  /** columns become buttons */
  onSelect?: (id: string) => void;
  label: string;
  className?: string;
};

/**
 * GDotMatrix (GP3): columns of up to N dots with labels underneath. Lit dots
 * use the accent (or a series token), the peak column full ink, empty slots
 * `--g-dim` at 35%. Any non-zero column lights at least one dot. Each column
 * is focusable (an image with its title, or a button with `onSelect`) and
 * shows a GChartTooltip on hover and focus. `mode="alpha"` lights every dot
 * with its cell's value as alpha (AdPilot delivery).
 */
export function GDotMatrix({ columns, rows = 6, max, color = 'accent', peakInk = true, mode = 'count', compact = false, selected = null, onSelect, label, className = '', ...stateProps }: GDotMatrixProps) {
  const [ref, W] = useWidth<HTMLDivElement>(320);
  const [hover, setHover] = useState<number | null>(null);
  const allZero = columns.every((c) => !(c.value > 0)) && (mode !== 'alpha' || columns.every((c) => (c.cells ?? []).every((v) => !(v !== null && v > 0))));
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (columns.length === 0 ? 'empty' : 'ready'), height: rows * (compact ? 8 : 10) + 20 });
  if (body) return <div data-g="GDotMatrix" className={`g-dots ${className}`}>{body}</div>;
  const lit = dotFill(columns.map((c) => c.value), rows, max);
  const peak = peakInk && !allZero ? peakIndex(columns.map((c) => c.value)) : -1;
  const cellVals = mode === 'alpha' ? columns.flatMap((c) => (c.cells ?? []).filter((v): v is number => v !== null && Number.isFinite(v))) : [];
  const cMin = cellVals.length ? Math.min(...cellVals) : 0;
  const cMax = cellVals.length ? Math.max(...cellVals) : 0;
  const colW = W / Math.max(1, columns.length);
  const hc = hover !== null ? columns[hover] : null;
  return (
    <div ref={ref} data-g="GDotMatrix" data-mode={mode} data-compact={compact || undefined} className={`g-dots ${className}`}>
      <div role={onSelect ? 'radiogroup' : 'group'} aria-label={allZero ? `${label} · none in this range` : label} className="g-dots-cols">
        {columns.map((c, i) => {
          const fill = i === peak ? 'var(--g-ink)' : colorVar(color);
          const dots = Array.from({ length: rows }, (_, r) => {
            if (mode === 'alpha') {
              const v = c.cells?.[r] ?? null;
              const a = heatAlpha(v, cMin, cMax);
              return <i key={r} style={a > 0 ? { background: `color-mix(in srgb, ${colorVar(color)} ${Math.round(a * 100)}%, transparent)` } : undefined} data-empty={a === 0 || undefined} />;
            }
            const on = rows - r <= lit[i]; // fill from the bottom
            return <i key={r} style={on ? { background: fill } : undefined} data-empty={!on || undefined} />;
          });
          const common = {
            className: 'g-dots-col',
            'data-selected': selected === c.id || undefined,
            'data-dim': selected !== null && selected !== c.id ? '' : undefined,
            onPointerEnter: () => setHover(i),
            onPointerLeave: () => setHover((h) => (h === i ? null : h)),
            onFocus: () => setHover(i),
            onBlur: () => setHover(null),
          };
          const inner = (<><span className="g-dots-stack">{dots}</span><span className="g-dots-label">{c.label}</span></>);
          return onSelect ? (
            <button key={c.id} {...common} type="button" role="radio" aria-checked={selected === c.id} aria-label={c.title} onClick={() => onSelect(c.id)}>{inner}</button>
          ) : (
            <div key={c.id} {...common} role="img" tabIndex={0} aria-label={c.title}>{inner}</div>
          );
        })}
      </div>
      {allZero && <div className="g-dots-caption">None in this range.</div>}
      {hc && hover !== null && <GChartTooltip x={colW * (hover + 0.5)} y={0} containerWidth={W} title={hc.title} />}
    </div>
  );
}
