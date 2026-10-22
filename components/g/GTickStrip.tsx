export type TickRunState = 'ok' | 'failed' | 'missing';

export type GTickStripProps = {
  /** summary for assistive tech: "Inbound · 24h: 31 messages, peak 6 at 14:00" */
  label: string;
  /** value mode: heights 4 to 22px by value (null = missing) */
  values?: readonly (number | null)[];
  /** runs mode (`kind="runs"`): ok 8px ink, failed 14px err, missing 4px line */
  kind?: 'values' | 'runs';
  states?: readonly TickRunState[];
  /** per-tick `<title>` (what and when) */
  titles?: readonly string[];
  /** index of the marked tick (now) */
  marked?: number;
  onHero?: boolean;
  className?: string;
};

/**
 * GTickStrip (GP3): N data-driven 2px ticks with round caps. Each tick's
 * height comes from its value or run state and carries its own title.
 * Empty input draws flat track ticks titled "no data". Display-only
 * `role="img"` with a summary label.
 */
export function GTickStrip({ label, values, kind = 'values', states, titles, marked, onHero = false, className = '' }: GTickStripProps) {
  const n = kind === 'runs' ? states?.length ?? 0 : values?.length ?? 0;
  if (n === 0) {
    const text = `${label} · no data`;
    return (
      <div data-g="GTickStrip" role="img" aria-label={text} title={text} className={`g-ticks ${className}`} data-empty="" data-on-hero={onHero || undefined}>
        {Array.from({ length: 24 }, (_, i) => <i key={i} style={{ height: 4 }} />)}
      </div>
    );
  }
  const max = kind === 'values' ? Math.max(0, ...(values ?? []).map((v) => (v !== null && Number.isFinite(v) ? v : 0))) : 0;
  return (
    <div data-g="GTickStrip" role="img" aria-label={label} className={`g-ticks ${className}`} data-on-hero={onHero || undefined}>
      {Array.from({ length: n }, (_, i) => {
        let h = 4;
        let tone: string | undefined;
        if (kind === 'runs') {
          const s = states![i];
          h = s === 'ok' ? 8 : s === 'failed' ? 14 : 4;
          tone = s;
        } else {
          const v = values![i];
          if (v === null || !Number.isFinite(v)) tone = 'missing';
          else h = max > 0 ? 4 + (Math.max(0, v) / max) * 18 : 4;
        }
        return (
          <i key={i} title={titles?.[i]} data-tone={tone} data-marked={i === marked || undefined} style={{ height: h }} />
        );
      })}
    </div>
  );
}
