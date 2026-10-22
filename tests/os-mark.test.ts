import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Branding : the sidebar and the icon rail brand with the
 * GladOS flag mark (the glyph cropped from the GladOS lockup, white on
 * transparent) served from /public via next/image. The glow is CSS
 * (.os-mark), never baked into the asset. The 2026-08-13 wordmark raster and
 * the maintainer's ring-S OsMark are retired.
 */
describe('branding', () => {
  test('the one sidebar DOM (every width) brands with the deployment\'s mark via next/image', () => {
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar.split('src={brand.mark}').length - 1).toBe(1);
    expect(sidebar).toContain("import Image from 'next/image'");
    expect(sidebar).not.toContain('glados-wordmark');
    expect(sidebar).not.toContain('os-rail-mark');
    expect(sidebar).not.toContain('GLADOS');
    expect(sidebar).not.toContain('OsMark');
  });

  test('the mark asset ships with the app and the glow lives in CSS', () => {
    expect(existsSync(join(process.cwd(), 'public/brand/glados-mark.png'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'public/brand/founderos-mark.png'))).toBe(true);
    const css = read('app/globals.css');
    expect(css).toContain('.os-mark {');
    expect(css).toMatch(/\.os-mark \{[^}]*drop-shadow/);
    expect(css).not.toContain('.os-rail-mark');
  });

  test('the retired ring mark is fully gone', () => {
    expect(existsSync(join(process.cwd(), 'components/OsMark.tsx'))).toBe(false);
  });
});

describe('brand per deployment', () => {
  test('unset shows the client product; glados shows the operator\'s own', async () => {
    const { brandFor } = await import('@/lib/brand');
    expect(brandFor(undefined).name).toBe('FounderOS');
    expect(brandFor('').mark).toBe('/brand/founderos-mark.png');
    expect(brandFor(' GladOS ').name).toBe('GladOS');
    expect(brandFor('glados').mark).toBe('/brand/glados-mark.png');
  });
});
