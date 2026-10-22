import type { ReactNode } from 'react';
import { arcPath, polar } from '@/lib/chart-geometry';

export type GRingGaugeProps = {
  /** null = not applicable: the arc is empty and the centre reads "—" */
  value: number | null;
  /** scale top (S03 ROAS: 4) */
  max: number;
  /** the reference tick (break-even 1.00x); below it the arc is `--g-warn` */
  reference?: number;
  /** what the gauge measures, window and source */
  label: string;
  /** under the centre: "0 to 4x" */
  scaleCaption?: string;
  format?: (v: number) => string;
  /** replaces the centre text (e.g. a GDotNumber) */
  centre?: ReactNode;
  /** px, default 120 */
  size?: number;
  className?: string;
};

/**
 * GRingGauge (GP3): a value arc on a 10px `--g-track` ring, from 12 o'clock
 * clockwise, `--g-accent` with a round cap; one `--g-ink` reference tick. A
 * value under the reference turns the arc `--g-warn`; values past `max`
 * fill the ring and the centre keeps the true value. Display-only.
 */
export function GRingGauge({ value, max, reference, label, scaleCaption, format = (v) => `${v.toFixed(2)}x`, centre, size = 120, className = '' }: GRingGaugeProps) {
  const sw = 10;
  const r = size / 2 - sw / 2 - 1;
  const c = size / 2;
  const v = value !== null && Number.isFinite(value) ? value : null;
  const frac = v === null || max <= 0 ? 0 : Math.max(0, Math.min(1, v / max));
  const below = v !== null && reference !== undefined && v < reference;
  const refDeg = reference !== undefined && max > 0 ? Math.max(0, Math.min(1, reference / max)) * 360 : null;
  const a = refDeg === null ? null : polar(c, c, r - sw / 2 - 2, refDeg);
  const b = refDeg === null ? null : polar(c, c, r + sw / 2 + 1, refDeg);
  const text = v === null ? `${label} · no data` : `${label}: ${format(v)}${reference !== undefined ? `, reference ${format(reference)}` : ''}`;
  return (
    <div data-g="GRingGauge" role="img" aria-label={text} title={text} className={`g-ringgauge ${className}`} data-below={below || undefined} style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" strokeWidth={sw} className="g-ringgauge-track" />
        {frac > 0 && <path d={arcPath(c, c, r, 0, frac * 360)} fill="none" strokeWidth={sw} strokeLinecap="round" className="g-ringgauge-arc" />}
        {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="g-ringgauge-ref" />}
      </svg>
      <div className="g-ringgauge-centre" aria-hidden="true">
        {centre ?? <span className="g-ringgauge-value">{v === null ? '—' : format(v)}</span>}
        {scaleCaption && <span className="g-ringgauge-cap">{scaleCaption}</span>}
      </div>
    </div>
  );
}
