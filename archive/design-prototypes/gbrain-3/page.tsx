import { GBrainRadialLazy } from '@/components/GBrainRadialLazy';
import { GBrainVariantSwitch } from '@/archive/design-prototypes/components/GBrainVariantSwitch';
import { loadObservatoryData } from '@/lib/gbrain-observatory';

// G-Brain design variant 3 — the radial sunburst from UI Example 6
// (docs/DESIGN-GBRAIN.md). Variants 1 (flat constellation) and 2 (3D core)
// live at /design/gbrain and /design/gbrain-2 — switcher on every variant.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function GBrainRadialDemoPage() {
  const data = loadObservatoryData();
  return (
    <div className="relative -mx-8 -mb-16 -mt-7 h-[calc(100vh-52px)] wide:-mx-10 ultra:-mx-12">
      <GBrainRadialLazy data={data} />
      <GBrainVariantSwitch />
    </div>
  );
}
