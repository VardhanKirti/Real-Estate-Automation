import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore } from '@/lib/lab/store';
import { seedLabFixtures } from '@/lib/lab/fixtures';
import { distillProfiles } from '@/lib/lab/distill';

describe('distillProfiles', () => {
  it('never stores a profile for a format with too few cases (04 5.5: 8 cases and 8 controls)', () => {
    const db = new Database(':memory:');
    db.exec(LAB_DDL);
    const store = labStore(db);
    const now = new Date('2026-10-10T12:00:00Z');
    seedLabFixtures(store, now);
    const versions = () => store.profiles.latest().map((p) => `${p.formatFamily}:${p.version}`).sort();
    const before = versions();
    // every format keeps its posts but loses its cases: nothing is left to distil
    db.exec("DELETE FROM lab_controls WHERE role = 'case'");
    const out = distillProfiles(store, { now });
    expect(out).toEqual([]);
    expect(versions()).toEqual(before);
  });
});
