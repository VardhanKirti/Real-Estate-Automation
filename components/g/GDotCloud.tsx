export const DOT_CLOUD_CAP = 192;

export type GDotCloudProps = {
  /** dots in the cloud (one per item) */
  total: number;
  /** of which lit */
  lit: number;
  /** what a dot is and what lit means: "48 pooled · 12 proven 30+ days" */
  label: string;
  onHero?: boolean;
  className?: string;
};

/**
 * GDotCloud (S00 §5.3, the engine's `.ae-dotcloud`): an unordered count, one
 * 4px dot per item, lit first. Capped at 192 dots; past the cap the label
 * says "first 192 shown". Display-only. Zero items render nothing (the
 * caller's numeral already says 0).
 */
export function GDotCloud({ total, lit, label, onHero = false, className = '' }: GDotCloudProps) {
  const n = Math.max(0, Math.min(DOT_CLOUD_CAP, Math.floor(total)));
  if (n === 0) return null;
  const on = Math.max(0, Math.min(n, Math.floor(lit)));
  const text = total > DOT_CLOUD_CAP ? `${label} (first ${DOT_CLOUD_CAP} shown)` : label;
  return (
    <div data-g="GDotCloud" role="img" aria-label={text} title={text} className={`g-dotcloud ${className}`} data-on-hero={onHero || undefined}>
      {Array.from({ length: n }, (_, i) => <span key={i} data-on={i < on || undefined} />)}
    </div>
  );
}
