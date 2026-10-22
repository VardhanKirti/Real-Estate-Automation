import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeProductOptions, productOptions } from '@/lib/creative-engine/products';
import { writeCache, writeSettings } from '@/lib/creative-engine/store';

/** S03 FR-12 and edge cases 3 to 5. */

describe('mergeProductOptions', () => {
  test('ventures, the chosen Arcads product and the catalog merge; a venture wins a case-insensitive clash', () => {
    const out = mergeProductOptions({
      ventures: [{ label: 'Lumen Desk', detail: 'Desk lamps that know when to stop' }],
      settingsProduct: 'lumen desk',
      catalogProducts: [{ name: 'Northwind Kit', description: 'Sample kit' }, { name: 'LUMEN DESK' }],
    });
    expect(out).toEqual([
      { label: 'Lumen Desk', detail: 'Desk lamps that know when to stop', source: 'venture' },
      { label: 'Northwind Kit', detail: 'Sample kit', source: 'arcads' },
    ]);
  });
  test('all sources empty: no options', () => {
    expect(mergeProductOptions({ ventures: [], settingsProduct: null, catalogProducts: [] })).toEqual([]);
    expect(mergeProductOptions({ ventures: [], settingsProduct: '  ', catalogProducts: [{ name: '' }] })).toEqual([]);
  });
});

describe('productOptions reads disk only', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-products-'));
    process.env.CREATIVE_ENGINE_STORE_DIR = dir;
    process.env.GLADOS_DATA_DIR = dir;
  });
  afterEach(() => {
    delete process.env.CREATIVE_ENGINE_STORE_DIR;
    delete process.env.GLADOS_DATA_DIR;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test('settings and an old catalog cache feed it; no fetch happens', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    writeSettings({ arcadsProductName: 'Pinion Board' });
    writeCache('arcads-catalog', { state: 'connected', detail: '', actors: [], voices: [], products: [{ id: 'p1', name: 'Halyard Mat' }], fetchedAt: '2020-01-01T00:00:00.000Z' });
    const out = productOptions();
    expect(out.map((o) => o.label)).toEqual(['Pinion Board', 'Halyard Mat']);
    expect(spy).not.toHaveBeenCalled();
  });
});
