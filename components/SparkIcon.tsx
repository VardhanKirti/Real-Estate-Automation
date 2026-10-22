/**
 * The agent emblem — a concentric core (dot + orbit ring), inlined as an SVG
 * data-URI mask. Replaced the four-point spark 2026-08-24  — the rings echo the Optimal Engine
 * radial core instead. The mask sits over a solid color, so `shade` tints
 * the silhouette to any color — black for the Wizard, each department's
 * life-area color for its agents, etc.
 */
export const EMBLEM_MINT = 'var(--accent)';

const SPARK_MASK =
  "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='15'/%3E%3Cpath d='M50 12 a38 38 0 1 0 0.001 0 Z M50 21 a29 29 0 1 1 -0.001 0 Z' fill-rule='evenodd'/%3E%3C/svg%3E\")";

export function SparkIcon({
  size = 28,
  shade = 'var(--accent)',
  className = '',
}: {
  shade?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label="Agent"
      className={`emblem inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: shade,
        // color drives the hover drop-shadow glow (.emblem in globals.css)
        color: shade,
        WebkitMaskImage: SPARK_MASK,
        maskImage: SPARK_MASK,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}
