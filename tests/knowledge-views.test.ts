import { describe, expect, it } from 'vitest';
import type { KIEdge, KIEntity } from '@/lib/knowledge-index';
import type { NodeMetrics } from '@/lib/knowledge-metrics';
import {
  CATEGORICAL,
  KIND_CATEGORY,
  authorityBand,
  bandKey,
  egoNetwork,
  interpret,
  radialLayout,
  recencyBand,
  timelineBuckets,
} from '@/lib/knowledge-views';

const ent = (id: string, over: Partial<KIEntity> = {}): KIEntity => ({
  id,
  kind: 'page',
  label: id,
  cluster: 'A',
  summary: '',
  words: 0,
  days: 1,
  href: null,
  source: null,
  terms: [],
  ...over,
});

const met = (id: string, over: Partial<NodeMetrics> = {}): NodeMetrics => ({
  id,
  degree: 1,
  authoredDegree: 1,
  pagerank: 0.01,
  betweenness: 0,
  component: 0,
  articulation: false,
  ...over,
});

describe('colour bands', () => {
  it('maps days to a recency band, and null to its own band', () => {
    expect(recencyBand(3)).toBe('week');
    expect(recencyBand(20)).toBe('month');
    expect(recencyBand(80)).toBe('quarter');
    expect(recencyBand(200)).toBe('year');
    expect(recencyBand(900)).toBe('older');
    expect(recencyBand(null)).toBe('none');
  });

  it('folds the three structural kinds into one category', () => {
    // seven kinds cannot be separated by hue on this surface; the fold is
    // deliberate and the ranking table still shows the true kind
    expect(KIND_CATEGORY.workflow).toBe('system');
    expect(KIND_CATEGORY.tool).toBe('system');
    expect(KIND_CATEGORY.department).toBe('system');
    expect(KIND_CATEGORY.page).toBe('page');
    expect(new Set(Object.values(KIND_CATEGORY)).size).toBe(CATEGORICAL.length);
  });

  it('places authority into percentile bands against the whole graph', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => (100 - i) / 100); // descending
    expect(authorityBand(0.99, sorted)).toBe('a1');
    expect(authorityBand(0.8, sorted)).toBe('a2');
    expect(authorityBand(0.5, sorted)).toBe('a3');
    expect(authorityBand(0.05, sorted)).toBe('a4');
  });

  it('routes bandKey through the selected dimension', () => {
    const e = ent('x', { kind: 'tool', days: 400 });
    const ctx = { sortedPr: [0.02, 0.01], health: { orphans: new Set(['x']), staleHubs: new Set<string>(), bridges: new Set<string>() } };
    expect(bandKey(e, met('x'), 'kind', ctx)).toBe('system');
    expect(bandKey(e, met('x'), 'recency', ctx)).toBe('older'); // 400d is over a year
    expect(bandKey(e, met('x'), 'health', ctx)).toBe('orphan');
  });
});

describe('radialLayout — position carries meaning', () => {
  const entities = [
    ent('hi', { cluster: 'A' }),
    ent('lo', { cluster: 'A' }),
    ent('other', { cluster: 'B' }),
  ];
  const metrics = new Map([
    ['hi', met('hi', { pagerank: 0.9, degree: 20 })],
    ['lo', met('lo', { pagerank: 0.01, degree: 1 })],
    ['other', met('other', { pagerank: 0.4, degree: 5 })],
  ]);

  it('puts high authority nearer the centre than low', () => {
    const { placed } = radialLayout(entities, metrics);
    const r = (id: string) => {
      const p = placed.find((x) => x.id === id)!;
      return Math.hypot(p.x, p.y);
    };
    expect(r('hi')).toBeLessThan(r('lo'));
  });

  it('sizes nodes by degree', () => {
    const { placed } = radialLayout(entities, metrics);
    expect(placed.find((p) => p.id === 'hi')!.r).toBeGreaterThan(placed.find((p) => p.id === 'lo')!.r);
  });

  it('gives every cluster its own arc, and places every entity exactly once', () => {
    const { placed, arcs } = radialLayout(entities, metrics);
    expect(placed).toHaveLength(3);
    expect(arcs.map((a) => a.cluster).sort()).toEqual(['A', 'B']);
    expect(arcs.reduce((s, a) => s + a.count, 0)).toBe(3);
  });
});

describe('egoNetwork — one record and what reaches it', () => {
  const entities = ['c', 'n1', 'n2', 'far', 'unreachable'].map((id) => ent(id));
  const metrics = new Map(entities.map((e) => [e.id, met(e.id)]));
  const edges: KIEdge[] = [
    { a: 'c', b: 'n1', kind: 'link', evidence: '', weight: 1 },
    { a: 'c', b: 'n2', kind: 'mention', evidence: '', weight: 1 },
    { a: 'n1', b: 'far', kind: 'link', evidence: '', weight: 1 },
  ];

  it('rings nodes by hop distance and excludes what cannot be reached', () => {
    const ego = egoNetwork('c', entities, edges, metrics, { maxHops: 2 });
    expect(ego.hops.get('c')).toBe(0);
    expect(ego.hops.get('n1')).toBe(1);
    expect(ego.hops.get('far')).toBe(2);
    expect(ego.hops.has('unreachable')).toBe(false);
  });

  it('honours the edge-kind filter — hiding mentions drops what only mentions reached', () => {
    const ego = egoNetwork('c', entities, edges, metrics, { maxHops: 2, kinds: new Set(['link']) });
    expect(ego.hops.has('n2')).toBe(false);
    expect(ego.hops.has('n1')).toBe(true);
  });

  it('puts the focus at the origin', () => {
    const ego = egoNetwork('c', entities, edges, metrics);
    const centre = ego.placed.find((p) => p.id === 'c')!;
    expect(centre.x).toBe(0);
    expect(centre.y).toBe(0);
  });
});

describe('timelineBuckets', () => {
  it('buckets by month and skips records with no date', () => {
    const now = Date.UTC(2026, 5, 15);
    const b = timelineBuckets(
      [ent('a', { days: 0 }), ent('b', { days: 1 }), ent('c', { days: 40 }), ent('d', { days: null })],
      now,
    );
    expect(b.reduce((s, x) => s + x.total, 0)).toBe(3); // d is not plotted
    expect(b.length).toBe(2); // June and May
    expect(b[0].key < b[1].key).toBe(true); // oldest first
  });
});

describe('interpret — the numbers, in words', () => {
  it('calls out a record nothing points to', () => {
    const text = interpret(ent('x'), met('x', { authoredDegree: 0 }), { sortedPr: [0.01], medianDegree: 2 });
    expect(text).toMatch(/only by search/i);
  });

  it('calls out a sole bridge', () => {
    const text = interpret(ent('x'), met('x', { articulation: true, degree: 4 }), { sortedPr: [0.01], medianDegree: 2 });
    expect(text).toMatch(/only bridge/i);
  });

  it('calls out a depended-on record that has gone stale', () => {
    const text = interpret(
      ent('x', { days: 400 }),
      met('x', { pagerank: 0.9, degree: 30 }),
      { sortedPr: [0.9, 0.5, 0.1], medianDegree: 2 },
    );
    expect(text).toMatch(/400 days ago/);
  });
});
