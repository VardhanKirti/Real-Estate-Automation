export type GBlobState = 'ready' | 'approved' | 'draft' | 'sent';

export type GBlobProps = {
  state: GBlobState;
  /** the state in words for assistive tech and `title`: "Brief ready" */
  label: string;
  /** px before blur, default 28 */
  size?: number;
  className?: string;
};

/**
 * GBlob (S00 §5.3, the engine's `.ae-blob`): a blurred dot coloured by
 * `--g-state-<state>`. It encodes an item's state only, so it always carries
 * its state as a label. Not a glow: it sits inside its card, never outside.
 */
export function GBlob({ state, label, size = 28, className = '' }: GBlobProps) {
  return <span data-g="GBlob" role="img" aria-label={label} title={label} className={`g-blob ${className}`} data-state={state} style={{ width: size, height: size }} />;
}
