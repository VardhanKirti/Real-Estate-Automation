export type GRingsStatus = 'ok' | 'warn' | 'err' | 'off';

export type GRingsProps = {
  /** lit rings, 0 to 3 (required: the rings are a readout, never decoration) */
  value: number;
  /** the centre dot (required): connection or health state */
  status: GRingsStatus;
  /** what the rings and the dot mean, with the value: "2 runs in flight · Arcads connected" */
  label: string;
  /** px, default 86 */
  size?: number;
  onHero?: boolean;
  className?: string;
};

const STATUS_WORD: Record<GRingsStatus, string> = { ok: 'ok', warn: 'needs attention', err: 'error', off: 'off' };

/**
 * GRings (S00 §5.3, FR-18; replaces the engine's decorative Rings, H39): up
 * to three concentric 1px rings, the inner `value` of them lit, and a centre
 * dot coloured by `status`. Both props are required so the component cannot
 * render as decoration. Values above 3 light all three and the label keeps
 * the true count.
 */
export function GRings({ value, status, label, size = 86, onHero = false, className = '' }: GRingsProps) {
  const lit = Math.max(0, Math.min(3, Math.floor(Number.isFinite(value) ? value : 0)));
  const text = `${label} (${STATUS_WORD[status]})`;
  return (
    <div data-g="GRings" role="img" aria-label={text} title={text} className={`g-rings ${className}`} data-status={status} data-on-hero={onHero || undefined} style={{ width: size, height: size }}>
      {[100, 74, 49].map((s, i) => (
        // ring 0 is the outermost; lighting fills from the inside out
        <span key={s} data-on={2 - i < lit || undefined} style={{ width: `${s}%`, height: `${s}%` }} />
      ))}
      <i />
    </div>
  );
}
