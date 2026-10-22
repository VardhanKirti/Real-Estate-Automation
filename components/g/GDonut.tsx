'use client';

import { useState, type ReactNode } from 'react';
import { arcPath, donutArcs } from '@/lib/chart-geometry';
import { colorVar, slotColor, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

export type DonutSlice = { id: string; label: string; value: number; color?: VizColor };

export type GDonutProps = VizStateProps & {
  slices: readonly DonutSlice[];
  /** px, default 190 (S02 §5.7) */
  size?: number;
  /** ring stroke 12 to 16px, default 16 */
  stroke?: number;
  formatValue?: (v: number) => string;
  /** caption under the centre total: "per month" */
  centreLabel?: string;
  /** replaces the default centre total (e.g. a GDotNumber) */
  centre?: ReactNode;
  /** hide the legend list (when a page shows its own) */
  legend?: boolean;
  /** a legend row or slice click; rows are buttons only when set */
  onSelect?: (id: string) => void;
  /** dims slices that do not match (search-dim, S02 §5.7) */
  dimmed?: readonly string[];
  /** blur amounts */
  hideValues?: boolean;
  label: string;
  className?: string;
};

/**
 * GDonut (S00 §5.3, S02 §5.7): a ring with round caps and 2° visible gaps on
 * a `--g-track` circle, slices in series order, a centre readout and a
 * legend list. Hovering a slice or a legend row dims the others to 35% and
 * swaps the centre to that slice. The one-slice rule: a single slice says
 * nothing a ring can add, so it renders a stat (value and label) instead.
 */
export function GDonut({
  slices, size = 190, stroke = 16, formatValue = (v) => v.toLocaleString('en-US'), centreLabel, centre, legend = true, onSelect, dimmed = [],
  hideValues = false, label, className = '', ...stateProps
}: GDonutProps) {
  const [hover, setHover] = useState<string | null>(null);
  const vis = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = vis.reduce((a, s) => a + s.value, 0);
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (total === 0 ? 'empty' : 'ready'), height: size });
  if (body) return <div data-g="GDonut" className={`g-donut ${className}`}>{body}</div>;

  if (vis.length === 1) {
    const s = vis[0];
    return (
      <div data-g="GDonut" data-single="" className={`g-donut ${className}`} title={`${label}: all ${s.label}`}>
        <div className="g-donut-stat">
          <span className="g-donut-big" data-mask={hideValues || undefined}>{formatValue(s.value)}</span>
          <span className="g-donut-cap">{s.label} · 100%{centreLabel ? ` · ${centreLabel}` : ''}</span>
        </div>
      </div>
    );
  }

  const sw = Math.max(12, Math.min(16, stroke));
  const r = size / 2 - sw / 2;
  const c = size / 2;
  const colours = slices.map((s, i) => colorVar(s.color ?? slotColor(i)));
  const arcs = donutArcs(slices.map((s) => s.value), { gapDeg: 2, strokePx: sw, radius: r });
  const hs = hover ? slices.find((s) => s.id === hover) ?? null : null;
  const dim = (id: string) => (hover !== null && hover !== id) || dimmed.includes(id);
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;

  return (
    <div data-g="GDonut" className={`g-donut ${className}`}>
      <div className="g-donut-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${label}: ${vis.map((s) => `${s.label} ${pct(s.value)}`).join(', ')}`}>
          <circle cx={c} cy={c} r={r} fill="none" className="g-donut-track" strokeWidth={sw} />
          {arcs.map((a) => {
            const s = slices[a.index];
            return (
              <path
                key={s.id}
                d={arcPath(c, c, r, a.start, a.end)}
                fill="none"
                stroke={colours[a.index]}
                strokeWidth={sw}
                strokeLinecap="round"
                data-dim={dim(s.id) || undefined}
                onPointerEnter={() => setHover(s.id)}
                onPointerLeave={() => setHover((h) => (h === s.id ? null : h))}
                onClick={onSelect ? () => onSelect(s.id) : undefined}
              >
                <title>{`${s.label}: ${hideValues ? '' : `${formatValue(s.value)} · `}${pct(s.value)}`}</title>
              </path>
            );
          })}
        </svg>
        <div className="g-donut-centre" aria-hidden="true">
          {hs ? (
            <>
              <span className="g-donut-big" data-mask={hideValues || undefined}>{formatValue(hs.value)}</span>
              <span className="g-donut-cap">{hs.label} · {pct(hs.value)}</span>
            </>
          ) : centre ?? (
            <>
              <span className="g-donut-big" data-mask={hideValues || undefined}>{formatValue(total)}</span>
              {centreLabel && <span className="g-donut-cap">{centreLabel}</span>}
            </>
          )}
        </div>
      </div>
      {legend && (
        <ul className="g-donut-legend" aria-label={`${label} legend`}>
          {slices.map((s, i) => {
            const inner = (
              <>
                <i style={{ background: colours[i] }} />
                <span className="g-donut-lname">{s.label}</span>
                <span className="g-donut-lval" data-mask={hideValues || undefined}>{formatValue(s.value)}</span>
                <span className="g-donut-lpct">{total > 0 ? pct(Math.max(0, s.value)) : '—'}</span>
              </>
            );
            const hov = { onPointerEnter: () => setHover(s.id), onPointerLeave: () => setHover((h) => (h === s.id ? null : h)) };
            return (
              <li key={s.id} data-dim={dim(s.id) || undefined}>
                {onSelect ? (
                  <button type="button" className="g-donut-row" data-action="" {...hov} onFocus={() => setHover(s.id)} onBlur={() => setHover(null)} onClick={() => onSelect(s.id)}>{inner}</button>
                ) : (
                  <div className="g-donut-row" {...hov}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
