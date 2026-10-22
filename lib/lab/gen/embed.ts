/**
 * Embeddings for Ask the Lab, dedupe and grounding (07 7.11). Local hashed vectors are the
 * default (free, deterministic, no network: v1 `clusters.embed`). OpenAI's
 * text-embedding-3-small is optional behind the `embed` spend line (cap 0 = off) and only
 * ever called from the live branch of `gatedCall`. Search and dedupe compare vectors of the
 * same model only.
 */
import { createHash } from 'node:crypto';
import type { LabComment, LabDissection, LabEmbedSubject, LabIdea, LabPost } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { cosine, embed as localEmbed, EMBED_DIM } from '@/lib/lab/clusters';
import { gatedCall, lineEnabled } from '@/lib/lab/spend';
import { isDry } from '@/lib/lab/dry';
import { readEnvLocal } from '@/lib/creds';
import { resolveSttKey } from '@/lib/connectors/apify';
import { labFetch, type FetchFn } from '@/lib/lab/net';

export const LOCAL_EMBED_MODEL = 'local-hash-v1';
export const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
/** $0.02 per 1M input tokens (OpenAI model page, read 2026-10-11). */
export const EMBED_PRICE_PER_MTOK = 0.02;
export const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
export const OPENAI_EMBED_BATCH = 100;
export const BACKFILL_LIMIT = 500;

export interface Embedder {
  model: string;
  dim: number;
  paid: boolean;
  embed(texts: string[]): Promise<{ vecs: (Float32Array | null)[]; tokens: number }>;
}

/** v1 clusters.embed(), model 'local-hash-v1', dim 256, free. */
export const localEmbedder: Embedder = {
  model: LOCAL_EMBED_MODEL,
  dim: EMBED_DIM,
  paid: false,
  async embed(texts) {
    return { vecs: texts.map((t) => localEmbed(t)), tokens: 0 };
  },
};

/** Synchronous local vector (the local embedder is pure). */
export const localVec = (text: string): Float32Array | null => localEmbed(text);

/**
 * OpenAI embeddings: POST {model, input: string[]} in batches of 100; `data[i].embedding`,
 * `usage.total_tokens`. Only constructed inside a gated live branch.
 */
export function openaiEmbedder(key: string, opts: { fetch?: FetchFn } = {}): Embedder {
  const f = opts.fetch ?? labFetch;
  return {
    model: OPENAI_EMBED_MODEL,
    dim: 1536,
    paid: true,
    async embed(texts) {
      const vecs: (Float32Array | null)[] = [];
      let tokens = 0;
      for (let i = 0; i < texts.length; i += OPENAI_EMBED_BATCH) {
        const batch = texts.slice(i, i + OPENAI_EMBED_BATCH);
        const res = await f(OPENAI_EMBED_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: batch }) });
        if (!res.ok) throw new Error(`OpenAI embeddings answered ${res.status}`);
        const body = (await res.json()) as { data?: { index?: number; embedding?: number[] }[]; usage?: { total_tokens?: number } };
        const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        for (let k = 0; k < batch.length; k++) {
          const e = rows[k]?.embedding;
          vecs.push(Array.isArray(e) && e.length ? Float32Array.from(e) : null);
        }
        tokens += Number(body.usage?.total_tokens ?? 0);
      }
      return { vecs, tokens };
    },
  };
}

type Env = Record<string, string | undefined>;
const liveEnv = (): Env => ({ ...process.env, ...readEnvLocal() });

/** Which model is in force: 'openai' only with LAB_EMBED_PROVIDER=openai, a key, the embed line on, and not dry. */
export function activeModel(opts: { env?: Env; store?: LabStore } = {}): string {
  const env = opts.env ?? liveEnv();
  if (env.LAB_EMBED_PROVIDER?.trim() !== 'openai' || isDry()) return LOCAL_EMBED_MODEL;
  if (!resolveSttKey()) return LOCAL_EMBED_MODEL;
  return lineEnabled('embed', { env, store: opts.store }) ? OPENAI_EMBED_MODEL : LOCAL_EMBED_MODEL;
}

/** LAB_EMBED_PROVIDER = 'local' (default) | 'openai'; falls back to local when the key or cap is missing. */
export function activeEmbedder(opts: { env?: Env; store?: LabStore } = {}): Embedder {
  if (activeModel(opts) === OPENAI_EMBED_MODEL) {
    const key = resolveSttKey();
    if (key) return openaiEmbedder(key);
  }
  return localEmbedder;
}

export const textHash = (text: string): string => createHash('sha256').update(text).digest('hex');

/** `${hookText}\n${topic}: ${angle}\n${caption.slice(0, 300)}\n${transcript.slice(0, 600)}` */
export function postText(p: Pick<LabPost, 'caption'>, d: Pick<LabDissection, 'hookText'> | null, topic: { topic: string; angle: string } | null, transcript: string | null): string {
  return `${d?.hookText ?? ''}\n${topic ? `${topic.topic}: ${topic.angle}` : ''}\n${(p.caption ?? '').slice(0, 300)}\n${(transcript ?? '').slice(0, 600)}`;
}

/** 7.3.2: title + ". " + angle + ". " + hookForm + " " + trigger. */
export function ideaText(i: Pick<LabIdea, 'title' | 'angle'> & { hookForm?: string | null; hookTrigger?: string | null }): string {
  return `${i.title}. ${i.angle}. ${i.hookForm ?? ''} ${i.hookTrigger ?? ''}`.trim();
}

export const commentText = (c: Pick<LabComment, 'text'>): string => c.text;

/** Every subject of the requested kinds with the text it is embedded from. */
export function subjects(store: LabStore, kinds: readonly ('post' | 'idea' | 'comment')[]): { kind: LabEmbedSubject; id: string; text: string }[] {
  const out: { kind: LabEmbedSubject; id: string; text: string }[] = [];
  if (kinds.includes('post')) {
    const topics = new Map<string, { topic: string; angle: string }>();
    for (const t of store.topics.all()) if (t.isPrimary) topics.set(t.postId, { topic: t.topic, angle: t.angle });
    const dis = new Map(store.dissections.all().map((d) => [d.postId, d]));
    const tr = new Map(store.transcripts.all().map((t) => [t.postId, t]));
    for (const p of store.posts.all()) {
      const t = tr.get(p.id);
      out.push({ kind: 'post', id: p.id, text: postText(p, dis.get(p.id) ?? null, topics.get(p.id) ?? null, t?.status === 'done' ? t.text : null) });
    }
  }
  if (kinds.includes('idea')) for (const i of store.ideas.all()) out.push({ kind: 'idea', id: i.id, text: ideaText(i) });
  if (kinds.includes('comment')) for (const c of store.comments.all()) out.push({ kind: 'comment', id: c.id, text: commentText(c) });
  return out.filter((s) => s.text.trim());
}

/** Rows of the active model that are missing or stale (text hash changed). */
export function pending(store: LabStore, model: string, kinds: readonly ('post' | 'idea' | 'comment')[] = ['post', 'idea', 'comment']): { kind: LabEmbedSubject; id: string; text: string; hash: string }[] {
  return subjects(store, kinds).flatMap((s) => {
    const hash = textHash(s.text);
    const row = store.embeddings.get(s.kind, s.id, model);
    return row && row.textHash === hash ? [] : [{ ...s, hash }];
  });
}

/** Indexing progress for one model (Ask: "Indexing {done} of {total}"): subjects with a row of that model. */
export function indexProgress(store: LabStore, model: string, kinds: readonly ('post' | 'idea' | 'comment')[] = ['post']): { done: number; total: number } {
  const all = subjects(store, kinds);
  const done = all.filter((s) => store.embeddings.get(s.kind, s.id, model) !== null).length;
  return { done, total: all.length };
}

/** Synchronous local backfill (free, no run row): the fixture worlds and tests use it. */
export function embedLocalNow(store: LabStore, kinds: readonly ('post' | 'idea' | 'comment')[] = ['post', 'idea', 'comment'], at: string = new Date().toISOString()): number {
  const todo = pending(store, LOCAL_EMBED_MODEL, kinds);
  return write(store, todo, todo.map((t) => localVec(t.text)), LOCAL_EMBED_MODEL, at);
}

function write(store: LabStore, rows: { kind: LabEmbedSubject; id: string; hash: string }[], vecs: (Float32Array | null)[], model: string, at: string): number {
  let n = 0;
  store.transaction(() => {
    rows.forEach((r, k) => {
      const v = vecs[k];
      if (!v) return;
      store.embeddings.upsert({ subjectKind: r.kind, subjectId: r.id, model, dim: v.length, textHash: r.hash, vec: v, createdAt: at });
      n++;
    });
  });
  return n;
}

/**
 * Embed what is missing or stale for the active model, at most `limit` (500) per cycle.
 * Local: free, no run row. OpenAI: one gated call per backfill on provider and line `embed`,
 * charged from the response's own token count at the published price.
 */
export async function backfill(store: LabStore, opts: { kinds?: ('post' | 'idea' | 'comment')[]; limit?: number; override?: boolean; scheduled?: boolean; embedder?: Embedder; now?: Date } = {}): Promise<{ embedded: number; skipped: number; model: string }> {
  const embedder = opts.embedder ?? activeEmbedder({ store });
  const kinds = opts.kinds ?? ['post', 'idea', 'comment'];
  const todo = pending(store, embedder.model, kinds);
  const batch = todo.slice(0, opts.limit ?? BACKFILL_LIMIT);
  const skipped = todo.length - batch.length;
  const at = (opts.now ?? new Date()).toISOString();
  if (batch.length === 0) return { embedded: 0, skipped, model: embedder.model };
  if (!embedder.paid) {
    const { vecs } = await embedder.embed(batch.map((b) => b.text));
    return { embedded: write(store, batch, vecs, embedder.model, at), skipped, model: embedder.model };
  }
  const out = await gatedCall(store, { provider: 'embed', line: 'embed', kind: 'embed', actor: `openai:${embedder.model}`, input: { model: embedder.model, subjects: batch.length }, override: opts.override, scheduled: opts.scheduled, now: opts.now }, {
    dry: () => ({ result: 0, items: 0 }),
    live: async () => {
      const { vecs, tokens } = await embedder.embed(batch.map((b) => b.text));
      const n = write(store, batch, vecs, embedder.model, at);
      const usd = Math.round(((tokens * EMBED_PRICE_PER_MTOK) / 1e6) * 1e6) / 1e6;
      return { result: n, units: tokens, actualUsd: usd, estUsd: usd, items: n };
    },
  });
  return { embedded: out.result, skipped, model: embedder.model };
}

/** A stored vector of one subject for the given model, or a fresh local one when the model is local. */
export function vectorOf(store: LabStore, kind: LabEmbedSubject, id: string, model: string, fallbackText?: string): Float32Array | null {
  const row = store.embeddings.get(kind, id, model);
  if (row) return row.vec;
  return model === LOCAL_EMBED_MODEL && fallbackText ? localVec(fallbackText) : null;
}

export { cosine };

/** Mean pairwise cosine of a set of vectors (null under 2). */
export function meanPairwiseCos(vecs: readonly Float32Array[]): number | null {
  if (vecs.length < 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) {
    sum += cosine(vecs[i], vecs[j]);
    n++;
  }
  return sum / n;
}

/**
 * Embed ad hoc texts (Generate candidates, an Ask query) with an embedder: local is free and
 * logs nothing; a paid embedder goes through the `embed` line's gate (cap 0 = off, CapError).
 */
export async function embedTexts(store: LabStore, texts: string[], embedder: Embedder, opts: { override?: boolean; now?: Date; purpose?: string } = {}): Promise<(Float32Array | null)[]> {
  if (texts.length === 0) return [];
  if (!embedder.paid) return (await embedder.embed(texts)).vecs;
  const out = await gatedCall(store, { provider: 'embed', line: 'embed', kind: 'embed', actor: `openai:${embedder.model}`, input: { model: embedder.model, purpose: opts.purpose ?? 'adhoc', texts: texts.length }, override: opts.override, now: opts.now }, {
    dry: () => ({ result: texts.map(() => null as Float32Array | null) }),
    live: async () => {
      const { vecs, tokens } = await embedder.embed(texts);
      const usd = Math.round(((tokens * EMBED_PRICE_PER_MTOK) / 1e6) * 1e6) / 1e6;
      return { result: vecs, units: tokens, actualUsd: usd, estUsd: usd, items: vecs.length };
    },
  });
  return out.result;
}
