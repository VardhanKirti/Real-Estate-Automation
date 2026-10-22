import { notFound } from 'next/navigation';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { PageHeader } from '@/components/PageHeader';
import { LegacyKitSpecimen } from './LegacyKitSpecimen';

/**
 * Dev-only specimen of the Bennett Legacy kit (FounderOS ui merge SPEC §5 P2
 * exit): every primitive and state over specimen data, laid out like the
 * FounderOS v1 Trading slab, for screenshot review and scripts/l-audit.mjs.
 * Not in the nav, not served by a production build.
 */
export const metadata = { title: 'Legacy kit' };
export const dynamic = 'force-dynamic';

export default function LegacyKitPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  if (treeFor(getAppearance(), '/dev/l-kit') === 'legacy') return <LegacyKitSpecimen />;
  return (
    <PageHeader
      title="Legacy kit"
      eyebrow="This specimen renders under the Bennett Legacy style. Switch to it in Settings, Appearance, to see the kit."
    />
  );
}
