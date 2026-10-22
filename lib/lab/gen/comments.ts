/**
 * The comments layer (07 7.13): built, and off until a monthly cap above $0 (and section 08's
 * LAB_COMMENTS flag) turns it on. Three Apify actors read up to 40 comments per post; handles
 * exist only inside `normalizeComment` and are replaced by an HMAC (`authorHash`) before a row
 * is built; @mentions in text read `@someone`. A deterministic intent classifier, recurring
 * questions as idea seeds, and audience overlap with tracked creators are computed from the
 * stored rows. Every paid call goes through `gatedCall` on the `comments` line.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { LabComment, LabCommentIntent, LabIdea, LabPlatform } from '@/lib/schemas';
import { VsCandidateSchema } from '@/lib/schemas';
import type { z } from 'zod';
import type { LabStore } from '@/lib/lab/store';
import { CapError, enforceCap, gatedCall } from '@/lib/lab/spend';
import { isDry } from '@/lib/lab/dry';
import { readEnvLocal, resolveCred, upsertEnvLocal } from '@/lib/creds';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { createApifyClient, type FetchLike } from '@/lib/lab/apify-client';
import { labFetch } from '@/lib/lab/net';
import { claudeJson, type ClaudeJson } from '@/lib/creative-engine/claude';
import { activeModel, cosine, localVec, LOCAL_EMBED_MODEL } from '@/lib/lab/gen/embed';
import { groundingCount, groundingRefusal } from '@/lib/lab/gen/grounding';
import { enrichIdea, ideaContext } from '@/lib/lab/ideas';
import { fmtRatio } from '@/lib/lab/measures';
import { NOT_ENOUGH, x1 } from '@/lib/lab/gen/format';

export const COMMENTS_PER_POST = 40;
export const COMMENTS_POSTS_PER_CYCLE = 20;
export const SEED_DAYS = 30;
export const SEED_MIN_COMMENTS = 3;
export const SEED_MIN_POSTS = 2;
export const SEED_COSINE: Record<string, number> = { 'local-hash-v1': 0.6, 'text-embedding-3-small': 0.8 };
export const INTENT_MIN_COMMENTS = 20;
export const INTENT_MIN_COMPARISON = 5;
export const OVERLAP_MIN = 50;
export const OVERLAP_DAYS = 90;
export const COMMENTS_RUN_MAX_USD = 2;
export const SEED_IDEA_PROMPT_VERSION = 'seed-idea-v1';
export const COMMENTS_OFF_COPY = 'Comments are off. Set a monthly cap in Setup > Spend to turn them on.';

/** hex(HMAC_SHA256(key = salt, msg = platform + ':' + normalised handle)).slice(0, 32). Never the handle. */
export function authorHash(platform: string, handle: string, salt: string): string {
  const h = handle.trim().toLowerCase().replace(/^@/, '');
  return createHmac('sha256', salt).update(`${platform}:${h}`).digest('hex').slice(0, 32);
}

/** LAB_COMMENT_SALT through lib/creds.ts; when absent, 32 random bytes hex written once to .env.local. */
export function commentSalt(): string {
  const have = resolveCred('LAB_COMMENT_SALT', []);
  if (have) return have;
  const salt = randomBytes(32).toString('hex');
  upsertEnvLocal({ LAB_COMMENT_SALT: salt });
  return salt;
}

/* ── actors (7.13.1) ──────────────────────────────────────────────────── */

export type CommentPlatform = Extract<LabPlatform, 'instagram' | 'tiktok' | 'youtube'>;
export const COMMENT_PLATFORMS: readonly CommentPlatform[] = ['instagram', 'tiktok', 'youtube'];

export const COMMENT_ACTORS: Record<CommentPlatform, { actorId: string; buildInput: (urls: string[]) => Record<string, unknown> }> = {
  instagram: { actorId: 'apify/instagram-comment-scraper', buildInput: (urls) => ({ directUrls: urls, resultsLimit: COMMENTS_PER_POST, includeNestedComments: false }) },
  tiktok: { actorId: 'clockworks/tiktok-comments-scraper', buildInput: (urls) => ({ postURLs: urls, commentsPerPost: COMMENTS_PER_POST, maxRepliesPerComment: 0 }) },
  // sortCommentsBy: the enum value for "top" is LC-07-4 (read the actor's input schema before the first run); omitted until then
  youtube: { actorId: 'streamers/youtube-comments-scraper', buildInput: (urls) => ({ startUrls: urls.map((url) => ({ url })), maxComments: COMMENTS_PER_POST }) },
};

/**
 * The gate preview's price per 1,000 comments: the highest figure listed for each actor in
 * 7.13.1 (page headline, published event price, or the stale TikTok FAQ), so the preview never
 * under-reads. 09's price book (estimateRun) replaces it once lane S lands.
 */
export const COMMENT_PREVIEW_PRICE_PER_1000: Record<CommentPlatform, number> = { instagram: 2.6, tiktok: 5.0, youtube: 2.0 };

export function previewCommentsUsd(platform: CommentPlatform, comments: number): number {
  return Math.round(((COMMENT_PREVIEW_PRICE_PER_1000[platform] * comments) / 1000) * 10_000) / 10_000;
}

/* ── normalising (handles never leave this function) ──────────────────── */

const MENTION = /@[A-Za-z0-9._]+/g;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export type NormalizeCtx = { postId: string; salt: string; creatorHandle: string | null; runId: string | null; capturedAt: string; keyword: string | null };

/** One actor item to one row (7.13.3). Returns null when the item has no id or no text. */
export function normalizeComment(platform: CommentPlatform, item: Record<string, unknown>, ctx: NormalizeCtx): LabComment | null {
  let ext = '';
  let text = '';
  let handle = '';
  let likes: number | null = null;
  let replies: number | null = null;
  let postedAt: string | null = null;
  let isReply = false;
  let ownerFlag = false;
  let heart: boolean | null = null;
  if (platform === 'instagram') {
    ext = str(item.id);
    text = str(item.text);
    handle = str(item.ownerUsername);
    likes = num(item.likesCount);
    replies = num(item.repliesCount);
    postedAt = str(item.timestamp) || null;
  } else if (platform === 'tiktok') {
    ext = str(item.cid);
    text = str(item.text);
    handle = str(item.uniqueId);
    likes = num(item.diggCount);
    replies = num(item.replyCommentTotal);
    postedAt = str(item.createTimeISO) || null;
  } else {
    ext = str(item.cid);
    text = str(item.comment);
    handle = str(item.author);
    likes = num(item.voteCount);
    replies = num(item.replyCount);
    isReply = Boolean(item.replyToCid) || item.type === 'reply';
    ownerFlag = item.authorIsChannelOwner === true;
    heart = typeof item.hasCreatorHeart === 'boolean' ? item.hasCreatorHeart : null;
  }
  if (!ext || !text.trim()) return null;
  const authorH = authorHash(platform, handle || `anon:${ext}`, ctx.salt);
  const byCreator = ownerFlag || (ctx.creatorHandle ? authorH === authorHash(platform, ctx.creatorHandle, ctx.salt) : false);
  const clean = text.replace(MENTION, '@someone').trim();
  const { intent, rule } = classifyIntent(clean, { keyword: ctx.keyword });
  return { id: `${platform}:${ext}`, postId: ctx.postId, platform, authorHash: authorH, text: clean, likes, replies, isReply, byCreator, creatorHeart: platform === 'youtube' ? heart : null, postedAt, capturedAt: ctx.capturedAt, intent, intentRule: rule, runId: ctx.runId };
}

/* ── intent (7.13.4) ──────────────────────────────────────────────────── */

const INTENT_RULES: { intent: Exclude<LabCommentIntent, 'bait' | 'question' | 'other'>; rule: string; re: RegExp[] }[] = [
  { intent: 'request', rule: 'what-tool', re: [/\b(what|which) (tool|app|software|ai|plugin|extension|model|mic|camera)\b/i] },
  { intent: 'request', rule: 'link', re: [/\b(link|url|where (can|do) i (get|find|download))\b/i] },
  { intent: 'request', rule: 'how-to', re: [/\bhow (do|did|can) (i|you)\b/i, /\b(tutorial|step by step|walk ?through|set ?up|setup)\b/i] },
  { intent: 'request', rule: 'make-one', re: [/\b(can|could|will) you (make|do|show|cover)\b/i, /\bdo one on\b/i, /\bpart 2\b/i] },
];
const OBJECTION = /\b(doesn'?t work|didn'?t work|not true|wrong|fake|scam|clickbait|misleading)\b/i;
const PRAISE = /\b(thanks?|thank you|amazing|great|love (this|it)|so good|helpful|game ?changer)\b/i;

/** The keyword a caption or CTA asks for ("comment AGENT"), or null. */
export function postKeyword(text: string | null | undefined): string | null {
  const m = (text ?? '').match(/\b[Cc]omment\s+["'“]?([A-Z]{2,})\b/);
  return m ? m[1] : null;
}

/** First match wins, in the 7.13.4 order. */
export function classifyIntent(text: string, ctx: { keyword?: string | null } = {}): { intent: LabCommentIntent; rule: string | null } {
  const t = text.trim();
  const tokens = t.split(/\s+/).filter(Boolean);
  const bare = t.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  if (ctx.keyword && bare.toUpperCase() === ctx.keyword.toUpperCase()) return { intent: 'bait', rule: 'keyword-echo' };
  if (tokens.length >= 1 && tokens.length <= 2 && /\p{L}/u.test(bare) && bare === bare.toUpperCase() && /^[\p{Lu}\p{N}\s]+$/u.test(bare) && bare.replace(/\s/g, '').length >= 2) return { intent: 'bait', rule: 'keyword-echo' };
  for (const r of INTENT_RULES) if (r.re.some((re) => re.test(t))) return { intent: r.intent, rule: r.rule };
  if (/\?\s*$/.test(t)) return { intent: 'question', rule: 'question' };
  if (OBJECTION.test(t)) return { intent: 'objection', rule: 'objection' };
  if (PRAISE.test(t)) return { intent: 'praise', rule: 'praise' };
  return { intent: 'other', rule: null };
}

/* ── intent score per post ────────────────────────────────────────────── */

export type IntentScore = { requestRate: number | null; ratio: number | null; n: number; comparison: number; shown: boolean; text: string };

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * requestRate = request comments / views x 10,000; shown as a ratio to the median of the
 * same creator's same-format posts that have comments, only with 20+ comments on the post and
 * 5+ comparison posts; otherwise `not enough yet`.
 */
export function intentScore(store: LabStore, postId: string): IntentScore {
  const post = store.posts.get(postId);
  const rateOf = (id: string): { rate: number | null; n: number } => {
    const cs = store.comments.forPost(id, 10_000);
    const views = store.metrics.forPost(id).reduce<number | null>((a, m) => (m.views !== null && (a === null || m.views > a) ? m.views : a), null);
    return { rate: cs.length && views ? (cs.filter((c) => c.intent === 'request').length / views) * 10_000 : null, n: cs.length };
  };
  const own = rateOf(postId);
  const fam = store.dissections.get(postId)?.format ?? null;
  const peers = post ? store.posts.bySource(post.sourceId).filter((p) => p.id !== postId && store.dissections.get(p.id)?.format === fam).map((p) => rateOf(p.id)).filter((r) => r.n > 0 && r.rate !== null).map((r) => r.rate as number) : [];
  const med = median(peers);
  const shown = own.n >= INTENT_MIN_COMMENTS && peers.length >= INTENT_MIN_COMPARISON && own.rate !== null && med !== null && med > 0;
  const ratio = shown ? Math.round((own.rate! / med!) * 10) / 10 : null;
  const r1 = own.rate === null ? null : Math.round(own.rate * 10) / 10;
  return {
    requestRate: r1,
    ratio,
    n: own.n,
    comparison: peers.length,
    shown,
    text: shown ? `${r1} requests per 10k views, ${x1(ratio!)} this creator's usual (n ${peers.length}). Untested as a predictor.` : NOT_ENOUGH,
  };
}

/* ── seeds (7.13.5) ───────────────────────────────────────────────────── */

/** 07 7.13.5 seed row (01 25.2: StudioView.seeds carries these). */
export type CommentSeed = { id: string; label: string; comments: number; posts: number; ideaId: string | null };

export const seedIdOf = (commentIds: readonly string[]): string => `seed-${createHash('sha256').update([...commentIds].sort().join('\n')).digest('hex').slice(0, 8)}`;

/** Greedy clustering against running centroids; a seed needs 3+ comments from 2+ posts. Ids are stable across runs. */
export function commentSeeds(store: LabStore, now: Date): CommentSeed[] {
  const since = now.getTime() - SEED_DAYS * 86_400_000;
  const model = activeModel({ store });
  const threshold = SEED_COSINE[model] ?? SEED_COSINE[LOCAL_EMBED_MODEL];
  const rows = store.comments.all().filter((c) => (c.intent === 'request' || c.intent === 'question') && Date.parse(c.postedAt ?? c.capturedAt) >= since).sort((a, b) => a.id.localeCompare(b.id));
  const clusters: { centroid: Float32Array; count: number; members: LabComment[] }[] = [];
  for (const c of rows) {
    const v = store.embeddings.get('comment', c.id, model)?.vec ?? (model === LOCAL_EMBED_MODEL ? localVec(c.text) : null);
    if (!v) continue;
    let best = -1;
    let bestS = -Infinity;
    clusters.forEach((cl, i) => {
      const s = cosine(v, cl.centroid);
      if (s >= threshold && s > bestS) {
        best = i;
        bestS = s;
      }
    });
    if (best < 0) clusters.push({ centroid: Float32Array.from(v), count: 1, members: [c] });
    else {
      const cl = clusters[best];
      const next = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) next[i] = (cl.centroid[i] * cl.count + v[i]) / (cl.count + 1);
      cl.centroid = next;
      cl.count++;
      cl.members.push(c);
    }
  }
  const openBySeed = new Map(store.ideas.all('open').filter((i) => i.seedId).map((i) => [i.seedId!, i.id]));
  return clusters
    .filter((cl) => cl.members.length >= SEED_MIN_COMMENTS && new Set(cl.members.map((m) => m.postId)).size >= SEED_MIN_POSTS)
    .map((cl) => {
      const id = seedIdOf(cl.members.map((m) => m.id));
      const label = [...cl.members].sort((a, b) => a.text.length - b.text.length || a.id.localeCompare(b.id))[0].text.slice(0, 80);
      return { id, label, comments: cl.members.length, posts: new Set(cl.members.map((m) => m.postId)).size, ideaId: openBySeed.get(id) ?? null };
    })
    .sort((a, b) => b.comments - a.comments || a.id.localeCompare(b.id));
}

/* ── audience overlap (7.13.6) ────────────────────────────────────────── */

/** Jaccard of two author sets, null under 50 on either side. */
export function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): { j: number | null; a: number; b: number; shared: number; text: string } {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  const shown = a.size >= OVERLAP_MIN && b.size >= OVERLAP_MIN && union > 0;
  const j = shown ? shared / union : null;
  const fmt = (n: number) => n.toLocaleString('en-US');
  return { j, a: a.size, b: b.size, shared, text: j === null ? NOT_ENOUGH : `Shared commenters ${(Math.round(j * 1000) / 10).toFixed(1)}% (n ${fmt(a.size)} / ${fmt(b.size)})` };
}

/** Per tracked creator: shared commenters with the operator's own posts, last 90 days, creators' own replies excluded. */
export function audienceOverlap(store: LabStore, now: Date): { sourceId: string; j: number | null; a: number; b: number; text: string }[] {
  const since = now.getTime() - OVERLAP_DAYS * 86_400_000;
  const posts = new Map(store.posts.all().map((p) => [p.id, p]));
  const mine = new Set<string>();
  const theirs = new Map<string, Set<string>>();
  for (const c of store.comments.all()) {
    if (c.byCreator || !(Date.parse(c.postedAt ?? c.capturedAt) >= since)) continue;
    const p = posts.get(c.postId);
    if (!p) continue;
    if (p.isOwned) mine.add(c.authorHash);
    else (theirs.get(p.sourceId) ?? theirs.set(p.sourceId, new Set()).get(p.sourceId)!).add(c.authorHash);
  }
  return store.sources.all('tracked').map((s) => {
    const o = overlap(mine, theirs.get(s.id) ?? new Set());
    return { sourceId: s.id, j: o.j, a: o.a, b: o.b, text: o.text };
  });
}

/* ── selection and the run ────────────────────────────────────────────── */

/** The Apify client's fetch, through the dry network guard. */
const labFetchLike: FetchLike = (url, init) => labFetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

/** Owned posts aged 72h to 14d with no comments yet, then tracked breakouts with none, newest first; at most 20. */
export function selectForComments(store: LabStore, now: Date): string[] {
  const has = new Set(store.comments.all().map((c) => c.postId));
  const age = (p: { postedAt: string | null }) => (p.postedAt ? (now.getTime() - Date.parse(p.postedAt)) / 3_600_000 : -1);
  const ok = (p: { platform: string; url: string }) => (COMMENT_PLATFORMS as readonly string[]).includes(p.platform) && Boolean(p.url);
  const all = store.posts.all().filter((p) => !has.has(p.id) && ok(p));
  const newest = (a: { postedAt: string | null }, b: { postedAt: string | null }) => (b.postedAt ?? '').localeCompare(a.postedAt ?? '');
  const owned = all.filter((p) => p.isOwned && age(p) >= 72 && age(p) <= 14 * 24).sort(newest);
  const tracked = all.filter((p) => !p.isOwned && store.measures.get(p.id)?.isBreakout).sort(newest);
  return [...owned, ...tracked].slice(0, COMMENTS_POSTS_PER_CYCLE).map((p) => p.id);
}

/** Fixture items for the dry run: real-shaped actor items with fictional handles (never stored). */
function dryItems(store: LabStore, platform: CommentPlatform, postIds: string[]): { postId: string; item: Record<string, unknown> }[] {
  const pool = ['What tool is that in the second clip?', 'Can you make a full tutorial on this setup?', 'This is so helpful, thank you', 'Does this work on Windows?', 'Not true, this is clickbait', 'AGENT', 'nice one @fan_07_sample', 'Where can I get the template?'];
  const out: { postId: string; item: Record<string, unknown> }[] = [];
  postIds.forEach((postId, pi) => {
    const p = store.posts.get(postId);
    for (let k = 0; k < 6; k++) {
      const handle = `fan_${String(((pi * 5 + k) % 40) + 1).padStart(2, '0')}_sample`;
      const text = pool[(pi + k) % pool.length];
      const ext = `dry-${postId}-${k}`;
      const at = p?.postedAt ? new Date(Date.parse(p.postedAt) + (k + 1) * 3_600_000).toISOString() : null;
      if (platform === 'instagram') out.push({ postId, item: { id: ext, text, ownerUsername: handle, likesCount: k, repliesCount: 0, timestamp: at, ownerProfilePicUrl: 'https://example.invalid/p.jpg' } });
      else if (platform === 'tiktok') out.push({ postId, item: { cid: ext, text, uniqueId: handle, diggCount: k, replyCommentTotal: 0, createTimeISO: at, avatarThumbnail: 'https://example.invalid/a.jpg', videoWebUrl: p?.url } });
      else out.push({ postId, item: { cid: ext, comment: text, author: `@${handle}`, voteCount: k, replyCount: 0, authorIsChannelOwner: false, hasCreatorHeart: k === 0, replyToCid: null, type: 'comment' } });
    }
  });
  return out;
}

/** Write normalised rows for one platform's items (live ingest after the run, or the dry fixture). */
export function ingestCommentItems(store: LabStore, items: { postId: string | null; item: Record<string, unknown> }[], ctx: { platform: CommentPlatform; salt: string; runId: string | null; now: Date }): number {
  const posts = store.posts.all().filter((p) => p.platform === ctx.platform);
  const byUrl = new Map(posts.map((p) => [p.url.replace(/\/$/, ''), p]));
  let n = 0;
  store.transaction(() => {
    for (const { postId, item } of items) {
      const url = str(item.postUrl ?? item.videoWebUrl ?? item.inputUrl ?? item.pageUrl).replace(/\/$/, '');
      const post = postId ? store.posts.get(postId) : (byUrl.get(url) ?? null);
      if (!post) continue;
      const creator = store.sources.get(post.sourceId)?.handle ?? null;
      const row = normalizeComment(ctx.platform, item, { postId: post.id, salt: ctx.salt, creatorHandle: creator, runId: ctx.runId, capturedAt: ctx.now.toISOString(), keyword: postKeyword(post.caption) });
      if (!row) continue;
      store.comments.upsert(row);
      n++;
    }
  });
  return n;
}

export type CommentsRunResult = { runIds: string[]; posts: number; comments: number; pending: boolean };

/**
 * Fetch comments for selected posts (or the given ids): one gated run per platform on line
 * `comments`, maxTotalChargeUsd = min(cap headroom, $2.00). Dry builds fixture items and runs
 * them through the same normaliser. Live runs return pending; `ingestCommentsRun` reads the
 * finished dataset (called by the run advancer).
 */
export async function runComments(store: LabStore, opts: { postIds?: string[]; override?: boolean; scheduled?: boolean; now?: Date; salt?: string; fetch?: FetchLike } = {}): Promise<CommentsRunResult> {
  const now = opts.now ?? new Date();
  // 7.13.2: a cap of 0 (or no LAB_COMMENTS flag) is off before anything is selected or built; dry never refuses
  if (!isDry()) enforceCap(store, { provider: 'comments', line: 'comments', reserve: false }, Boolean(opts.override) && !opts.scheduled, now);
  const ids = (opts.postIds?.length ? opts.postIds : selectForComments(store, now)).filter((id) => store.posts.get(id));
  const byPlatform = new Map<CommentPlatform, string[]>();
  for (const id of ids) {
    const p = store.posts.get(id)!;
    if (!(COMMENT_PLATFORMS as readonly string[]).includes(p.platform)) continue;
    (byPlatform.get(p.platform as CommentPlatform) ?? byPlatform.set(p.platform as CommentPlatform, []).get(p.platform as CommentPlatform)!).push(id);
  }
  const res: CommentsRunResult = { runIds: [], posts: 0, comments: 0, pending: false };
  for (const [platform, postIds] of byPlatform) {
    const actor = COMMENT_ACTORS[platform];
    const urls = postIds.map((id) => store.posts.get(id)!.url);
    const preview = previewCommentsUsd(platform, postIds.length * COMMENTS_PER_POST);
    const out = await gatedCall(store, {
      provider: 'comments', line: 'comments', kind: 'comments', actor: actor.actorId, input: { platform, posts: postIds.length, postIds }, override: opts.override, scheduled: opts.scheduled, now,
      reserve: true, maxRunUsd: COMMENTS_RUN_MAX_USD, estimate: { point: preview, high: preview, minMaxTotalChargeUsd: platform === 'youtube' ? 0.5 : null },
    }, {
      dry: (run) => {
        const n = ingestCommentItems(store, dryItems(store, platform, postIds), { platform, salt: opts.salt ?? 'dry-run-salt', runId: run.id, now });
        return { result: { comments: n, pending: false }, items: n };
      },
      live: async (run, live) => {
        const token = resolveApifyToken();
        if (!token) throw new Error('Apify is not configured.');
        const client = createApifyClient({ token, fetch: opts.fetch ?? labFetchLike });
        const started = await client.startRun(actor.actorId, actor.buildInput(urls), { maxTotalChargeUsd: Math.min(live.maxTotalChargeUsd ?? COMMENTS_RUN_MAX_USD, COMMENTS_RUN_MAX_USD) });
        void run;
        return { result: { comments: 0, pending: true }, units: 0, actualUsd: null, apifyRunId: started.id, datasetId: started.defaultDatasetId ?? null, pending: true };
      },
    });
    res.runIds.push(out.run.id);
    res.posts += postIds.length;
    res.comments += out.result.comments;
    res.pending = res.pending || out.result.pending;
  }
  return res;
}

/** Read a finished comments run's dataset into lab_comments (the run's own items; the settle is the advancer's). */
export async function ingestCommentsRun(store: LabStore, runId: string, opts: { fetch?: FetchLike; now?: Date; salt?: string } = {}): Promise<number> {
  const run = store.runs.get(runId);
  if (!run || run.kind !== 'comments' || !run.datasetId) return 0;
  const platform = (run.input as { platform?: CommentPlatform } | null)?.platform;
  if (!platform || !(COMMENT_PLATFORMS as readonly string[]).includes(platform)) return 0;
  const token = resolveApifyToken();
  if (!token || isDry()) return 0;
  const client = createApifyClient({ token, fetch: opts.fetch ?? labFetchLike });
  const items = (await client.datasetItems(run.datasetId, { limit: 5000 })) as Record<string, unknown>[];
  return ingestCommentItems(store, items.map((item) => ({ postId: null, item })), { platform, salt: opts.salt ?? commentSalt(), runId, now: opts.now ?? new Date() });
}

/** The 402 copy for a comments refusal: the off line reads the 7.13.2 sentence. */
export function commentsCapCopy(err: CapError): string {
  return err.reason === 'off' ? COMMENTS_OFF_COPY : err.message;
}

/* ── from_seed ────────────────────────────────────────────────────────── */

export type SeedAsk = (prompt: string) => Promise<ClaudeJson<z.input<typeof VsCandidateSchema>>>;

/**
 * `{action:'from_seed', seedId}`: one LLM call (seed-idea-v1), same shape as 7.4 without an
 * event, grounded by the 2-breakout rule on the seed's question. Dry: the seed label as the title.
 */
export async function ideaFromSeed(store: LabStore, seedId: string, opts: { now?: Date; ask?: SeedAsk; override?: boolean } = {}): Promise<{ ok: true; idea: LabIdea; existing: boolean } | { ok: false; status: 404 | 422 | 502 | 503; error: string }> {
  const now = opts.now ?? new Date();
  const seed = commentSeeds(store, now).find((s) => s.id === seedId);
  if (!seed) return { ok: false, status: 404, error: 'no such seed' };
  const existing = store.ideas.all('open').find((i) => i.seedId === seedId);
  if (existing) return { ok: true, idea: existing, existing: true };
  const g = groundingCount(store, { angle: 'other', query: seed.label, now });
  if (g.count < 2) return { ok: false, status: 422, error: groundingRefusal(g.count) };
  const ctx = ideaContext(store, { now });
  const allowed = new Set(g.postIds);
  const ask: SeedAsk = opts.ask ?? ((p) => claudeJson(p, VsCandidateSchema, { timeoutMs: 120_000 }));
  const handle = (id: string) => store.sources.get(id)?.handle ?? id;
  const prompt = [
    'You propose ONE short-form video idea that answers a question this creator\'s audience keeps asking, grounded only in the posts below.',
    `AUDIENCE QUESTION: seed=${seed.id} · "${seed.label}" · ${seed.comments} comments · ${seed.posts} posts`,
    `The creator's formats: ${ctx.families.join(', ') || 'unknown'}.`,
    'POSTS THAT BROKE OUT ON THIS:',
    ...g.grounding.exemplars.map((e) => `- post=${e.postId} · @${handle(e.creatorId)} · ${fmtRatio(e.ratio)} · hook: "${e.hookText}"`),
    `Cite ONLY seed ${seed.id} and the post ids listed above. ${ctx.knownClusters.size ? `Use one cluster id from: ${[...ctx.knownClusters].slice(0, 12).join(', ')}.` : ''}`,
    'No dashes of any kind. Plain words.',
    `Reply with STRICT JSON only: {"title":"","clusterId":"","eventId":null,"seedId":"${seed.id}","angle":"","angleClass":"how_to","hookForm":"direct_question","trigger":"curiosity","tension":null,"formatFamily":"","evidence":[{"postId":"","why":""}],"probability":0.5}`,
  ].join('\n');
  type R = { title: string; clusterId: string | null; angle: string; hookForm: LabIdea['hookForm']; trigger: LabIdea['hookTrigger']; family: string | null; tension: LabIdea['tension'] };
  let reply: R;
  try {
    const out = await gatedCall(store, { provider: 'llm', line: 'llm', kind: 'ideas', actor: 'claude-cli', input: { promptVersion: SEED_IDEA_PROMPT_VERSION, seedId }, override: opts.override, now }, {
      dry: () => ({ result: { title: `Your audience asks: ${seed.label}`.slice(0, 90), clusterId: null, angle: 'answer the question', hookForm: 'direct_question', trigger: 'curiosity', family: null, tension: null } as R }),
      live: async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await ask(prompt);
          if (!res.ok) throw new Error(res.unavailable ? 'the claude CLI is not on this host' : `seed idea failed: ${res.error}`);
          const p = VsCandidateSchema.safeParse(res.data);
          if (!p.success) continue;
          const c = p.data;
          if (c.eventId || (c.clusterId && !ctx.knownClusters.has(c.clusterId)) || c.evidence.some((e) => !allowed.has(e.postId))) continue;
          return { result: { title: c.title, clusterId: c.clusterId, angle: c.angle, hookForm: c.hookForm, trigger: c.trigger, family: c.formatFamily, tension: c.tension } as R, units: attempt + 1, actualUsd: 0 };
        }
        throw new Error("The model's idea cited posts that are not in the Lab. Nothing was saved.");
      },
    });
    reply = out.result;
  } catch (e) {
    if (e instanceof CapError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return /not on this host/.test(msg) ? { ok: false, status: 503, error: 'The claude CLI is not on this host. Generate needs it.' } : { ok: false, status: 502, error: msg };
  }
  const evidence = g.postIds.slice(0, 3).map((postId) => ({ postId, why: 'broke out on this question' }));
  for (const e of evidence) {
    if (ctx.postInfo.has(e.postId)) continue;
    const p = store.posts.get(e.postId);
    const d = store.dissections.get(e.postId);
    if (p) ctx.postInfo.set(e.postId, { postId: e.postId, handle: handle(p.sourceId), platform: p.platform, format: d?.format ?? 'other', breakout: store.measures.get(e.postId)?.breakout ?? 0, isBreakout: true, hookForm: d?.hookForm ?? 'other', hookText: d?.hookText ?? '', angle: '', pillar: d?.pillar ?? 'educational' });
  }
  const family = reply.family && ctx.families.includes(reply.family) ? reply.family : (ctx.families[0] ?? 'other');
  const base = enrichIdea(store, { title: reply.title, clusterId: reply.clusterId ?? '', angle: reply.angle, tension: reply.tension, formatFamily: family, evidence }, ctx, { createdAt: now.toISOString() });
  const idea: LabIdea = { ...base, clusterId: reply.clusterId, thin: g.grounding.exemplars.length < 3, source: 'seed', seedId, eventId: null, launchAngle: 'other', batchId: null, notes: null, hookForm: reply.hookForm ?? null, hookTrigger: reply.trigger ?? null, vsProbability: null, mmrRank: null, grounding: g.grounding, promptVersion: isDry() ? 'dry' : SEED_IDEA_PROMPT_VERSION };
  store.ideas.upsert(idea);
  return { ok: true, idea, existing: false };
}

/** Comments layer on: the provider flag and a cap above 0 (08 spend rules). */
export function commentsEnabled(): boolean {
  const env = { ...process.env, ...readEnvLocal() };
  const cap = Number(env.LAB_COMMENTS_CAP_USD ?? '0');
  return env.LAB_COMMENTS?.trim() === '1' && Number.isFinite(cap) && cap > 0;
}
