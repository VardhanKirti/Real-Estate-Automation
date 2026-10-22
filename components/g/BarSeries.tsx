'use client';

import { useId, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clamp, extent, labelIndices, signedBars } from '@/lib/chart-geometry';
import { stepCursor } from '@/lib/chart-sync';
import { GChartTooltip } from './GChartTooltip';
import { colorVar, slotColor, useCursor, useVizId, useWidth, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

type Tip = { title: ReactNode; lines?: ReactNode[]; hint?: ReactNode };

export type SeriesBar = { id: string; label: string; value: number | null; tip?: Tip };
export type GroupedBar = { id: string; label: string; values: readonly (number | null)[]; tip?: Tip };
export type BarKey = { id: string; label: string; color?: VizColor };

type Common = VizStateProps & {
  /** px, default 104 (S02 §5.7) */
  height?: number;
  syncId?: string;
  formatValue?: (v: number) => string;
  onSelect?: (id: string) => void;
  label: string;
  className?: string;
};

export type BarSeriesProps = Common & {
  bars: readonly SeriesBar[];
  /** highlighted fill: accent gradient (In), `--g-err` (Out), ok/err by sign (Net) */
  tone?: 'accent' | 'err' | 'signed';
  /** which bar is lit at rest: the newest (default), a bar id, or none */
  highlight?: 'latest' | string | null;
};

export type BarGroupedProps = Common & {
  groups: readonly GroupedBar[];
  keys: readonly BarKey[];
};

const AXIS_H = 20;

/**
 * GBarChart `variant="series"` (S02 §5.7, GP3): one pill bar per bucket,
 * width `min(22, colW × .55)`, radius = half the width. Rest fill
 * `--g-track-soft`; the latest and the hovered bar take the tone. Negative
 * values hang below a centre baseline. No y axis, no gridlines; month labels
 * every other one past 6 buckets plus the hovered one.
 */
export function BarSeries({ bars, tone = 'accent', highlight = 'latest', height = 104, syncId, formatValue = (v) => v.toLocaleString('en-US'), onSelect, label, className = '', ...stateProps }: BarSeriesProps) {
  const [ref, W] = useWidth<HTMLDivElement>(600);
  const selfId = useId();
  const [cursor, setCursor] = useCursor(syncId, selfId);
  const gid = useVizId('g-bars');
  const n = bars.length;
  const empty = n === 0 || bars.every((b) => b.value === null || !Number.isFinite(b.value));
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (empty ? 'empty' : 'ready'), height: height + AXIS_H });
  if (body) return <div data-g="GBarChart" data-variant="series" className={`g-bars ${className}`}>{body}</div>;

  const colW = W / n;
  const bw = Math.max(3, Math.min(22, colW * 0.55));
  const { bars: geo, baseline } = signedBars(bars.map((b) => b.value), height - 4, 4);
  const lit = highlight === 'latest' ? n - 1 : highlight === null ? -1 : bars.findIndex((b) => b.id === highlight);
  const xLabels = new Set(labelIndices(n, { everyOtherAbove: 6, max: n }));
  if (cursor !== null) xLabels.add(cursor);

  const fillFor = (i: number) => {
    const on = i === lit || i === cursor;
    if (!on) return 'var(--g-track-soft)';
    const v = bars[i].value ?? 0;
    if (tone === 'err') return 'var(--g-err)';
    if (tone === 'signed') return v < 0 ? 'var(--g-err)' : 'var(--g-ok)';
    return `url(#${gid})`;
  };

  const handlers = cursorHandlers(n, cursor, setCursor, (x) => clamp(Math.floor(x / colW), 0, n - 1), onSelect ? (i) => onSelect(bars[i].id) : undefined);
  const ci = cursor !== null && cursor < n ? cursor : null;
  const tip = ci === null ? null : bars[ci].tip ?? { title: bars[ci].label, lines: [bars[ci].value === null ? 'no data' : formatValue(bars[ci].value as number)] };

  return (
    <div ref={ref} data-g="GBarChart" data-variant="series" className={`g-bars ${className}`} role="group" aria-roledescription="chart" aria-label={`${label}. Arrow keys move through ${n} bars.`} tabIndex={0} style={{ height: height + AXIS_H }} data-clickable={onSelect ? '' : undefined} {...handlers}>
      <svg width={W} height={height + AXIS_H} aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--g-accent)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--g-accent-2)' }} />
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={baseline + 2} y2={baseline + 2} className="g-xy-base" />
        {bars.map((b, i) => {
          const g = geo[i];
          if (b.value === null) return null;
          return <rect key={b.id} x={colW * (i + 0.5) - bw / 2} y={g.y + 2} width={bw} height={g.h} rx={bw / 2} style={{ fill: fillFor(i) }} data-zero={g.zero || undefined} />;
        })}
        {Array.from(xLabels).map((i) => (
          <text key={i} x={colW * (i + 0.5)} y={height + 14} textAnchor="middle" className="g-xy-axis" data-on={i === ci || undefined}>{bars[i].label}</text>
        ))}
      </svg>
      {tip && ci !== null && <GChartTooltip x={colW * (ci + 0.5)} y={geo[ci].y + 2} containerWidth={W} title={tip.title} lines={tip.lines} hint={tip.hint} />}
      <span className="sr-only" aria-live="polite">{ci === null ? '' : `${bars[ci].label}, ${bars[ci].value === null ? 'no data' : formatValue(bars[ci].value as number)}`}</span>
    </div>
  );
}

/**
 * GBarChart `variant="grouped"`: buckets of side-by-side pill bars, one per
 * key, in the keys' series colours, 2px apart. The cursor bucket stays at
 * full opacity and the others drop to 45% (S00 §5.3).
 */
export function BarGrouped({ groups, keys, height = 140, syncId, formatValue = (v) => v.toLocaleString('en-US'), onSelect, label, className = '', ...stateProps }: BarGroupedProps) {
  const [ref, W] = useWidth<HTMLDivElement>(600);
  const selfId = useId();
  const [cursor, setCursor] = useCursor(syncId, selfId);
  const n = groups.length;
  const all = groups.flatMap((g) => g.values as (number | null)[]);
  const empty = n === 0 || keys.length === 0 || all.every((v) => v === null || !Number.isFinite(v));
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (empty ? 'empty' : 'ready'), height: height + AXIS_H });
  if (body) return <div data-g="GBarChart" data-variant="grouped" className={`g-bars ${className}`}>{body}</div>;

  const [, hi] = extent(all, true);
  const colW = W / n;
  const k = keys.length;
  const bw = Math.max(3, Math.min(16, (colW * 0.7 - (k - 1) * 2) / k));
  const groupW = k * bw + (k - 1) * 2;
  const xLabels = new Set(labelIndices(n, { everyOtherAbove: 6, max: n }));
  if (cursor !== null) xLabels.add(cursor);
  const handlers = cursorHandlers(n, cursor, setCursor, (x) => clamp(Math.floor(x / colW), 0, n - 1), onSelect ? (i) => onSelect(groups[i].id) : undefined);
  const ci = cursor !== null && cursor < n ? cursor : null;
  const tip = ci === null ? null : groups[ci].tip ?? {
    title: groups[ci].label,
    lines: keys.map((key, j) => { const v = groups[ci].values[j]; return `${key.label} ${v === null || v === undefined ? 'no data' : formatValue(v)}`; }),
  };
  const yOf = (v: number) => height - (hi > 0 ? (Math.max(0, v) / hi) * (height - 4) : 0);

  return (
    <div ref={ref} data-g="GBarChart" data-variant="grouped" className={`g-bars ${className}`} role="group" aria-roledescription="chart" aria-label={`${label}. Arrow keys move through ${n} groups.`} tabIndex={0} style={{ height: height + AXIS_H }} data-clickable={onSelect ? '' : undefined} {...handlers}>
      <svg width={W} height={height + AXIS_H} aria-hidden="true">
        <line x1={0} x2={W} y1={height} y2={height} className="g-xy-base" />
        {groups.map((g, i) => (
          <g key={g.id} opacity={ci !== null && ci !== i ? 0.45 : 1}>
            {keys.map((key, j) => {
              const v = g.values[j];
              if (v === null || v === undefined || !Number.isFinite(v)) return null;
              const y = Math.min(yOf(v), height - 4);
              return <rect key={key.id} x={colW * (i + 0.5) - groupW / 2 + j * (bw + 2)} y={y} width={bw} height={height - y} rx={bw / 2} style={{ fill: colorVar(key.color ?? slotColor(j)) }} />;
            })}
          </g>
        ))}
        {Array.from(xLabels).map((i) => (
          <text key={i} x={colW * (i + 0.5)} y={height + 14} textAnchor="middle" className="g-xy-axis" data-on={i === ci || undefined}>{groups[i].label}</text>
        ))}
      </svg>
      {tip && ci !== null && <GChartTooltip x={colW * (ci + 0.5)} y={Math.min(...groups[ci].values.map((v) => (v === null || !Number.isFinite(v) ? height : yOf(v))))} containerWidth={W} title={tip.title} lines={tip.lines} hint={tip.hint} />}
    </div>
  );
}

/** Pointer and keyboard cursor wiring shared by the SVG bar variants. */
function cursorHandlers(n: number, cursor: number | null, setCursor: (i: number | null) => void, indexAt: (x: number) => number, select?: (i: number) => void) {
  return {
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => setCursor(indexAt(e.clientX - e.currentTarget.getBoundingClientRect().left)),
    onPointerLeave: () => setCursor(null),
    onBlur: () => setCursor(null),
    onClick: select ? () => { if (cursor !== null) select(cursor); } : undefined,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') { setCursor(null); return; }
      if ((e.key === 'Enter' || e.key === ' ') && select && cursor !== null) { e.preventDefault(); select(cursor); return; }
      const next = stepCursor(cursor, e.key, n);
      if (next !== null) { e.preventDefault(); setCursor(next); }
    },
  };
}
