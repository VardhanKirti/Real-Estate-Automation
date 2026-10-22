'use client';

import { useId, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { areaPaths, clamp, extent, labelIndices, nearestIndex, peakIndex, seriesPaths, spreadX } from '@/lib/chart-geometry';
import { stepCursor } from '@/lib/chart-sync';
import { GTag } from './Controls';
import { GChartTooltip } from './GChartTooltip';
import { colorVar, slotColor, useCursor, useVizId, useWidth, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

export type XYSeries = {
  id: string;
  label: string;
  values: readonly (number | null)[];
  color?: VizColor;
  /** carried-forward points (S03 F4): the segment ending on one is dashed */
  carried?: readonly boolean[];
};

export type XYChartProps = VizStateProps & {
  /** one label per bucket, oldest first ("Aug", "Mon 3"); tooltips use it */
  labels: readonly string[];
  /** shorter axis labels, same length as `labels` (default `labels`) */
  axisLabels?: readonly string[];
  series: readonly XYSeries[];
  /** `step` draws flat buckets (S02 Touches) with a peak tag and per-bucket hover */
  variant?: 'linear' | 'step';
  /** plot height in px (default 160) */
  height?: number;
  /** charts with the same id share one crosshair and keyboard cursor (GP3, ACGP3.5) */
  syncId?: string;
  formatValue?: (v: number) => string;
  /** tooltip content for bucket i; default "label" + one line per series */
  tip?: (i: number) => { title: ReactNode; lines?: ReactNode[]; hint?: ReactNode };
  /** peak tag text for the step variant: "222 touches · Aug" */
  peakLabel?: (i: number, v: number) => string;
  /** three y labels (0, mid, max); default on for linear, off for step */
  yAxis?: boolean;
  /** include zero in the y scale (default true); false fits the scale to the data, for slow-moving totals */
  zeroBase?: boolean;
  /** Enter or click on a bucket */
  onSelect?: (i: number) => void;
  /** what the chart shows, window and source (accessible name) */
  label: string;
  className?: string;
};

type Kind = 'line' | 'area';

const AXIS_H = 22;

/**
 * The shared line/area renderer behind GLineChart and GAreaChart (S00 §5.3,
 * GP3). No grid except one `--g-line` baseline; 11px muted axis labels (at
 * most 3 x and 3 y on linear charts, every other bucket on step charts);
 * 1.75px round lines; areas fill series colour 18% to 0. Hover or the
 * keyboard moves a cursor: a `--g-ring` rule, a dot per series and a
 * GChartTooltip. With `syncId`, every chart in the group follows.
 */
export function XYChart({ kind, ...p }: XYChartProps & { kind: Kind }) {
  const {
    labels, axisLabels, series, variant = 'linear', height = 160, syncId, formatValue = (v) => v.toLocaleString('en-US'),
    tip, peakLabel, yAxis, zeroBase = true, onSelect, label, className = '', ...stateProps
  } = p;
  const [ref, W] = useWidth<HTMLDivElement>(600);
  const selfId = useId();
  const [cursor, setCursor] = useCursor(syncId, selfId);
  const gid = useVizId('g-area');
  const n = labels.length;
  const step = variant === 'step';
  const showY = yAxis ?? !step;
  const single = series.length === 1;
  const peak = step && single ? peakIndex(series[0].values) : -1;
  const hasPeakTag = peak >= 0 && !!peakLabel;

  const all = series.flatMap((s) => s.values as (number | null)[]);
  const empty = n === 0 || all.every((v) => v === null || !Number.isFinite(v));
  const state = stateProps.state ?? (empty ? 'empty' : 'ready');
  const totalH = height + AXIS_H;
  const body = VizStateBody({ ...stateProps, state, height: totalH });
  if (body) return <div data-g={kind === 'line' ? 'GLineChart' : 'GAreaChart'} className={`g-xy ${className}`}>{body}</div>;

  const [lo0, hi0] = extent(all, zeroBase);
  const lo = lo0;
  const hi = hi0 === lo0 ? lo0 + 1 : hi0;
  const padL = showY ? 40 : 8;
  const padR = 8;
  const padT = hasPeakTag ? 34 : 8;
  const plotB = height;
  const yOf = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (plotB - padT);
  const baseY = yOf(Math.max(lo, Math.min(hi, 0)));

  // Bucket geometry: linear charts put points on centres spread edge to edge;
  // step charts give each bucket a flat of equal width.
  const bw = step ? (W - padL - padR) / Math.max(1, n) : 0;
  const centres = step ? Array.from({ length: n }, (_, i) => padL + bw * (i + 0.5)) : spreadX(n, padL, W - padR);
  const edges = step ? Array.from({ length: n + 1 }, (_, i) => padL + bw * i) : centres;

  const drawn = series.map((s, k) => {
    const color = colorVar(s.color ?? slotColor(k));
    // a step series is drawn over the bucket edges, the last value repeated to close the final flat
    const vals = step ? [...s.values, s.values[n - 1] ?? null] : [...s.values];
    const carried = s.carried ? (step ? [false, ...s.carried] : [...s.carried]) : undefined;
    const lines = seriesPaths(vals, edges, yOf, { step, carried });
    const areas = kind === 'area' ? areaPaths(vals, edges, yOf, baseY, step) : [];
    return { s, color, lines, areas };
  });

  const xLabels = step ? labelIndices(n, { everyOtherAbove: 8 }) : labelIndices(n, { max: 3 });
  const shown = new Set(xLabels);
  if (cursor !== null && cursor >= 0 && cursor < n) shown.add(cursor);
  const yLabels = showY ? [hi, (hi + lo) / 2, lo] : [];

  const indexAt = (clientX: number, el: Element) => {
    const x = clientX - el.getBoundingClientRect().left;
    if (step) return clamp(Math.floor((x - padL) / Math.max(1, bw)), 0, n - 1);
    return nearestIndex(centres, x);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => setCursor(indexAt(e.clientX, e.currentTarget));
  const onLeave = () => setCursor(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { setCursor(null); return; }
    if ((e.key === 'Enter' || e.key === ' ') && onSelect && cursor !== null) { e.preventDefault(); onSelect(cursor); return; }
    const next = stepCursor(cursor, e.key, n);
    if (next !== null) { e.preventDefault(); setCursor(next); }
  };

  const ci = cursor !== null && cursor >= 0 && cursor < n ? cursor : null;
  const tipContent = ci === null ? null : tip ? tip(ci) : {
    title: labels[ci],
    lines: series.map((s) => {
      const v = s.values[ci];
      const val = v === null || !Number.isFinite(v) ? 'no data' : formatValue(v);
      return single ? `${val}${s.carried?.[ci] ? ' · carried forward' : ''}` : `${s.label} ${val}${s.carried?.[ci] ? ' (carried)' : ''}`;
    }),
  };
  const tipY = ci === null ? 0 : Math.min(...series.map((s) => { const v = s.values[ci]; return v === null || !Number.isFinite(v) ? plotB : yOf(v); }));
  const live = tipContent ? [labels[ci!], ...(tipContent.lines ?? []).filter((l): l is string => typeof l === 'string')].join(', ') : '';

  return (
    <div
      ref={ref}
      data-g={kind === 'line' ? 'GLineChart' : 'GAreaChart'}
      data-variant={variant}
      className={`g-xy ${className}`}
      role="group"
      aria-roledescription="chart"
      aria-label={`${label}. Arrow keys move through ${n} points${onSelect ? ', Enter opens one' : ''}.`}
      tabIndex={0}
      style={{ height: totalH }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onBlur={onLeave}
      onKeyDown={onKey}
      onClick={onSelect && ci !== null ? () => onSelect(ci) : undefined}
      data-clickable={onSelect ? '' : undefined}
    >
      <svg width={W} height={totalH} aria-hidden="true" className="g-xy-svg">
        {kind === 'area' && (
          <defs>
            {drawn.map((d, k) => (
              <linearGradient key={k} id={`${gid}-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: d.color, stopOpacity: 0.18 }} />
                <stop offset="100%" style={{ stopColor: d.color, stopOpacity: 0 }} />
              </linearGradient>
            ))}
          </defs>
        )}
        <line x1={padL} x2={W - padR} y1={baseY} y2={baseY} className="g-xy-base" />
        {yLabels.map((v, i) => (
          <text key={i} x={padL - 8} y={yOf(v)} className="g-xy-axis" textAnchor="end" dominantBaseline="middle">{formatValue(Math.round(v))}</text>
        ))}
        {drawn.map((d, k) => d.areas.map((a, j) => <path key={`a${k}-${j}`} d={a} fill={`url(#${gid}-${k})`} />))}
        {drawn.map((d, k) => d.lines.map((l, j) => (
          <path key={`l${k}-${j}`} d={l.d} fill="none" stroke={d.color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.dashed ? '4 4' : undefined} data-carried={l.dashed || undefined} />
        )))}
        {hasPeakTag && (
          <circle cx={centres[peak]} cy={yOf(series[0].values[peak] as number)} r={3.5} className="g-xy-peak" style={{ fill: drawn[0].color }} />
        )}
        {ci !== null && (
          <>
            <line x1={centres[ci]} x2={centres[ci]} y1={padT - 4} y2={baseY} className="g-xy-rule" />
            {series.map((s, k) => {
              const v = s.values[ci];
              return v === null || !Number.isFinite(v) ? null : <circle key={k} cx={centres[ci]} cy={yOf(v)} r={3} style={{ fill: drawn[k].color }} className="g-xy-dot" />;
            })}
          </>
        )}
        {Array.from(shown).map((i) => (
          <text key={`x${i}`} x={centres[i]} y={plotB + 15} className="g-xy-axis" data-on={i === ci || undefined} textAnchor={step ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {(axisLabels ?? labels)[i]}
          </text>
        ))}
      </svg>
      {hasPeakTag && ci === null && (
        <span className="g-xy-peaktag" style={{ left: clamp(centres[peak], 60, W - 60), top: yOf(series[0].values[peak] as number) - 12 }}>
          <GTag>{peakLabel!(peak, series[0].values[peak] as number)}</GTag>
        </span>
      )}
      {tipContent && ci !== null && (
        <GChartTooltip x={centres[ci]} y={tipY} containerWidth={W} title={tipContent.title} lines={tipContent.lines} hint={tipContent.hint} />
      )}
      <span className="sr-only" aria-live="polite">{live}</span>
    </div>
  );
}
