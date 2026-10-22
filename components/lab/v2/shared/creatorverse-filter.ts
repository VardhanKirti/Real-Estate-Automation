/**
 * The Creatorverse's client-side filtering and search, kept pure so they are tested on their own
 * (tests/lab-creatorverse.test.ts) and the component only wires them to state.
 */
import type { VerseEdge, VerseKind, VerseNode, VersePlatform } from '@/lib/lab/view/creatorverse';

/** A tracked X creator (`twitter`) and an X watch-list account (`x`) share one platform chip. */
export const platKey = (p: VersePlatform): VersePlatform => (p === 'twitter' ? 'x' : p);

/** Which nodes are shown under the hidden kinds and platforms. */
export function shownMask(nodes: readonly VerseNode[], hiddenKinds: ReadonlySet<VerseKind>, hiddenPlats: ReadonlySet<VersePlatform>): boolean[] {
  return nodes.map((n) => !hiddenKinds.has(n.kind) && !hiddenPlats.has(platKey(n.platform)));
}

/** Toggle one chip; the last shown value of a facet never hides, so the graph is never filtered to nothing. */
export function toggleFacet<T>(hidden: ReadonlySet<T>, v: T, all: readonly T[]): Set<T> {
  const t = new Set(hidden);
  if (t.has(v)) t.delete(v);
  else if (all.filter((x) => !t.has(x)).length > 1) t.add(v);
  return t;
}

/** The edges to draw: both ends shown, and only the strongest unless every link is asked for. */
export function drawnEdges(edges: readonly VerseEdge[], shown: readonly boolean[], showAll: boolean): VerseEdge[] {
  return edges.filter((e) => shown[e.a] && shown[e.b] && (showAll || e.strong));
}

/** Search by handle or name: handles that start with the query first, then by size; at most `limit`. */
export function searchCreators(nodes: readonly VerseNode[], query: string, limit = 6): number[] {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (!q) return [];
  const bare = (n: VerseNode) => n.handle.toLowerCase().replace(/^@/, '');
  return nodes
    .map((n, i) => ({ i, n }))
    .filter(({ n }) => bare(n).includes(q) || n.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!bare(a.n).startsWith(q)) - Number(!bare(b.n).startsWith(q)) || a.n.rank - b.n.rank)
    .slice(0, limit)
    .map((x) => x.i);
}
