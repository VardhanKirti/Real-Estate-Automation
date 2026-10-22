'use client';

import { useRef } from 'react';

/**
 * Hover-to-play muted preview for a delivered/generated video card: play on
 * mouseenter, pause (and rewind) on mouseleave. No autoplay, no ambient
 * motion when the card isn't under the pointer.
 */
export function HoverVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      className={className}
      onMouseEnter={() => ref.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const v = ref.current;
        if (!v) return;
        v.pause();
        v.currentTime = 0;
      }}
    />
  );
}
