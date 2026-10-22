import { AboutButton } from '@/components/system-g/AboutButton';

/**
 * /knowledge "About this page" (S05 F05.3, F05.30): the explanatory copy the
 * Classic page carries inline, moved word for word off the working surface.
 */
export function KnowledgeAbout() {
  return (
    <AboutButton>
      <p>
        Every record the OS holds, how each one connects, and which parts of it the rest depends on. Each connection
        carries the evidence that produced it, so a relationship can be checked rather than believed.
      </p>
      <h3>Network</h3>
      <p>
        In the whole-graph view connections are summed into the ribbons between clusters. Open one record to see the
        individual connections and the evidence behind each. Similarity is inferred rather than observed, so it stays
        off by default. Click a swatch to hide that group.
      </p>
      <h3>Matrix</h3>
      <p>
        Every edge between two clusters, counted. A bright cell means those two bodies of knowledge reference each
        other; a dark row means a cluster that mostly talks to itself. The diagonal is deliberately left out — a cluster
        is always densest internally, and including it would wash out the comparison that matters.
      </p>
      <h3>Timeline</h3>
      <p>
        Each bar is one month, counting records whose file was last modified then. Records with no date on disk —
        database rows rather than files — are not plotted, because they would be a guess. A long tail on the left with
        nothing above it is knowledge that was written once and never revisited.
      </p>
      <h3>Ranking</h3>
      <p>
        The same numbers the graph is drawn from, sortable. Authority is PageRank — how much of the graph eventually
        flows through a record. Brokerage is betweenness — how often it sits on the shortest path between two others.
        High brokerage with low connections is the signature of a single point of failure. Both are computed on written
        connections only: inferred vocabulary similarity is a way to find things, not evidence that anyone relies on
        them.
      </p>
      <h3>Findings</h3>
      <p>
        Everything below is derived from the graph, not asserted. Each finding names the measurement that produced it,
        so you can disagree with the threshold rather than the conclusion. Open one to see the records it is about.
      </p>
    </AboutButton>
  );
}
