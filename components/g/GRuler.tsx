export type GRulerProps = {
  /** the value and its scale in words: "Median 34 days of 90" (also the `title`) */
  label: string;
  value: number | null;
  max: number;
  /** 30 to 40 ticks (S00 §5.3); default 36 */
  ticks?: number;
  /** `warn` marks with the badge colour, `over` with `--g-err`, both 3px */
  tone?: 'warn' | 'over';
  onHero?: boolean;
  className?: string;
};

/**
 * GRuler (S00 §5.3, port of the engine's Ruler / TickGauge): 2px ticks at
 * 8 / 14 / 22px, the mark where the value sits. Display-only `role="img"`.
 * A null value draws no mark and the label says so.
 */
export function GRuler({ label, value, max, ticks = 36, tone, onHero = false, className = '' }: GRulerProps) {
  const n = Math.max(30, Math.min(40, Math.round(ticks)));
  const pct = value === null || !Number.isFinite(value) || max <= 0 ? null : Math.max(0, Math.min(1, value / max));
  const mark = pct === null ? -1 : Math.round(pct * (n - 1));
  const text = pct === null ? `${label} · no data` : label;
  return (
    <div data-g="GRuler" role="img" aria-label={text} title={text} className={`g-ruler ${className}`} data-tone={tone} data-on-hero={onHero || undefined}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-k={i === mark ? 'mark' : i % 5 === 0 ? 'tall' : undefined} style={{ height: i === mark ? 22 : i % 5 === 0 ? 14 : 8 }} />
      ))}
    </div>
  );
}
