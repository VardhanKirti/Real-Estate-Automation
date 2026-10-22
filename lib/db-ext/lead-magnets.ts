/**
 * Lead magnets repository (pages/lead-magnets.md §2). No connector of its
 * own; nothing seeded.
 */
import type Database from 'better-sqlite3';
import type { z } from 'zod';
import {
  LeadMagnetPatchSchema,
  LeadMagnetSchema,
  LeadMagnetStatusSchema,
  type LeadMagnet,
  type LeadMagnetPatch,
  type LeadMagnetStatus,
} from '@/lib/schemas';

type Raw = {
  id: string; name: string; offer: string; live_url: string; destination: string; campaign: string;
  status: string; went_live_at: string | null; notes: string; created_at: string; updated_at: string;
};
const toMagnet = (r: Raw): LeadMagnet =>
  LeadMagnetSchema.parse({
    id: r.id, name: r.name, offer: r.offer, liveUrl: r.live_url, destination: r.destination, campaign: r.campaign,
    status: r.status, wentLiveAt: r.went_live_at, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
  });

export function leadMagnetsRepo(db: InstanceType<typeof Database>) {
  const write = (m: LeadMagnet) =>
    db.prepare(
      `INSERT OR REPLACE INTO lead_magnets
         (id, name, offer, live_url, destination, campaign, status, went_live_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(m.id, m.name, m.offer, m.liveUrl, m.destination, m.campaign, m.status, m.wentLiveAt, m.notes, m.createdAt, m.updatedAt);

  return {
    insert(input: z_input): LeadMagnet {
      const m = LeadMagnetSchema.parse(input);
      write(m);
      return m;
    },
    get(id: string): LeadMagnet | null {
      const r = db.prepare('SELECT * FROM lead_magnets WHERE id = ?').get(id) as Raw | undefined;
      return r ? toMagnet(r) : null;
    },
    /** Newest first, optionally filtered by status (`?status=`). */
    all(status?: LeadMagnetStatus): LeadMagnet[] {
      if (status) LeadMagnetStatusSchema.parse(status);
      const rows = status
        ? db.prepare('SELECT * FROM lead_magnets WHERE status = ? ORDER BY created_at DESC, rowid DESC').all(status)
        : db.prepare('SELECT * FROM lead_magnets ORDER BY created_at DESC, rowid DESC').all();
      return (rows as Raw[]).map(toMagnet);
    },
    /** Partial edit, validated by round-tripping the whole row. Null when the id is unknown. */
    update(id: string, patch: LeadMagnetPatch, updatedAt = new Date().toISOString()): LeadMagnet | null {
      const current = this.get(id);
      if (!current) return null;
      const clean = LeadMagnetPatchSchema.parse(patch);
      const next = LeadMagnetSchema.parse({ ...current, ...clean, updatedAt });
      write(next);
      return next;
    },
    /** Deletes the record only (never the page it points at). True when a row went. */
    remove(id: string): boolean {
      return db.prepare('DELETE FROM lead_magnets WHERE id = ?').run(id).changes > 0;
    },
  };
}

type z_input = z.input<typeof LeadMagnetSchema>;
