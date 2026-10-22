'use client';

import type { ReactNode } from 'react';
import { GBar, type GBarSegment, type GBarTone } from './GBar';
import { VizStateBody, type VizStateProps } from './viz-shared';

export type GDriverRow = {
  id: string;
  label: string;
  value: number;
  /** printed value; default the number */
  display?: ReactNode;
  /** what the row means, for `title` and the bar's label */
  title?: string;
  tone?: GBarTone;
  /** split row (won / lost) */
  segments?: GBarSegment[];
  /** the row is a button (GP3: rows can be buttons) */
  onClick?: () => void;
  /** or a link */
  href?: string;
  selected?: boolean;
};

export type GDriverBarsProps = VizStateProps & {
  rows: GDriverRow[];
  /** scale; default the largest row */
  max?: number;
  /** rows after the first `top` draw in the soft tone (CE DriverBars) */
  top?: number;
  /** `on-hero`: white fills at 25% / 100% on a hero gradient (GP3) */
  tone?: 'card' | 'on-hero';
  /** label column width, px (S00: 72) */
  labelWidth?: number;
  label?: string;
  className?: string;
};

/**
 * GDriverBars (S00 §5.3, GP3): rows of label · bar · value. A row with
 * `onClick` or `href` is a real button or link with a focus ring; a row
 * without is display-only and does not lift on hover.
 */
export function GDriverBars({ rows, max, top, tone = 'card', labelWidth = 72, label, className = '', ...state }: GDriverBarsProps) {
  const body = VizStateBody({ ...state, height: Math.max(1, rows.length || 3) * 24 });
  if (body) return <div data-g="GDriverBars" className={`g-driver ${className}`}>{body}</div>;
  if (rows.length === 0) return <div data-g="GDriverBars" className={`g-driver ${className}`}><VizStateBody state="empty" emptyText={state.emptyText} empty={state.empty} height={72} /></div>;
  const m = max ?? Math.max(0, ...rows.map((r) => r.segments ? r.segments.reduce((s, x) => s + x.value, 0) : r.value));
  const onHero = tone === 'on-hero';
  return (
    <ul data-g="GDriverBars" className={`g-driver ${className}`} data-on-hero={onHero || undefined} aria-label={label} style={{ ['--gk-driver-label' as string]: `${labelWidth}px` }}>
      {rows.map((r, i) => {
        const soft = top !== undefined && i >= top;
        const barTone: GBarTone | undefined = r.tone ?? (soft ? 'soft' : undefined);
        const title = r.title ?? `${r.label}: ${typeof r.display === 'string' ? r.display : r.value}`;
        const inner = (
          <>
            <span className="g-driver-label">{r.label}</span>
            <GBar label={title} value={r.value} max={m || 1} tone={barTone} segments={r.segments} onHero={onHero} className="g-driver-bar" />
            <span className="g-driver-value">{r.display ?? r.value}</span>
          </>
        );
        return (
          <li key={r.id}>
            {r.onClick ? (
              <button type="button" className="g-driver-row" data-action="" aria-pressed={r.selected} title={title} onClick={r.onClick}>{inner}</button>
            ) : r.href ? (
              <a className="g-driver-row" data-action="" href={r.href} title={title}>{inner}</a>
            ) : (
              <div className="g-driver-row" title={title}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
