'use client';

import { heatAlpha } from '@/lib/chart-geometry';
import { useWidth, VizStateBody, type VizStateProps } from './viz-shared';

export type GHeatmapProps = VizStateProps & {
  rows: readonly string[];
  cols: readonly string[];
  /** values[r][c]; null = no value (no fill) */
  values: readonly (readonly (number | null)[])[];
  /** colour scale; default the data's min and max */
  scale?: { min: number; max: number };
  /** a cell click; cells are buttons only when set */
  onCell?: (r: number, c: number) => void;
  formatValue?: (v: number) => string;
  /** a cell's title; default "row · col: value" */
  cellTitle?: (r: number, c: number, v: number | null) => string;
  /** largest cell px, default 28 */
  maxCell?: number;
  label: string;
  className?: string;
};

/**
 * GHeatmap (GP3, S05 F05.34): square cells, radius 4, value as `--g-accent`
 * alpha from .08 to 1, a scale legend under the grid. Cells are buttons with
 * titles when `onCell` is set. No cells or all-null draws the empty state.
 */
export function GHeatmap({ rows, cols, values, scale, onCell, formatValue = (v) => v.toLocaleString('en-US'), cellTitle, maxCell = 28, label, className = '', ...stateProps }: GHeatmapProps) {
  const [ref, W] = useWidth<HTMLDivElement>(480);
  const flat = values.flatMap((r) => r.filter((v): v is number => v !== null && Number.isFinite(v)));
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (flat.length === 0 || rows.length === 0 || cols.length === 0 ? 'empty' : 'ready'), height: 200 });
  if (body) return <div data-g="GHeatmap" className={`g-heat ${className}`}>{body}</div>;
  const min = scale?.min ?? Math.min(...flat);
  const max = scale?.max ?? Math.max(...flat);
  const labelW = Math.min(120, Math.max(48, ...rows.map((r) => r.length * 6.5)));
  const cell = Math.max(10, Math.min(maxCell, Math.floor((W - labelW - 4) / cols.length) - 3));
  return (
    <div ref={ref} data-g="GHeatmap" className={`g-heat ${className}`}>
      <div role={onCell ? 'group' : 'img'} aria-label={label} className="g-heat-grid" style={{ gridTemplateColumns: `${labelW}px repeat(${cols.length}, ${cell}px)`, ['--gk-heat-cell' as string]: `${cell}px` }}>
        <span aria-hidden="true" />
        {cols.map((c, j) => <span key={`c${j}`} className="g-heat-col" title={c} aria-hidden="true">{cell >= 22 ? c : ''}</span>)}
        {rows.map((rl, i) => (
          <div key={`r${i}`} style={{ display: 'contents' }}>
            <span className="g-heat-row" title={rl}>{rl}</span>
            {cols.map((cl, j) => {
              const v = values[i]?.[j] ?? null;
              const a = heatAlpha(v, min, max);
              const title = cellTitle ? cellTitle(i, j, v) : `${rl} · ${cl}: ${v === null ? 'no value' : formatValue(v)}`;
              const style = { background: a > 0 ? `color-mix(in srgb, var(--g-accent) ${Math.round(a * 100)}%, transparent)` : undefined };
              return onCell ? (
                <button key={j} type="button" className="g-heat-cell" data-empty={a === 0 || undefined} style={style} title={title} aria-label={title} onClick={() => onCell(i, j)} />
              ) : (
                <span key={j} className="g-heat-cell" data-empty={a === 0 || undefined} style={style} title={title} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="g-heat-scale" aria-label={`Scale ${formatValue(min)} to ${formatValue(max)}`}>
        <span>{formatValue(min)}</span>
        <i aria-hidden="true" />
        <span>{formatValue(max)}</span>
      </div>
    </div>
  );
}
