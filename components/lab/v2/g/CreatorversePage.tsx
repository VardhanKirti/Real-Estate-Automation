'use client';
/**
 * Creatorverse (`/lab/creatorverse`), GladOS tree: the lead line and the full-page 3D creator network
 * (components/lab/v2/shared/Creatorverse.tsx) in the GladOS chip language. Not configured shows the frame's
 * set-up card (GPageShell); no creators shows the honest empty state with Add source.
 */
import type { CreatorversePageView } from '@/lib/lab/view/creatorverse';
import { CreatorverseGraph } from '@/components/lab/v2/shared/Creatorverse';
import { GPageShell } from './PageShell';
import { SectionNote } from './bits';

export function CreatorversePage({ view }: { view: CreatorversePageView }) {
  const g = view.graph;
  return (
    <GPageShell frame={view.frame} sheet={view.sheet}>
      <div className="lab2g-stack">
        {g.state.kind === 'ready' && g.nodes.length ? <CreatorverseGraph view={g} tree="g" /> : <SectionNote state={g.state} className="lab2g-onaurora-note" />}
      </div>
    </GPageShell>
  );
}
