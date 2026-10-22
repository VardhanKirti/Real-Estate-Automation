import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDbPath } from '@/lib/data';

// An upgraded install must never boot onto an empty database: data written
// before the rename lives in founder-os.db and has to be opened in place.
let dir: string;
const saved = { GLADOS_DATA_DIR: process.env.GLADOS_DATA_DIR };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glados-dbpath-'));
  process.env.GLADOS_DATA_DIR = dir;
});
afterEach(() => {
  if (saved.GLADOS_DATA_DIR === undefined) delete process.env.GLADOS_DATA_DIR;
  else process.env.GLADOS_DATA_DIR = saved.GLADOS_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('database path', () => {
  test('a fresh data directory gets glados.db', () => {
    expect(resolveDbPath({})).toBe(path.join(dir, 'glados.db'));
  });

  test('an install from before the rename keeps opening founder-os.db', () => {
    fs.writeFileSync(path.join(dir, 'founder-os.db'), '');
    expect(resolveDbPath({})).toBe(path.join(dir, 'founder-os.db'));
  });

  test('once glados.db exists it wins over the legacy file', () => {
    fs.writeFileSync(path.join(dir, 'founder-os.db'), '');
    fs.writeFileSync(path.join(dir, 'glados.db'), '');
    expect(resolveDbPath({})).toBe(path.join(dir, 'glados.db'));
  });

  test('an explicit path wins, including the legacy variable', () => {
    expect(resolveDbPath({ GLADOS_DB: '/x/a.db' })).toBe('/x/a.db');
    expect(resolveDbPath({ FOUNDER_OS_DB: '/x/b.db' })).toBe('/x/b.db');
  });
});
