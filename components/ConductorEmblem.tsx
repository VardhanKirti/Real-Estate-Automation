import { SparkIcon } from '@/components/SparkIcon';
import { WizardIcon } from '@/lib/nav';

/**
 * The Wizard's living core — the super-agent's mark on every surface it
 * appears (the right-edge dock, the /agents chat, the /org "AI Head" card).
 *
 * Replaces the old hard-bordered square chip with a round core wrapped in a
 * hairline ring that echoes the BrainViz signature: the Wizard IS the org's
 * brain. Idle it stays quiet (the Monolith rule — machinery, not mascots).
 * While an agent is being chatted with (`thinking`) it comes alive: an accent
 * arc orbits the ring, the core breathes, and a heartbeat halo pulses outward.
 * All motion is scoped to `.thinking` and disabled under prefers-reduced-motion
 * — see the `.conductor-emblem` block in app/globals.css.
 */

/** Compose the emblem's class list; `thinking` is the one bit the animation
    keys off, so it is unit-tested (tests/conductor-emblem.test.ts). */
export function conductorEmblemClasses(thinking: boolean, className = ''): string {
  return ['conductor-emblem', thinking ? 'thinking' : '', className]
    .filter(Boolean)
    .join(' ');
}

export function ConductorEmblem({
  size = 32,
  shade = 'var(--text)',
  thinking = false,
  glyph = 'core',
  className = '',
}: {
  /** Full footprint of the core + ring, in px. */
  size?: number;
  /** Tint of the Acme silhouette. */
  shade?: string;
  /** True while an agent is being chatted with — turns the motion on. */
  thinking?: boolean;
  /** The centre mark: the shared agent core (default), or the Wizard's own
   *  wand so the open dock matches its launcher (S08 Q-SH-1, dock header only). */
  glyph?: 'core' | 'wand';
  className?: string;
}) {
  // the silhouette sits at ~56% of the core so the ring + disc frame it
  const glyphSize = Math.round(size * 0.56);
  return (
    <span
      className={conductorEmblemClasses(thinking, className)}
      style={{ width: size, height: size }}
      data-thinking={thinking || undefined}
    >
      <span className="conductor-halo" aria-hidden />
      <span className="conductor-sweep" aria-hidden />
      <span className="conductor-ring" aria-hidden />
      <span className="conductor-core">
        {glyph === 'wand' ? (
          <WizardIcon aria-hidden width={glyphSize} height={glyphSize} strokeWidth={1.5} style={{ color: shade }} />
        ) : (
          <SparkIcon size={glyphSize} shade={shade} />
        )}
      </span>
    </span>
  );
}
