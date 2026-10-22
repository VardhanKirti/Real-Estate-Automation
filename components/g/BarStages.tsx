'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { stageBarGeometry, stackSegments } from '@/lib/chart-geometry';
import { formatCompact, formatFull, formatUsdCompact } from '@/lib/format-number';
import { GChartTooltip } from './GChartTooltip';
import { useWidth, VizStateBody, type VizStateProps } from './viz-shared';

export type StageColumn = {
  id: string;
  label: string;
  /** the measured value: dollars when `measure="usd"`, a count when `"count"` */
  value: number;
  /** a secondary count for the sub-line ("25 deals") */
  count?: number;
  /** replaces the default sub-line */
  sub?: string;
  /** a stacked column (Closed): won on top, lost below; its height is won + lost */
  won?: number;
  lost?: number;
  /** conversion from the previous stage, 0..1 (GFunnelStep's third header line); null = "—" */
  conversion?: number | null;
  /** tooltip lines; default: the full figure and the share of the total */
  tip?: { title?: ReactNode; lines?: ReactNode[]; hint?: ReactNode };
};

export type BarStagesProps = VizStateProps & {
  columns: readonly StageColumn[];
  measure: 'usd' | 'count';
  /** the dotted connector that carries the flow direction (off for categories, S02 §5.7) */
  flow?: boolean;
  /** the selected column (one at a time, `aria-checked`) */
  selected?: string | null;
  /** makes each column a radio; without it the chart is display-only */
  onSelect?: (id: string) => void;
  /**
   * Stacked columns only: a click on the won or lost segment (or ↑ / ↓ while
   * that column has focus) picks the segment (S02 FR-B2, §6). Optional; without
   * it a segment click selects the column as before.
   */
  onSegmentSelect?: (id: string, segment: 'won' | 'lost') => void;
  /** the picked segment of the selected stacked column; the other dims */
  selectedSegment?: 'won' | 'lost' | null;
  /** print the conversion row (GFunnelStep) */
  conversionRow?: boolean;
  /** blur header values and tip amounts (Finances "hide values"); bars stay */
  hideValues?: boolean;
  /** plot height override; default 200 / 180 / 140 by width (S02 §5.3) */
  plotHeight?: number;
  /** noun for the count sub-line: ['deal', 'deals'] */
  countNoun?: readonly [string, string];
  /** muted hint under the tip ("Click to show these deals") */
  tipHint?: string;
  label: string;
  className?: string;
  /** the `data-g` name (GFunnelStep renders through this) */
  kit?: string;
};

const MIN_H = 6;

/**
 * GBarChart `variant="stages"` (S02 §5.3, C13; geometry in
 * lib/chart-geometry.ts): one column per stage, a stat header over each bar,
 * no axes, one baseline. Height is linear in the measure; zero is a 6px
 * track stub that stays clickable. Closed-style columns stack won over lost
 * with a 2px gap. The whole column (header plus bar) is the click target and
 * the group is a radiogroup with arrow keys.
 */
export function BarStages({
  columns, measure, flow = true, selected = null, onSelect, onSegmentSelect, selectedSegment = null, conversionRow = false, hideValues = false, plotHeight,
  countNoun = ['item', 'items'], tipHint, label, className = '', kit = 'GBarChart', ...stateProps
}: BarStagesProps) {
  const [ref, W] = useWidth<HTMLDivElement>(860);
  const [hover, setHover] = useState<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const narrow = W < 560;
  /** Under 560px with more than two columns the headers wrap 2 × n above the plot (S02 §5.9) instead of crushing into the columns. */
  const wrapHeads = narrow && columns.length > 2;
  const plotH = plotHeight ?? (W < 560 ? 140 : W < 1000 ? 180 : 200);
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (columns.length === 0 ? 'empty' : 'ready'), height: plotH + 96 });
  if (body) return <div data-g={kit} data-variant="stages" className={`g-stages ${className}`}>{body}</div>;

  const heightOf = (c: StageColumn) => (c.won !== undefined || c.lost !== undefined ? (c.won ?? 0) + (c.lost ?? 0) : c.value);
  const geo = stageBarGeometry(columns.map(heightOf), plotH, MIN_H);
  const total = columns.reduce((s, c) => s + Math.max(0, heightOf(c)), 0);
  const colW = W / Math.max(1, columns.length);
  const barW = Math.max(12, narrow ? colW * 0.6 : Math.min(72, colW * 0.46));
  const money = measure === 'usd';
  const compact = (v: number) => (money ? formatUsdCompact(v) : narrow ? formatCompact(v) : formatFull(v));
  const full = (v: number) => (money ? `$${formatFull(Math.round(v))}` : formatFull(v));
  const conv = columns.map((c) => (c.conversion === undefined ? null : c.conversion));
  const realConv = conv.filter((c): c is number => c !== null && Number.isFinite(c));
  const worst = conversionRow && realConv.length > 1 ? Math.min(...realConv) : null;
  const interactive = !!onSelect;
  const focusIdx = Math.max(0, columns.findIndex((c) => c.id === selected));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect) return;
    const i = columns.findIndex((c) => c.id === (document.activeElement as HTMLElement | null)?.dataset.col);
    const cur = i >= 0 ? columns[i] : null;
    if (onSegmentSelect && cur && (cur.won !== undefined || cur.lost !== undefined) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onSegmentSelect(cur.id, e.key === 'ArrowUp' ? 'won' : 'lost');
      return;
    }
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(columns.length - 1, (i < 0 ? focusIdx : i) + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, (i < 0 ? focusIdx : i) - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = columns.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(columns[next].id);
    groupRef.current?.querySelector<HTMLElement>(`[data-col='${CSS.escape(columns[next].id)}']`)?.focus();
  };


  /** One column's stat header (label, value, sub, conversion). */
  const headOf = (c: StageColumn, i: number) => {
    const stacked = c.won !== undefined || c.lost !== undefined;
    const v = heightOf(c);
    const sub = c.sub ?? (c.count !== undefined ? `${c.count} ${c.count === 1 ? countNoun[0] : countNoun[1]}` : undefined);
    return (
      <span className="g-stage-head">
        <span className="g-stage-label">{c.label}</span>
        {stacked ? (
          <span className="g-stage-split" data-mask={hideValues || undefined} title={`${full(c.won ?? 0)} won · ${full(c.lost ?? 0)} lost`}>
            <span data-tone="ok">{compact(c.won ?? 0)} won</span> · <span data-tone="err">{compact(c.lost ?? 0)} lost</span>
          </span>
        ) : (
          <span className="g-stage-value" data-mask={hideValues || undefined} title={full(v)}>{compact(v)}</span>
        )}
        {sub && <span className="g-stage-sub">{sub}</span>}
        {conversionRow && (
          <span className="g-stage-conv" data-tone={worst !== null && conv[i] === worst ? 'warn' : undefined}>
            {conv[i] === null || !Number.isFinite(conv[i] as number) ? '—' : `${Math.round((conv[i] as number) * 100)}%`}
          </span>
        )}
      </span>
    );
  };

  const hovered = hover ? columns.findIndex((c) => c.id === hover) : -1;
  const hc = hovered >= 0 ? columns[hovered] : null;
  const tip = hc ? (() => {
    const v = heightOf(hc);
    const share = total > 0 ? Math.round((Math.max(0, v) / total) * 100) : 0;
    const t = hc.tip;
    const lines: ReactNode[] = t?.lines ?? (hc.won !== undefined || hc.lost !== undefined
      ? [`${full(hc.won ?? 0)} won`, `${full(hc.lost ?? 0)} lost`]
      : [`${full(v)}${hc.count !== undefined ? ` across ${hc.count} ${hc.count === 1 ? countNoun[0] : countNoun[1]}` : ''}`, `${share}% of the total`]);
    return { title: t?.title ?? hc.label, lines, hint: t?.hint ?? (interactive ? tipHint : undefined) };
  })() : null;

  return (
    <div ref={ref} data-g={kit} data-variant="stages" data-narrow={narrow || undefined} className={`g-stages ${className}`}>
      {wrapHeads && (
        <div className="g-stages-heads" aria-hidden="true">
          {columns.map((c, i) => (
            <div key={c.id} className="g-stages-headcell" data-selected={selected === c.id || undefined} onClick={onSelect ? () => onSelect(c.id) : undefined}>
              {headOf(c, i)}
            </div>
          ))}
        </div>
      )}
      <div
        ref={groupRef}
        role={interactive ? 'radiogroup' : 'group'}
        aria-label={label}
        className="g-stages-cols"
        style={{ ['--gk-stage-head' as string]: `${wrapHeads ? 0 : conversionRow ? HEAD_H_CONV : HEAD_H}px`, ['--gk-stage-head-gap' as string]: `${HEAD_GAP}px`, ['--gk-stage-plot' as string]: `${plotH}px`, ['--gk-stage-bar' as string]: `${barW}px`, ['--gk-stage-gap' as string]: `${colW - barW}px` }}
        onKeyDown={onKey}
      >
        {columns.map((c, i) => {
          const g = geo[i];
          const isSel = selected === c.id;
          const stacked = c.won !== undefined || c.lost !== undefined;
          const segs = stacked && !g.zero ? stackSegments(c.won ?? 0, c.lost ?? 0, g.h) : [];
          const v = heightOf(c);
          const sub = c.sub ?? (c.count !== undefined ? `${c.count} ${c.count === 1 ? countNoun[0] : countNoun[1]}` : undefined);
          const aria = `${c.label}: ${stacked ? `${full(c.won ?? 0)} won, ${full(c.lost ?? 0)} lost` : full(v)}${sub ? `, ${sub}` : ''}${conversionRow && conv[i] !== null ? `, ${Math.round((conv[i] as number) * 100)}% from previous` : ''}`;
          const inner = (
            <>
              {!wrapHeads && headOf(c, i)}
              <span className="g-stage-plot">
                <span className="g-stage-bar" data-zero={g.zero || undefined} data-stacked={segs.length > 1 || undefined} style={{ height: g.h }}>
                  {segs.map((s) => (
                    <i
                      key={s.key}
                      data-seg={s.key}
                      data-seg-dim={isSel && selectedSegment !== null && selectedSegment !== s.key ? '' : undefined}
                      style={{ top: s.y, height: s.h }}
                      onClick={onSegmentSelect ? (e) => { e.stopPropagation(); onSegmentSelect(c.id, s.key); } : undefined}
                    />
                  ))}
                </span>
                {flow && i < columns.length - 1 && <span className="g-stage-flow" aria-hidden="true" />}
              </span>
            </>
          );
          const common = {
            'data-col': c.id,
            'data-selected': isSel || undefined,
            'data-dim': selected !== null && !isSel ? '' : undefined,
            className: 'g-stage-col',
            onPointerEnter: () => setHover(c.id),
            onPointerLeave: () => setHover((h) => (h === c.id ? null : h)),
          };
          return interactive ? (
            <button
              key={c.id}
              {...common}
              type="button"
              role="radio"
              aria-checked={isSel}
              aria-label={aria}
              tabIndex={i === focusIdx ? 0 : -1}
              onFocus={() => setHover(c.id)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect!(c.id)}
            >
              {inner}
            </button>
          ) : (
            <div key={c.id} {...common} role="img" aria-label={aria}>{inner}</div>
          );
        })}
      </div>
      <span className="g-stage-baseline" aria-hidden="true" />
      {tip && hovered >= 0 && (
        <GChartTooltip
          x={colW * (hovered + 0.5)}
          y={(wrapHeads ? (groupRef.current?.offsetTop ?? 0) : conversionRow ? HEAD_H_CONV : HEAD_H) + HEAD_GAP + (plotH - geo[hovered].h)}
          containerWidth={W}
          title={tip.title}
          lines={tip.lines}
          hint={tip.hint}
          masked={hideValues}
        />
      )}
    </div>
  );
}

/** Header block height (px) and the gap above the plot; CSS reads them as `--gk-stage-head` / `--gk-stage-head-gap`. */
const HEAD_H = 66;
const HEAD_H_CONV = 84;
const HEAD_GAP = 12;

