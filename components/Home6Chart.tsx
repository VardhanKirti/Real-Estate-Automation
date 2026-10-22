'use client';

/**
 * Stacked posting-activity chart for the home page — the tall rounded-bar
 * chart from the reference, driven by REAL Zernio posting history (posts per
 * day per platform), or inbound comms when there is none. Hover, tap, swipe
 * or the arrow keys show the day's real counts.
 *
 * It draws at its real pixel width (S10 FR-11): a ResizeObserver measures the
 * wrapper (one render per frame) and the viewBox is that size, so axis text is
 * a true 10.5px at any width. Bars that would be under 5px become ISO weeks
 * (lib/home-chart.ts). Before the first measurement the box is an
 * aspect-ratio skeleton of the same height, so nothing jumps on hydration.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { bucketSeries, chartHeight, monthTicks, visibleTicks } from '@/lib/home-chart';

export type Home6Series = { key: string; label: string; color: string; points: number[] };
/** `g`: the GladOS tree's skin (--g-* tokens only, glados-ui SPEC S01 FR-8); logic is shared. */
export type Home6ChartProps = { days: string[]; series: Home6Series[]; title?: string; skin?: 'classic' | 'g' };

/** Every colour the chart paints, per skin. Classic keeps its exact values (AC00.18). */
const SKIN = {
  classic: { grid: 'rgb(var(--mist-rgb) / 0.06)', axis: 'var(--text-3)', hover: 'rgb(var(--mist-rgb) / 0.05)' },
  g: { grid: 'var(--g-line)', axis: 'var(--g-muted)', hover: 'var(--g-track-soft)' },
} as const;

const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 24;
const FONT = 10.5;

export function Home6Chart({ days, series, title = 'Activity chart', skin = 'classic' }: Home6ChartProps) {
  const c = SKIN[skin];
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [tipSize, setTipSize] = useState({ w: 0, h: 0 });

  // measure the wrapper; one state update per animation frame while it resizes
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      setWidth(Math.round(el.getBoundingClientRect().width));
    };
    read();
    const ro = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(read);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const W = width;
  const H = chartHeight(W || 940);
  const plotW = Math.max(1, W - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;

  const chart = useMemo(() => bucketSeries(days, series, plotW), [days, series, plotW]);
  const n = chart.days.length;

  // a bucket change (resize past 5px a bar) invalidates the hovered index
  useEffect(() => setHover(null), [chart.weekly]);

  const totals = useMemo(
    () => chart.days.map((_, i) => chart.series.reduce((s, sr) => s + (sr.points[i] ?? 0), 0)),
    [chart],
  );
  const max = Math.max(1, ...totals);
  // y-axis: round up to a friendly step; 5 lines on a tall plot, 3 on a short one
  const lines = plotH >= 220 ? 4 : 2;
  const step = max <= lines + 1 ? 1 : Math.ceil(max / lines);
  const yMax = step * Math.ceil(max / step);
  const gridLines = Array.from({ length: Math.round(yMax / step) + 1 }, (_, k) => k * step);

  const bw = plotW / Math.max(1, n);
  const bar = Math.min(28, Math.max(2, bw * 0.62));
  const xOf = (i: number) => PAD_L + i * bw;
  const ticks = useMemo(() => visibleTicks(monthTicks(chart.days), (i) => PAD_L + i * bw), [chart.days, bw]);

  useEffect(() => {
    const el = tipRef.current;
    if (el && (el.offsetWidth !== tipSize.w || el.offsetHeight !== tipSize.h)) setTipSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [hover, W, tipSize]);

  const idxAt = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || n === 0) return null;
    const x = clientX - el.getBoundingClientRect().left - PAD_L;
    if (x < 0 || x > plotW) return null;
    return Math.min(n - 1, Math.max(0, Math.floor(x / bw)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    const cur = hover ?? -1;
    let next: number | null = cur;
    if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1);
    else if (e.key === 'ArrowLeft') next = cur < 0 ? n - 1 : Math.max(0, cur - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') next = null;
    else return;
    e.preventDefault();
    setHover(next);
  };

  // tooltip: clamped in px inside the card; flips under the plot top on the
  // other side when it would sit on the hovered bar
  const tip = (() => {
    if (hover == null || W === 0) return null;
    const cx = xOf(hover) + bw / 2;
    const w = tipSize.w || 140;
    let left = Math.min(Math.max(8, cx - w / 2), W - w - 8);
    const barTop = PAD_T + plotH - (totals[hover] / yMax) * plotH;
    const tipBottom = 6 + (tipSize.h || 60);
    if (barTop < tipBottom && cx >= left - 4 && cx <= left + w + 4) {
      left = cx > W / 2 ? Math.max(8, cx - w - 16) : Math.min(W - w - 8, cx + 16);
    }
    return { left };
  })();

  const announce =
    hover == null
      ? ''
      : `${chart.labels[hover]}: ${
          chart.series
            .filter((sr) => (sr.points[hover] ?? 0) > 0)
            .map((sr) => `${sr.points[hover]} ${sr.label}`)
            .join(', ') || 'nothing'
        }`;

  return (
    <div
      ref={wrapRef}
      data-h6-chart
      className="relative outline-none"
      tabIndex={0}
      role="group"
      aria-label={`${title}. Use left and right arrows to read ${chart.weekly ? 'weeks' : 'days'}.`}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      {W === 0 ? (
        <div className="h6-chart-skeleton" />
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="h6-chart-svg"
          aria-hidden="true"
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse' || e.buttons) setHover(idxAt(e.clientX));
          }}
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse') return;
            const i = idxAt(e.clientX);
            setHover((h) => (i === h ? null : i));
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setHover(null);
          }}
        >
          {gridLines.map((v) => {
            const y = PAD_T + plotH - (v / yMax) * plotH;
            return (
              <g key={v}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={c.grid} />
                <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fontSize={FONT} fill={c.axis} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {v}
                </text>
              </g>
            );
          })}
          {chart.days.map((d, i) => {
            let acc = 0;
            const x = xOf(i) + (bw - bar) / 2;
            return (
              <g key={d}>
                <rect x={xOf(i)} y={PAD_T} width={bw} height={plotH} fill={hover === i ? c.hover : 'transparent'} />
                {chart.series.map((sr) => {
                  const v = sr.points[i] ?? 0;
                  if (v === 0) return null;
                  const h = (v / yMax) * plotH;
                  const y = PAD_T + plotH - ((acc + v) / yMax) * plotH;
                  acc += v;
                  return <rect key={sr.key} x={x} y={y} width={bar} height={Math.max(1.5, h - 1)} rx={bar / 3.2} fill={sr.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
                })}
              </g>
            );
          })}
          {ticks.map((t) => (
            <text key={t.i} x={xOf(t.i)} y={H - 6} fontSize={FONT} fill={c.axis}>
              {t.label}
            </text>
          ))}
        </svg>
      )}

      {hover != null && tip && skin === 'g' && (
        <div ref={tipRef} className="hg-chart-tip" style={{ left: tip.left, top: 6 }}>
          <div className="hg-chart-tip-title">{chart.labels[hover]}</div>
          <div className="hg-chart-tip-lines">
            {totals[hover] === 0 && <span className="hg-chart-tip-none">nothing</span>}
            {chart.series
              .filter((sr) => (sr.points[hover] ?? 0) > 0)
              .map((sr) => (
                <span key={sr.key} className="hg-chart-tip-line">
                  <i style={{ background: sr.color }} />
                  {sr.points[hover]} {sr.label}
                </span>
              ))}
          </div>
        </div>
      )}
      {hover != null && tip && skin === 'classic' && (
        <div
          ref={tipRef}
          className="h6-tip pointer-events-none absolute z-10 max-w-[calc(100%-16px)] rounded-[12px] border p-3"
          style={{
            left: tip.left,
            top: 6,
            background: 'color-mix(in srgb, var(--elevated) 95%, transparent)',
            borderColor: 'rgb(var(--mist-rgb) / 0.14)',
          }}
        >
          <div className="mb-1.5 whitespace-nowrap text-[10.5px]" style={{ color: 'var(--text-2)' }}>
            {chart.labels[hover]}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {totals[hover] === 0 && (
              <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                nothing
              </span>
            )}
            {chart.series
              .filter((sr) => (sr.points[hover] ?? 0) > 0)
              .map((sr) => (
                <span key={sr.key} className="flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: 'rgb(var(--mist-rgb) / 0.12)', color: 'var(--text)' }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: sr.color }} />
                  {sr.points[hover]} {sr.label}
                </span>
              ))}
          </div>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
