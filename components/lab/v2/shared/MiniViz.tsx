/**
 * Mini viz for tiles (02 section 8.1) and the cost fit bar (8.2). All SVG, aria-hidden: the tile's link
 * label carries the meaning. Geometry only; colours come from .lab2-viz-* classes.
 */
import { areaPaths } from '@/lib/chart-geometry';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

type Size = { w?: number; h?: number };

export type BandVizProps = Size & {
  ageH: number;
  points: { h: number; v: number }[];
  band: { h: number; lo: number; mid: number; hi: number }[];
  dim?: boolean;
};

const lg = (v: number) => Math.log10(Math.max(0, v) + 1);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Post snapshot curve over the creator's normal band at age (log views). */
export function BandViz({ ageH, points, band, w = 88, h = 32, dim }: BandVizProps) {
  const maxH = Math.max(72, ageH);
  const ys = [...band.flatMap((b) => [lg(b.lo), lg(b.hi)]), ...points.map((p) => lg(p.v))];
  if (!ys.length) return null;
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo || 1) * 0.08;
  lo -= pad; hi += pad;
  const x = (hh: number) => r1(2 + (hh / maxH) * (w - 6));
  const y = (v: number) => r1(h - 2 - ((lg(v) - lo) / (hi - lo)) * (h - 4));
  const sorted = [...band].sort((a, b) => a.h - b.h);
  const area = sorted.length > 1
    ? `M${sorted.map((b) => `${x(b.h)} ${y(b.hi)}`).join(' L')} L${[...sorted].reverse().map((b) => `${x(b.h)} ${y(b.lo)}`).join(' L')} Z`
    : null;
  const mid = sorted.length > 1 ? `M${sorted.map((b) => `${x(b.h)} ${y(b.mid)}`).join(' L')}` : null;
  const pts = [...points].sort((a, b) => a.h - b.h);
  const last = pts[pts.length - 1];
  return (
    <svg className="lab2-viz" data-viz="band" data-dim={dim ? '' : undefined} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {area && <path className="lab2-viz-band" d={area} />}
      {mid && <path className="lab2-viz-mid" d={mid} fill="none" strokeWidth={1} strokeDasharray="2 2" />}
      {pts.length > 1 && <polyline className="lab2-viz-line" data-lab-mark="" fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" points={pts.map((p) => `${x(p.h)},${y(p.v)}`).join(' ')} />}
      {last && <circle className="lab2-viz-dot" cx={x(last.h)} cy={y(last.v)} r={2.5} />}
    </svg>
  );
}

/** `max` sets a shared scale (a row of tiles compared on one axis); default is the series' own max. */
export type WaveVizProps = Size & { buckets: number[]; nowIndex: number; window: 'open' | 'closing' | 'closed'; max?: number; dim?: boolean };

/** Coverage wave: creators covering per 6h since launch, straight segments (no smoothing). */
export function WaveViz({ buckets, nowIndex, window: win, max: scale, w = 88, h = 32, dim }: WaveVizProps) {
  const vals = buckets.slice(0, 28);
  if (vals.length < 2) return null;
  const max = Math.max(1, scale ?? 0, ...vals);
  const xs = vals.map((_, i) => r1(2 + (i / (vals.length - 1)) * (w - 4)));
  const yOf = (v: number) => r1(h - 2 - (v / max) * (h - 6));
  const [area] = areaPaths(vals, xs, yOf, h - 1);
  const line = `M${vals.map((v, i) => `${xs[i]} ${yOf(v)}`).join(' L')}`;
  const nx = xs[Math.min(vals.length - 1, Math.max(0, nowIndex))];
  return (
    <svg className="lab2-viz" data-viz="wave" data-window={win} data-dim={dim ? '' : undefined} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {area && <path className="lab2-viz-band" d={area} />}
      <path className="lab2-viz-line" data-lab-mark="" d={line} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeDasharray={win === 'closing' ? '3 2' : undefined} />
      <line className="lab2-viz-mid" x1={nx} x2={nx} y1={2} y2={h - 1} strokeWidth={1} />
    </svg>
  );
}

export type CapVizProps = Size & { spent: number; cap: number; dim?: boolean };

function capTone(f: number): 'ok' | 'near' | 'over' {
  return f >= 1 ? 'over' : f >= 0.8 ? 'near' : 'ok';
}

/** Cap meter: 2px track filled to spent / cap, a knob on glass with a ring (warn at 80%, down at 100%). */
export function CapViz({ spent, cap, w = 88, h = 32, dim }: CapVizProps) {
  const f = cap > 0 ? Math.max(0, spent / cap) : 0;
  const x0 = 6, x1 = w - 6, cy = h / 2;
  const kx = r1(x0 + Math.min(1, f) * (x1 - x0));
  return (
    <svg className="lab2-viz" data-viz="cap" data-tone={capTone(f)} data-dim={dim ? '' : undefined} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <line className="lab2-viz-track" x1={x0} x2={x1} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round" />
      <line className="lab2-viz-fill" data-lab-mark="" x1={x0} x2={kx} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round" />
      <circle className="lab2-viz-knob" cx={kx} cy={cy} r={5} strokeWidth={1.5} />
    </svg>
  );
}

export type TickVizProps = Size & { values: number[]; highlight: number[]; dim?: boolean };

/** Tick bars: 2px wide, 6px pitch, height proportional; highlighted indices in --lab-up. */
export function TickViz({ values, highlight, w = 88, h = 32, dim }: TickVizProps) {
  const max = Math.max(0, ...values);
  const n = Math.min(values.length, Math.floor((w - 2) / 6) + 1);
  const vals = values.slice(-n);
  const off = values.length - vals.length;
  const hl = new Set(highlight);
  return (
    <svg className="lab2-viz" data-viz="ticks" data-dim={dim ? '' : undefined} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {vals.map((v, i) => {
        const bh = v > 0 && max > 0 ? Math.max(2, (v / max) * (h - 4)) : 1;
        const on = hl.has(i + off);
        return <rect key={i} className={on ? 'lab2-viz-tick-on' : 'lab2-viz-tick'} data-lab-mark={on ? '' : undefined} x={w - 2 - (vals.length - 1 - i) * 6} y={h - 1 - bh} width={2} height={bh} rx={1} />;
      })}
    </svg>
  );
}

export type CostFitBarProps = Size & {
  spent: number;
  estimate: { low: number; point: number; high: number };
  cap: number | null;
  fit: 'fits' | 'tight' | 'over';
};

/** Cap meter plus a hatched estimate segment and a tick at the high bound (02 section 8.2). */
export function CostFitBar({ spent, estimate, cap, fit, w = 200, h = 16 }: CostFitBarProps) {
  const km = useKitMark();
  if (cap === null || !(cap > 0)) return null;
  const x0 = 6, x1 = w - 6, cy = h / 2;
  const at = (v: number) => r1(x0 + Math.min(1, Math.max(0, v / cap)) * (x1 - x0));
  const sx = at(spent), px = at(spent + estimate.point), hx = at(spent + estimate.high);
  const id = `lab2-hatch-${Math.round(spent * 1000)}-${Math.round(estimate.point * 1000)}`;
  return (
    <svg className="lab2-viz" data-viz="costfit" data-fit={fit} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-lab="CostFitBar" {...km('LabCostFitBar')}>
      <defs>
        <pattern id={id} width={3} height={3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="lab2-viz-hatch" x1={0} y1={0} x2={0} y2={3} strokeWidth={1} />
        </pattern>
      </defs>
      <line className="lab2-viz-track" x1={x0} x2={x1} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round" />
      <rect x={sx} y={cy - 3} width={Math.max(0, px - sx)} height={6} fill={`url(#${id})`} />
      <line className="lab2-viz-fill" data-lab-mark="" x1={x0} x2={sx} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round" />
      <line className="lab2-viz-mid" x1={hx} x2={hx} y1={cy - 5} y2={cy + 5} strokeWidth={1} />
      <circle className="lab2-viz-knob" cx={sx} cy={cy} r={4} strokeWidth={1.5} />
    </svg>
  );
}
