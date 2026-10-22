import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dataDir,
  dataPath,
  filmingMode,
  invalidateModeCache,
  isRealDataPath,
  assertSeedTarget,
} from '@/lib/paths';

// Never the real .glados-mode — an earlier version of this test deleted the
// operator's actual filming setting when the suite ran.
const MODE_FILE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'glados-mode-')),
  '.glados-mode',
);
process.env.GLADOS_MODE_FILE = MODE_FILE;

function clearEnv() {
  delete process.env.GLADOS_DATA_DIR;
  delete process.env.DEMO_MODE;
  delete process.env.GLADOS_ALLOW_REAL_SEED;
  try {
    fs.unlinkSync(MODE_FILE);
  } catch {
    /* not there */
  }
  invalidateModeCache();
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe('data directory resolution', () => {
  it('defaults to the real data directory', () => {
    expect(filmingMode()).toBe(false);
    expect(dataDir()).toBe(path.join(process.cwd(), 'data'));
    expect(dataPath('glados.db')).toBe(path.join(process.cwd(), 'data', 'glados.db'));
  });

  it('DEMO_MODE=1 points every store at demo-data', () => {
    process.env.DEMO_MODE = '1';
    invalidateModeCache();
    expect(filmingMode()).toBe(true);
    expect(dataPath('bank.db')).toBe(path.join(process.cwd(), 'demo-data', 'bank.db'));
  });

  it('DEMO_MODE=0 forces filming off even with the mode file present', () => {
    fs.writeFileSync(MODE_FILE, 'filming');
    process.env.DEMO_MODE = '0';
    invalidateModeCache();
    expect(filmingMode()).toBe(false);
  });

  it('the mode file toggles filming without touching env', () => {
    fs.writeFileSync(MODE_FILE, 'filming');
    invalidateModeCache();
    expect(filmingMode()).toBe(true);
    expect(dataDir()).toBe(path.join(process.cwd(), 'demo-data'));

    fs.writeFileSync(MODE_FILE, 'real');
    invalidateModeCache();
    expect(filmingMode()).toBe(false);
  });

  it('GLADOS_DATA_DIR wins and pins the instance out of filming mode', () => {
    fs.writeFileSync(MODE_FILE, 'filming');
    process.env.GLADOS_DATA_DIR = '/srv/glados/data';
    invalidateModeCache();
    // The mac mini sets this. No toggle in the UI can move it.
    expect(filmingMode()).toBe(false);
    expect(dataDir()).toBe('/srv/glados/data');
  });

  it('resolves a relative GLADOS_DATA_DIR against the project root', () => {
    process.env.GLADOS_DATA_DIR = 'var/data';
    expect(dataDir()).toBe(path.join(process.cwd(), 'var', 'data'));
  });
});

describe('real-data protection', () => {
  it('recognises paths inside the real data directory', () => {
    expect(isRealDataPath(path.join(process.cwd(), 'data'))).toBe(true);
    expect(isRealDataPath(path.join(process.cwd(), 'data', 'bank.db'))).toBe(true);
    expect(isRealDataPath(path.join(process.cwd(), 'demo-data', 'bank.db'))).toBe(false);
    // A sibling that merely starts with the same characters is not inside it.
    expect(isRealDataPath(path.join(process.cwd(), 'data-archive'))).toBe(false);
  });

  it('refuses to seed the real data directory', () => {
    expect(() => assertSeedTarget()).toThrow(/real data directory/);
  });

  it('allows seeding when filming mode is on', () => {
    process.env.DEMO_MODE = '1';
    invalidateModeCache();
    expect(() => assertSeedTarget()).not.toThrow();
  });

  it('allows seeding the real directory only with the explicit escape hatch', () => {
    process.env.GLADOS_ALLOW_REAL_SEED = '1';
    expect(() => assertSeedTarget()).not.toThrow();
  });
});
