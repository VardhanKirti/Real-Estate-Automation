import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { THEMES } from '@/lib/theme';
import { paletteFor, paletteForAppearance } from '@/lib/use-palette';

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

describe('paletteForAppearance (FR-12)', () => {
  test('Classic: the theme palette', () => {
    for (const t of THEMES) expect(paletteForAppearance({ ui: 'classic', theme: t })).toEqual(paletteFor(t));
  });

  test('new style: series from --g-series-1..6, the rest from the derived theme', () => {
    const vars: Record<string, string> = { '--g-series-1': ' #111111', '--g-series-2': '#222222', '--g-series-3': '#333333' };
    const p = paletteForAppearance({ ui: 'glados', theme: 'grey-frost' }, (n) => vars[n] ?? '');
    expect(p.series).toEqual(['#111111', '#222222', '#333333']);
    expect(p.channels).toEqual(paletteFor('grey-frost').channels);
  });

  test('new style before its tokens exist: the derived theme palette, nothing invented', () => {
    expect(paletteForAppearance({ ui: 'glados', theme: 'red' }, () => '')).toEqual(paletteFor('red'));
  });
});

describe('usePalette observes appearance through X3', () => {
  test('usePalette is built on onAppearanceChange, not its own observer (FR-12, C29)', () => {
    const src = read('lib/use-palette.ts');
    expect(src).toMatch(/onAppearanceChange\(/);
    expect(src).not.toMatch(/new MutationObserver/);
  });
});
