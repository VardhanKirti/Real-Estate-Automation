'use client';

import dynamic from 'next/dynamic';
import type { ObservatoryData } from '@/lib/gbrain-observatory';

/** Canvas engine is client-only (rAF + sprites) — ships lazily, real data flows in as props. */
const GBrainObservatory = dynamic(
  () => import('@/archive/design-prototypes/components/GBrainObservatory').then((m) => m.GBrainObservatory),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full" style={{ background: 'var(--viz-stage)' }}>
        <div className="flex h-full items-center justify-center font-mono text-[11px] text-[#3d3d46]">
          waking the brain…
        </div>
      </div>
    ),
  },
);

export function GBrainObservatoryLazy({ data }: { data: ObservatoryData }) {
  return <GBrainObservatory data={data} />;
}
