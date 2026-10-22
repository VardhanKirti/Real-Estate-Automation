'use client';

import { useState } from 'react';
import { polar, radarPoints } from '@/lib/chart-geometry';
import { GEmpty } from './States';
import { colorVar, slotColor, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

export type RadarAxis = { id: string; label: string };
export type RadarLayer = { id: string; label: string; values: readonly (number | null)[]; color?: VizColor };

export type GRadarProps = VizStateProps & {
  axes: readonly RadarAxis[];
  layers: readonly RadarLayer[];
  /** value at the rim, default 100 */
  max?: number;
  /** the locked layer (legend click); others dim to 35% */
  activeLayer?: string | null;
  /** lock or unlock a layer; without it the legend is hover-only */
  onLayer?: (id: string | null) => void;
  /** px, default 260 */
  size?: number;
  formatValue?: (v: number) => string;
  label: string;
  className?: string;
};

/**
 * GRadar (GP3, S05 F05.15): an n-axis spider on `--g-line` spokes and rings;
 * each layer is a 1.5px series stroke with a 12% fill. Hovering a layer
 * (polygon or legend) sifts: the others dim to 35%. A legend click locks the
 * layer (`onLayer`). No layers draws the axes and an empty caption.
 */
export function GRadar({ axes, layers, max = 100, activeLayer = null, onLayer, size = 260, formatValue = (v) => String(Math.round(v)), label, className = '', ...stateProps }: GRadarProps) {
  const [hover, setHover] = useState<string | null>(null);
  const body = stateProps.state && stateProps.state !== 'ready' ? VizStateBody({ ...stateProps, height: size }) : null;
  if (body) return <div data-g="GRadar" className={`g-radar ${className}`}>{body}</div>;
  const pad = 34;
  const r = size / 2 - pad;
  const c = size / 2;
  const n = axes.length;
  const focus = hover ?? activeLayer;
  const summary = layers.length === 0 ? `${label} · no data` : `${label}: ${layers.map((l) => `${l.label} ${axes.map((a, k) => `${a.label} ${l.values[k] === null || l.values[k] === undefined ? 'no data' : formatValue(l.values[k] as number)}`).join(', ')}`).join('; ')}`;
  return (
    <div data-g="GRadar" className={`g-radar ${className}`}>
      <svg width={size} height={size} role="img" aria-label={summary}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={axes.map((_, k) => { const p = polar(c, c, r * f, (360 * k) / Math.max(1, n)); return `${p.x},${p.y}`; }).join(' ')} className="g-radar-ring" />
        ))}
        {axes.map((a, k) => {
          const end = polar(c, c, r, (360 * k) / Math.max(1, n));
          const lab = polar(c, c, r + 16, (360 * k) / Math.max(1, n));
          return (
            <g key={a.id}>
              <line x1={c} y1={c} x2={end.x} y2={end.y} className="g-radar-spoke" />
              <text x={lab.x} y={lab.y} className="g-xy-axis" textAnchor={Math.abs(lab.x - c) < 4 ? 'middle' : lab.x > c ? 'start' : 'end'} dominantBaseline="middle">{a.label}</text>
            </g>
          );
        })}
        {layers.map((l, i) => {
          const pts = radarPoints(l.values, max, c, c, r);
          const col = colorVar(l.color ?? slotColor(i));
          return (
            <polygon
              key={l.id}
              points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
              className="g-radar-layer"
              style={{ stroke: col, fill: `color-mix(in srgb, ${col} 12%, transparent)` }}
              data-dim={focus !== null && focus !== l.id ? '' : undefined}
              onPointerEnter={() => setHover(l.id)}
              onPointerLeave={() => setHover((h) => (h === l.id ? null : h))}
            />
          );
        })}
      </svg>
      {layers.length === 0 ? (
        <GEmpty inline title={stateProps.emptyText ?? 'No layers to show.'} />
      ) : layers.length > 1 && (
        <ul className="g-legend" data-layout="inline" aria-label={`${label} layers`}>
          {layers.map((l, i) => (
            <li key={l.id}>
              {onLayer ? (
                <button type="button" className="g-legend-item" aria-pressed={activeLayer === l.id} title={activeLayer === l.id ? `Unlock ${l.label}` : `Lock ${l.label}`} onPointerEnter={() => setHover(l.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(l.id)} onBlur={() => setHover(null)} onClick={() => onLayer(activeLayer === l.id ? null : l.id)}>
                  <i style={{ background: colorVar(l.color ?? slotColor(i)) }} /><span className="g-legend-label">{l.label}</span>
                </button>
              ) : (
                <span className="g-legend-item" data-static="" onPointerEnter={() => setHover(l.id)} onPointerLeave={() => setHover(null)}>
                  <i style={{ background: colorVar(l.color ?? slotColor(i)) }} /><span className="g-legend-label">{l.label}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
