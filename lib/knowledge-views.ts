/**
 * Pure view math for the Knowledge Visualizer.
 *
 * Layout here is not decoration — every position, size and colour is bound to a
 * measured property, so reading the picture and reading the table give the same
 * answer:
 *
 *   angle   which cluster the record belongs to
 *   radius  authority (PageRank) — the records the rest of the graph depends on
 *           sit near the middle, strays sit at the rim
 *   size    degree — how many things touch it
 *   colour  whichever dimension is selected (kind, cluster, recency, authority,
 *           health)
 *
 * The ego layout answers the other question: pick one record and lay out only
 * what actually reaches it, ringed by how many hops away it is.
 */
import type { KIEdge, KIEntity, EdgeKind } from '@/lib/knowledge-index';
import type { NodeMetrics } from '@/lib/knowledge-metrics';

export type Placed = KIEntity & {
  x: number;
  y: number;
  r: number;
  m: NodeMetrics;
};

export type ColorDimension = 'kind' | 'recency' | 'authority' | 'health';

export type LegendEntry = { key: string; label: string; color: string; count: number; hint?: string };

// ─────────────────────────────────────────────────────────────────────────────
// Palettes
//
// The categorical set below was produced by running the dataviz validator
// against this page's surface (#040b0a) and is ALL-PASS on the lightness band,
// chroma floor, CVD separation, normal-vision floor and contrast. Two things
// fell out of that:
//
//   - Seven node kinds could not be separated on a near-black surface at any
//     lightness that keeps them in band, so the three structural kinds
//     (department, workflow, tool) fold into one "System record" category.
//     Nothing is hidden by this — the ranking table still lists the true kind,
//     and it is a better taxonomy anyway: those three are things the platform
//     runs, the other two are things a person wrote.
//   - Recency and authority are ORDERED, so they get single-hue sequential
//     ramps rather than arbitrary hues. Health uses the reserved status
//     colours, which is what they are for.
//
// Cluster is deliberately not a colour mode: position already encodes it (the
// angular wedge, labelled on the rim), and 15 clusters cannot be separated by
// hue at all.
// ─────────────────────────────────────────────────────────────────────────────

/** The five categorical slots, in fixed order. Never cycled, never generated.
 *  Slots 0/1 route through CSS vars (blue/green) so red theme re-keys warm;
 *  purple/tan/pink aren't banned hues and stay literal in Classic and GladOS;
 *  slots 3/4 read --cat-4/--cat-5 only where a style defines them (Bennett
 *  Legacy re-keys the graph to its kg tints, founderos-ui pages/knowledge.md). */
export const CATEGORICAL = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4, #bd8730)', 'var(--cat-5, #c25a7e)'] as const;

/** Node kind → the category it is coloured as. */
export const KIND_CATEGORY: Record<string, string> = {
  page: 'page',
  skill: 'skill',
  agent: 'agent',
  person: 'agent',
  client: 'client',
  workflow: 'system',
  tool: 'system',
  department: 'system',
};

export const CATEGORY_COLOR: Record<string, string> = {
  page: CATEGORICAL[0],
  skill: CATEGORICAL[1],
  agent: CATEGORICAL[2],
  client: CATEGORICAL[3],
  system: CATEGORICAL[4],
};

export const CATEGORY_LABEL: Record<string, string> = {
  page: 'Brain page',
  skill: 'Skill',
  agent: 'Agent',
  client: 'Account',
  system: 'System record',
};

export const CATEGORY_HINT: Record<string, string> = {
  page: 'A markdown page on disk in the brain store.',
  skill: 'A SKILL.md directory in the skill library.',
  agent: 'An agent or person in the roster.',
  client: 'An account in the pipeline.',
  system: 'A workflow, tool or department the platform runs.',
};

export const KIND_LABEL: Record<string, string> = {
  page: 'Brain page',
  skill: 'Skill',
  agent: 'Agent',
  client: 'Account',
  workflow: 'Workflow',
  tool: 'Tool',
  department: 'Department',
  person: 'Person',
};

export const EDGE_COLOR: Record<EdgeKind, string> = {
  link: 'var(--cat-2)',
  owns: 'var(--cat-3)',
  mention: 'var(--cat-1)',
  similar: 'var(--cat-similar, #5c6b66)',
};

export const EDGE_LABEL: Record<EdgeKind, string> = {
  link: 'Wikilink',
  owns: 'Ownership',
  mention: 'Name mention',
  similar: 'Similar vocabulary',
};

export const EDGE_HINT: Record<EdgeKind, string> = {
  link: 'An author wrote a link from one page to the other.',
  owns: 'A structural relation the database asserts.',
  mention: "The target's name appears in the source's text. The evidence is the sentence.",
  similar: 'Inferred, not observed: the two share distinctive vocabulary.',
};

/**
 * Sequential ramp — one hue, monotonic lightness. On a dark surface the
 * brightest step means "most", so recent/high sits at the top.
 */
export const SEQ_MINT = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'] as const;

/** Recency bands, in days since last edit — ordered, so a sequential ramp. */
export const RECENCY_BANDS: { key: string; label: string; color: string; max: number | null }[] = [
  { key: 'week', label: 'Past week', color: SEQ_MINT[0], max: 7 },
  { key: 'month', label: 'Past month', color: SEQ_MINT[1], max: 30 },
  { key: 'quarter', label: 'Past quarter', color: SEQ_MINT[2], max: 90 },
  { key: 'year', label: 'Past year', color: SEQ_MINT[3], max: 365 },
  { key: 'older', label: 'Over a year', color: SEQ_MINT[4], max: null },
  { key: 'none', label: 'No date on disk', color: 'var(--seq-none, #3b4744)', max: -1 },
];

export function recencyBand(days: number | null): string {
  if (days === null) return 'none';
  for (const b of RECENCY_BANDS) {
    if (b.max !== null && b.max >= 0 && days <= b.max) return b.key;
  }
  return 'older';
}

export const AUTHORITY_BANDS: { key: string; label: string; color: string }[] = [
  { key: 'a1', label: 'Top 5% — load-bearing', color: SEQ_MINT[0] },
  { key: 'a2', label: 'Top 25%', color: SEQ_MINT[1] },
  { key: 'a3', label: 'Middle half', color: SEQ_MINT[2] },
  { key: 'a4', label: 'Bottom quarter', color: SEQ_MINT[3] },
];

/** Status colours — reserved, and used here for exactly what they mean. */
export const HEALTH_BANDS: { key: string; label: string; color: string; hint: string }[] = [
  { key: 'orphan', label: 'Orphan', color: 'var(--err)', hint: 'Nothing an author wrote points here.' },
  { key: 'stale-hub', label: 'Stale hub', color: 'var(--warn)', hint: 'High authority, untouched for 90+ days.' },
  { key: 'bridge', label: 'Single bridge', color: 'var(--cat-3)', hint: 'Removing it would split the graph.' },
  { key: 'ok', label: 'Connected and current', color: 'var(--ok)', hint: 'Nothing structural to flag.' },
];



export type HealthLookup = {
  orphans: Set<string>;
  staleHubs: Set<string>;
  bridges: Set<string>;
};

export function healthBand(id: string, h: HealthLookup): string {
  if (h.orphans.has(id)) return 'orphan';
  if (h.staleHubs.has(id)) return 'stale-hub';
  if (h.bridges.has(id)) return 'bridge';
  return 'ok';
}

export function authorityBand(pr: number, sortedPr: number[]): string {
  const n = sortedPr.length;
  if (!n) return 'a4';
  // sortedPr is descending
  const p5 = sortedPr[Math.floor(n * 0.05)] ?? 0;
  const p25 = sortedPr[Math.floor(n * 0.25)] ?? 0;
  const p75 = sortedPr[Math.floor(n * 0.75)] ?? 0;
  if (pr >= p5) return 'a1';
  if (pr >= p25) return 'a2';
  if (pr >= p75) return 'a3';
  return 'a4';
}

/** Which legend key a node falls into for the chosen dimension. */
export function bandKey(
  e: KIEntity,
  m: NodeMetrics,
  dim: ColorDimension,
  ctx: { sortedPr: number[]; health: HealthLookup },
): string {
  switch (dim) {
    case 'kind':
      return KIND_CATEGORY[e.kind] ?? 'system';
    case 'recency':
      return recencyBand(e.days);
    case 'authority':
      return authorityBand(m.pagerank, ctx.sortedPr);
    case 'health':
      return healthBand(e.id, ctx.health);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Radial layout — angle = cluster, radius = authority, size = degree
// ─────────────────────────────────────────────────────────────────────────────

export function radialLayout(
  entities: KIEntity[],
  metrics: Map<string, NodeMetrics>,
  opts: { rInner?: number; rOuter?: number; gap?: number } = {},
): { placed: Placed[]; arcs: { cluster: string; from: number; to: number; mid: number; count: number }[] } {
  const rInner = opts.rInner ?? 78;
  const rOuter = opts.rOuter ?? 470;
  const gap = opts.gap ?? 0.055;

  const groups = new Map<string, KIEntity[]>();
  for (const e of entities) {
    const l = groups.get(e.cluster) ?? [];
    l.push(e);
    groups.set(e.cluster, l);
  }
  const clusters = [...groups.keys()].sort(
    (a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0) || a.localeCompare(b),
  );

  const total = entities.length || 1;
  const prs = entities.map((e) => metrics.get(e.id)?.pagerank ?? 0);
  const maxPr = Math.max(...prs, 1e-9);
  const minPr = Math.min(...prs);
  const maxDeg = Math.max(...entities.map((e) => metrics.get(e.id)?.degree ?? 0), 1);

  const placed: Placed[] = [];
  const arcs: { cluster: string; from: number; to: number; mid: number; count: number }[] = [];

  let cursor = -Math.PI / 2;
  for (const c of clusters) {
    const list = groups.get(c)!;
    // A cluster of two must still get an arc you can read a label off, so the
    // sweep is a blend of its true share and an equal share. Pure proportional
    // turned a third of the rim into unlabelable slivers.
    const share = list.length / total;
    const equal = 1 / clusters.length;
    const span = (share * 0.68 + equal * 0.32) * (Math.PI * 2) - gap;
    const from = cursor;
    const to = cursor + Math.max(span, 0.06);
    arcs.push({ cluster: c, from, to, mid: (from + to) / 2, count: list.length });

    // Inside a cluster, sort by authority so the wedge reads inward-outward.
    const sorted = [...list].sort(
      (a, b) => (metrics.get(b.id)?.pagerank ?? 0) - (metrics.get(a.id)?.pagerank ?? 0),
    );
    sorted.forEach((e, i) => {
      const m = metrics.get(e.id)!;
      // Authority → radius, on a sqrt scale so the crowded low end separates.
      const t = maxPr > minPr ? (m.pagerank - minPr) / (maxPr - minPr) : 0;
      // Most records sit in a narrow authority band, so a pure authority radius
      // laid every cluster out as a single thin arc — a caterpillar, not a
      // cloud. A deterministic offset (no randomness: the demo must render the
      // same every take) thickens the band without breaking the reading that
      // inward means more depended-on.
      const band = ((i * 7) % 9) - 4; // -4..4, cycles without clumping
      const rr = rOuter - Math.sqrt(t) * (rOuter - rInner) + band * 7.5;
      // Spread within the wedge; the offset alternates so neighbours in the
      // sort order do not land on the same spoke.
      const frac = sorted.length === 1 ? 0.5 : i / (sorted.length - 1);
      const jitter = (((i * 5) % 7) - 3) * 0.006;
      const ang = from + frac * (to - from) + jitter;
      placed.push({
        ...e,
        m,
        x: Math.cos(ang) * rr,
        y: Math.sin(ang) * rr * 0.72, // ellipse — the canvas is wide
        r: 2.4 + Math.sqrt(m.degree / maxDeg) * 6.4,
      });
    });
    cursor = to + gap;
  }

  return { placed, arcs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ego layout — one record and everything that actually reaches it
// ─────────────────────────────────────────────────────────────────────────────

export type EgoResult = {
  hops: Map<string, number>;
  placed: Placed[];
  /** edges wholly inside the ego network */
  edges: KIEdge[];
  /** ids worth printing a label for — a crowded ring is labelled selectively */
  labeled: Set<string>;
};

export function egoNetwork(
  focusId: string,
  entities: KIEntity[],
  edges: KIEdge[],
  metrics: Map<string, NodeMetrics>,
  opts: { maxHops?: number; kinds?: Set<EdgeKind>; perHopCap?: number } = {},
): EgoResult {
  const maxHops = opts.maxHops ?? 2;
  const kinds = opts.kinds ?? new Set<EdgeKind>(['link', 'owns', 'mention', 'similar']);
  const perHopCap = opts.perHopCap ?? 90;

  const byId = new Map(entities.map((e) => [e.id, e]));
  const nbr = new Map<string, { id: string; edge: KIEdge }[]>();
  for (const e of edges) {
    if (!kinds.has(e.kind)) continue;
    (nbr.get(e.a) ?? nbr.set(e.a, []).get(e.a)!).push({ id: e.b, edge: e });
    (nbr.get(e.b) ?? nbr.set(e.b, []).get(e.b)!).push({ id: e.a, edge: e });
  }

  const hops = new Map<string, number>([[focusId, 0]]);
  let frontier = [focusId];
  for (let h = 1; h <= maxHops; h++) {
    const next: { id: string; weight: number }[] = [];
    for (const f of frontier) {
      for (const { id, edge } of nbr.get(f) ?? []) {
        if (hops.has(id)) continue;
        next.push({ id, weight: edge.weight });
      }
    }
    // Strongest evidence first when a hop overflows — an ego view that shows
    // everything at 2 hops is the hairball it was meant to replace.
    next.sort((a, b) => b.weight - a.weight);
    const seen = new Set<string>();
    for (const n of next) {
      if (seen.has(n.id) || hops.has(n.id)) continue;
      seen.add(n.id);
      hops.set(n.id, h);
      if (seen.size >= perHopCap) break;
    }
    frontier = [...seen];
    if (!frontier.length) break;
  }

  const byHop = new Map<number, string[]>();
  for (const [id, h] of hops) (byHop.get(h) ?? byHop.set(h, []).get(h)!).push(id);

  // Rings grow with their population. A hub with 75 first-hop neighbours needs
  // a much wider ring than one with six, and a fixed radius crushed the busy
  // case into an unreadable band.
  const n1 = byHop.get(1)?.length ?? 0;
  const n2 = byHop.get(2)?.length ?? 0;
  const r1 = Math.min(300, Math.max(150, 118 + n1 * 2.1));
  const r2 = Math.min(560, Math.max(r1 + 130, r1 + 110 + n2 * 1.5));
  const RING = [0, r1, r2];

  const placed: Placed[] = [];
  const maxDeg = Math.max(...entities.map((e) => metrics.get(e.id)?.degree ?? 0), 1);
  for (const [h, ids] of byHop) {
    // group a ring by cluster so the same colours sit together
    const sorted = [...ids].sort((a, b) => {
      const ea = byId.get(a)!;
      const eb = byId.get(b)!;
      return ea.cluster.localeCompare(eb.cluster) || ea.label.localeCompare(eb.label);
    });
    sorted.forEach((id, i) => {
      const e = byId.get(id);
      const m = metrics.get(id);
      if (!e || !m) return;
      if (h === 0) {
        placed.push({ ...e, m, x: 0, y: 0, r: 13 });
        return;
      }
      const ang = (i / sorted.length) * Math.PI * 2 - Math.PI / 2;
      const wobble = ((i % 3) - 1) * 16;
      const rr = RING[h] + wobble;
      placed.push({
        ...e,
        m,
        x: Math.cos(ang) * rr,
        y: Math.sin(ang) * rr * 0.72,
        r: 3.6 + Math.sqrt(m.degree / maxDeg) * 7,
      });
    });
  }

  const inside = edges.filter((e) => kinds.has(e.kind) && hops.has(e.a) && hops.has(e.b));

  // Label budget: everything when a ring is sparse, otherwise the most
  // connected few. Printing 75 overlapping names is the same as printing none.
  const labeled = new Set<string>([focusId]);
  const LABEL_CAP = 22;
  for (const h of [1, 2]) {
    const ids = byHop.get(h) ?? [];
    if (h === 2) continue; // the outer ring is context, never labelled
    if (ids.length <= LABEL_CAP) {
      for (const id of ids) labeled.add(id);
    } else {
      [...ids]
        .sort((a, b) => (metrics.get(b)?.degree ?? 0) - (metrics.get(a)?.degree ?? 0))
        .slice(0, LABEL_CAP)
        .forEach((id) => labeled.add(id));
    }
  }

  return { hops, placed, edges: inside, labeled };
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineBucket = { key: string; label: string; total: number; byCluster: Record<string, number> };

/** Month buckets of last-modified dates, oldest first. */
export function timelineBuckets(entities: KIEntity[], now = Date.now()): TimelineBucket[] {
  const map = new Map<string, TimelineBucket>();
  for (const e of entities) {
    if (e.days === null) continue;
    const d = new Date(now - e.days * 86_400_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const b =
      map.get(key) ??
      map
        .set(key, {
          key,
          label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
          total: 0,
          byCluster: {},
        })
        .get(key)!;
    b.total++;
    b.byCluster[e.cluster] = (b.byCluster[e.cluster] ?? 0) + 1;
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking rows
// ─────────────────────────────────────────────────────────────────────────────

export type RankRow = {
  id: string;
  label: string;
  kind: string;
  cluster: string;
  degree: number;
  authored: number;
  authority: number;
  brokerage: number;
  days: number | null;
  words: number;
};

export function rankRows(entities: KIEntity[], metrics: Map<string, NodeMetrics>): RankRow[] {
  return entities.map((e) => {
    const m = metrics.get(e.id)!;
    return {
      id: e.id,
      label: e.label,
      kind: e.kind,
      cluster: e.cluster,
      degree: m.degree,
      authored: m.authoredDegree,
      authority: m.pagerank,
      brokerage: m.betweenness,
      days: e.days,
      words: e.words,
    };
  });
}

/** A one-line reading of what a node's numbers mean, for the focus panel. */
export function interpret(e: KIEntity, m: NodeMetrics, ctx: { sortedPr: number[]; medianDegree: number }): string {
  const band = authorityBand(m.pagerank, ctx.sortedPr);
  const parts: string[] = [];
  if (m.authoredDegree === 0)
    parts.push('Nothing an author wrote points here — it is reachable only by search.');
  else if (band === 'a1')
    parts.push(`In the top 5% by authority: ${m.degree} records connect to it, and the rest of the graph leans on it.`);
  else if (band === 'a2') parts.push(`Well connected — ${m.degree} records touch it, above the median of ${ctx.medianDegree}.`);
  else parts.push(`${m.degree} connections, ${m.authoredDegree} of them written rather than inferred.`);

  if (m.articulation)
    parts.push('It is also the only bridge between two parts of the graph: if it goes, they stop reaching each other.');
  else if (m.betweenness > 0 && m.degree > 0 && m.betweenness / Math.max(1, m.degree) > 60)
    parts.push('It brokers far more paths than its connection count suggests — a quiet dependency.');

  if (e.days !== null && e.days > 180 && band !== 'a4')
    parts.push(`Last edited ${e.days} days ago while still being depended on.`);
  return parts.join(' ');
}
