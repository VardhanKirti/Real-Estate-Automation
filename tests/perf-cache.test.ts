import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore } from '@/lib/lab/store';
import type { LabSource } from '@/lib/schemas';
import { invalidateSwr, keyTag, swr } from '@/lib/swr';

/**
 * Perf caches must never change what a page shows: the lab store's read memo returns exactly what
 * a fresh query would, and the stale-while-revalidate memo only ever hands out real results.
 */

const T0 = '2026-10-10T06:00:00.000Z';
const src = (id: string, handle = id): LabSource => ({ id, kind: 'tracked', platform: 'tiktok', handle, url: null, displayName: handle, status: 'active', addedAt: T0, reason: null, score: null });
const post = (id: string, sourceId: string) => ({ id, sourceId, platform: 'tiktok' as const, externalId: id, url: `https://example.com/${id}`, postedAt: T0, caption: id, contentType: 'video', thumbnailUrl: null, mediaUrl: null, durationS: null, isOwned: false });

describe('lab store read memo', () => {
  test('a write on the same connection is seen by the next read', () => {
    const db = new Database(':memory:');
    db.exec(LAB_DDL);
    const s = labStore(db);
    s.sources.upsert(src('a'));
    expect(s.sources.all().map((x) => x.id)).toEqual(['a']);
    s.sources.upsert(src('b'));
    expect(s.sources.all().map((x) => x.id)).toEqual(['a', 'b']);
    s.posts.upsert(post('p1', 'a'));
    expect(s.posts.all().map((p) => p.id)).toEqual(['p1']);
    expect(s.posts.get('p1')?.caption).toBe('p1');
    expect(s.posts.get('nope')).toBeNull();
    expect(s.posts.bySource('a').map((p) => p.id)).toEqual(['p1']);
    expect(s.posts.bySource('b')).toEqual([]);
  });

  test('a commit from another connection is seen by the next read', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-memo-')), 'lab.db');
    const a = new Database(file);
    a.exec(LAB_DDL);
    const sa = labStore(a);
    sa.sources.upsert(src('a'));
    expect(sa.sources.all()).toHaveLength(1);
    const b = new Database(file);
    labStore(b).sources.upsert(src('b'));
    expect(sa.sources.all().map((x) => x.id)).toEqual(['a', 'b']);
  });

  test('a rolled-back write is not served from the memo', () => {
    const db = new Database(':memory:');
    db.exec(LAB_DDL);
    const s = labStore(db);
    s.sources.upsert(src('a'));
    expect(s.sources.all()).toHaveLength(1);
    expect(() =>
      s.transaction(() => {
        s.sources.upsert(src('b'));
        expect(s.sources.all()).toHaveLength(2);
        throw new Error('roll back');
      }),
    ).toThrow('roll back');
    expect(s.sources.all().map((x) => x.id)).toEqual(['a']);
  });

  test('each caller gets its own array, and rows cannot be edited in place', () => {
    const db = new Database(':memory:');
    db.exec(LAB_DDL);
    const s = labStore(db);
    s.sources.upsert(src('b'));
    s.sources.upsert(src('a'));
    const first = s.sources.all();
    first.reverse();
    first.pop();
    expect(s.sources.all().map((x) => x.id)).toEqual(['a', 'b']);
    expect(() => {
      (s.sources.all()[0] as { handle: string }).handle = 'changed';
    }).toThrow(TypeError);
    expect(s.sources.all()[0].handle).toBe('a');
  });
});

describe('swr', () => {
  const opts = { freshMs: 1_000, maxStaleMs: 60_000, force: true };

  test('fresh hits reuse the last real result; concurrent callers share one call', async () => {
    invalidateSwr('t1');
    let calls = 0;
    const load = async () => ++calls;
    const [x, y] = await Promise.all([swr('t1', opts, load), swr('t1', opts, load)]);
    expect([x, y, calls]).toEqual([1, 1, 1]);
    expect(await swr('t1', opts, load)).toBe(1);
    expect(calls).toBe(1);
  });

  test('a stale result is served while one refresh runs, then the new result', async () => {
    invalidateSwr('t2');
    let calls = 0;
    const load = async () => ++calls;
    expect(await swr('t2', { ...opts, freshMs: 0 }, load)).toBe(1);
    expect(await swr('t2', { ...opts, freshMs: 0 }, load)).toBe(1); // stale, refresh started
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
    expect(await swr('t2', opts, load)).toBe(2);
  });

  test('past maxStale, or after an invalidation, the caller waits for a real call', async () => {
    invalidateSwr('t3');
    let calls = 0;
    const load = async () => ++calls;
    await swr('t3', opts, load);
    expect(await swr('t3', { ...opts, freshMs: 0, maxStaleMs: 0 }, load)).toBe(2);
    invalidateSwr('t3');
    expect(await swr('t3', opts, load)).toBe(3);
  });

  test('a call that started before an invalidation is not cached', async () => {
    invalidateSwr('t4');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = swr('t4', opts, async () => {
      await gate;
      return 'old';
    });
    invalidateSwr('t4');
    release();
    expect(await slow).toBe('old');
    expect(await swr('t4', opts, async () => 'new')).toBe('new');
  });

  test('errors are not cached', async () => {
    invalidateSwr('t5');
    await expect(swr('t5', opts, async () => { throw new Error('down'); })).rejects.toThrow('down');
    expect(await swr('t5', opts, async () => 'up')).toBe('up');
  });

  test('without force it is off under vitest (every test sees a real call)', async () => {
    let calls = 0;
    await swr('t6', { freshMs: 60_000, maxStaleMs: 60_000 }, async () => ++calls);
    await swr('t6', { freshMs: 60_000, maxStaleMs: 60_000 }, async () => ++calls);
    expect(calls).toBe(2);
  });

  test('keyTag never contains the secret', () => {
    expect(keyTag('sk_live_abc')).not.toContain('sk_live');
    expect(keyTag('sk_live_abc')).toHaveLength(12);
  });
});
