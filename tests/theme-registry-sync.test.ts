import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { THEMES, THEME_META, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';
import { APPEARANCE_INIT_SCRIPT, DEFAULT_APPEARANCE, defaultAppearanceFor, resolveAppearance } from '@/lib/appearance';
import { paletteFor } from '@/lib/use-palette';
import { LIFE_AREA_MAPS } from '@/components/KnowledgeGraph';

/**
 * S06 T2: the theme registry (lib/theme.ts) and everything keyed by theme id
 * must move together. A theme missing from any of these silently falls back to
 * Console values (mint charts, teal life areas): the "green leak".
 */

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Top-level rules as { selectors, body }; nested at-rule bodies are skipped. */
function topLevelRules(src: string): { selectors: string[]; body: string }[] {
  const out: { selectors: string[]; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        const head = src.slice(start, open).trim();
        if (!head.startsWith('@')) out.push({ selectors: head.split(',').map((s) => s.trim()), body: src.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

const RULES = topLevelRules(css);

/** The --bg a theme's root token set resolves to: the last root-level declaration wins, as in the cascade. */
function rootBg(theme: Theme): string | null {
  const own = `:root[data-theme='${theme}']`;
  let bg: string | null = null;
  for (const r of RULES) {
    if (!r.selectors.includes(own)) continue;
    const m = [...r.body.matchAll(/(?:^|[;{\s])--bg:\s*([^;]+);/g)];
    if (m.length) bg = m[m.length - 1][1].trim().toLowerCase();
  }
  return bg;
}

describe('theme registry sync (S06 T2)', () => {
  const colourways = THEMES.filter((t) => t !== 'console');

  test.each(colourways)('%s has a token block in globals.css', (t) => {
    expect(css).toContain(`data-theme='${t}'`);
    expect(rootBg(t), `${t} root --bg`).toMatch(/^#[0-9a-f]{6}$/);
  });

  test.each([...THEMES])('%s has its own JS palette (no silent Console fallback)', (t) => {
    expect(paletteFor(t).name).toBe(t);
  });

  test.each(colourways)('%s has a life-area colour map', (t) => {
    expect(LIFE_AREA_MAPS).toHaveProperty(t);
  });

  test.each(colourways)('%s picker swatch ground equals its --bg', (t) => {
    expect(THEME_META[t].swatch[0].toLowerCase()).toBe(rootBg(t));
  });

  test('console swatch ground equals the base --bg', () => {
    const base = RULES.find((r) => r.selectors.includes(":root[data-theme='console']"));
    const m = base?.body.match(/--bg:\s*([^;]+);/);
    expect(THEME_META.console.swatch[0].toLowerCase()).toBe(m?.[1].trim().toLowerCase());
  });

  test('Grey Frost shares the Frost signal: palette and life areas', () => {
    const gf = paletteFor('grey-frost');
    const frost = paletteFor('frost');
    expect(gf.series).toEqual(frost.series);
    expect(gf.series[0]).toBe('#9fc6ff');
    expect(gf.channels).toEqual(frost.channels);
    expect(gf.pearls).toEqual(frost.pearls);
    expect(gf.observatory).toEqual(frost.observatory);
    expect(gf.glow).toBe('rgba(120, 180, 255, 0.07)');
    expect(LIFE_AREA_MAPS['grey-frost']).toEqual(LIFE_AREA_MAPS.frost);
  });

  test('every Frost-scoped rule has a Grey Frost twin, so the theme never falls back to Console', () => {
    const frostSel = RULES.flatMap((r) => r.selectors).filter((s) => s.includes("data-theme='frost'"));
    const all = new Set(RULES.flatMap((r) => r.selectors));
    expect(frostSel.length).toBeGreaterThan(0);
    for (const s of frostSel) expect(all.has(s.replace("data-theme='frost'", "data-theme='grey-frost'")), s).toBe(true);
  });
});

describe('pre-paint init script (runs the generated string, Classic style)', () => {
  function run(stored: string | null, throws = false): string | null {
    const attrs: Record<string, string> = {};
    const localStorage = {
      getItem: (k: string) => {
        if (throws) throw new Error('blocked');
        return k === THEME_STORAGE_KEY ? stored : null;
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const document = { cookie: '', documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), getAttribute: (k: string) => attrs[k] ?? null } };
    const window = { matchMedia: () => ({ matches: false }) };
    new Function('localStorage', 'document', 'window', 'location', APPEARANCE_INIT_SCRIPT)(localStorage, document, window, { search: '' });
    return attrs['data-theme'] ?? null;
  }

  test.each([...THEMES])('stored %s is applied before paint', (t) => {
    expect(run(t)).toBe(t);
  });

  test("stale, missing or blocked storage is a fresh install: this build's default (FR-7, T1) and its theme", () => {
    // glados-private: glados · ice · dark derives Grey Frost; the client build (tests run as it) opens Bennett Legacy · Monolith
    expect(resolveAppearance(defaultAppearanceFor('glados')).theme).toBe('grey-frost');
    expect(resolveAppearance(defaultAppearanceFor('founderos')).theme).toBe('monolith');
    const fresh = resolveAppearance(DEFAULT_APPEARANCE).theme;
    expect(run('grey')).toBe(fresh);
    expect(run(null)).toBe(fresh);
    expect(run('grey-frost', true)).toBe(fresh);
  });
});
