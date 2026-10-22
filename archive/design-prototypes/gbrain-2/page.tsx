import { GBrainCore3DLazy } from '@/archive/design-prototypes/components/GBrainCore3DLazy';
import { GBrainVariantSwitch } from '@/archive/design-prototypes/components/GBrainVariantSwitch';
import { loadObservatoryData } from '@/lib/gbrain-observatory';

// G-Brain design variant 2 — the 3D rotating core (docs/DESIGN-GBRAIN.md).
// Variants 1 (flat constellation) and 3 (radial) are at /design/gbrain and
// -3. All render the REAL brain-store: lobes, pages + chunks, live retrieval.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function GBrain3DDemoPage() {
  const data = loadObservatoryData();
  return (
    <div className="relative -mx-8 -mb-16 -mt-7 h-[calc(100vh-52px)] wide:-mx-10 ultra:-mx-12">
      <GBrainCore3DLazy data={data} />
      <GBrainVariantSwitch />
    </div>
  );
}
