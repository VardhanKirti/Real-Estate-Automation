/**
 * Morning digest storage (pages/feature-additions.md F3), adapted from the
 * 2026-10-06 parts bin (lib/db-ext/comms-digest.ts).
 *
 *   comms_digests  one row per built digest; body_json is the report the
 *                  builder returned, so /inbox renders it without re-reading
 *                  every connector.
 *   digest_reads   read marks: the whole digest (entry_key '') or one entry,
 *                  keyed by the stable entryKey (source|sender|ts) so a
 *                  rebuild never resurrects something already answered.
 */
import type Database from 'better-sqlite3';
import { CommsDigestSchema, DigestReadSchema, type CommsDigestRow, type DigestRead } from '@/lib/schemas';

type DigestRaw = { id: string; date: string; body_json: string; created_at: string };
const toDigest = (r: DigestRaw): CommsDigestRow => {
  let body: unknown = null;
  try {
    body = JSON.parse(r.body_json);
  } catch {
    body = null;
  }
  return CommsDigestSchema.parse({ id: r.id, date: r.date, body, createdAt: r.created_at });
};

export function commsDigestsRepo(db: InstanceType<typeof Database>) {
  const reads = {
    mark(digestId: string, entryKey = '', at = new Date().toISOString()): DigestRead {
      const v = DigestReadSchema.parse({ digestId, entryKey, readAt: at });
      db.prepare('INSERT OR REPLACE INTO digest_reads (digest_id, entry_key, read_at) VALUES (?, ?, ?)').run(v.digestId, v.entryKey, v.readAt);
      return v;
    },
    unmark(digestId: string, entryKey = ''): void {
      db.prepare('DELETE FROM digest_reads WHERE digest_id = ? AND entry_key = ?').run(digestId, entryKey);
    },
    forDigest(digestId: string): DigestRead[] {
      return (
        db.prepare('SELECT * FROM digest_reads WHERE digest_id = ? ORDER BY read_at DESC').all(digestId) as {
          digest_id: string; entry_key: string; read_at: string;
        }[]
      ).map((r) => DigestReadSchema.parse({ digestId: r.digest_id, entryKey: r.entry_key, readAt: r.read_at }));
    },
    /** Every cleared entry key across digests (a rebuild must not bring them back). */
    clearedKeys(): string[] {
      return (db.prepare("SELECT DISTINCT entry_key FROM digest_reads WHERE entry_key != ''").all() as { entry_key: string }[]).map(
        (r) => r.entry_key,
      );
    },
    /** Housekeeping: drop marks older than `before` (ISO). */
    prune(before: string): void {
      db.prepare('DELETE FROM digest_reads WHERE read_at < ?').run(before);
    },
  };

  return {
    insert(row: { id: string; date: string; body: unknown; createdAt: string }): CommsDigestRow {
      const v = CommsDigestSchema.parse(row);
      db.prepare('INSERT OR REPLACE INTO comms_digests (id, date, body_json, created_at) VALUES (?, ?, ?, ?)').run(
        v.id, v.date, JSON.stringify(v.body ?? null), v.createdAt,
      );
      return v;
    },
    get(id: string): CommsDigestRow | null {
      const r = db.prepare('SELECT * FROM comms_digests WHERE id = ?').get(id) as DigestRaw | undefined;
      return r ? toDigest(r) : null;
    },
    latest(): CommsDigestRow | null {
      const r = db.prepare('SELECT * FROM comms_digests ORDER BY created_at DESC, rowid DESC LIMIT 1').get() as DigestRaw | undefined;
      return r ? toDigest(r) : null;
    },
    recent(limit = 14): CommsDigestRow[] {
      return (db.prepare('SELECT * FROM comms_digests ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as DigestRaw[]).map(toDigest);
    },
    /** Unread = the digest itself has no whole-digest read mark. */
    isRead(id: string): boolean {
      return Boolean(db.prepare("SELECT 1 FROM digest_reads WHERE digest_id = ? AND entry_key = ''").get(id));
    },
    reads,
  };
}
