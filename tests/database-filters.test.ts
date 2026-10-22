import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = readFileSync(join(process.cwd(), 'components/database/DatabaseExplorer.tsx'), 'utf8');

/**
 * GladOS UI H38 (S05 F05.21, AC05.8): the Brain Files kind chips are real
 * filters. A click pins the kind (aria-pressed), dims every block without it
 * and filters the breakdown list; hover only previews. Behaviour is checked in
 * the browser by the lane's Playwright run; this pins the wiring.
 */
describe('/database kind chips are real filters (H38)', () => {
  test('chips are toggle buttons with aria-pressed bound to the pinned kind', () => {
    expect(SRC).toMatch(/aria-pressed=\{pinned === k\.id\}/);
    expect(SRC).toMatch(/onClick=\{\(\) => \{ setPinned\(\(h\) => \(h === k\.id \? null : k\.id\)\)/);
  });

  test('leaving or blurring a chip clears only the preview, never the pinned filter', () => {
    expect(SRC).toMatch(/onMouseLeave=\{\(\) => setPeek\(null\)\}/);
    expect(SRC).toMatch(/onBlur=\{\(\) => setPeek\(null\)\}/);
    expect(SRC).not.toMatch(/setHl\(/);
    expect(SRC).toMatch(/const hl = peek \?\? pinned;/);
  });

  test('blocks without the kind dim, and the breakdown list keeps only items with it', () => {
    expect(SRC).toMatch(/const lit = \(m: Mix \| undefined\) => !hl \|\| !m \|\| m\[hl\] > 0;/);
    expect(SRC).toMatch(/opacity: dim \? 0\.28 : 1/);
    expect(SRC).toMatch(/const listItems = pinned \? viewItems\.filter/);
    expect(SRC).toMatch(/\{listItems\.map\(/);
    // the pinned chip stays visible (to clear it) even where the kind is absent
    expect(SRC).toMatch(/viewMix\[k\.id\] > 0 \|\| k\.id === pinned/);
    expect(SRC).toMatch(/onClick=\{\(\) => setPinned\(null\)\}[^>]*>Clear</);
  });
});
