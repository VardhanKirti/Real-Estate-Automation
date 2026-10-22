import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dryReason, envDry, isDry } from '@/lib/creative-engine/dry';
import { readCatalog } from '@/lib/arcads/catalog';
import { buildHealthSnapshot } from '@/lib/creative-engine/snapshot';
import { createCampaign } from '@/lib/creative-engine/store';

/**
 * SPEC Q-ENG-7 (DECISIONS.md): Filming forces dry for every Creative Engine
 * paid action. Every paid path (research, probe, UGC, motion, image,
 * workflow run) gates on isDry(), so the switch is tested here once and the
 * source scan below keeps the paid paths routed through it.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-film-'));
  process.env.CREATIVE_ENGINE_STORE_DIR = dir;
  process.env.CREATIVE_ENGINE_ASSET_DIR = path.join(dir, 'assets');
});
afterEach(() => {
  delete process.env.CREATIVE_ENGINE_STORE_DIR;
  delete process.env.CREATIVE_ENGINE_ASSET_DIR;
  delete process.env.DEMO_MODE;
  delete process.env.CREATIVE_ENGINE_DRY;
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Filming forces dry', () => {
  test('off by default; CREATIVE_ENGINE_DRY and Filming each turn it on, with their reason', () => {
    expect(isDry()).toBe(false);
    expect(dryReason()).toBeNull();
    process.env.DEMO_MODE = '1';
    expect(isDry()).toBe(true);
    expect(envDry()).toBe(false);
    expect(dryReason()).toBe('filming');
    process.env.CREATIVE_ENGINE_DRY = '1';
    expect(dryReason()).toBe('env');
  });
  test('in Filming the catalog is the fixture set and nothing is fetched', async () => {
    process.env.DEMO_MODE = '1';
    const spy = vi.spyOn(globalThis, 'fetch');
    const c = await readCatalog(true);
    expect(c.state).toBe('dry');
    expect(c.detail).toMatch(/Filming/);
    expect(spy).not.toHaveBeenCalled();
  });
  test('the snapshot reports Filming apart from a dry session; campaigns are born filming', async () => {
    process.env.DEMO_MODE = '1';
    const h = await buildHealthSnapshot();
    expect(h).toMatchObject({ dry: true, dryEnv: false, filming: true });
    expect(createCampaign({ text: 'a lamp that dims', product: '', audience: '', goal: 'unset' }).origin).toBe('filming');
  });
  test('every paid path gates on isDry()', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
    expect(read('lib/creative-engine/generate.ts')).toMatch(/return isDry\(\) \? null : createArcadsClient\(\)/);
    expect(read('lib/creative-engine/workflow-run.ts')).toMatch(/isDry\(\) \? null : createArcadsClient\(\)/);
    expect(read('lib/creative-engine/research.ts')).toMatch(/if \(isDry\(\)\)/);
    expect(read('lib/creative-engine/health.ts')).toMatch(/if \(isDry\(\)\)/);
    expect(read('app/api/creative-engine/research/route.ts')).toMatch(/!isDry\(\) && !createForeplayClient\(\)/);
  });
});
