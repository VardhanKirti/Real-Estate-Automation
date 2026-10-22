import { PageHeader } from '@/components/PageHeader';
import { knowledgeIndex } from '@/lib/knowledge-index';
import { graphAnalysis } from '@/lib/knowledge-metrics';
import { KnowledgeVisualizer } from '@/components/knowledge/KnowledgeVisualizer';
import { KnowledgeG } from '@/components/knowledge/KnowledgeG';
import { KnowledgeAbout } from '@/components/knowledge/KnowledgeAbout';
import { GPage, GSectionHeader } from '@/components/g';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';

export const dynamic = 'force-dynamic';

/**
 * Knowledge Visualizer — the cross-domain graph over everything the OS knows.
 *
 * Deliberately separate from /brain: Optimal Engine is the retrieval surface and is
 * left exactly as it is. This page is the analytical one. The index and the
 * graph analysis both run on the server (they walk the whole store and run
 * PageRank / Brandes over it); only the results cross to the client, with the
 * metrics Map flattened to pairs because a Map does not survive the boundary.
 *
 * Both are cached against the state of the store on disk, so a page load costs
 * a directory walk rather than a rebuild. That matters more than it looks:
 * Brandes is O(V·E), so the analysis is the one part of this page whose cost
 * grows quadratically with the size of the knowledge base.
 */
export default function KnowledgePage() {
  const index = knowledgeIndex();
  const analysis = graphAnalysis(index);
  const flat = {
    metrics: [...analysis.metrics.entries()],
    components: analysis.components,
    clusterMatrix: analysis.clusterMatrix,
    findings: analysis.findings,
    summary: analysis.summary,
  };

  // Two trees, one index (glados-ui SPEC X5, S05 F05.30 to F05.37).
  if (treeFor(getAppearance(), '/knowledge') === 'glados') {
    return (
      <GPage className="kg-page kg-viz">
        <GSectionHeader
          size="page"
          title="Knowledge visualizer"
          caption="Every record the OS holds, how each one connects, and which parts the rest depends on."
          action={<KnowledgeAbout />}
        />
        <KnowledgeG index={index} analysis={flat} />
      </GPage>
    );
  }

  return (
    <div className="kv-page">
      <PageHeader eyebrow="Knowledge layer" title="Knowledge visualizer" />
      <p className="-mt-3 mb-3 max-w-[96ch] text-[12px] leading-relaxed text-os-muted">
        Every record the OS holds, how each one connects, and which parts of it the rest depends on. Each connection
        carries the evidence that produced it, so a relationship can be checked rather than believed.
      </p>
      <KnowledgeVisualizer
        index={index}
        analysis={{
          metrics: [...analysis.metrics.entries()],
          components: analysis.components,
          clusterMatrix: analysis.clusterMatrix,
          findings: analysis.findings,
          summary: analysis.summary,
        }}
      />
    </div>
  );
}
