import { GBrainObservatoryLazy } from '@/archive/design-prototypes/components/GBrainObservatoryLazy';
import { GBrainVariantSwitch } from '@/archive/design-prototypes/components/GBrainVariantSwitch';
import { loadObservatoryData } from '@/lib/gbrain-observatory';

// G-Brain design variant 1 — the flat constellation (docs/DESIGN-GBRAIN.md).
// Variants 2 (3D core) and 3 (radial) are at /design/gbrain-2 and -3. All
// render the REAL brain-store: folders, pages + chunks, live retrieval.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function GBrainDemoPage() {
  const data = loadObservatoryData();
  return (
    <div className="relative -mx-8 -mb-16 -mt-7 h-[calc(100vh-52px)] wide:-mx-10 ultra:-mx-12">
      <GBrainObservatoryLazy data={data} />
      <GBrainVariantSwitch />
    </div>
  );
}
