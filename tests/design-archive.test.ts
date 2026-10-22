import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const at = (p: string) => join(process.cwd(), p);
const read = (p: string) => readFileSync(at(p), 'utf8');

const ROUTES = ['console', 'gbrain', 'gbrain-2', 'gbrain-3', 'home-6'];
const EXCLUSIVE = ['GBrainObservatory', 'GBrainObservatoryLazy', 'GBrainCore3D', 'GBrainCore3DLazy', 'GBrainVariantSwitch'];

/**
 * GladOS UI H36 / S05 F05.110 / AC05.19: the five /design/* prototype routes
 * are archived, not served. No page file under app/design means Next answers
 * 404 for every one of them.
 */
describe('/design/* prototypes are archived (H36)', () => {
  test('no route file is left under app/design', () => {
    expect(existsSync(at('app/design'))).toBe(false);
  });

  test.each(ROUTES)('archive keeps /design/%s with restore notes', (r) => {
    expect(existsSync(at(`archive/design-prototypes/${r}/page.tsx`))).toBe(true);
  });

  test.each(EXCLUSIVE)('%s moved with the routes and nothing live imports it', (c) => {
    expect(existsSync(at(`components/${c}.tsx`))).toBe(false);
    expect(existsSync(at(`archive/design-prototypes/components/${c}.tsx`))).toBe(true);
  });

  test('README lists restore steps and names no person or venture', () => {
    const readme = read('archive/design-prototypes/README.md');
    expect(readme).toMatch(/## To restore/);
    expect(readme).not.toMatch(/Brody|Merydian|Exosoft/i);
  });

  test('Home still renders Home6Console', () => {
    expect(read('app/page.tsx')).toMatch(/<Home6Console \/>/);
    expect(existsSync(at('components/Home6Console.tsx'))).toBe(true);
  });
});
