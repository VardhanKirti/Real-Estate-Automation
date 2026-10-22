'use client';
/**
 * Creatorverse (`/lab/creatorverse`), Classic tree: the lead line and the full-page 3D creator network
 * (components/lab/v2/shared/Creatorverse.tsx) in the Classic chip and button language. Not configured shows
 * the frame's set-up card; no creators shows the honest empty state with Add source.
 */
import type { CreatorversePageView } from '@/lib/lab/view/creatorverse';
import { CreatorverseGraph } from '@/components/lab/v2/shared/Creatorverse';
import { Frame } from './Frame';
import { StateLine } from './parts';

export function CreatorversePage({ view }: { view: CreatorversePageView }) {
  const g = view.graph;
  return (
    <Frame frame={view.frame} sheet={view.sheet}>
      <div className="lab2-verse-wrap">
        {g.state.kind === 'ready' && g.nodes.length ? <CreatorverseGraph view={g} tree="c" /> : <StateLine state={g.state} />}
      </div>
    </Frame>
  );
}
