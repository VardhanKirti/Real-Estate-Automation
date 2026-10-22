import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME, THEMES, THEME_META, THEME_STORAGE_KEY, isTheme, nextTheme, resolveInitialTheme } from '@/lib/theme';
import { APPEARANCE_INIT_SCRIPT } from '@/lib/appearance';

describe('theme registry — Console default; Red, White, Frost and Grey Frost the sanctioned colorways', () => {
  test('console stays the default; the five colorways are registered in picker order', () => {
    expect(DEFAULT_THEME).toBe('console');
    expect(THEMES).toEqual(['console', 'red', 'light', 'frost', 'grey-frost']);
    expect(THEME_STORAGE_KEY).toBe('glados-theme');
  });

  test('every theme carries picker metadata: name, blurb, 3 swatch colors', () => {
    for (const t of THEMES) {
      const meta = THEME_META[t];
      expect(meta.name.length, t).toBeGreaterThan(0);
      expect(meta.blurb.length, t).toBeGreaterThan(0);
      expect(meta.swatch).toHaveLength(3);
      for (const c of meta.swatch) expect(c, `${t} swatch`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test('isTheme guards arbitrary strings — retired ids are no longer valid', () => {
    expect(isTheme('console')).toBe(true);
    expect(isTheme('red')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('frost')).toBe(true);
    expect(isTheme('grey-frost')).toBe(true);
    expect(isTheme('grey')).toBe(false);
    expect(isTheme('mono')).toBe(false);
    expect(isTheme('glados-glass')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  test('resolveInitialTheme falls back to console for stale stored ids', () => {
    expect(resolveInitialTheme('console')).toBe('console');
    expect(resolveInitialTheme('red')).toBe('red');
    expect(resolveInitialTheme('grey-frost')).toBe('grey-frost');
    expect(resolveInitialTheme('glados-glass')).toBe('console');
    expect(resolveInitialTheme('mono')).toBe('console');
    expect(resolveInitialTheme(null)).toBe('console');
  });

  test('nextTheme cycles the ring', () => {
    expect(nextTheme('console')).toBe('red');
    expect(nextTheme('red')).toBe('light');
    expect(nextTheme('light')).toBe('frost');
    expect(nextTheme('frost')).toBe('grey-frost');
    expect(nextTheme('grey-frost')).toBe('console');
  });

  test('the pre-paint init script (lib/appearance.ts) reads the theme key and falls back to console', () => {
    expect(APPEARANCE_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(APPEARANCE_INIT_SCRIPT).toContain(`DT="console"`);
  });

  test('the pre-paint init script accepts every registered id, grey-frost included', () => {
    for (const t of THEMES) expect(APPEARANCE_INIT_SCRIPT).toContain(JSON.stringify(t));
    expect(APPEARANCE_INIT_SCRIPT).toContain('"grey-frost"');
  });

  test('Grey Frost carries the S06 picker entry', () => {
    expect(THEME_META['grey-frost'].name).toBe('Grey Frost');
    expect(THEME_META['grey-frost'].blurb).toBe("Frost's ice ink, signal and glow on a soft grey ground");
    expect(THEME_META['grey-frost'].swatch).toEqual(['#18191d', '#9fc6ff', '#ecf2fa']);
  });

  test('globals.css groups the bare :root with console, so no-JS loads render Console', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    expect(css).toMatch(/:root,\s*\n:root\[data-theme='console'\]/);
  });

  test('no retired theme token blocks survive in globals.css', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    for (const dead of ['mono', 'mono-light', 'glados', 'glados-glass', 'midnight', 'ember']) {
      expect(css, dead).not.toContain(`data-theme='${dead}'`);
    }
  });

  test('console carries the four-step data ramp', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    for (const v of ['--ramp-1', '--ramp-2', '--ramp-3', '--ramp-4']) expect(css).toContain(v);
  });
});
