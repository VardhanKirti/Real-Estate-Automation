import type { LabStore } from '@/lib/lab/store';

/**
 * Topic clusters that persist across runs (SPEC §4.10): every primary topic is embedded
 * and matched to the nearest existing cluster centroid; a topic that matches nothing
 * starts a new cluster. Centroids are running means, stored on lab_clusters, so a topic
 * keeps its history and a cluster id never changes between syncs.
 *
 * Embedding v1 is LOCAL and free: a hashed bag of word unigrams, bigrams and character
 * trigrams (256 dims, L2-normalised). At this scale (hundreds of short topic strings) it
 * separates "agent memory" from "voice cloning" well and it costs nothing, makes no
 * network call and is deterministic, so Filming and tests use the same path as a real
 * install. A provider embedding can replace `embed` later through the spend gate
 * (provider `llm`), keeping the same matching code; `EMBED_MODEL` is stored with nothing
 * else so a model change is visible in code review, not silently mixed.
 */

export const EMBED_DIM = 256;
export const EMBED_MODEL = 'local-hash-v1';
/** Cosine at or above this joins an existing cluster. */
export const MATCH_THRESHOLD = 0.55;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'how', 'why', 'what', 'my', 'your', 'i', 'you', 'is', 'are', 'it', 'this', 'that', 'vs', 'ai']);

function hash(s: string): number {
  // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Deterministic local embedding of a short topic string. All-zero text → null. */
export function embed(text: string): Float32Array | null {
  const v = new Float32Array(EMBED_DIM);
  const ws = tokens(text);
  const add = (feat: string, w: number) => {
    const h = hash(feat);
    v[h % EMBED_DIM] += (h & 0x80000000 ? -1 : 1) * w;
  };
  for (const w of ws) {
    add(`w:${w}`, 1);
    const padded = `^${w}$`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`c:${padded.slice(i, i + 3)}`, 0.35);
  }
  for (let i = 0; i + 1 < ws.length; i++) add(`b:${ws[i]} ${ws[i + 1]}`, 0.8);
  return normalize(v);
}

export function normalize(v: Float32Array): Float32Array | null {
  let n = 0;
  for (const x of v) n += x * x;
  if (!(n > 0)) return null;
  const s = 1 / Math.sqrt(n);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * s;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Running mean of a centroid that already holds `count` members, then renormalised. */
export function updateCentroid(centroid: Float32Array, count: number, add: Float32Array): Float32Array {
  const out = new Float32Array(centroid.length);
  for (let i = 0; i < centroid.length; i++) out[i] = (centroid[i] * count + add[i]) / (count + 1);
  return normalize(out) ?? out;
}

export type Centroid = { id: string; label: string; vec: Float32Array; count: number };

/** The best cluster for a vector, or null when nothing reaches the threshold. */
export function nearest(vec: Float32Array, centroids: readonly Centroid[], threshold = MATCH_THRESHOLD): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const c of centroids) {
    const s = cosine(vec, c.vec);
    if (s >= threshold && (!best || s > best.score)) best = { id: c.id, score: s };
  }
  return best;
}

/** Sentence case for a topic label; known acronyms stay upper case ("Ai video editing" read as a typo). */
const ACRONYMS = new Set(['ai', 'api', 'apis', 'cli', 'cta', 'gpt', 'llm', 'llms', 'mcp', 'rag', 'saas', 'seo', 'sdk', 'ui', 'ux']);
export const titleCase = (s: string) =>
  s.replace(/\s+/g, ' ').trim().replace(/[A-Za-z]+/g, (w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w)).replace(/^./, (c) => c.toUpperCase());
const slug = (s: string) => tokens(s).join('-').slice(0, 40) || 'topic';

export type ClusterResult = { embedded: number; assigned: number; created: string[]; seeded: number };

/**
 * Assign every primary topic to a cluster by centroid matching, persisting topic
 * embeddings, new clusters and moved centroids. Idempotent: a topic that already has an
 * embedding and a cluster is left alone; clusters that exist without a centroid (seeded
 * by hand or by an older run) get one from their current members first.
 */
export function assignClusters(store: LabStore, opts: { now?: Date; threshold?: number } = {}): ClusterResult {
  const now = (opts.now ?? new Date()).toISOString();
  const threshold = opts.threshold ?? MATCH_THRESHOLD;
  const topics = store.topics.all().filter((t) => t.isPrimary && t.topic.trim());
  const res: ClusterResult = { embedded: 0, assigned: 0, created: [], seeded: 0 };
  return store.transaction(() => {
    const vecOf = new Map<string, Float32Array | null>();
    const vec = (postId: string, topic: string): Float32Array | null => {
      const k = `${postId}\u0000${topic}`;
      if (vecOf.has(k)) return vecOf.get(k)!;
      let v = store.topics.embedding(postId, topic);
      if (!v || v.length !== EMBED_DIM) {
        v = embed(topic);
        if (v) {
          store.topics.setEmbedding(postId, topic, v);
          res.embedded++;
        }
      }
      vecOf.set(k, v);
      return v;
    };
    const members = new Map<string, number>();
    for (const t of topics) if (t.clusterId) members.set(t.clusterId, (members.get(t.clusterId) ?? 0) + 1);
    const centroids: Centroid[] = [];
    for (const c of store.clusters.all()) {
      let v = store.clusters.centroid(c.id);
      if (!v || v.length !== EMBED_DIM) {
        // seed from the members it already has (or its label when it has none)
        const mv = topics.filter((t) => t.clusterId === c.id).map((t) => vec(t.postId, t.topic)).filter((x): x is Float32Array => !!x);
        const sum = new Float32Array(EMBED_DIM);
        for (const m of mv) for (let i = 0; i < EMBED_DIM; i++) sum[i] += m[i];
        v = (mv.length ? normalize(sum) : null) ?? embed(c.label);
        if (!v) continue;
        store.clusters.upsert({ ...c, centroid: v });
        res.seeded++;
      }
      centroids.push({ id: c.id, label: c.label, vec: v, count: members.get(c.id) ?? 0 });
    }
    const dirty = new Set<string>();
    for (const t of topics) {
      if (t.clusterId) continue;
      const v = vec(t.postId, t.topic);
      if (!v) continue;
      const hit = nearest(v, centroids, threshold);
      let target: Centroid;
      if (hit) target = centroids.find((c) => c.id === hit.id)!;
      else {
        let id = `lc-${slug(t.topic)}`;
        for (let n = 2; centroids.some((c) => c.id === id); n++) id = `lc-${slug(t.topic)}-${n}`;
        target = { id, label: titleCase(t.topic), vec: v, count: 0 };
        centroids.push(target);
        store.clusters.upsert({ id, label: target.label, createdAt: now, centroid: v });
        res.created.push(id);
      }
      if (target.count > 0) target.vec = updateCentroid(target.vec, target.count, v);
      target.count++;
      dirty.add(target.id);
      store.topics.setCluster(t.postId, t.topic, target.id);
      res.assigned++;
    }
    for (const c of centroids) if (dirty.has(c.id)) store.clusters.upsert({ id: c.id, label: c.label, createdAt: now, centroid: c.vec });
    return res;
  });
}

/** Match free text (a trend-feed headline) to a cluster, or null. Read-only. */
export function matchText(store: LabStore, text: string, threshold = MATCH_THRESHOLD): { id: string; score: number } | null {
  const v = embed(text);
  if (!v) return null;
  const cs: Centroid[] = store.clusters.all().flatMap((c) => {
    const vec = store.clusters.centroid(c.id) ?? embed(c.label);
    return vec ? [{ id: c.id, label: c.label, vec, count: 0 }] : [];
  });
  return nearest(v, cs, threshold);
}
