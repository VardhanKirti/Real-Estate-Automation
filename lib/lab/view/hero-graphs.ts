/**
 * The two graphs on Today's gradient cards (`/lab`): the creator network and the breakout chart.
 * Server-built like every other Lab view model. The network's 3D layout is computed here with
 * d3-force (x and y by the simulation, z by a custom force), so the client only projects and rotates
 * stored coordinates: the same data always draws the same shape and nothing jumps on load.
 */
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import type { LabMeasureV2, LabPost } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabPlatformId, SectionState } from '@/lib/lab/view/shared';
import { fill, fmtRatio } from '@/lib/lab/view/format';
import { readOf } from '@/lib/lab/view/posts';
import { READY, state, withSample } from '@/lib/lab/view/section';

const DAY = 86_400_000;
const SOCIAL: ReadonlySet<string> = new Set(['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter']);

export const HERO_GRAPH_COPY = {
  networkLabel: 'Creator network',
  chartLabel: 'Breakouts',
  briefTag: 'Brief',
  windowTag: 'Window',
  noCreators: 'No tracked creators yet.',
  addCreators: 'Add creators',
  noPosts: 'No judged posts from your creators in the last 14 days.',
  schedule: 'Schedule runs',
  networkSummary: '{n} tracked creators, {b} with breakouts in the last 30 days. Linked when they covered the same launch or share a topic; the {e} strongest links are drawn.',
  networkTop: 'Most breakouts: {name} ({k}).',
  chartSummary: '{n} posts from the last 14 days by age and ratio to their creator\'s normal. {w} broke out this week, {o} the week before.',
  chartTop: 'Highest: {name} at {ratio}.',
  nodeTitle: '{name}: {k} in 30 days',
  pointTitle: '{name}: {ratio} at {age}',
} as const;

export type NetworkNodeView = {
  /** lab source id */
  id: string;
  handle: string;
  name: string;
  platform: LabPlatformId;
  /** breakouts from this creator's posts in the last 30 days */
  breakouts: number;
  /** any of them posted in the last 7 days */
  hot: boolean;
  /** dominant topic cluster label, or null */
  topic: string | null;
  /** "/lab/breakouts?creator=<id>&window=30" */
  href: string;
  /** hover / accessible line */
  title: string;
  /** unit-sphere layout, each in [-1, 1] */
  x: number;
  y: number;
  z: number;
};

export type NetworkEdgeView = { a: number; b: number; kind: 'event' | 'topic'; /** 0..1 */ w: number };

export type CreatorNetworkView = {
  state: SectionState;
  label: typeof HERO_GRAPH_COPY.networkLabel;
  nodes: NetworkNodeView[];
  edges: NetworkEdgeView[];
  /** largest node breakout count, for sizing */
  maxBreakouts: number;
  /** text alternative of the whole graph */
  summary: string;
};

export type BreakoutPointView = {
  postId: string;
  /** "?post=<id>" */
  href: string;
  handle: string;
  /** days since posted, 0..windowDays */
  ageD: number;
  ratio: number;
  breakout: boolean;
  /** broke out and was posted in the last 7 days */
  thisWeek: boolean;
  title: string;
};

export type BreakoutChartView = {
  state: SectionState;
  label: typeof HERO_GRAPH_COPY.chartLabel;
  windowDays: 14;
  points: BreakoutPointView[];
  /** log axis bounds for ratio */
  yDomain: [number, number];
  /** breakout bar (ratio 3x, 04 isBreakoutV2) */
  threshold: 3;
  thisWeek: number;
  lastWeek: number;
  summary: string;
};

export type HeroGraphsView = { network: CreatorNetworkView; chart: BreakoutChartView };

export function emptyHeroGraphs(st: SectionState = state('empty')): HeroGraphsView {
  return {
    network: { state: st, label: HERO_GRAPH_COPY.networkLabel, nodes: [], edges: [], maxBreakouts: 0, summary: st.message ?? '' },
    chart: { state: st, label: HERO_GRAPH_COPY.chartLabel, windowDays: 14, points: [], yDomain: [0.1, 10], threshold: 3, thisWeek: 0, lastWeek: 0, summary: st.message ?? '' },
  };
}

/* ── creator network ─────────────────────────────────────────────────── */

type SimNode = SimulationNodeDatum & { i: number; z: number; vz: number };

/** Deterministic 3D force layout: d3-force moves x and y; `forceZ` repels and springs along z the same way. */
export function layout3d(n: number, links: { a: number; b: number; w: number }[]): { x: number; y: number; z: number }[] {
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0, z: 0 }];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const nodes: SimNode[] = Array.from({ length: n }, (_, i) => {
    // Fibonacci sphere start: deterministic and already spread in all three axes.
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    return { i, x: Math.cos(golden * i) * r * 100, y: y * 100, z: Math.sin(golden * i) * r * 100, vz: 0 };
  });
  const L: (SimulationLinkDatum<SimNode> & { w: number })[] = links.map((l) => ({ source: l.a, target: l.b, w: l.w }));
  const forceZ = (alpha: number) => {
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const dz = b.z - a.z;
        const d2 = Math.max(25, dx * dx + dy * dy + dz * dz);
        const f = (-120 * alpha * dz) / d2;
        a.vz += f;
        b.vz -= f;
      }
    }
    for (const l of L) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      const dz = t.z - s.z;
      const k = 0.04 * alpha * (0.2 + l.w);
      s.vz += dz * k;
      t.vz -= dz * k;
    }
    for (const a of nodes) {
      a.vz -= a.z * 0.06 * alpha; // pull to the middle on z as forceX and forceY do on x and y
      a.vz *= 0.6;
      a.z += a.vz;
    }
  };
  const sim = forceSimulation<SimNode>(nodes)
    .force('charge', forceManyBody<SimNode>().strength(-120))
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode> & { w: number }>(L).distance((l) => 46 - 16 * l.w).strength((l) => 0.04 + 0.22 * l.w))
    .force('x', forceX<SimNode>(0).strength(0.06))
    .force('y', forceY<SimNode>(0).strength(0.06))
    .force('center', forceCenter(0, 0))
    .force('z', forceZ)
    .stop();
  sim.tick(260);
  return roundOut(nodes.map((p) => [p.x ?? 0, p.y ?? 0, p.z]));
}

/** Jacobi eigenvectors of a symmetric 3x3 matrix (columns of V) and their eigenvalues. */
function eigen3(A: number[][]): { vals: number[]; V: number[][] } {
  const a = A.map((r) => [...r]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-12) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { vals: [a[0][0], a[1][1], a[2][2]], V };
}

/**
 * Launch coverage tends to string creators into a chain, which reads as a stick from most angles. The
 * layout is turned onto its principal axes and the long axes are eased toward the short one (not fully:
 * some shape is information), then scaled so 95% of nodes sit inside the unit sphere.
 */
function roundOut(P: number[][]): { x: number; y: number; z: number }[] {
  const n = P.length;
  const mean = [0, 1, 2].map((k) => P.reduce((a, p) => a + p[k], 0) / n);
  const C = [0, 1, 2].map((i) => [0, 1, 2].map((j) => P.reduce((a, p) => a + (p[i] - mean[i]) * (p[j] - mean[j]), 0) / n));
  const { vals, V } = eigen3(C);
  const raw = vals.map((v) => Math.sqrt(Math.max(0, v)));
  // A flat or tiny graph (2 to 4 nodes) keeps its shape: never stretch an axis more than 4x.
  const sd = raw.map((v) => Math.max(v, Math.max(...raw) / 4, 1e-6));
  const target = Math.cbrt(sd[0] * sd[1] * sd[2]);
  const scale = sd.map((v) => Math.pow(target / v, 0.7));
  const Q = P.map((p) => [0, 1, 2].map((k) => ((p[0] - mean[0]) * V[0][k] + (p[1] - mean[1]) * V[1][k] + (p[2] - mean[2]) * V[2][k]) * scale[k]));
  const radii = Q.map((q) => Math.hypot(q[0], q[1], q[2])).sort((a, b) => a - b);
  const r = Math.max(1e-6, radii[Math.min(n - 1, Math.floor(n * 0.95))]);
  const round = (v: number) => Math.round(Math.max(-1.2, Math.min(1.2, v / r)) * 1000) / 1000;
  return Q.map((q) => ({ x: round(q[0]), y: round(q[1]), z: round(q[2]) }));
}

const cos = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; dot += v * (b.get(k) ?? 0); }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * The links between creators, shared by the Today card and the Creatorverse: two creators are linked when
 * they covered the same launch (strength by how many) or, failing that, when their primary topic mix is
 * close (cosine >= 0.6, each creator's two nearest). `strong` marks each creator's `k` strongest links,
 * the set the card draws; `extraCoverage` lets a caller add coverage that is not a post (an X watch
 * account whose vendor made the launch). Also returns each creator's dominant topic label.
 */
export function creatorLinks(
  store: LabStore,
  ids: readonly string[],
  opts: { postSource?: Map<string, number>; k?: number; extraCoverage?: { eventId: string; i: number }[] } = {},
): { edges: (NetworkEdgeView & { strong: boolean })[]; topic: (string | null)[] } {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const topK = opts.k ?? 3;
  let postSource = opts.postSource;
  if (!postSource) {
    postSource = new Map<string, number>();
    for (const p of store.posts.all()) {
      const i = idx.get(p.sourceId);
      if (i !== undefined) postSource.set(p.id, i);
    }
  }
  const creators = ids;
  // Topic mix per creator: primary topic cluster counts.
  const clusterLabel = new Map(store.clusters.all().map((c) => [c.id, c.label]));
  const mix = creators.map(() => new Map<string, number>());
  for (const tp of store.topics.all()) {
    if (!tp.isPrimary || !tp.clusterId) continue;
    const i = postSource.get(tp.postId);
    if (i === undefined) continue;
    mix[i].set(tp.clusterId, (mix[i].get(tp.clusterId) ?? 0) + 1);
  }
  const topic = mix.map((m) => {
    let best: string | null = null, bn = 0;
    for (const [k, v] of m) if (v > bn || (v === bn && best !== null && k < best)) { best = k; bn = v; }
    return best ? clusterLabel.get(best) ?? null : null;
  });

  // Shared launches: creators who covered the same event.
  const byEvent = new Map<string, Set<number>>();
  const cover = (eventId: string, i: number) => {
    const s = byEvent.get(eventId) ?? new Set<number>();
    s.add(i);
    byEvent.set(eventId, s);
  };
  for (const c of store.eventCoverage.all()) {
    const i = idx.get(c.sourceId);
    if (i === undefined) continue;
    cover(c.eventId, i);
  }
  for (const x of opts.extraCoverage ?? []) cover(x.eventId, x.i);
  const pair = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (const s of byEvent.values()) {
    const ids = [...s].sort((a, b) => a - b);
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) pair.set(key(ids[x], ids[y]), (pair.get(key(ids[x], ids[y])) ?? 0) + 1);
  }
  const maxShared = Math.max(1, ...pair.values());
  const edges: NetworkEdgeView[] = [...pair.entries()].map(([k, v]) => {
    const [a, b] = k.split(':').map(Number);
    return { a, b, kind: 'event' as const, w: Math.round((0.35 + 0.65 * (v / maxShared)) * 100) / 100 };
  });

  // Shared topics: each creator links to its two closest topic neighbours (cosine >= 0.6) not already linked.
  const linked = new Set(pair.keys());
  for (let i = 0; i < creators.length; i++) {
    if (!mix[i].size) continue;
    const near = creators
      .map((_, j) => ({ j, s: j === i ? -1 : cos(mix[i], mix[j]) }))
      .filter((x) => x.s >= 0.6)
      .sort((a, b) => b.s - a.s || a.j - b.j)
      .slice(0, 2);
    for (const { j, s } of near) {
      const k = key(i, j);
      if (linked.has(k)) continue;
      linked.add(k);
      edges.push({ a: Math.min(i, j), b: Math.max(i, j), kind: 'topic', w: Math.round(Math.min(1, (s - 0.6) / 0.4) * 0.3 * 100) / 100 });
    }
  }
  // Launch coverage makes near-cliques (everyone covers the big launch): each creator's strongest k links
  // are marked, so a reader can draw neighbourhoods instead of a hairball.
  const ranked = [...edges].sort((p, q) => q.w - p.w || p.a - q.a || p.b - q.b);
  const kept = new Set<NetworkEdgeView>();
  const byNode: NetworkEdgeView[][] = creators.map(() => []);
  for (const e of ranked) {
    byNode[e.a].push(e);
    byNode[e.b].push(e);
  }
  for (const list of byNode) for (const e of list.slice(0, topK)) kept.add(e);
  return { edges: edges.sort((p, q) => p.a - q.a || p.b - q.b).map((e) => ({ ...e, strong: kept.has(e) })), topic };
}


export function creatorNetwork(store: LabStore, now: Date, sample: boolean): CreatorNetworkView {
  const C = HERO_GRAPH_COPY;
  const creators = store.sources.all('tracked').filter((s) => s.status === 'active' && SOCIAL.has(s.platform));
  if (!creators.length) {
    const st = state('empty', C.noCreators, { label: C.addCreators, href: withSample('?setup=sources&focus=add', sample) });
    return { state: st, label: C.networkLabel, nodes: [], edges: [], maxBreakouts: 0, summary: C.noCreators };
  }
  const idx = new Map(creators.map((s, i) => [s.id, i]));
  const t = now.getTime();
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const breakouts = creators.map(() => 0);
  const hot = creators.map(() => false);
  const postSource = new Map<string, number>();
  for (const p of store.posts.all()) {
    const i = idx.get(p.sourceId);
    if (i === undefined) continue;
    postSource.set(p.id, i);
    if (!p.postedAt || !measures.get(p.id)?.isBreakout) continue;
    const age = t - Date.parse(p.postedAt);
    if (age < 0 || age > 30 * DAY) continue;
    breakouts[i]++;
    if (age <= 7 * DAY) hot[i] = true;
  }

  const { edges: linked, topic } = creatorLinks(store, creators.map((s) => s.id), { postSource, k: 3 });
  const edges: NetworkEdgeView[] = linked.filter((e) => e.strong).map(({ a, b, kind, w }) => ({ a, b, kind, w }));

  const pos = layout3d(creators.length, edges);
  const nodes: NetworkNodeView[] = creators.map((s, i) => {
    const name = s.handle ? `@${s.handle.replace(/^@/, '')}` : s.displayName;
    return {
      id: s.id,
      handle: name,
      name: s.displayName || name,
      platform: s.platform as LabPlatformId,
      breakouts: breakouts[i],
      hot: hot[i],
      topic: topic[i],
      href: withSample(`/lab/breakouts?creator=${encodeURIComponent(s.id)}`, sample),
      title: fill(C.nodeTitle, { name, k: breakouts[i] === 1 ? '1 breakout' : `${breakouts[i]} breakouts` }),
      ...pos[i],
    };
  });
  const withB = nodes.filter((n) => n.breakouts > 0).length;
  const top = [...nodes].sort((a, b) => b.breakouts - a.breakouts || a.handle.localeCompare(b.handle))[0];
  const summary = fill(C.networkSummary, { n: nodes.length, b: withB, e: edges.length }) + (top && top.breakouts > 0 ? ` ${fill(C.networkTop, { name: top.handle, k: top.breakouts })}` : '');
  return { state: READY, label: C.networkLabel, nodes, edges, maxBreakouts: Math.max(0, ...breakouts), summary };
}

/* ── breakout chart ──────────────────────────────────────────────────── */

const MAX_POINTS = 160;

/** Stable 32-bit hash so thinning a busy chart always keeps the same posts. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function breakoutChart(store: LabStore, now: Date, sample: boolean): BreakoutChartView {
  const C = HERO_GRAPH_COPY;
  const t = now.getTime();
  const sources = new Map(store.sources.all('tracked').filter((s) => s.status === 'active').map((s) => [s.id, s]));
  const pts: BreakoutPointView[] = [];
  for (const p of store.posts.all() as LabPost[]) {
    if (p.isOwned || !p.postedAt || !sources.has(p.sourceId)) continue;
    const ageMs = t - Date.parse(p.postedAt);
    if (ageMs < 0 || ageMs > 14 * DAY) continue;
    const m = (store.measures.get(p.id) ?? null) as LabMeasureV2 | null;
    const read = readOf(m, p, now);
    const ratio = read.state === 'judged' ? read.ratio : m?.breakout ?? null;
    if (ratio === null || !(ratio > 0)) continue;
    const src = sources.get(p.sourceId)!;
    const handle = src.handle ? `@${src.handle.replace(/^@/, '')}` : src.displayName;
    const ageD = Math.round((ageMs / DAY) * 100) / 100;
    const breakout = Boolean(m?.isBreakout);
    pts.push({
      postId: p.id,
      href: withSample(`?post=${encodeURIComponent(p.id)}`, sample),
      handle,
      ageD,
      ratio: Math.round(ratio * 100) / 100,
      breakout,
      thisWeek: breakout && ageD <= 7,
      title: fill(C.pointTitle, { name: handle, ratio: fmtRatio(ratio), age: ageD < 1 ? `${Math.max(1, Math.round(ageD * 24))}h` : `${Math.round(ageD)}d` }),
    });
  }
  if (!pts.length) {
    const st = state('empty', C.noPosts, { label: C.schedule, href: withSample('?setup=schedule', sample) });
    return { ...emptyHeroGraphs(st).chart, summary: C.noPosts };
  }
  const thisWeek = pts.filter((p) => p.thisWeek).length;
  const lastWeek = pts.filter((p) => p.breakout && p.ageD > 7).length;
  // A busy fortnight is thinned to stay readable at card size: every breakout stays, the rest are a stable sample.
  let shown = pts;
  if (pts.length > MAX_POINTS) {
    const keep = pts.filter((p) => p.breakout);
    const rest = pts.filter((p) => !p.breakout).sort((a, b) => hash(a.postId) - hash(b.postId)).slice(0, Math.max(0, MAX_POINTS - keep.length));
    shown = [...keep, ...rest];
  }
  shown.sort((a, b) => Number(a.breakout) - Number(b.breakout) || b.ageD - a.ageD || a.postId.localeCompare(b.postId));
  const hi = Math.max(...shown.map((p) => p.ratio));
  const lo = Math.min(...shown.map((p) => p.ratio));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const yDomain: [number, number] = [r2(Math.max(0.05, Math.min(0.3, lo * 0.8))), r2(Math.min(100, Math.max(10, hi * 1.25)))];
  const top = [...pts].sort((a, b) => b.ratio - a.ratio)[0];
  const summary = fill(C.chartSummary, { n: pts.length, w: thisWeek, o: lastWeek }) + ` ${fill(C.chartTop, { name: top.handle, ratio: fmtRatio(top.ratio) })}`;
  return { state: READY, label: C.chartLabel, windowDays: 14, points: shown, yDomain, threshold: 3, thisWeek, lastWeek, summary };
}

export function heroGraphs(store: LabStore, now: Date, sample: boolean): HeroGraphsView {
  return { network: creatorNetwork(store, now, sample), chart: breakoutChart(store, now, sample) };
}
