import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BACKUP_SUFFIX,
  LEGACY_PUBLIC_PREFIX,
  PUBLIC_PREFIX,
  relFromPublic,
  resolveRenamedDir,
  rewriteLegacyAssetPaths,
} from '@/lib/creative-engine/migrate';
import { CampaignSchema } from '@/lib/creative-engine/schemas';
import { createCampaign, mutateCampaign, readCampaign, resetStoreDirMemo, storeDir } from '@/lib/creative-engine/store';

/**
 * S02 FR-13 / FR-14: the Ad Engine → Creative Engine on-disk rename. Every
 * case runs in its own temp dir with fictional data; nothing here reads or
 * moves the operator's data/ or public/ (vitest.config.ts also sets
 * CREATIVE_ENGINE_MIGRATE=0 for every other test).
 */

const ENV = ['CREATIVE_ENGINE_STORE_DIR', 'AD_ENGINE_STORE_DIR', 'CREATIVE_ENGINE_ASSET_DIR', 'AD_ENGINE_ASSET_DIR', 'CREATIVE_ENGINE_MIGRATE', 'GLADOS_DATA_DIR'] as const;
let saved: Record<string, string | undefined> = {};
let tmp: string;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-migrate-'));
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetStoreDirMemo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Every file under dir with its bytes, for byte-identical comparisons. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(dir);
  return out;
}

/** A fictional campaign with five assets on the old public prefix, written into storeDir/campaigns. */
function fictionalStore(dir: string): string {
  process.env.CREATIVE_ENGINE_STORE_DIR = dir;
  const c = createCampaign({ text: 'a lamp that dims itself at bedtime', product: 'Dimly', audience: 'night owls', goal: 'sales' } as Parameters<typeof createCampaign>[0]);
  const files = ['ast-1.mp4', 'ast-2.mp4', 'ast-3.mp4', 'ast-4.png', 'ast-5.png'];
  mutateCampaign(c.id, (x) => ({
    ...x,
    assets: files.map((f, i) => ({
      id: f.replace(/\..+$/, ''),
      generationId: 'gen-1',
      kind: f.endsWith('.mp4') ? ('video' as const) : ('image' as const),
      path: `${LEGACY_PUBLIC_PREFIX}${c.id}/${f}`,
      thumbnailPath: i === 0 ? `${LEGACY_PUBLIC_PREFIX}${c.id}/ast-1-thumb.png` : null,
      sourceUrl: null,
      model: 'fictional-model',
      creditsCharged: 1,
      durationSec: null,
      at: '2026-10-01T00:00:00.000Z',
    })),
  }));
  delete process.env.CREATIVE_ENGINE_STORE_DIR;
  return c.id;
}

describe('resolveRenamedDir', () => {
  test('(a) old only: renamed to new, contents byte-identical', () => {
    const old = path.join(tmp, 'ad-engine');
    const next = path.join(tmp, 'creative-engine');
    fs.mkdirSync(path.join(old, 'campaigns'), { recursive: true });
    fs.writeFileSync(path.join(old, 'campaigns', 'ae-x.json'), '{"id":"ae-x"}\n');
    fs.writeFileSync(path.join(old, 'ledger.json'), '[]\n');
    const before = snapshot(old);
    const warn = vi.fn();
    const res = resolveRenamedDir(next, old, { warn });
    expect(res).toEqual({ dir: next, migrated: true, legacy: false });
    expect(fs.existsSync(old)).toBe(false);
    expect(snapshot(next)).toEqual(before);
    expect(warn).not.toHaveBeenCalled();
    // idempotent: a second call finds the new dir and does nothing
    expect(resolveRenamedDir(next, old, { warn })).toEqual({ dir: next, migrated: false, legacy: false });
  });

  test('(b) both exist: new used, old untouched, warned once', () => {
    const old = path.join(tmp, 'ad-engine');
    const next = path.join(tmp, 'creative-engine');
    fs.mkdirSync(old);
    fs.mkdirSync(next);
    fs.writeFileSync(path.join(old, 'runs.json'), '[{"id":"old"}]\n');
    fs.writeFileSync(path.join(next, 'runs.json'), '[{"id":"new"}]\n');
    const before = snapshot(old);
    const warn = vi.fn();
    const res = resolveRenamedDir(next, old, { warn });
    expect(res.dir).toBe(next);
    expect(snapshot(old)).toEqual(before);
    expect(fs.readFileSync(path.join(next, 'runs.json'), 'utf8')).toContain('"new"');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('(c) neither exists: new, nothing created until a write', () => {
    const next = path.join(tmp, 'creative-engine');
    const res = resolveRenamedDir(next, path.join(tmp, 'ad-engine'));
    expect(res).toEqual({ dir: next, migrated: false, legacy: false });
    expect(fs.existsSync(next)).toBe(false);
  });

  test('(d) rename throws: old returned, nothing deleted, warned', () => {
    const old = path.join(tmp, 'ad-engine');
    const next = path.join(tmp, 'creative-engine');
    fs.mkdirSync(old);
    fs.writeFileSync(path.join(old, 'credits.json'), '{"balance":5}\n');
    const before = snapshot(old);
    const warn = vi.fn();
    const rename = () => {
      throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    };
    const res = resolveRenamedDir(next, old, { warn, rename });
    expect(res).toEqual({ dir: old, migrated: false, legacy: true });
    expect(snapshot(old)).toEqual(before);
    expect(fs.existsSync(next)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('EXDEV');
  });

  test('migrate:false reads the old dir in place', () => {
    const old = path.join(tmp, 'ad-engine');
    fs.mkdirSync(old);
    const res = resolveRenamedDir(path.join(tmp, 'creative-engine'), old, { migrate: false });
    expect(res).toEqual({ dir: old, migrated: false, legacy: true });
    expect(fs.existsSync(old)).toBe(true);
  });
});

describe('rewriteLegacyAssetPaths', () => {
  test('(e) five asset paths rewritten, backup written once, reruns are no-ops', () => {
    const store = path.join(tmp, 'store');
    const id = fictionalStore(store);
    const file = path.join(store, 'campaigns', `${id}.json`);
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(path.join(store, 'runs.json'), JSON.stringify([{ id: 'run-1', outputRef: `asset:${id}/ast-1.mp4`, note: `${LEGACY_PUBLIC_PREFIX}${id}/ast-1.mp4` }], null, 2) + '\n');

    const warn = vi.fn();
    const report = rewriteLegacyAssetPaths(store, { warn });
    expect(report.skipped).toEqual([]);
    expect(report.rewritten.sort()).toEqual([file, path.join(store, 'runs.json')].sort());
    const after = CampaignSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(after.assets).toHaveLength(5);
    for (const a of after.assets) expect(a.path?.startsWith(PUBLIC_PREFIX)).toBe(true);
    expect(after.assets[0].thumbnailPath?.startsWith(PUBLIC_PREFIX)).toBe(true);
    expect(fs.readFileSync(file + BACKUP_SUFFIX, 'utf8')).toBe(original);
    expect(fs.readFileSync(path.join(store, 'runs.json'), 'utf8')).not.toContain(LEGACY_PUBLIC_PREFIX);
    expect(fs.readFileSync(path.join(store, 'runs.json'), 'utf8')).toContain(`asset:${id}/ast-1.mp4`);

    // idempotent, and the backup is never overwritten
    fs.writeFileSync(file + BACKUP_SUFFIX, 'keep me');
    expect(rewriteLegacyAssetPaths(store, { warn })).toEqual({ rewritten: [], skipped: [] });
    expect(fs.readFileSync(file + BACKUP_SUFFIX, 'utf8')).toBe('keep me');
    expect(warn).not.toHaveBeenCalled();
    // the backup does not show up as a campaign
    expect(fs.readdirSync(path.join(store, 'campaigns')).filter((n) => n.endsWith('.json'))).toEqual([`${id}.json`]);
  });

  test('(e) a schema-invalid result leaves the original and writes no backup', () => {
    const store = path.join(tmp, 'store');
    fs.mkdirSync(path.join(store, 'campaigns'), { recursive: true });
    const file = path.join(store, 'campaigns', 'ae-bad.json');
    const original = JSON.stringify({ id: 'ae-bad', assets: [{ path: `${LEGACY_PUBLIC_PREFIX}ae-bad/a.mp4` }] });
    fs.writeFileSync(file, original);
    const warn = vi.fn();
    const report = rewriteLegacyAssetPaths(store, { warn });
    expect(report).toEqual({ rewritten: [], skipped: [file] });
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.existsSync(file + BACKUP_SUFFIX)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a missing store is a no-op, never a throw', () => {
    expect(rewriteLegacyAssetPaths(path.join(tmp, 'nope'))).toEqual({ rewritten: [], skipped: [] });
  });
});

describe('storeDir() glue', () => {
  test('(f) an override env skips the migration entirely', () => {
    const data = path.join(tmp, 'data');
    fs.mkdirSync(path.join(data, 'ad-engine'), { recursive: true });
    process.env.GLADOS_DATA_DIR = data;
    process.env.CREATIVE_ENGINE_MIGRATE = '1';
    process.env.AD_ENGINE_STORE_DIR = path.join(tmp, 'override');
    expect(storeDir()).toBe(path.join(tmp, 'override'));
    expect(fs.existsSync(path.join(data, 'ad-engine'))).toBe(true);
    expect(fs.existsSync(path.join(data, 'creative-engine'))).toBe(false);
  });

  test('first read renames <data>/ad-engine and the campaign still reads; once per data dir', () => {
    const store = path.join(tmp, 'seed');
    const id = fictionalStore(store);
    const data = path.join(tmp, 'data');
    fs.mkdirSync(data);
    fs.renameSync(store, path.join(data, 'ad-engine'));
    process.env.GLADOS_DATA_DIR = data;
    process.env.CREATIVE_ENGINE_MIGRATE = '1';
    // the asset dir override keeps the test off public/; it also skips the path rewrite
    process.env.CREATIVE_ENGINE_ASSET_DIR = path.join(tmp, 'assets');
    resetStoreDirMemo();

    expect(storeDir()).toBe(path.join(data, 'creative-engine'));
    expect(fs.existsSync(path.join(data, 'ad-engine'))).toBe(false);
    const c = readCampaign(id);
    expect(c?.assets).toHaveLength(5);
    // an un-migrated path still resolves to the same file on disk
    expect(relFromPublic(c!.assets[0].path!)).toBe(`${id}/ast-1.mp4`);

    // a second data dir (Filming toggled) migrates on its own
    const demo = path.join(tmp, 'demo-data');
    fs.mkdirSync(path.join(demo, 'ad-engine'), { recursive: true });
    process.env.GLADOS_DATA_DIR = demo;
    expect(storeDir()).toBe(path.join(demo, 'creative-engine'));
    expect(fs.existsSync(path.join(demo, 'ad-engine'))).toBe(false);
  });

  test('CREATIVE_ENGINE_MIGRATE=0 reads the old dir in place', () => {
    const data = path.join(tmp, 'data');
    fs.mkdirSync(path.join(data, 'ad-engine'), { recursive: true });
    process.env.GLADOS_DATA_DIR = data;
    process.env.CREATIVE_ENGINE_MIGRATE = '0';
    resetStoreDirMemo();
    expect(storeDir()).toBe(path.join(data, 'ad-engine'));
    expect(fs.existsSync(path.join(data, 'creative-engine'))).toBe(false);
  });
});

describe('relFromPublic', () => {
  test('(g) strips either prefix and leaves anything else alone', () => {
    expect(relFromPublic('/content-media/creative-engine/ae-1/a.mp4')).toBe('ae-1/a.mp4');
    expect(relFromPublic('/content-media/ad-engine/ae-1/a.mp4')).toBe('ae-1/a.mp4');
    expect(relFromPublic('ae-1/a.mp4')).toBe('ae-1/a.mp4');
  });
});
