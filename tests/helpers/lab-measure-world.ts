/**
 * A small crafted store for section 04's measure tests: one or more creators, posts every two
 * days, reads at fixed ages, follower snapshots. Every number is invented and deterministic.
 */
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import type { LabPlatform, LabPost } from '@/lib/schemas';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const BASE = Date.parse('2026-06-01T10:00:00.000Z');
export const iso = (ms: number) => new Date(ms).toISOString();

export function emptyStore(): { db: InstanceType<typeof Database>; store: LabStore } {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return { db, store: labStore(db) };
}

/** Deterministic spread around 1 (no RNG): a fixed list of multipliers. */
export const WOBBLE = [1, 1.3, 0.8, 1.1, 0.9, 1.25, 0.75, 1.05, 0.95, 1.2, 0.85, 1.15, 0.7, 1.35, 0.9, 1.1];

export type CreatorSpec = { id: string; platform?: LabPlatform; owned?: boolean; contentType?: string; followers?: number; posts?: number; scale?: number; everyDays?: number; startMs?: number };

/** Views at an age: a saturating curve to `total` by 14 days. */
export const viewsAt = (total: number, h: number) => Math.round(total * (1 - Math.exp(-h / 40)));

export function addCreator(store: LabStore, c: CreatorSpec, readAges: readonly number[] = [6, 24, 72, 168, 336], nowMs = BASE + 60 * DAY): LabPost[] {
  const platform = c.platform ?? 'tiktok';
  store.sources.upsert({ id: c.id, kind: c.owned ? 'owned' : 'tracked', platform, handle: c.id, url: null, displayName: c.id, status: 'active', addedAt: iso(BASE - 30 * DAY), reason: null, score: null });
  store.creatorSnapshots.add({ sourceId: c.id, capturedAt: iso((c.startMs ?? BASE) - 20 * DAY), followers: c.followers ?? 50_000, following: 10, postCount: 100 });
  const out: LabPost[] = [];
  for (let i = 0; i < (c.posts ?? 12); i++) {
    const posted = (c.startMs ?? BASE) + i * (c.everyDays ?? 2) * DAY;
    const p: LabPost = { id: `${c.id}-p${i}`, sourceId: c.id, platform, externalId: `${c.id}-p${i}`, url: `https://example.test/${c.id}/${i}`, postedAt: iso(posted), caption: `post ${i}`, contentType: c.contentType ?? 'video', thumbnailUrl: null, mediaUrl: null, durationS: 40, isOwned: Boolean(c.owned) };
    store.posts.upsert(p);
    const total = (c.scale ?? 10_000) * WOBBLE[i % WOBBLE.length];
    for (const h of readAges) {
      if (posted + h * HOUR > nowMs) continue;
      const v = viewsAt(total, h);
      store.metrics.add({ postId: p.id, capturedAt: iso(posted + h * HOUR), views: v, likes: Math.round(v * 0.05), comments: Math.round(v * 0.005), shares: Math.round(v * 0.004), saves: Math.round(v * 0.006) });
    }
    out.push(p);
  }
  return out;
}

export function addReads(store: LabStore, post: LabPost, total: number, ages: readonly number[]) {
  const posted = Date.parse(post.postedAt!);
  for (const h of ages) {
    const v = viewsAt(total, h);
    store.metrics.add({ postId: post.id, capturedAt: iso(posted + h * HOUR), views: v, likes: Math.round(v * 0.05), comments: Math.round(v * 0.005), shares: null, saves: null });
  }
}
