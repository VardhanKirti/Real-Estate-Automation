import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPrivatePath, previewFile, scanBrain } from '@/lib/database/scan';
import { squarify } from '@/components/database/DatabaseExplorer';
import type { DbNode } from '@/lib/database/scan';

let root = '';
const prev = process.env.BRAIN_DIR;
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'brain-'));
  mkdirSync(path.join(root, 'Knowledge/notes'), { recursive: true });
  mkdirSync(path.join(root, 'Vault'), { recursive: true });
  writeFileSync(path.join(root, 'TAXONOMY.md'), '# map\n');
  writeFileSync(path.join(root, 'Knowledge/notes/a.md'), 'x'.repeat(3000));
  writeFileSync(path.join(root, 'Knowledge/big.bin'), Buffer.alloc(10_000));
  writeFileSync(path.join(root, 'Vault/RecoveryCodes.txt'), 'secret');
  writeFileSync(path.join(root, 'api-token.txt'), 'secret');
  process.env.BRAIN_DIR = root;
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); if (prev === undefined) delete process.env.BRAIN_DIR; else process.env.BRAIN_DIR = prev; });

describe('Database — brain scanner', () => {
  test('sizes roll up and children sort largest first', () => {
    const db = scanBrain(0);
    if (!db.configured) throw new Error('not configured');
    expect(db.tree.size).toBe(6 + 3000 + 10_000 + 6 + 6);
    expect(db.tree.files).toBe(5);
    expect(db.tree.children![0].name).toBe('Knowledge');
    expect(db.tree.children![0].children!.map((c) => c.name)).toEqual(['big.bin', 'notes']);
  });

  test('a missing folder reports not configured with where it looked', () => {
    process.env.BRAIN_DIR = path.join(root, 'nope');
    const db = scanBrain(0);
    expect(db.configured).toBe(false);
    if (!db.configured) expect(db.tried[0]).toContain('nope');
    process.env.BRAIN_DIR = root;
  });

  test('text previews, binary and private files show metadata only', () => {
    const t = previewFile('TAXONOMY.md');
    expect(t.ok && t.kind === 'text' && t.text).toBe('# map\n');
    const b = previewFile('Knowledge/big.bin');
    expect(b.ok && b.kind).toBe('binary');
    for (const p of ['Vault/RecoveryCodes.txt', 'api-token.txt']) {
      const v = previewFile(p);
      expect(v.ok && v.kind).toBe('private');
      expect(JSON.stringify(v)).not.toContain('secret');
    }
  });

  test('nothing outside the brain folder can be read', () => {
    for (const p of ['../../etc/passwd', '/etc/passwd', 'Knowledge/../../x']) {
      const r = previewFile(p);
      expect(r.ok).toBe(false);
    }
  });

  test('private path rules', () => {
    expect(isPrivatePath('Vault/x.md')).toBe(true);
    expect(isPrivatePath('.git/config')).toBe(true);
    expect(isPrivatePath('Projects/app/.env.local')).toBe(true);
    expect(isPrivatePath('Knowledge/notes.md')).toBe(false);
  });

  test('squarify fills the rectangle exactly', () => {
    const rs = squarify([600, 300, 100], { x: 0, y: 0, w: 40, h: 25 });
    expect(rs.reduce((a, r) => a + r.w * r.h, 0)).toBeCloseTo(1000, 6);
  });
});

describe('Database — block layout and colour code', () => {
  const node = (name: string, size: number): DbNode => ({ name, path: name, dir: false, size, files: 1, mtime: 0 });
  test('every individually shown block is big enough to click; the rest fold into one block', async () => {
    const { layoutLevel } = await import('@/components/database/DatabaseExplorer');
    const items = [node('huge', 6_300_000_000), node('git', 567_000_000), ...Array.from({ length: 17 }, (_, i) => node(`small-${i}`, 1_000_000 - i * 1000))];
    const { blocks, shown } = layoutLevel(items, { x: 0, y: 0, w: 780, h: 600 });
    const individual = blocks.filter((b) => b.node);
    expect(individual.every((b) => b.w >= 76 && b.h >= 44)).toBe(true);
    const rest = blocks.find((b) => !b.node)!;
    expect(rest.restCount).toBe(items.length - shown);
    expect(rest.w).toBeGreaterThanOrEqual(76);
    expect(rest.h).toBeGreaterThanOrEqual(44);
  });
  test('the rest opens at its own scale: small items become clickable there', async () => {
    const { layoutLevel } = await import('@/components/database/DatabaseExplorer');
    const small = Array.from({ length: 17 }, (_, i) => node(`small-${i}`, 1_000_000 - i * 1000));
    const { blocks } = layoutLevel(small, { x: 0, y: 0, w: 780, h: 600 });
    expect(blocks.filter((b) => b.node).length).toBe(17);
  });
  test('content types', async () => {
    const { kindOf } = await import('@/components/database/DatabaseExplorer');
    expect(kindOf('a/notes.md', 'notes.md')).toBe('docs');
    expect(kindOf('r/s1.mp4', 's1.mp4')).toBe('video');
    expect(kindOf('.git/objects/pack/p.pack', 'p.pack')).toBe('system');
    expect(kindOf('x/data.csv', 'data.csv')).toBe('data');
    expect(kindOf('x/run.py', 'run.py')).toBe('code');
    expect(kindOf('x/mystery', 'mystery')).toBe('other');
  });
});
