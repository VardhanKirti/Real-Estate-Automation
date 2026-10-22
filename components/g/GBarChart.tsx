'use client';

import type { ReactNode } from 'react';
import { BarGrouped, BarSeries, type BarGroupedProps, type BarSeriesProps } from './BarSeries';
import { BarStages, type BarStagesProps } from './BarStages';
import { colorVar, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

export type { StageColumn } from './BarStages';
export type { BarKey, GroupedBar, SeriesBar } from './BarSeries';

export type HorizontalBar = { id: string; label: string; value: number; display?: ReactNode; title?: string };

export type BarHorizontalProps = VizStateProps & {
  rows: readonly HorizontalBar[];
  max?: number;
  color?: VizColor;
  selected?: string | null;
  onSelect?: (id: string) => void;
  label: string;
  className?: string;
};

export type GBarChartProps =
  | ({ variant: 'stages' } & BarStagesProps)
  | ({ variant: 'series' } & BarSeriesProps)
  | ({ variant: 'grouped' } & BarGroupedProps)
  | ({ variant: 'horizontal' } & BarHorizontalProps);

/**
 * GBarChart (S00 §5.3, GP3, S02 §5.3/§5.7). Bars with fully rounded caps, 2px
 * gaps between stack segments instead of strokes, no hatching; the selected
 * bar at full opacity and the rest at 45%.
 *
 * - `stages`: the revenue / pipeline chart (header stats, `measure="usd|count"`,
 *   stacked won/lost, `flow` connector, no axes, radiogroup keyboard);
 * - `series`: one pill per bucket, signed below a centre baseline, `syncId`;
 * - `grouped`: side-by-side bars per bucket, `syncId`;
 * - `horizontal`: ranked rows.
 *
 * The old `dots` variant is GDotMatrix (X1).
 */
export function GBarChart(props: GBarChartProps) {
  switch (props.variant) {
    case 'stages': { const { variant: _v, ...p } = props; return <BarStages {...p} />; }
    case 'series': { const { variant: _v, ...p } = props; return <BarSeries {...p} />; }
    case 'grouped': { const { variant: _v, ...p } = props; return <BarGrouped {...p} />; }
    case 'horizontal': { const { variant: _v, ...p } = props; return <BarHorizontal {...p} />; }
  }
}

function BarHorizontal({ rows, max, color = 'accent', selected = null, onSelect, label, className = '', ...stateProps }: BarHorizontalProps) {
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (rows.length === 0 ? 'empty' : 'ready'), height: Math.max(3, rows.length) * 30 });
  if (body) return <div data-g="GBarChart" data-variant="horizontal" className={`g-hbars ${className}`}>{body}</div>;
  const m = max ?? Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul data-g="GBarChart" data-variant="horizontal" aria-label={label} className={`g-hbars ${className}`}>
      {rows.map((r) => {
        const pct = m > 0 ? Math.max(0, Math.min(1, r.value / m)) : 0;
        const on = selected === null || selected === r.id;
        const title = r.title ?? `${r.label}: ${typeof r.display === 'string' ? r.display : r.value.toLocaleString('en-US')}`;
        const inner = (
          <>
            <span className="g-hbar-label">{r.label}</span>
            <span className="g-hbar-track"><i style={{ width: `${pct * 100}%`, background: on ? colorVar(color) : 'var(--g-track-soft)' }} /></span>
            <span className="g-hbar-value">{r.display ?? r.value.toLocaleString('en-US')}</span>
          </>
        );
        return (
          <li key={r.id}>
            {onSelect ? (
              <button type="button" className="g-hbar-row" data-action="" aria-pressed={selected === r.id} title={title} onClick={() => onSelect(r.id)}>{inner}</button>
            ) : (
              <div className="g-hbar-row" title={title}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
