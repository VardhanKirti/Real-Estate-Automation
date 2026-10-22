/**
 * Small, explicit ledger worlds for tests: an in-memory store, owned and tracked sources, posts
 * with reads at chosen ages, and scripts with versions. Fictional ids and numbers only.
 */
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import type { LabPlatform, LabPost, LabScriptBody } from '@/lib/schemas';
import { rng } from '@/lib/lab/ledger/metrics';

export const H = 3_600_000;
export const DAY = 24 * H;
export const iso = (ms: number) => new Date(ms).toISOString();

export function memStore(): LabStore {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
}

export function addSource(store: LabStore, id: string, opts: { platform?: LabPlatform; kind?: 'owned' | 'tracked' } = {}) {
  store.sources.upsert({ id, kind: opts.kind ?? 'owned', platform: opts.platform ?? 'instagram', handle: id, url: null, displayName: id, status: 'active', addedAt: '2026-01-01T00:00:00.000Z', reason: null, score: null });
}

/** A post with reads: `reads` maps age in hours to views. */
export function addPost(store: LabStore, p: { id: string; source: string; postedAt: number; reads?: Record<number, number>; platform?: LabPlatform; contentType?: string; owned?: boolean; durationS?: number | null; exo?: boolean }): LabPost {
  const post: LabPost = {
    id: p.id, sourceId: p.source, platform: p.platform ?? 'instagram', externalId: `ext-${p.id}`, url: `https://example.com/${p.id}`, postedAt: iso(p.postedAt),
    caption: `Post ${p.id}`, contentType: p.contentType ?? 'reel', thumbnailUrl: null, mediaUrl: null, durationS: p.durationS ?? 30, isOwned: p.owned ?? true,
  };
  store.posts.upsert(post);
  if (p.exo) store.posts.flagExo(p.id, 'collab', null, iso(p.postedAt));
  for (const [age, views] of Object.entries(p.reads ?? {})) {
    store.metrics.add({ postId: p.id, capturedAt: iso(p.postedAt + Number(age) * H), views, likes: null, comments: null, shares: null, saves: null });
  }
  return store.posts.get(p.id)!;
}

export const SCRIPT_BODY: LabScriptBody = {
  durationS: 30, wpm: 160, hooks: [{ form: 'results_first', trigger: 'curiosity', spoken: 'I cut my edit time in half.', onScreen: 'Half the edit time', words: 7 }],
  hookChoice: 0, sections: [{ type: 'hook', startPct: 0, endPct: 10, spoken: 'Hook.', onScreen: '', visualNote: '' }, { type: 'demo', startPct: 10, endPct: 90, spoken: 'Demo.', onScreen: '', visualNote: '' }],
  cta: 'Follow for more.', caption: 'A caption.', titles: ['A title'], platform: 'instagram',
};

export function addScript(store: LabStore, id: string, opts: { versions?: number; publishedPostId?: string | null } = {}) {
  store.scripts.upsert({ id, ideaId: null, title: `Script ${id}`, status: opts.publishedPostId ? 'published' : 'draft', publishedPostId: opts.publishedPostId ?? null, createdAt: '2026-01-01T00:00:00.000Z' });
  for (let v = 1; v <= (opts.versions ?? 1); v++) {
    store.scripts.addVersion({ scriptId: id, version: v, body: SCRIPT_BODY, gate: { passed: true, checks: [], scores: null }, createdAt: '2026-01-01T00:00:00.000Z', editDiff: null });
  }
}

/** n earlier owned posts on one source, each with a 168 h read, posted daily before `before`. */
export function addHistory(store: LabStore, source: string, before: number, views: readonly number[], opts: { platform?: LabPlatform; contentType?: string; prefix?: string } = {}) {
  views.forEach((v, i) => addPost(store, { id: `${opts.prefix ?? source}-h${i}`, source, postedAt: before - (i + 9) * DAY, reads: { 160: v * 0.95, 175: v }, platform: opts.platform, contentType: opts.contentType }));
}

/** n owned Instagram reels, one a day, the oldest first, each read at 3, 6, 12, 24, 150 and 190 h. */
export function forecastWorld(n: number, opts: { start?: number; source?: string; now?: number } = {}) {
  const NOW = opts.now ?? Date.parse('2026-10-11T12:00:00.000Z');
  const s = memStore();
  const src = opts.source ?? 'own';
  addSource(s, src);
  const next = rng(`world|${n}`);
  for (let i = 0; i < n; i++) {
    const posted = (opts.start ?? NOW - 10 * DAY) - i * DAY;
    const v24 = 5_000 + next() * 20_000;
    const k = 1.8 + next() * 0.6;
    addPost(s, { id: `p${String(i).padStart(3, '0')}`, source: src, postedAt: posted, reads: { 3: v24 * 0.2, 6: v24 * 0.35, 12: v24 * 0.6, 24: v24, 150: v24 * k * 0.95, 190: v24 * k * 1.05 } });
  }
  return s;
}

