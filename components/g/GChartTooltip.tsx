'use client';

import { useRef, useState, type ReactNode } from 'react';
import { clampTip } from '@/lib/chart-geometry';
import { useIsoLayoutEffect } from './viz-shared';

export type GChartTooltipProps = {
  /** anchor x in the positioned parent's px (the tip centres on it) */
  x: number;
  /** anchor y: the tip's bottom edge sits `gap` px above it */
  y: number;
  /** width of the positioned parent (the card), for the 12px clamp */
  containerWidth: number;
  title: ReactNode;
  lines?: ReactNode[];
  /** muted last line, e.g. "Click to show these deals" */
  hint?: ReactNode;
  /** blur amounts (Finances hide values) */
  masked?: boolean;
  gap?: number;
  className?: string;
};

/**
 * The floating chart pill (S00 §5.3, X1): `--g-card-2`, `--g-shadow`,
 * 13 / 11.5 lines, a 5px caret, clamped 12px inside its card, fading in after
 * 120ms (no delay under reduced motion). Display-only: the focused or
 * hovered mark carries the same text in its own label, so this is
 * `aria-hidden`.
 */
export function GChartTooltip({ x, y, containerWidth, title, lines = [], hint, masked = false, gap = 10, className = '' }: GChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useIsoLayoutEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth);
  });
  const left = clampTip(x, w || 160, containerWidth);
  const caret = Math.max(10, Math.min((w || 160) - 10, x - left));
  return (
    <div
      ref={ref}
      data-g="GChartTooltip"
      aria-hidden="true"
      className={`g-chart-tip ${className}`}
      data-masked={masked || undefined}
      style={{ left, top: y - gap, ['--gk-tip-caret' as string]: `${caret}px` }}
    >
      <div className="g-chart-tip-title">{title}</div>
      {lines.map((l, i) => (<div key={i} className="g-chart-tip-line" data-mask={masked || undefined}>{l}</div>))}
      {hint && <div className="g-chart-tip-hint">{hint}</div>}
    </div>
  );
}
