import { extent, seriesPaths, spreadX } from '@/lib/chart-geometry';
import { colorVar, type VizColor } from './viz-shared';

export type GSparklineProps = {
  values: readonly (number | null)[];
  /** what the line is, its window and source: "Followers · 30d · Zernio" */
  label: string;
  color?: VizColor;
  /** px, 24 to 32 (default 28) */
  height?: number;
  /** viewBox width; the svg stretches to its box */
  width?: number;
  onHero?: boolean;
  className?: string;
};

/**
 * GSparkline (S00 §5.3): a 1.5px line in a series token, no axes, a 5px dot on
 * the last real point. Null values break the line. Fewer than two real
 * points draw a flat `--g-track` line and the label says "no data".
 * Display-only `role="img"`.
 */
export function GSparkline({ values, label, color = 'series-1', height = 28, width = 120, onHero = false, className = '' }: GSparklineProps) {
  const H = Math.max(24, Math.min(32, height));
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const pad = 3;
  if (real.length < 2) {
    const text = `${label} · no data`;
    return (
      <svg data-g="GSparkline" role="img" aria-label={text} className={`g-spark ${className}`} viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        <title>{text}</title>
        <line x1={0} x2={width} y1={H / 2} y2={H / 2} className="g-spark-empty" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const [lo, hi] = extent(values, false);
  const span = hi - lo || 1;
  const xs = spreadX(values.length, pad, width - pad);
  const yOf = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const paths = seriesPaths(values, xs, yOf);
  let last = values.length - 1;
  while (last >= 0 && (values[last] === null || !Number.isFinite(values[last] as number))) last--;
  const stroke = onHero ? 'var(--g-on-hero)' : colorVar(color);
  return (
    <span data-g="GSparkline" role="img" aria-label={label} title={label} className={`g-spark ${className}`} style={{ height: H }}>
      <svg viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {paths.map((p, i) => <path key={i} d={p.d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <i className="g-spark-dot" style={{ left: `${(xs[last] / width) * 100}%`, top: yOf(values[last] as number), background: stroke }} />
    </span>
  );
}
