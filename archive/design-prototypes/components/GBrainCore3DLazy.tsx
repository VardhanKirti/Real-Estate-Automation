'use client';

import dynamic from 'next/dynamic';
import type { ObservatoryData } from '@/lib/gbrain-observatory';

/** 3D core engine is client-only (canvas + rAF) — ships lazily, real data flows in as props. */
const GBrainCore3D = dynamic(() => import('@/archive/design-prototypes/components/GBrainCore3D').then((m) => m.GBrainCore3D), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full" style={{ background: 'var(--viz-stage)' }}>
      <div className="flex h-full items-center justify-center font-mono text-[11px] text-[#3d3d46]">
        waking the brain…
      </div>
    </div>
  ),
});

export function GBrainCore3DLazy({ data }: { data: ObservatoryData }) {
  return <GBrainCore3D data={data} />;
}
