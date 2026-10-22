/**
 * Graph analytics over the knowledge index.
 *
 * These are the actual algorithms, run exactly — at ~470 nodes and ~2k edges
 * there is no reason to approximate anything, so nothing here is a stand-in
 * for a real computation:
 *
 *   PageRank      power iteration, damping 0.85 — "how much of the graph
 *                 eventually flows through this record". Answers *authority*
 *                 better than a raw link count, because a link from a hub is
 *                 worth more than a link from a stray note.
 *   Betweenness   Brandes, unweighted — "how often this record sits on the
 *                 shortest path between two others". Answers *brokerage*:
 *                 high betweenness with low degree is the classic signature of
 *                 a single point of failure in a body of knowledge.
 *   Components    union-find — which records cannot reach each other at all.
 *   Articulation  Tarjan — the records whose removal would split the graph.
 *
 * The findings below are all *derived*. Every one names the records it is about
 * and the number that produced it, so a reader can disagree with it.
 */
import type { KIEdge, KIEntity, EdgeKind, KnowledgeIndex } from '@/lib/knowledge-index';

export type NodeMetrics = {
  id: string;
  degree: number;
  /** degree counting only authored edges (link/owns/mention) — not inferred similarity */
  authoredDegree: number;
  pagerank: number;
  betweenness: number;
  component: number;
  /** true when removing this node would disconnect part of the graph */
  articulation: boolean;
};

export type Finding = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  kind: 'orphan' | 'stale-hub' | 'single-point' | 'silo' | 'undocumented' | 'duplicate';
  title: string;
  /** what was measured, in plain words */
  detail: string;
  /** the records this is about — capped for the UI, so `total` is the truth */
  targets: string[];
  /** how many records the finding actually covers, before the display cap */
  total: number;
};

export type GraphAnalysis = {
  metrics: Map<string, NodeMetrics>;
  components: { id: number; size: number }[];
  /** cluster → cluster edge counts (both directions folded together) */
  clusterMatrix: { clusters: string[]; counts: number[][]; internal: number[] };
  findings: Finding[];
  /** graph-level numbers for the header strip */
  summary: {
    nodes: number;
    edges: number;
    density: number;
    avgDegree: number;
    components: number;
    largestComponentPct: number;
    orphans: number;
    medianDays: number | null;
  };
};

const AUTHORED: EdgeKind[] = ['link', 'owns', 'mention'];

/** Adjacency over a chosen set of edge kinds. */
function adjacency(entities: KIEntity[], edges: KIEdge[], kinds: Set<EdgeKind>) {
  const index = new Map<string, number>();
  entities.forEach((e, i) => index.set(e.id, i));
  const adj: number[][] = entities.map(() => []);
  for (const e of edges) {
    if (!kinds.has(e.kind)) continue;
    const a = index.get(e.a);
    const b = index.get(e.b);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].push(b);
    adj[b].push(a);
  }
  // dedupe — a pair can be joined by more than one edge kind
  return { index, adj: adj.map((l) => [...new Set(l)]) };
}

function pagerank(adj: number[][], damping = 0.85, iters = 60): number[] {
  const n = adj.length;
  if (n === 0) return [];
  let pr = new Array(n).fill(1 / n);
  for (let it = 0; it < iters; it++) {
    const next = new Array(n).fill((1 - damping) / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      const d = adj[i].length;
      if (d === 0) {
        dangling += pr[i];
        continue;
      }
      const share = (damping * pr[i]) / d;
      for (const j of adj[i]) next[j] += share;
    }
    // dangling mass is redistributed evenly rather than lost
    const spread = (damping * dangling) / n;
    for (let i = 0; i < n; i++) next[i] += spread;
    pr = next;
  }
  return pr;
}

/** Brandes betweenness centrality, unweighted, undirected. */
function betweenness(adj: number[][]): number[] {
  const n = adj.length;
  const cb = new Array(n).fill(0);
  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const preds: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Array(n).fill(0);
    const dist = new Array(n).fill(-1);
    sigma[s] = 1;
    dist[s] = 0;
    const queue: number[] = [s];
    let qi = 0;
    while (qi < queue.length) {
      const v = queue[qi++];
      stack.push(v);
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          preds[w].push(v);
        }
      }
    }
    const delta = new Array(n).fill(0);
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of preds[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) cb[w] += delta[w];
    }
  }
  // undirected: each pair counted twice
  return cb.map((v) => v / 2);
}

function components(adj: number[][]): number[] {
  const n = adj.length;
  const comp = new Array(n).fill(-1);
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i] !== -1) continue;
    const stack = [i];
    comp[i] = c;
    while (stack.length) {
      const v = stack.pop()!;
      for (const w of adj[v]) {
        if (comp[w] === -1) {
          comp[w] = c;
          stack.push(w);
        }
      }
    }
    c++;
  }
  return comp;
}

/** Tarjan articulation points, iterative (the graph is shallow but not tiny). */
function articulationPoints(adj: number[][]): boolean[] {
  const n = adj.length;
  const isArt = new Array(n).fill(false);
  const disc = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const parent = new Array(n).fill(-1);
  let timer = 0;

  for (let root = 0; root < n; root++) {
    if (disc[root] !== -1) continue;
    let rootChildren = 0;
    // iterative DFS: [node, index into adj[node]]
    const stack: [number, number][] = [[root, 0]];
    disc[root] = low[root] = timer++;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [v, i] = frame;
      if (i < adj[v].length) {
        frame[1]++;
        const w = adj[v][i];
        if (disc[w] === -1) {
          parent[w] = v;
          disc[w] = low[w] = timer++;
          if (v === root) rootChildren++;
          stack.push([w, 0]);
        } else if (w !== parent[v]) {
          low[v] = Math.min(low[v], disc[w]);
        }
      } else {
        stack.pop();
        const p = parent[v];
        if (p !== -1) {
          low[p] = Math.min(low[p], low[v]);
          if (p !== root && low[v] >= disc[p]) isArt[p] = true;
        }
      }
    }
    if (rootChildren > 1) isArt[root] = true;
  }
  return isArt;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function analyzeGraph(ix: KnowledgeIndex): GraphAnalysis {
  const { entities, edges } = ix;
  const allKinds = new Set<EdgeKind>(['link', 'owns', 'mention', 'similar']);
  const { adj } = adjacency(entities, edges, allKinds);
  const authored = adjacency(entities, edges, new Set(AUTHORED));

  // Every structural claim runs on the AUTHORED graph only. Similarity is
  // inferred from vocabulary overlap; letting it feed PageRank meant a skill
  // with one real inbound reference could rank fourth in the whole system on
  // the strength of edges nobody wrote. Authority, brokerage, reachability and
  // "would removing this split the graph" are claims about what people
  // actually recorded, so they are computed from that and nothing else.
  // `degree` still counts every edge, so the table can show the difference.
  const pr = pagerank(authored.adj);
  const bt = betweenness(authored.adj);
  const comp = components(authored.adj);
  const art = articulationPoints(authored.adj);

  const metrics = new Map<string, NodeMetrics>();
  entities.forEach((e, i) => {
    metrics.set(e.id, {
      id: e.id,
      degree: adj[i].length,
      authoredDegree: authored.adj[i].length,
      pagerank: pr[i] ?? 0,
      betweenness: bt[i] ?? 0,
      component: comp[i] ?? 0,
      articulation: art[i] ?? false,
    });
  });

  // component sizes
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const componentList = [...sizes.entries()]
    .map(([id, size]) => ({ id, size }))
    .sort((a, b) => b.size - a.size);

  // ── cluster matrix ───────────────────────────────────────────────────────
  const clusterOf = new Map(entities.map((e) => [e.id, e.cluster]));
  const clusters = [...new Set(entities.map((e) => e.cluster))].sort();
  const ci = new Map(clusters.map((c, i) => [c, i]));
  const counts = clusters.map(() => clusters.map(() => 0));
  const internal = clusters.map(() => 0);
  for (const e of edges) {
    const a = ci.get(clusterOf.get(e.a) ?? '');
    const b = ci.get(clusterOf.get(e.b) ?? '');
    if (a === undefined || b === undefined) continue;
    if (a === b) internal[a]++;
    else {
      counts[a][b]++;
      counts[b][a]++;
    }
  }

  // ── findings ─────────────────────────────────────────────────────────────
  const byId = new Map(entities.map((e) => [e.id, e]));
  const findings: Finding[] = [];

  // 1. orphans — nothing an author wrote points at these
  const orphans = entities.filter((e) => (metrics.get(e.id)?.authoredDegree ?? 0) === 0);
  if (orphans.length) {
    findings.push({
      id: 'orphans',
      severity: orphans.length > entities.length * 0.06 ? 'high' : 'medium',
      kind: 'orphan',
      title: `${orphans.length} records nothing points to`,
      detail:
        `No link, ownership or name mention reaches these. They are only findable by ` +
        `search, which means in practice they are not found. ` +
        `${orphans.length} of ${entities.length} records (${((orphans.length / entities.length) * 100).toFixed(1)}%).`,
      targets: orphans.slice(0, 40).map((e) => e.id),
      total: orphans.length,
    });
  }

  // 2. stale hubs — heavily depended on, long untouched
  const ranked = entities
    .filter((e) => e.days !== null)
    .map((e) => ({ e, m: metrics.get(e.id)! }))
    .sort((a, b) => b.m.pagerank - a.m.pagerank);
  const topQuartile = ranked.slice(0, Math.max(1, Math.floor(ranked.length * 0.25)));
  const staleHubs = topQuartile.filter((r) => (r.e.days ?? 0) > 90).sort((a, b) => (b.e.days ?? 0) - (a.e.days ?? 0));
  if (staleHubs.length) {
    findings.push({
      id: 'stale-hubs',
      severity: 'high',
      kind: 'stale-hub',
      title: `${staleHubs.length} heavily-referenced records have gone stale`,
      detail:
        `These sit in the top quarter of the graph by authority but have not been edited in over 90 days. ` +
        `The oldest is ${staleHubs[0].e.days} days old and ${staleHubs[0].m.degree} records depend on it. ` +
        `Staleness matters here because of the traffic, not the age.`,
      targets: staleHubs.slice(0, 30).map((r) => r.e.id),
      total: staleHubs.length,
    });
  }

  // 3. single points — high brokerage, low degree, and structurally load-bearing
  const btSorted = [...metrics.values()].sort((a, b) => b.betweenness - a.betweenness);
  const brokers = btSorted.filter((m) => m.articulation && m.betweenness > 0).slice(0, 12);
  if (brokers.length) {
    const top = byId.get(brokers[0].id);
    findings.push({
      id: 'single-points',
      severity: 'medium',
      kind: 'single-point',
      title: `${brokers.length} records are the only bridge between parts of the graph`,
      detail:
        `Removing any one of these splits the knowledge graph into disconnected pieces. ` +
        `${top ? `“${top.label}” is the most load-bearing` : ''} — it sits on ${Math.round(brokers[0].betweenness)} ` +
        `shortest paths between other records. Worth a second owner, or a second link.`,
      targets: brokers.map((m) => m.id),
      total: brokers.length,
    });
  }

  // 4. undocumented — a database record with no page written about it
  const mentioned = new Set<string>();
  for (const e of edges) {
    if (e.kind !== 'mention') continue;
    mentioned.add(e.b);
  }
  const undocumented = entities.filter(
    (e) => (e.kind === 'agent' || e.kind === 'client' || e.kind === 'workflow') && !mentioned.has(e.id),
  );
  if (undocumented.length) {
    findings.push({
      id: 'undocumented',
      severity: 'medium',
      kind: 'undocumented',
      title: `${undocumented.length} live records have nothing written about them`,
      detail:
        `The system runs these, but no page or skill in the library names them. ` +
        `If the person who set them up leaves, nothing explains what they do.`,
      targets: undocumented.map((e) => e.id),
      total: undocumented.length,
    });
  }

  // 5. near-duplicates — say the same thing, and do not know about each other
  const linked = new Set<string>();
  for (const e of edges) {
    if (e.kind === 'similar') continue;
    linked.add(e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);
  }
  const dupes = edges
    .filter((e) => e.kind === 'similar' && e.weight > 0.62)
    .filter((e) => !linked.has(e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20);
  if (dupes.length) {
    findings.push({
      id: 'duplicates',
      severity: 'low',
      kind: 'duplicate',
      title: `${dupes.length} pairs cover the same ground without referencing each other`,
      detail:
        `Vocabulary overlap above 0.62 with no link, ownership or mention between them. ` +
        `Usually this means two people wrote the same page twice, or one should link to the other.`,
      targets: dupes.flatMap((e) => [e.a, e.b]),
      total: dupes.length,
    });
  }

  // 6. silos — clusters that barely talk to the rest
  const siloed: string[] = [];
  clusters.forEach((c, i) => {
    const out = counts[i].reduce((s, v) => s + v, 0);
    const inside = internal[i];
    if (inside >= 8 && out / (inside + out) < 0.12) siloed.push(c);
  });
  if (siloed.length) {
    findings.push({
      id: 'silos',
      severity: 'low',
      kind: 'silo',
      title: `${siloed.length} clusters are effectively closed`,
      detail:
        `Fewer than 12% of their connections leave the cluster: ${siloed.join(', ')}. ` +
        `Knowledge in a closed cluster does not reach the people who would act on it.`,
      targets: [],
      total: siloed.length,
    });
  }

  const n = entities.length;
  const m = edges.length;
  const days = entities.map((e) => e.days).filter((d): d is number => d !== null);

  return {
    metrics,
    components: componentList,
    clusterMatrix: { clusters, counts, internal },
    findings: findings.sort(
      (a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity],
    ),
    summary: {
      nodes: n,
      edges: m,
      density: n > 1 ? (2 * m) / (n * (n - 1)) : 0,
      avgDegree: n ? (2 * m) / n : 0,
      components: componentList.length,
      largestComponentPct: n ? ((componentList[0]?.size ?? 0) / n) * 100 : 0,
      orphans: orphans.length,
      medianDays: median(days),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache
//
// The analysis is by far the most expensive thing on the page — Brandes is
// O(V·E), so it grows quadratically with the store while the index itself
// grows linearly. Keying on the index OBJECT is exact and free: knowledgeIndex()
// returns the identical object for as long as nothing on disk has changed, so a
// new object is precisely the signal that the analysis has to be redone.
// ─────────────────────────────────────────────────────────────────────────────
let analysisCache: { forIndex: KnowledgeIndex; value: GraphAnalysis } | null = null;

export function graphAnalysis(ix: KnowledgeIndex): GraphAnalysis {
  if (analysisCache && analysisCache.forIndex === ix) return analysisCache.value;
  const value = analyzeGraph(ix);
  analysisCache = { forIndex: ix, value };
  return value;
}
