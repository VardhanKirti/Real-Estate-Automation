/**
 * Ask the Lab (07 7.12): a deterministic query parser, filter-then-similarity search over the
 * active embedding model only, and deterministic answer copy. No LLM prose, no LLM call.
 */
import { LAB_FORMATS, type LabFormat, type LabHookForm, type LabPlatform, type LabPost } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { activeEmbedder, cosine, embedTexts, indexProgress, LOCAL_EMBED_MODEL, type Embedder } from '@/lib/lab/gen/embed';
import { MIN_N, x1 } from '@/lib/lab/gen/format';

export const ASK_LIMIT = 24;
export const ASK_MAX_LIMIT = 48;
export const ASK_DEFAULT_DAYS = 90;
export const ASK_MIN_SIM: Record<string, number> = { 'local-hash-v1': 0.12, 'text-embedding-3-small': 0.25 };
export const ASK_CLOSE_SIM: Record<string, number> = { 'local-hash-v1': 0.35, 'text-embedding-3-small': 0.6 };
export const ASK_PLACEHOLDER = 'Ask about your niche: results-first hooks on TikTok that broke out last month';
export const NOTHING_INDEXED = 'Nothing indexed yet. The Lab indexes posts after each sync.';

/** 07 7.12.1 */
export type AskFilters = {
  platforms: LabPlatform[];
  formats: LabFormat[];
  hookForms: LabHookForm[];
  minRatio: number | null;
  maxRatio: number | null;
  days: number;
  owned: 'only' | 'exclude' | 'any';
  creators: string[];
  dualHigh: boolean;
  semantic: string;
  matched: { span: string; as: string }[];
};

type Rule = { re: RegExp; as: string; apply: (f: AskFilters, m: RegExpExecArray) => void };

const add = <T>(xs: T[], x: T) => {
  if (!xs.includes(x)) xs.push(x);
};
const plat = (p: LabPlatform): Rule['apply'] => (f) => add(f.platforms, p);
const fmt = (x: LabFormat): Rule['apply'] => (f) => add(f.formats, x);
const hook = (h: LabHookForm): Rule['apply'] => (f) => add(f.hookForms, h);
const HOOKS = '(?:\\s+hooks?)?';

/** The 7.12.1 table, in order. Patterns are case-insensitive with word boundaries. */
const RULES: Rule[] = [
  { re: /\b(?:tiktok|tt)\b/gi, as: 'platform', apply: plat('tiktok') },
  { re: /\b(?:instagram|ig|insta|reels?)\b/gi, as: 'platform', apply: plat('instagram') },
  { re: /\bshorts\b/gi, as: 'platform', apply: (f) => { add(f.platforms, 'youtube'); (f as AskFilters & { _shorts?: boolean })._shorts = true; } },
  { re: /\b(?:youtube|yt)\b/gi, as: 'platform', apply: plat('youtube') },
  { re: /\blinkedin\b/gi, as: 'platform', apply: plat('linkedin') },
  { re: /\b(?:twitter|tweets?|x posts)\b|\bon x\b/gi, as: 'platform', apply: plat('twitter') },
  { re: /\b(?:tutorials?|walkthroughs?)\b/gi, as: 'format', apply: fmt('tutorial_walkthrough') },
  { re: /\btalking heads?\b/gi, as: 'format', apply: fmt('talking_head') },
  { re: /\bscreen ?rec(?:ording)?s?\b/gi, as: 'format', apply: fmt('screen_recording') },
  { re: /\bskits?\b/gi, as: 'format', apply: fmt('skit') },
  { re: /\bgreen ?screen\b/gi, as: 'format', apply: fmt('green_screen') },
  { re: /\blong[- ]?form\b|\blong videos\b/gi, as: 'format', apply: fmt('long_form') },
  { re: /\bcarousels?\b/gi, as: 'format', apply: fmt('carousel') },
  { re: new RegExp(`\\bresults?[- ]first${HOOKS}\\b`, 'gi'), as: 'hook', apply: hook('results_first') },
  { re: new RegExp(`\\bcontrarian${HOOKS}\\b`, 'gi'), as: 'hook', apply: hook('contrarian') },
  { re: new RegExp(`\\bopen[- ]loops?${HOOKS}\\b`, 'gi'), as: 'hook', apply: hook('open_loop') },
  { re: /\bquestion hooks?\b/gi, as: 'hook', apply: hook('direct_question') },
  { re: new RegExp(`\\bhow[- ]to${HOOKS}\\b`, 'gi'), as: 'hook', apply: hook('howto_promise') },
  { re: new RegExp(`\\bnews${HOOKS}\\b`, 'gi'), as: 'hook', apply: hook('news_react') },
  { re: new RegExp(`\\blists?${HOOKS}\\b`, 'gi'), as: 'hook', apply: hook('list_tease') },
  { re: /\bnumber hooks?\b|\bstats?(?:\s+hooks?)?\b/gi, as: 'hook', apply: hook('number_stat') },
  { re: new RegExp(`\\bconfessions?${HOOKS}\\b`, 'gi'), as: 'hook', apply: hook('confession') },
  { re: /\bbroke out\b|\bbreakouts?\b|\bwent viral\b|\bviral\b/gi, as: 'ratio', apply: (f) => { f.minRatio = Math.max(f.minRatio ?? 0, 3); } },
  { re: /\b(\d+(?:\.\d+)?)x\b/gi, as: 'ratio', apply: (f, m) => { f.minRatio = Number(m[1]); } },
  { re: /\bflopp?(?:ed|s)\b|\bduds?\b|\bdidn'?t work\b/gi, as: 'ratio', apply: (f) => { f.maxRatio = 0.8; } },
  { re: /\b(?:last|past) (\d+) (days?|weeks?|months?)\b/gi, as: 'window', apply: (f, m) => { const n = Number(m[1]); f.days = /^w/i.test(m[2]) ? n * 7 : /^m/i.test(m[2]) ? n * 30 : n; } },
  { re: /\b(?:last|past) (week|month)\b/gi, as: 'window', apply: (f, m) => { f.days = /^w/i.test(m[1]) ? 7 : 30; } },
  { re: /\bthis week\b/gi, as: 'window', apply: (f) => { f.days = 7; } },
  { re: /\bthis month\b/gi, as: 'window', apply: (f) => { f.days = 30; } },
  { re: /\btoday\b/gi, as: 'window', apply: (f) => { f.days = 1; } },
  { re: /\bmine\b|\bmy posts\b|\bmy own\b|\bi made\b|\bmy\b/gi, as: 'mine', apply: (f) => { f.owned = 'only'; } },
  { re: /\bdual[- ]high\b/gi, as: 'dual high', apply: (f) => { f.dualHigh = true; } },
];

/** v1 clusters.ts STOP list plus 7.12.1's additions. */
export const ASK_STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'how', 'why', 'what', 'my', 'your', 'i', 'you', 'is', 'are', 'it', 'this', 'that', 'vs', 'ai', 'show', 'me', 'find', 'posts', 'videos', 'about', 'which', 'were', 'did']);

export type AskParseCtx = { handles?: ReadonlyMap<string, string> };

/** Deterministic parse (7.12.1). `handles` maps a lower-cased handle (no @) to its source id. */
export function parseAsk(q: string, ctx: AskParseCtx = {}): AskFilters {
  const f: AskFilters & { _shorts?: boolean } = { platforms: [], formats: [], hookForms: [], minRatio: null, maxRatio: null, days: ASK_DEFAULT_DAYS, owned: 'exclude', creators: [], dualHigh: false, semantic: '', matched: [] };
  let rest = ` ${q} `;
  const spans: { at: number; span: string; as: string }[] = [];
  for (const m of q.matchAll(/@([a-z0-9._]+)/gi)) {
    const h = m[1].toLowerCase().replace(/\.+$/, '');
    const id = ctx.handles?.get(h);
    if (id) {
      add(f.creators, id);
      spans.push({ at: m.index ?? 0, span: `@${h}`, as: 'creator' });
    } else spans.push({ at: m.index ?? 0, span: `@${h}`, as: `@${h} is not tracked` });
    rest = rest.replace(m[0], ' ');
  }
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const re = new RegExp(r.re.source, r.re.flags);
    while ((m = re.exec(rest))) {
      r.apply(f, m);
      spans.push({ at: q.toLowerCase().indexOf(m[0].toLowerCase()), span: m[0].trim(), as: r.as });
      rest = `${rest.slice(0, m.index)} ${' '.repeat(Math.max(0, m[0].length - 1))}${rest.slice(m.index + m[0].length)}`;
      re.lastIndex = m.index + 1;
    }
  }
  if (f._shorts && f.formats.length === 0) f.formats = LAB_FORMATS.filter((x) => x !== 'long_form');
  delete f._shorts;
  f.semantic = (rest.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'.+#-]*/gu) ?? []).map((w) => w.replace(/[.'-]+$/, '')).filter((w) => w && !ASK_STOP.has(w)).join(' ');
  f.matched = spans.sort((a, b) => a.at - b.at).map(({ span, as }) => ({ span, as }));
  return f;
}

/** lower-cased handle (no @) to source id, for every source with a handle. */
export function handleMap(store: LabStore): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of store.sources.all()) if (s.handle) m.set(s.handle.toLowerCase().replace(/^@/, ''), s.id);
  return m;
}

export type AskHit = { post: LabPost; similarity: number | null; ratio: number | null };
export type AskSearch = { model: string; hits: AskHit[]; indexing: { done: number; total: number } | null; indexed: number };

/** Posts passing every filter (ratio filters use the age-matched ratio; unrated posts are out when one is set). */
export function filterPosts(store: LabStore, f: AskFilters, now: Date): { post: LabPost; ratio: number | null }[] {
  const since = now.getTime() - f.days * 86_400_000;
  const out: { post: LabPost; ratio: number | null }[] = [];
  for (const p of store.posts.all()) {
    if (f.owned === 'only' && !p.isOwned) continue;
    if (f.owned === 'exclude' && p.isOwned) continue;
    if (f.platforms.length && !f.platforms.includes(p.platform)) continue;
    if (f.creators.length && !f.creators.includes(p.sourceId)) continue;
    if (!p.postedAt || !(Date.parse(p.postedAt) >= since)) continue;
    const d = store.dissections.get(p.id);
    if (f.formats.length && (!d || !f.formats.includes(d.format))) continue;
    if (f.hookForms.length && (!d || !f.hookForms.includes(d.hookForm))) continue;
    const m = store.measures.get(p.id);
    const ratio = m?.breakout ?? null;
    if ((f.minRatio !== null || f.maxRatio !== null) && ratio === null) continue;
    if (f.minRatio !== null && ratio! < f.minRatio) continue;
    if (f.maxRatio !== null && ratio! > f.maxRatio) continue;
    if (f.dualHigh && !m?.dualHigh) continue;
    out.push({ post: p, ratio });
  }
  return out;
}

/**
 * 7.12.2. Similarity compares only vectors of the active model (`lab_embeddings` rows); a post
 * without a row for that model is not searched semantically (Ask says it is still indexing).
 */
export async function searchAsk(store: LabStore, f: AskFilters, opts: { now?: Date; limit?: number; embedder?: Embedder } = {}): Promise<AskSearch> {
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(ASK_MAX_LIMIT, opts.limit ?? ASK_LIMIT));
  const embedder = opts.embedder ?? activeEmbedder({ store });
  const model = embedder.model;
  const prog = indexProgress(store, model, ['post']);
  const indexed = store.embeddings.count('post', model);
  const indexing = prog.total > 0 && prog.done < prog.total ? prog : null;
  const pool = filterPosts(store, f, now);
  let hits: AskHit[];
  if (f.semantic) {
    const [qv] = await embedTexts(store, [f.semantic], embedder, { now, purpose: 'ask' });
    const min = ASK_MIN_SIM[model] ?? ASK_MIN_SIM[LOCAL_EMBED_MODEL];
    hits = qv
      ? pool.flatMap(({ post, ratio }) => {
          const row = store.embeddings.get('post', post.id, model);
          if (!row || row.vec.length !== qv.length) return [];
          const s = cosine(qv, row.vec);
          return s >= min ? [{ post, ratio, similarity: Math.round(s * 1000) / 1000 }] : [];
        })
      : [];
    hits.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0) || (b.ratio ?? -1) - (a.ratio ?? -1) || a.post.id.localeCompare(b.post.id));
  } else {
    hits = pool.map(({ post, ratio }) => ({ post, ratio, similarity: null }));
    hits.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || (b.post.postedAt ?? '').localeCompare(a.post.postedAt ?? '') || a.post.id.localeCompare(b.post.id));
  }
  return { model, hits: hits.slice(0, limit), indexing, indexed };
}

/** 7.12.3 summary line. `indexed` 0 = nothing indexed yet (7.12.4). */
export function askSummary(hits: readonly { ratio: number | null }[], opts: { indexed: number; semantic: boolean }): string {
  const n = hits.length;
  if (n === 0) return opts.semantic && opts.indexed === 0 ? NOTHING_INDEXED : 'Nothing matches. Try fewer filters.';
  if (n < MIN_N) return `${n} posts match. Not enough to say more.`;
  const rated = hits.map((h) => h.ratio).filter((r): r is number => r !== null).sort((a, b) => a - b);
  const b = rated.filter((r) => r >= 3).length;
  const k = rated.length;
  const head = `${n} posts match. ${b} broke out (3x or more their creator's normal).`;
  if (k < MIN_N) return `${head} Median not enough yet (n ${k}).`;
  const mid = k % 2 ? rated[(k - 1) / 2] : (rated[k / 2 - 1] + rated[k / 2]) / 2;
  return `${head} Median ${x1(mid)}, n ${k}.`;
}

export const matchLabel = (similarity: number | null, model: string): 'close' | 'related' | 'filter' => (similarity === null ? 'filter' : similarity >= (ASK_CLOSE_SIM[model] ?? ASK_CLOSE_SIM[LOCAL_EMBED_MODEL]) ? 'close' : 'related');
