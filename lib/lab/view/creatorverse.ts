/**
 * Creatorverse (`/lab/creatorverse`) page model and its builder: every creator the Lab knows (your
 * accounts, tracked creators, the X watch list and discovery's suggestions) as one 3D network, sized and
 * arranged by audience. Server-built like the Today card's network (hero-graphs.ts, whose link rules it
 * shares): the 3D layout is computed here, so the client only projects, rotates and zooms stored
 * coordinates and the same data always draws the same shape.
 *
 * Size comes from the follower or subscriber count of the latest profile read (lab_creator_snapshots,
 * written by the Apify profile read and the author block on post items). A creator with no count is sized
 * by the median views of its posts and marked as such; one with neither gets a small hollow node at the
 * edge. Bigger creators sit nearer the centre: each node is pulled to a shell whose radius grows with its
 * size rank.
 */
import type { LabSource } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import type { LabParams, LabPlatformId, SectionState } from '@/lib/lab/view/shared';
import { creatorLinks } from '@/lib/lab/view/hero-graphs';
import { fill, fmtCount } from '@/lib/lab/view/format';
import { READY, section, state, withSample } from '@/lib/lab/view/section';

const DAY = 86_400_000;
const SOCIAL: ReadonlySet<string> = new Set(['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter', 'x']);
/** Each creator's strongest links, drawn by default (the Show all links toggle draws the rest). */
export const VERSE_K = 3;
/** A full-page graph stays readable and cheap to draw up to here; past it the smallest creators are left out and the summary says so. */
export const VERSE_MAX_NODES = 240;

export const VERSE_COPY = {
  title: 'Creatorverse',
  lead: 'Every creator the Lab follows, in one network. Bigger audiences sit nearer the centre.',
  noCreators: 'No creators yet. Add your accounts or a creator to follow and they appear here.',
  addSource: 'Add source',
  kinds: { owned: 'Your accounts', tracked: 'Tracked', watch: 'Watch list', suggested: 'Suggested' },
  /** one creator's kind, in a sentence */
  kindOne: { owned: 'your account', tracked: 'tracked', watch: 'on the watch list', suggested: 'suggested' },
  /** a count of a kind, in a sentence */
  kindMany: { owned: 'yours', tracked: 'tracked', watch: 'on the watch list', suggested: 'suggested' },
  kindNotes: {
    owned: 'One of your accounts.',
    tracked: 'A creator the Lab tracks: posts are scraped and measured.',
    watch: 'An X account on the Radar watch list: its launches are tracked, its posts are not.',
    suggested: 'Suggested by discovery, not tracked yet.',
  },
  audience: { followers: '{n} followers', subscribers: '{n} subscribers', views: '{n} median views', none: 'No audience size yet' },
  legendSize: 'Size is audience: followers, or subscribers on YouTube, from the latest profile read.',
  legendCentre: 'Bigger audiences pull toward the centre; the smallest sit at the edge.',
  legendFallback: '{n} with no follower count are sized by the median views of their posts and drawn faded.',
  legendNone: '{n} with no size data yet are small hollow rings at the edge.',
  legendEdges: 'Solid lines: covered the same launch. Dotted: share a topic.',
  legendK: 'Showing each creator\'s {k} strongest links.',
  legendAll: 'Showing every link.',
  summary: '{n} creators: {kinds}. {f} sized by followers{rest}. {e} links, {s} of them among each creator\'s {k} strongest.',
  summaryRest: ', {v} by median views, {z} without size data',
  biggest: 'Biggest: {list}.',
  capped: 'The {n} smallest creators are left out to keep the graph readable.',
  nodeTitle: '{name}, {platform}, {kind}. {size}. {b} in 30 days.',
} as const;

export type VerseKind = 'owned' | 'tracked' | 'watch' | 'suggested';
export type VersePlatform = LabPlatformId | 'x';
export type VerseSizeBasis = 'followers' | 'median_views' | 'none';

const KIND_ORDER: VerseKind[] = ['owned', 'tracked', 'watch', 'suggested'];
const PLATFORM_ORDER: VersePlatform[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter', 'x'];
const PLATFORM_NAME: Record<VersePlatform, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X', x: 'X' };
/**
 * Colour slots (Lab categorical tokens, themed per style and accent in app/globals.css). Slots 1, 2 and 4 are
 * the most distinct hues in every Classic palette (Console's 3 and 5 are both mints), and the watch list,
 * which has no audience data, takes the neutral 11.
 */
export const VERSE_KIND_TOKEN: Record<VerseKind, string> = { tracked: '--lab-cat-1', owned: '--lab-cat-2', suggested: '--lab-cat-4', watch: '--lab-cat-11' };
export const VERSE_PLATFORM_TOKEN: Record<VersePlatform, string> = { instagram: '--lab-cat-1', tiktok: '--lab-cat-2', youtube: '--lab-cat-4', x: '--lab-cat-3', twitter: '--lab-cat-3', linkedin: '--lab-cat-6' };

export type VerseNode = {
  /** lab source id */
  id: string;
  /** "@handle" */
  handle: string;
  name: string;
  platform: VersePlatform;
  platformLabel: string;
  kind: VerseKind;
  kindLabel: string;
  paused: boolean;
  /** latest follower or subscriber count, or null */
  followers: number | null;
  /** median latest views of this creator's posts; only computed when followers is null */
  medianViews: number | null;
  sizeBasis: VerseSizeBasis;
  /** "182k followers" | "12k median views" | "No audience size yet" */
  sizeText: string;
  /** 0..1 visual size on a log scale over every sized creator (0 when no size data) */
  s: number;
  /** 0 = biggest; unsized creators rank last */
  rank: number;
  /** breakouts from this creator's posts in the last 30 days */
  breakouts: number;
  /** posts stored for this creator */
  posts: number;
  /** a breakout posted in the last 7 days */
  hot: boolean;
  topic: string | null;
  /** discovery's reason (suggested only) */
  reason: string | null;
  /** links to other creators (all, not only the strongest) */
  degree: number;
  /** "/lab/breakouts?creator=<id>&window=30", null when the Lab stores no posts for it (watch list) */
  breakoutsHref: string | null;
  /** "?setup=sources": the source in Setup */
  setupHref: string;
  /** the creator's own profile URL, when stored */
  url: string | null;
  /** hover and accessible line */
  title: string;
  /** layout, the largest shell at radius 1 */
  x: number;
  y: number;
  z: number;
};

export type VerseEdge = { a: number; b: number; kind: 'event' | 'topic'; /** 0..1 */ w: number; /** among either end's k strongest */ strong: boolean };

export type VerseFacet<T extends string> = { id: T; label: string; n: number; token: string };

export type CreatorverseView = {
  state: SectionState;
  nodes: VerseNode[];
  edges: VerseEdge[];
  kinds: VerseFacet<VerseKind>[];
  platforms: VerseFacet<VersePlatform>[];
  k: number;
  legend: { size: string; centre: string; fallback: string | null; none: string | null; edges: string };
  counts: { creators: number; followers: number; medianViews: number; none: number; edges: number; strong: number; capped: number };
  /** text alternative of the whole graph */
  summary: string;
  /** a source id to select on load (`?creator=`), when it is in the graph */
  selected: string | null;
};

export type CreatorversePageView = {
  frame: LabFrameView;
  sheet: SheetPayload | null;
  graph: CreatorverseView;
};

export function emptyCreatorverse(st: SectionState = state('empty')): CreatorverseView {
  return {
    state: st,
    nodes: [],
    edges: [],
    kinds: [],
    platforms: [],
    k: VERSE_K,
    legend: { size: VERSE_COPY.legendSize, centre: VERSE_COPY.legendCentre, fallback: null, none: null, edges: VERSE_COPY.legendEdges },
    counts: { creators: 0, followers: 0, medianViews: 0, none: 0, edges: 0, strong: 0, capped: 0 },
    summary: st.message ?? '',
    selected: null,
  };
}

/* ── sizing ──────────────────────────────────────────────────────────── */

export type SizeInput = { followers: number | null; medianViews: number | null };
export type SizeOutput = { basis: VerseSizeBasis; value: number | null; s: number; rank: number };

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * Size every creator: followers when known, else median views, else nothing. `s` is a log scale over all
 * sized values (0 smallest, 1 largest); ranks put the biggest first and every unsized creator last, ties
 * broken by input order so the result is stable.
 */
export function sizeCreators(xs: readonly SizeInput[]): SizeOutput[] {
  const base = xs.map((x) => {
    if (x.followers !== null && x.followers > 0) return { basis: 'followers' as const, value: x.followers };
    if (x.medianViews !== null && x.medianViews > 0) return { basis: 'median_views' as const, value: x.medianViews };
    return { basis: 'none' as const, value: null };
  });
  const sized = base.filter((b) => b.value !== null).map((b) => Math.log10(b.value!));
  const lo = sized.length ? Math.min(...sized) : 0;
  const hi = sized.length ? Math.max(...sized) : 0;
  const order = base.map((b, i) => ({ i, v: b.value ?? -1 })).sort((a, b) => b.v - a.v || a.i - b.i);
  const rank = new Array<number>(xs.length);
  order.forEach((o, r) => { rank[o.i] = r; });
  return base.map((b, i) => ({
    basis: b.basis,
    value: b.value,
    s: b.value === null ? 0 : hi > lo ? Math.round(((Math.log10(b.value) - lo) / (hi - lo)) * 1000) / 1000 : 1,
    rank: rank[i],
  }));
}

/* ── layout ──────────────────────────────────────────────────────────── */

/**
 * Deterministic 3D layout organised by size: each node is pulled to a shell whose radius grows with its
 * size rank (the biggest at the centre), linked nodes attract, every pair repels. A plain O(n^2) force
 * loop: about 20 ms for 240 nodes. The outermost shell lands at radius 1.
 */
export function layoutBySize(n: number, links: readonly { a: number; b: number; w: number }[], shell: readonly number[]): { x: number; y: number; z: number }[] {
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0, z: 0 }];
  const R = 100;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
  // Fibonacci sphere directions, dealt out by a fixed stride so neighbouring size ranks start far apart
  // (rank order alone would stack the smallest creators on one pole), each on the node's own shell.
  let stride = Math.max(1, Math.round(n * 0.382));
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  while (gcd(stride, n) !== 1) stride++;
  for (let i = 0; i < n; i++) {
    const k = (i * stride) % n;
    const y = 1 - (2 * (k + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const rad = Math.max(0.08, shell[i]) * R;
    px[i] = Math.cos(golden * k) * r * rad;
    py[i] = y * rad;
    pz[i] = Math.sin(golden * k) * r * rad;
  }
  const ticks = 220;
  const rep = 260 * Math.min(1, 40 / n);
  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / ticks;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
        const d2 = Math.max(16, dx * dx + dy * dy + dz * dz);
        const f = (rep * alpha) / d2;
        vx[i] -= dx * f; vy[i] -= dy * f; vz[i] -= dz * f;
        vx[j] += dx * f; vy[j] += dy * f; vz[j] += dz * f;
      }
    }
    for (const l of links) {
      const dx = px[l.b] - px[l.a], dy = py[l.b] - py[l.a], dz = pz[l.b] - pz[l.a];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const k = (0.02 + 0.06 * l.w) * alpha * (d - 18) / d;
      vx[l.a] += dx * k; vy[l.a] += dy * k; vz[l.a] += dz * k;
      vx[l.b] -= dx * k; vy[l.b] -= dy * k; vz[l.b] -= dz * k;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(px[i] * px[i] + py[i] * py[i] + pz[i] * pz[i]) || 1e-6;
      const k = (0.22 * (shell[i] * R - d)) / d;
      vx[i] += px[i] * k; vy[i] += py[i] * k; vz[i] += pz[i] * k;
      vx[i] *= 0.55; vy[i] *= 0.55; vz[i] *= 0.55;
      px[i] += vx[i]; py[i] += vy[i]; pz[i] += vz[i];
    }
  }
  let max = 1e-6;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.sqrt(px[i] * px[i] + py[i] * py[i] + pz[i] * pz[i]));
  const round = (v: number) => Math.round((v / max) * 1000) / 1000;
  return Array.from({ length: n }, (_, i) => ({ x: round(px[i]), y: round(py[i]), z: round(pz[i]) }));
}

/** The shell a size rank sits on: the biggest near the centre, the unsized at the very edge. */
export function shellFor(rank: number, n: number, sized: boolean): number {
  if (!sized) return 1;
  const t = n <= 1 ? 0 : rank / (n - 1);
  return 0.1 + 0.8 * Math.pow(t, 0.6);
}

/* ── builder ─────────────────────────────────────────────────────────── */

const handleOf = (s: LabSource) => (s.handle ? `@${s.handle.replace(/^@/, '')}` : s.displayName);
const normKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

export function creatorverse(store: LabStore, now: Date, sample: boolean, selectedId: string | null = null): CreatorverseView {
  const C = VERSE_COPY;
  let creators = store.sources.all().filter((s) => (KIND_ORDER as string[]).includes(s.kind) && s.status !== 'dismissed' && SOCIAL.has(s.platform));
  if (!creators.length) {
    return emptyCreatorverse(state('empty', C.noCreators, { label: C.addSource, href: withSample('?setup=sources&focus=add', sample) }));
  }

  // Latest follower count per source (snapshots come oldest first).
  const followers = new Map<string, number>();
  for (const sn of store.creatorSnapshots.all()) if (sn.followers !== null && sn.followers > 0) followers.set(sn.sourceId, sn.followers);

  // Posts, 30-day breakouts and, for creators with no follower count, median views.
  const ids = new Set(creators.map((s) => s.id));
  const t = now.getTime();
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const postsBy = new Map<string, string[]>();
  const breakouts = new Map<string, number>();
  const hot = new Set<string>();
  for (const p of store.posts.all()) {
    if (!ids.has(p.sourceId)) continue;
    const list = postsBy.get(p.sourceId) ?? [];
    list.push(p.id);
    postsBy.set(p.sourceId, list);
    if (!p.postedAt || !measures.get(p.id)?.isBreakout) continue;
    const age = t - Date.parse(p.postedAt);
    if (age < 0 || age > 30 * DAY) continue;
    breakouts.set(p.sourceId, (breakouts.get(p.sourceId) ?? 0) + 1);
    if (age <= 7 * DAY) hot.add(p.sourceId);
  }
  const needViews = creators.filter((s) => !followers.has(s.id) && postsBy.has(s.id));
  const medianViews = new Map<string, number>();
  if (needViews.length) {
    const latest = store.metrics.latest();
    for (const s of needViews) {
      const v = median((postsBy.get(s.id) ?? []).map((id) => latest.get(id)?.views ?? null).filter((x): x is number => x !== null && x > 0));
      if (v !== null) medianViews.set(s.id, v);
    }
  }

  // Order by size first, so the cap drops the smallest and every index below is the size order.
  let sizes = sizeCreators(creators.map((s) => ({ followers: followers.get(s.id) ?? null, medianViews: medianViews.get(s.id) ?? null })));
  const byRank = creators.map((s, i) => ({ s, r: sizes[i].rank })).sort((a, b) => a.r - b.r).map((x) => x.s);
  const capped = Math.max(0, byRank.length - VERSE_MAX_NODES);
  creators = byRank.slice(0, VERSE_MAX_NODES);
  sizes = sizeCreators(creators.map((s) => ({ followers: followers.get(s.id) ?? null, medianViews: medianViews.get(s.id) ?? null })));

  // Links: the Today card's rules over every kind, plus an X watch account joining the launches its vendor made.
  const index = new Map(creators.map((s, i) => [s.id, i]));
  const postSource = new Map<string, number>();
  for (const [sid, list] of postsBy) {
    const i = index.get(sid);
    if (i !== undefined) for (const id of list) postSource.set(id, i);
  }
  const watchKeys = new Map<string, number>();
  creators.forEach((s, i) => {
    if (s.kind !== 'watch') return;
    for (const k of [s.handle, s.displayName]) if (k && normKey(k)) watchKeys.set(normKey(k), i);
  });
  const extraCoverage: { eventId: string; i: number }[] = [];
  if (watchKeys.size) {
    for (const ev of store.events.all()) {
      const i = ev.vendor ? watchKeys.get(normKey(ev.vendor)) : undefined;
      if (i !== undefined) extraCoverage.push({ eventId: ev.id, i });
    }
  }
  const { edges, topic } = creatorLinks(store, creators.map((s) => s.id), { postSource, k: VERSE_K, extraCoverage });
  const degree = creators.map(() => 0);
  for (const e of edges) { degree[e.a]++; degree[e.b]++; }

  const n = creators.length;
  const sizedN = sizes.filter((x) => x.basis !== 'none').length;
  const pos = layoutBySize(n, edges, sizes.map((x) => shellFor(x.rank, sizedN, x.basis !== 'none')));

  const nodes: VerseNode[] = creators.map((s, i) => {
    const platform = (s.platform === 'twitter' ? 'twitter' : s.platform) as VersePlatform;
    const kind = s.kind as VerseKind;
    const sz = sizes[i];
    const sizeText = sz.basis === 'followers'
      ? fill(platform === 'youtube' ? C.audience.subscribers : C.audience.followers, { n: fmtCount(sz.value!) })
      : sz.basis === 'median_views' ? fill(C.audience.views, { n: fmtCount(sz.value!) }) : C.audience.none;
    const b = breakouts.get(s.id) ?? 0;
    const name = handleOf(s);
    const nPosts = postsBy.get(s.id)?.length ?? 0;
    return {
      id: s.id,
      handle: name,
      name: s.displayName || name,
      platform,
      platformLabel: PLATFORM_NAME[platform],
      kind,
      kindLabel: C.kinds[kind],
      paused: s.status === 'paused',
      followers: followers.get(s.id) ?? null,
      medianViews: medianViews.get(s.id) ?? null,
      sizeBasis: sz.basis,
      sizeText,
      s: sz.s,
      rank: sz.rank,
      breakouts: b,
      posts: nPosts,
      hot: hot.has(s.id),
      topic: topic[i],
      reason: kind === 'suggested' ? s.reason : null,
      degree: degree[i],
      breakoutsHref: nPosts ? withSample(`/lab/breakouts?creator=${encodeURIComponent(s.id)}${kind === 'owned' ? '&mine=1' : ''}`, sample) : null,
      setupHref: withSample('?setup=sources', sample),
      url: s.url,
      title: fill(C.nodeTitle, { name, platform: PLATFORM_NAME[platform], kind: C.kindOne[kind], size: sizeText, b: b === 1 ? '1 breakout' : `${b} breakouts` }),
      ...pos[i],
    };
  });

  const facet = <T extends string>(order: readonly T[], key: (x: VerseNode) => T, label: (id: T) => string, token: (id: T) => string): VerseFacet<T>[] =>
    order.map((id) => ({ id, label: label(id), n: nodes.filter((x) => key(x) === id).length, token: token(id) })).filter((f) => f.n > 0);
  const kinds = facet(KIND_ORDER, (x) => x.kind, (id) => C.kinds[id], (id) => VERSE_KIND_TOKEN[id]);
  // X has two platform ids (a tracked twitter creator, a watch-list x account): one chip.
  const platforms = facet(PLATFORM_ORDER.filter((p) => p !== 'twitter'), (x) => (x.platform === 'twitter' ? 'x' : x.platform), (id) => PLATFORM_NAME[id], (id) => VERSE_PLATFORM_TOKEN[id]);

  const nViews = nodes.filter((x) => x.sizeBasis === 'median_views').length;
  const nNone = nodes.filter((x) => x.sizeBasis === 'none').length;
  const nFollow = nodes.length - nViews - nNone;
  const strong = edges.filter((e) => e.strong).length;
  const biggest = nodes.filter((x) => x.sizeBasis === 'followers').slice(0, 3).map((x) => `${x.handle} (${x.sizeText})`);
  const summary = [
    fill(C.summary, {
      n: nodes.length,
      kinds: kinds.map((k) => `${k.n} ${C.kindMany[k.id]}`).join(', '),
      f: nFollow,
      rest: nViews || nNone ? fill(C.summaryRest, { v: nViews, z: nNone }) : '',
      e: edges.length,
      s: strong,
      k: VERSE_K,
    }),
    biggest.length ? fill(C.biggest, { list: biggest.join(', ') }) : '',
    capped ? fill(C.capped, { n: capped }) : '',
  ].filter(Boolean).join(' ');

  return {
    state: READY,
    nodes,
    edges,
    kinds,
    platforms,
    k: VERSE_K,
    legend: {
      size: C.legendSize,
      centre: C.legendCentre,
      fallback: nViews ? fill(C.legendFallback, { n: nViews }) : null,
      none: nNone ? fill(C.legendNone, { n: nNone }) : null,
      edges: C.legendEdges,
    },
    counts: { creators: nodes.length, followers: nFollow, medianViews: nViews, none: nNone, edges: edges.length, strong, capped },
    summary,
    selected: selectedId && index.has(selectedId) ? selectedId : null,
  };
}

export function buildCreatorverse(store: LabStore, params: LabParams, _flags: LabContext['flags'], now: Date, inp: { frame: LabFrameView; sheet: SheetPayload | null }): CreatorversePageView {
  const view: CreatorversePageView = { frame: inp.frame, sheet: inp.sheet, graph: emptyCreatorverse() };
  if (inp.frame.mode.state === 'not_configured') return view;
  view.graph = section('creatorverse', 'graph', () => creatorverse(store, now, inp.frame.mode.sample, params.creator), (s) => emptyCreatorverse(s));
  return view;
}
