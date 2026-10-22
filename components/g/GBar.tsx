import { colorVar, type VizColor } from './viz-shared';

export type GBarTone = 'ink' | 'soft' | 'warn' | 'over' | VizColor;

export type GBarSegment = { value: number; tone?: GBarTone; label: string };

export type GBarProps = {
  /** what the bar measures, with its value and window: "Runs succeeded · 7d: 41 of 48" */
  label: string;
  value?: number | null;
  /** default 100, or the segment total */
  max?: number;
  /** fill tone; `over` paints `--g-err` (value past max), `warn` `--g-warn`, `soft` `--g-track-soft` */
  tone?: GBarTone;
  /** split meter (GP3): succeeded / failed etc., proportional to `max` or their sum */
  segments?: GBarSegment[];
  onHero?: boolean;
  loading?: boolean;
  className?: string;
};

function toneFill(t: GBarTone | undefined, onHero: boolean): string {
  if (!t || t === 'ink') return onHero ? 'var(--g-on-hero)' : 'var(--g-ink)';
  if (t === 'soft') return 'var(--g-track-soft)';
  if (t === 'over') return 'var(--g-err)';
  return colorVar(t);
}

/**
 * GBar (S00 §5.3, GP3 `segments`): a 6px meter on `--g-track`, radius 999.
 * Display-only: `role="meter"` (single value) or `role="img"` (segments),
 * with the label as its accessible name and `title`. A null value draws the
 * empty track and says "no data", never a zero.
 */
export function GBar({ label, value = null, max, tone, segments, onHero = false, loading = false, className = '' }: GBarProps) {
  if (loading) return <span data-g="GBar" className={`g-bar ${className}`} data-loading="" aria-busy="true" aria-label={label} />;
  if (segments && segments.length) {
    const sum = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
    const total = Math.max(max ?? 0, sum);
    return (
      <span data-g="GBar" role="img" aria-label={label} title={label} className={`g-bar ${className}`} data-on-hero={onHero || undefined} data-split="">
        {total > 0 && segments.map((s, i) => s.value > 0 && (
          <i key={i} title={s.label} style={{ width: `${(s.value / total) * 100}%`, background: toneFill(s.tone, onHero) }} />
        ))}
      </span>
    );
  }
  const m = max ?? 100;
  const v = value === null || !Number.isFinite(value) ? null : value;
  const pct = v === null || m <= 0 ? 0 : Math.max(0, Math.min(1, v / m));
  const t = v !== null && v > m && tone !== 'warn' ? 'over' : tone;
  return (
    <span
      data-g="GBar"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={m}
      aria-valuenow={v ?? undefined}
      aria-valuetext={v === null ? 'no data' : undefined}
      title={v === null ? `${label} · no data` : label}
      className={`g-bar ${className}`}
      data-on-hero={onHero || undefined}
    >
      {v !== null && <i style={{ width: `${pct * 100}%`, background: toneFill(t, onHero) }} />}
    </span>
  );
}
