import Image from 'next/image';
import { Sparkles } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { cx } from './format';

/**
 * The Conductor's living core (FO ConductorEmblem): a round core in a hairline
 * ring. Idle it is quiet; `thinking` orbits an accent arc, breathes the core
 * and pulses a halo. Motion is off under reduced motion. The core glyph is an
 * inline stroke icon (house rule), not FounderOS's brand emblem.
 */
export function ConductorEmblem({ size = 32, thinking = false, className }: { size?: number; thinking?: boolean; className?: string }) {
  const glyph = Math.round(size * 0.46);
  return (
    <span
      data-l="ConductorEmblem"
      className={cx('l-conductor', thinking && 'thinking', className)}
      style={{ width: size, height: size }}
      data-thinking={thinking || undefined}
      aria-hidden
    >
      <span className="l-conductor-halo" />
      <span className="l-conductor-sweep" />
      <span className="l-conductor-ring" />
      <span className="l-conductor-core">
        <Sparkles size={glyph} strokeWidth={1.6} />
      </span>
    </span>
  );
}

/** The deployment's mark (BRAND.mark), never a hard-coded product name (SPEC AC-15). */
export function OsMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <Image
      data-l="OsMark"
      src={BRAND.mark}
      alt={BRAND.name}
      width={size}
      height={size}
      className={cx('l-osmark', className)}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}
