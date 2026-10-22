'use client';

import { useId } from 'react';
import { stackParts } from '@/lib/chart-geometry';
import { GChartTooltip } from './GChartTooltip';
import { colorVar, slotColor, useCursor, useWidth, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

export type StackKey = { id: string; label: string; color?: VizColor };
export type StackedColumn = { id: string; label: string; parts: readonly number[] };

export type GStackedBarProps = VizStateProps & {
  /** one column per bucket; `parts[j]` is key j's value */
  columns: readonly StackedColumn[];
  keys: readonly StackKey[];
  /** plot height px, default 160 */
  height?: number;
  /** hide keys (a GLegend toggles them) */
  hiddenKeys?: readonly string[];
  formatValue?: (v: number) => string;
  onSelect?: (id: string) => void;
  selected?: string | null;
  /** charts with the same id share one hover cursor by bucket index (GP3 syncId, as GLineChart/GAreaChart) */
  syncId?: string;
  label: string;
  className?: string;
};

/**
 * GStackedBar (S00 §5.3): stacked columns, heights linear in each column's
 * total, parts top to bottom in key order with 2px gaps (no strokes, no
 * hatching), rounded caps. Hidden keys drop out of both the stack and the
 * scale. Columns are buttons when `onSelect` is set.
 */
export function GStackedBar({ columns, keys, height = 160, hiddenKeys = [], formatValue = (v) => v.toLocaleString('en-US'), onSelect, selected = null, syncId, label, className = '', ...stateProps }: GStackedBarProps) {
  const [ref, W] = useWidth<HTMLDivElement>(600);
  const selfId = useId();
  const [cursor, setHover] = useCursor(syncId, selfId);
  const hover = cursor !== null && cursor >= 0 && cursor < columns.length ? cursor : null;
  const visible = keys.map((k) => !hiddenKeys.includes(k.id));
  const totals = columns.map((c) => c.parts.reduce((s, v, j) => s + (visible[j] && Number.isFinite(v) && v > 0 ? v : 0), 0));
  const max = Math.max(0, ...totals);
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (max === 0 ? 'empty' : 'ready'), height: height + 20 });
  if (body) return <div data-g="GStackedBar" className={`g-stack ${className}`}>{body}</div>;
  const colW = W / Math.max(1, columns.length);
  const bw = Math.max(6, Math.min(40, colW * 0.5));
  const hc = hover !== null ? columns[hover] : null;
  return (
    <div ref={ref} data-g="GStackedBar" className={`g-stack ${className}`} style={{ height: height + 20 }}>
      <div role={onSelect ? 'radiogroup' : 'group'} aria-label={label} className="g-stack-cols" style={{ height }}>
        {columns.map((c, i) => {
          const h = max > 0 ? Math.max(totals[i] > 0 ? 4 : 0, (totals[i] / max) * (height - 4)) : 0;
          const parts = stackParts(c.parts.map((v, j) => (visible[j] ? v : 0)), h, 2);
          const aria = `${c.label}: ${keys.map((k, j) => (visible[j] ? `${k.label} ${formatValue(c.parts[j] ?? 0)}` : null)).filter(Boolean).join(', ')}`;
          const inner = (
            <span className="g-stack-bar" style={{ height: h, width: bw }}>
              {parts.map((p) => <i key={p.index} style={{ top: p.y, height: p.h, background: colorVar(keys[p.index].color ?? slotColor(p.index)) }} />)}
            </span>
          );
          const common = {
            className: 'g-stack-col',
            'data-dim': selected !== null && selected !== c.id ? '' : undefined,
            onPointerEnter: () => setHover(i),
            onPointerLeave: () => { if (hover === i) setHover(null); },
          };
          return onSelect ? (
            <button key={c.id} {...common} type="button" role="radio" aria-checked={selected === c.id} aria-label={aria} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onClick={() => onSelect(c.id)}>{inner}</button>
          ) : (
            <div key={c.id} {...common} role="img" aria-label={aria}>{inner}</div>
          );
        })}
      </div>
      <div className="g-stack-axis" aria-hidden="true">
        {columns.map((c) => <span key={c.id}>{c.label}</span>)}
      </div>
      {hc && hover !== null && (
        <GChartTooltip
          x={colW * (hover + 0.5)}
          y={height - (max > 0 ? (totals[hover] / max) * (height - 4) : 0)}
          containerWidth={W}
          title={hc.label}
          lines={keys.map((k, j) => (visible[j] ? `${k.label} ${formatValue(hc.parts[j] ?? 0)}` : null)).filter((x): x is string => x !== null)}
        />
      )}
    </div>
  );
}
