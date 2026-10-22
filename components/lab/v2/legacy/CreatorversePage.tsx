'use client';
/**
 * Creatorverse (`/lab/creatorverse`) under Bennett Legacy: the full-page 3D creator network
 * (components/lab/v2/shared/Creatorverse.tsx) drawn in Monolith ink on a hairline stage, its controls in
 * the Legacy chip and button language. Not configured shows the frame's set-up card; no creators shows the
 * honest empty state with Add source.
 */
import type { CreatorversePageView } from '@/lib/lab/view/creatorverse';
import { CreatorverseGraph } from '@/components/lab/v2/shared/Creatorverse';
import { LegacyCapHost } from './dialogs';
import { Frame } from './Frame';
import { Card, LState } from './parts';

export function CreatorversePage({ view }: { view: CreatorversePageView }) {
  const g = view.graph;
  return (
    <LegacyCapHost>
      <Frame frame={view.frame} sheet={view.sheet}>
        <div data-l="LabVerse" className="l-lab-verse">
          {g.state.kind === 'ready' && g.nodes.length ? <CreatorverseGraph view={g} tree="l" /> : <Card i={1}><LState state={g.state} /></Card>}
        </div>
      </Frame>
    </LegacyCapHost>
  );
}
