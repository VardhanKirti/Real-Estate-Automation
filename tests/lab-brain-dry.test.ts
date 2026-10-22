import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore } from '@/lib/lab/store';
import { invalidateModeCache } from '@/lib/paths';
import { seedLabFixtures } from '@/lib/lab/fixtures';
import { dryBrainIsReal, labBrainRoot, writeLabBrain } from '@/lib/lab/brain';
import { runLabIntel } from '@/lib/lab/intel';

/** AC-08-18: dry brain writes go to a scratch folder under the data dir, never into the real brain. */
const KEYS = ['LAB_DRY', 'GLADOS_DATA_DIR', 'GBRAIN_STORE', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE'] as const;
let saved: Record<string, string | undefined>;
let tmp: string;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-brain-'));
  process.env.LAB_DRY = '1';
  process.env.GLADOS_DATA_DIR = path.join(tmp, 'data');
  process.env.GBRAIN_STORE = path.join(tmp, 'real-brain');
  process.env.GLADOS_ENV_LOCAL = path.join(tmp, '.env.local');
  process.env.GLADOS_MODE_FILE = path.join(tmp, '.glados-mode');
  invalidateModeCache();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
});

const store = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  const s = labStore(db);
  seedLabFixtures(s, new Date('2026-10-12T03:00:00Z'));
  return s;
};

describe('AC-08-18: dry brain writes go to scratch', () => {
  test('labBrainRoot in dry is <data>/lab-dry-brain; live it is the brain store', () => {
    expect(labBrainRoot()).toBe(path.join(tmp, 'data', 'lab-dry-brain'));
    expect(dryBrainIsReal()).toBe(false);
    delete process.env.LAB_DRY;
    expect(labBrainRoot()).toBe(path.join(tmp, 'real-brain'));
  });

  test('runLabIntel in dry writes under <data>/lab-dry-brain/lab/ and nothing under the real brain', async () => {
    const s = store();
    await runLabIntel(s, { now: new Date('2026-10-12T03:00:00Z'), steps: ['brain'] });
    const direct = writeLabBrain(s, { now: new Date('2026-10-12T03:00:00Z') });
    expect(direct.paths.length).toBeGreaterThan(0);
    const dir = path.join(tmp, 'data', 'lab-dry-brain', 'lab');
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'real-brain'))).toBe(false);
  });

  test('no brainStoreDir( call under lib/lab/** outside lib/lab/brain.ts (where labBrainRoot lives)', () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && p !== path.join(process.cwd(), 'lib/lab/brain.ts') && /brainStoreDir\(/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(process.cwd(), p));
      }
    };
    walk(path.join(process.cwd(), 'lib/lab'));
    expect(hits).toEqual([]);
    const brain = fs.readFileSync(path.join(process.cwd(), 'lib/lab/brain.ts'), 'utf8');
    expect(brain).toContain('opts.root ?? labBrainRoot()');
  });
});
