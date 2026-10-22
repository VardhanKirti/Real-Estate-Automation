'use client';

import dynamic from 'next/dynamic';
import type { ObservatoryData } from '@/lib/gbrain-observatory';

/** Radial engine is client-only (SVG interactions) — ships lazily, real data flows in as props. */
const GBrainRadial = dynamic(() => import('@/components/GBrainRadial').then((m) => m.GBrainRadial), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full" style={{ background: 'var(--viz-stage-2)' }}>
      <div className="flex h-full items-center justify-center font-mono text-[11px] text-[var(--gbr-footer)]">
        waking the brain…
      </div>
    </div>
  ),
});

export function GBrainRadialLazy({ data, g = false, fullscreen }: { data: ObservatoryData; g?: boolean; fullscreen?: boolean }) {
  return <GBrainRadial data={data} g={g} fullscreen={fullscreen} />;
}
