import type { LabFormat, LabPlatform, LabSource } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { SEARCH_ACTORS, type ApifyClient } from '@/lib/lab/apify-client';
import { normalizeItems } from '@/lib/lab/normalize';
import { gatedCall } from '@/lib/lab/spend';
import { BREAKOUT_THRESHOLD } from '@/lib/lab/measures';
import { FORMAT_LABEL } from '@/lib/lab/distill';
import { drySearchItems } from '@/lib/lab/dry-items';

/**
 * Content-first discovery (SPEC §4.8). No following-graph scraping.
 *
 *   1. terms     your top primary topics (from your dissected posts), else your top hashtags
 *   2. search    keyword search actors on TikTok and YouTube, hashtag search on Instagram,
 *                capped per run, through the spend gate (dry: fixture search items)
 *   3. candidates creators the search returned that the Lab has never seen (any kind, any
 *                status: a dismissed creator is never suggested again) become `suggested`
 *                sources; the next cycle samples each once at 10 posts (lib/lab/sync.ts)
 *   4. score     share of sampled posts in your format families × topic overlap × recent
 *                breakout rate × growth, with the reason in words
 *
 * Similarity: there is NO embedding provider in this install (lib/connectors/llm.ts is a
 * chat gateway; no embeddings key or local model is wired). Topic overlap therefore uses a
 * deterministic bag-of-words cosine over normalised tokens (`similarity`), brute force in
 * JS. It is a lexical stand-in, said so here and in the suggestion reason; swap
 * `similarity` for an embedding cosine when a provider exists (Phase 5 owns embeddings).
 */

export const SIMILARITY_METHOD = 'token-overlap cosine (no embedding provider configured)';

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'what', 'how', 'why', 'are', 'was', 'from', 'into', 'about', 'just', 'have', 'has', 'not', 'but', 'all', 'can', 'will', 'its', 'our', 'out', 'one', 'get', 'got', 'here', 'they', 'them', 'than', 'then', 'when', 'who', 'did', 'does', 'use', 'using', 'used']);

/** Lower-case word tokens, stop words and short words dropped, a plural `s` folded. */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

export function termVector(texts: readonly string[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const t of texts) for (const tok of tokens(t)) v.set(tok, (v.get(tok) ?? 0) + 1);
  return v;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    const y = b.get(k);
    if (y) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** 0-1 topic overlap between two bodies of text (see SIMILARITY_METHOD). */
export function similarity(a: readonly string[], b: readonly string[]): number {
  return Math.round(cosine(termVector(a), termVector(b)) * 1000) / 1000;
}

/* ── 1. terms ──────────────────────────────────────────────────────────── */

/** Your most frequent primary topics (dissected owned posts), else your most used hashtags. */
export function discoveryTerms(store: LabStore, max = 4): string[] {
  const owned = new Set(store.posts.all().filter((p) => p.isOwned).map((p) => p.id));
  const count = new Map<string, number>();
  for (const t of store.topics.all()) if (owned.has(t.postId) && t.isPrimary) count.set(t.topic.toLowerCase(), (count.get(t.topic.toLowerCase()) ?? 0) + 1);
  if (count.size === 0) {
    for (const p of store.posts.all()) if (p.isOwned) for (const h of p.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []) count.set(h.slice(1).toLowerCase(), (count.get(h.slice(1).toLowerCase()) ?? 0) + 1);
    for (const generic of ['ai', 'fyp', 'foryou', 'viral', 'shorts', 'reels']) count.delete(generic);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([t]) => t);
}

/** Your format families: the formats of your dissected posts holding at least 10% of them. */
export function formatFamilies(store: LabStore): LabFormat[] {
  const owned = new Set(store.posts.all().filter((p) => p.isOwned).map((p) => p.id));
  const ds = store.dissections.all().filter((d) => owned.has(d.postId));
  const count = new Map<LabFormat, number>();
  for (const d of ds) count.set(d.format, (count.get(d.format) ?? 0) + 1);
  return [...count].filter(([, n]) => n / ds.length >= 0.1).sort((a, b) => b[1] - a[1]).map(([f]) => f);
}

/* ── 2. search ─────────────────────────────────────────────────────────── */

export const SEARCH_PER_TERM = 20;

export type SearchGroup = { platform: LabPlatform; actorId: string; terms: string[]; limit: number; actorInput: Record<string, unknown> };

/** One search run per platform that has a search actor and at least one of your accounts (all three when you have none there yet). */
export function planSearch(store: LabStore, terms: readonly string[], limit = SEARCH_PER_TERM): SearchGroup[] {
  if (terms.length === 0) return [];
  const mine = new Set(store.sources.all('owned').filter((s) => s.status === 'active').map((s) => s.platform));
  const platforms = (Object.keys(SEARCH_ACTORS) as LabPlatform[]).filter((p) => mine.size === 0 || mine.has(p));
  return platforms.map((platform) => {
    const actor = SEARCH_ACTORS[platform]!;
    const t = platform === 'instagram' ? terms.map((x) => x.replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean) : [...terms];
    return { platform, actorId: actor.actorId, terms: t, limit, actorInput: actor.buildInput(t, limit) };
  });
}

export type SearchDeps = { store: LabStore; client: ApifyClient | null; now?: Date; override?: boolean; scheduled?: boolean };

/** Start the searches through the gate. Dry ingests fixture search items at once; live leaves the run pending for advance-on-read. */
export async function startSearches(deps: SearchDeps, groups: readonly SearchGroup[]) {
  const now = deps.now ?? new Date();
  const out = [];
  for (const g of groups) {
    const input = { platform: g.platform, terms: g.terms, limit: g.limit, actorInput: g.actorInput };
    const res = await gatedCall<SearchIngest | null>(deps.store, { provider: 'apify', line: 'apify.sync', kind: 'search', actor: g.actorId, input, override: deps.override, scheduled: deps.scheduled, now }, {
      dry: () => {
        const items = drySearchItems(g.platform, g.terms, g.limit, now);
        return { result: ingestSearch(deps.store, g.platform, items, g.terms, now), units: items.length, items: items.length };
      },
      live: async () => {
        if (!deps.client) throw new Error('no Apify client');
        const started = await deps.client.startRun(g.actorId, g.actorInput, { maxItems: g.limit * g.terms.length });
        return { result: null, units: 0, actualUsd: null, apifyRunId: started.id, datasetId: started.defaultDatasetId, pending: true, items: null };
      },
    });
    out.push(res);
  }
  return out;
}

/* ── 3. candidates ─────────────────────────────────────────────────────── */

export const MAX_SUGGESTIONS_PER_SEARCH = 10;
export type SearchIngest = { candidates: number; skippedKnown: number };

/** Search items → new `suggested` sources (never one the Lab already knows, dismissed included). */
export function ingestSearch(store: LabStore, platform: LabPlatform, items: readonly unknown[], terms: readonly string[], now: Date): SearchIngest {
  const byAuthor = new Map<string, string[]>();
  for (const p of normalizeItems(platform, items)) {
    if (!p.authorHandle) continue;
    (byAuthor.get(p.authorHandle) ?? byAuthor.set(p.authorHandle, []).get(p.authorHandle)!).push(p.caption);
  }
  const mine = yourCorpus(store);
  let skippedKnown = 0;
  const fresh: { handle: string; captions: string[]; overlap: number }[] = [];
  for (const [handle, captions] of byAuthor) {
    if (store.sources.byHandle(platform, handle)) {
      skippedKnown++;
      continue;
    }
    fresh.push({ handle, captions, overlap: similarity(captions, mine.length ? mine : terms) });
  }
  fresh.sort((a, b) => b.overlap - a.overlap || b.captions.length - a.captions.length || a.handle.localeCompare(b.handle));
  const kept = fresh.slice(0, MAX_SUGGESTIONS_PER_SEARCH);
  for (const c of kept) {
    const term = terms.find((t) => c.captions.some((cap) => cap.toLowerCase().includes(t.toLowerCase()))) ?? terms[0] ?? 'your topics';
    const scored = scoreCandidate({ sampled: 0, inFamilies: 0, familyLabel: null, overlap: c.overlap, breakouts: 0, followerSlope: null });
    store.sources.upsert({
      id: `src-${platform}-${c.handle.replace(/[^a-z0-9]/g, '')}-${now.getTime().toString(36)}`,
      kind: 'suggested',
      platform,
      handle: c.handle,
      url: null,
      displayName: c.handle,
      status: 'active',
      addedAt: now.toISOString(),
      reason: `Found in ${PLATFORM_LABEL[platform]} search for "${term}" (${c.captions.length} post${c.captions.length === 1 ? '' : 's'}); not sampled yet`,
      score: scored.score,
    });
  }
  return { candidates: kept.length, skippedKnown };
}

const PLATFORM_LABEL: Record<LabPlatform, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', twitter: 'X', linkedin: 'LinkedIn' };

/** Your topics, angles and captions: the text a candidate's overlap is measured against. */
function yourCorpus(store: LabStore): string[] {
  const owned = store.posts.all().filter((p) => p.isOwned);
  const ids = new Set(owned.map((p) => p.id));
  return [...store.topics.all().filter((t) => ids.has(t.postId)).map((t) => `${t.topic} ${t.angle}`), ...owned.map((p) => p.caption)];
}

/* ── 4. score ──────────────────────────────────────────────────────────── */

export type CandidateFacts = {
  /** sampled posts (0 before the 10-post sample) */
  sampled: number;
  /** of those, dissected into one of your format families */
  inFamilies: number;
  familyLabel: string | null;
  /** 0-1 topic overlap with your content */
  overlap: number;
  /** sampled posts at or above 3x their own median */
  breakouts: number;
  /** follower growth per 30 days as a fraction (0.1 = +10%); null until two snapshots */
  followerSlope: number | null;
};

/**
 * score = formatShare × overlap × breakoutFactor × growthFactor, in 0-1.
 * Smoothing (so one missing signal does not zero a creator): formatShare is 0.5 before a
 * sample exists; breakoutFactor = min(1, 0.5 + breakout rate); growthFactor = clamp(1 +
 * slope, 0.5, 1.5) ÷ 1.5 (and 1 ÷ 1.5 before two follower snapshots).
 */
export function scoreCandidate(f: CandidateFacts): { score: number; reason: string } {
  const formatShare = f.sampled > 0 ? f.inFamilies / f.sampled : 0.5;
  const rate = f.sampled > 0 ? f.breakouts / f.sampled : 0;
  const growth = Math.min(1.5, Math.max(0.5, 1 + (f.followerSlope ?? 0))) / 1.5;
  const score = Math.round(Math.min(1, Math.max(0, formatShare * f.overlap * Math.min(1, 0.5 + rate) * growth)) * 1000) / 1000;
  const parts: string[] = [];
  if (f.sampled > 0) {
    parts.push(f.familyLabel ? `${f.inFamilies} of ${f.sampled} sampled posts are ${f.familyLabel.toLowerCase().replace(/\bai\b/g, 'AI')}` : `${f.sampled} posts sampled, none dissected into your formats yet`);
    parts.push(`${f.breakouts} broke out`);
  } else parts.push('not sampled yet');
  parts.push(`topic overlap ${Math.round(f.overlap * 100)}%`);
  if (f.followerSlope !== null) parts.push(`followers ${f.followerSlope >= 0 ? '+' : ''}${Math.round(f.followerSlope * 100)}% a month`);
  return { score, reason: parts.join(', ') };
}

/** Follower growth per 30 days from a creator's snapshots (first vs last), or null with fewer than two or under a day apart. */
export function followerSlope(snaps: readonly { capturedAt: string; followers: number | null }[]): number | null {
  const xs = snaps.filter((s) => s.followers !== null && s.followers > 0).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  if (xs.length < 2) return null;
  const a = xs[0];
  const b = xs[xs.length - 1];
  const days = (Date.parse(b.capturedAt) - Date.parse(a.capturedAt)) / 86_400_000;
  if (days < 1) return null;
  return Math.round((((b.followers! - a.followers!) / a.followers!) * (30 / days)) * 1000) / 1000;
}

/** Re-score every sampled suggestion from its posts, dissections, measures and snapshots. */
export function rescoreSuggestions(store: LabStore): number {
  const families = formatFamilies(store);
  const mine = yourCorpus(store);
  const top = families[0] ?? null;
  let n = 0;
  for (const s of store.sources.all('suggested')) {
    if (s.status !== 'active') continue;
    const posts = store.posts.bySource(s.id);
    if (posts.length === 0) continue;
    const ds = posts.map((p) => store.dissections.get(p.id));
    const inFamilies = ds.filter((d) => d && families.includes(d.format)).length;
    const breakouts = posts.filter((p) => (store.measures.get(p.id)?.breakout ?? 0) >= BREAKOUT_THRESHOLD).length;
    const topics = posts.flatMap((p) => store.topics.forPost(p.id).map((t) => `${t.topic} ${t.angle}`));
    const scored = scoreCandidate({
      sampled: posts.length,
      inFamilies,
      familyLabel: inFamilies > 0 && top ? (families.length === 1 ? FORMAT_LABEL[top] : 'in your formats') : null,
      overlap: similarity([...topics, ...posts.map((p) => p.caption)], mine),
      breakouts,
      followerSlope: followerSlope(store.creatorSnapshots.forSource(s.id)),
    });
    store.sources.upsert({ ...s, score: scored.score, reason: cap(scored.reason) } satisfies LabSource);
    n++;
  }
  return n;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
