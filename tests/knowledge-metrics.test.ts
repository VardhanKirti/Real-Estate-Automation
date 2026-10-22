import { describe, expect, it } from 'vitest';
import { analyzeGraph } from '@/lib/knowledge-metrics';
import type { KIEdge, KIEntity, KnowledgeIndex } from '@/lib/knowledge-index';

const ent = (id: string, over: Partial<KIEntity> = {}): KIEntity => ({
  id,
  kind: 'page',
  label: id,
  cluster: 'A',
  summary: '',
  words: 10,
  days: 5,
  href: null,
  source: id,
  terms: [],
  ...over,
});

const edge = (a: string, b: string, kind: KIEdge['kind'] = 'link'): KIEdge => ({
  a,
  b,
  kind,
  evidence: 'test',
  weight: 1,
});

const index = (entities: KIEntity[], edges: KIEdge[]): KnowledgeIndex => ({
  mounted: true,
  entities,
  edges,
  byKind: {},
  byEdgeKind: {},
  provenance: [],
  builtAt: 0,
});

describe('analyzeGraph — the numbers behind the picture', () => {
  it('finds the articulation point of a barbell', () => {
    // two triangles joined through a single node: only `bridge` can split it
    const entities = ['a1', 'a2', 'a3', 'bridge', 'b1', 'b2', 'b3'].map((id) => ent(id));
    const edges = [
      edge('a1', 'a2'), edge('a2', 'a3'), edge('a3', 'a1'),
      edge('a1', 'bridge'), edge('bridge', 'b1'),
      edge('b1', 'b2'), edge('b2', 'b3'), edge('b3', 'b1'),
    ];
    const a = analyzeGraph(index(entities, edges));
    expect(a.metrics.get('bridge')!.articulation).toBe(true);
    expect(a.metrics.get('a2')!.articulation).toBe(false);
    // and it brokers more paths than anything else
    const top = [...a.metrics.values()].sort((x, y) => y.betweenness - x.betweenness)[0];
    expect(top.id).toBe('bridge');
  });

  it('counts disconnected components', () => {
    const entities = ['x1', 'x2', 'y1', 'y2', 'lonely'].map((id) => ent(id));
    const a = analyzeGraph(index(entities, [edge('x1', 'x2'), edge('y1', 'y2')]));
    expect(a.summary.components).toBe(3);
    expect(a.components[0].size).toBe(2);
  });

  it('ranks a hub above its leaves by authority', () => {
    const entities = ['hub', 'l1', 'l2', 'l3', 'l4'].map((id) => ent(id));
    const edges = ['l1', 'l2', 'l3', 'l4'].map((l) => edge('hub', l));
    const a = analyzeGraph(index(entities, edges));
    const hub = a.metrics.get('hub')!.pagerank;
    expect(hub).toBeGreaterThan(a.metrics.get('l1')!.pagerank);
  });

  it('pagerank is a distribution — it sums to one', () => {
    const entities = ['a', 'b', 'c', 'd'].map((id) => ent(id));
    const a = analyzeGraph(index(entities, [edge('a', 'b'), edge('b', 'c')]));
    const total = [...a.metrics.values()].reduce((s, m) => s + m.pagerank, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('treats inferred similarity as unwritten: a similar-only node is still an orphan', () => {
    const entities = ['written', 'inferred'].map((id) => ent(id));
    const a = analyzeGraph(index(entities, [edge('written', 'inferred', 'similar')]));
    expect(a.metrics.get('inferred')!.degree).toBe(1);
    expect(a.metrics.get('inferred')!.authoredDegree).toBe(0);
    expect(a.findings.find((f) => f.kind === 'orphan')?.targets).toContain('inferred');
  });

  it('flags a stale hub only when it is BOTH depended on and old', () => {
    // one old hub, one fresh hub, four leaves each
    const entities = [
      ent('oldhub', { days: 400 }),
      ent('freshhub', { days: 2 }),
      ...['o1', 'o2', 'o3', 'o4'].map((id) => ent(id, { days: 400 })),
      ...['f1', 'f2', 'f3', 'f4'].map((id) => ent(id, { days: 2 })),
    ];
    const edges = [
      ...['o1', 'o2', 'o3', 'o4'].map((l) => edge('oldhub', l)),
      ...['f1', 'f2', 'f3', 'f4'].map((l) => edge('freshhub', l)),
      edge('oldhub', 'freshhub'),
    ];
    const a = analyzeGraph(index(entities, edges));
    const stale = a.findings.find((f) => f.kind === 'stale-hub');
    expect(stale?.targets).toContain('oldhub');
    expect(stale?.targets ?? []).not.toContain('freshhub');
  });

  it('builds a symmetric cluster matrix with the diagonal held separately', () => {
    const entities = [
      ent('a1', { cluster: 'A' }),
      ent('a2', { cluster: 'A' }),
      ent('b1', { cluster: 'B' }),
    ];
    const a = analyzeGraph(index(entities, [edge('a1', 'a2'), edge('a1', 'b1')]));
    const { clusters, counts, internal } = a.clusterMatrix;
    const ia = clusters.indexOf('A');
    const ib = clusters.indexOf('B');
    expect(counts[ia][ib]).toBe(1);
    expect(counts[ib][ia]).toBe(1); // symmetric
    expect(internal[ia]).toBe(1); // the A↔A edge is not in the matrix body
    expect(counts[ia][ia]).toBe(0);
  });

  it('reports an honest empty analysis for an empty graph', () => {
    const a = analyzeGraph(index([], []));
    expect(a.summary.nodes).toBe(0);
    expect(a.summary.density).toBe(0);
    expect(a.findings).toEqual([]);
  });
});

describe('findings report an honest count', () => {
  it('keeps the true total when the target list is capped for display', () => {
    // 60 orphans, more than the 40 the UI list carries
    const entities = Array.from({ length: 60 }, (_, i) => ent(`o${i}`));
    entities.push(ent('a'), ent('b'));
    const a = analyzeGraph(index(entities, [edge('a', 'b')]));
    const orphan = a.findings.find((f) => f.kind === 'orphan')!;
    expect(orphan.total).toBe(60);
    expect(orphan.targets.length).toBe(40); // capped
    expect(orphan.title).toContain('60');
  });
});

describe('structural metrics ignore inferred similarity', () => {
  it('does not let vocabulary similarity manufacture authority', () => {
    // `popular` is reached only by inferred edges; `real` by written ones
    const entities = ['popular', 'real', ...Array.from({ length: 6 }, (_, i) => `s${i}`)].map((id) => ent(id));
    const edges = [
      ...Array.from({ length: 6 }, (_, i) => edge(`s${i}`, 'popular', 'similar' as const)),
      edge('s0', 'real'),
      edge('s1', 'real'),
    ];
    const a = analyzeGraph(index(entities, edges));
    expect(a.metrics.get('popular')!.degree).toBe(6); // it has the connections
    expect(a.metrics.get('popular')!.authoredDegree).toBe(0); // but nobody wrote them
    expect(a.metrics.get('real')!.pagerank).toBeGreaterThan(a.metrics.get('popular')!.pagerank);
  });

  it('does not let a similarity edge bridge two otherwise separate islands', () => {
    const entities = ['a1', 'a2', 'b1', 'b2'].map((id) => ent(id));
    const a = analyzeGraph(
      index(entities, [edge('a1', 'a2'), edge('b1', 'b2'), edge('a1', 'b1', 'similar' as const)]),
    );
    expect(a.summary.components).toBe(2);
  });
});
