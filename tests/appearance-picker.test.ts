import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { AppearancePicker } from '@/components/AppearancePicker';
import { ACCENT_IDS, APPEARANCE_COOKIE, STORAGE_KEYS, writeAppearance, type Appearance } from '@/lib/appearance';
import { THEME_STORAGE_KEY, THEMES } from '@/lib/theme';
import { G_ROLLOUT_ROUTES, rolloutLine, rolloutProgress } from '@/lib/g-rollout';
import { AUDIT_ROUTES } from '../scripts/audit-routes.mjs';
import { CSS_NO_COMMENTS, declarations, topLevelRules } from './helpers/theme-css';
import { gCascade } from './helpers/g-colour';
import { renderWithRouter } from './helpers/render-client';

/**
 * Settings → Appearance (glados-ui SPEC S00 FR-13, C14, S05 F05.91; AC00.4,
 * AC00.5, AC00.21). The brand label is covered by tests/g-brand.test.ts.
 */

const render = (stored: Appearance) =>
  renderWithRouter(createElement(AppearancePicker, { initial: stored, rollout: { ready: 0, total: G_ROLLOUT_ROUTES.length } }));

/** The radiogroup named `label` and the radios inside it. */
function group(html: string, label: string): { found: boolean; radios: string[]; checked: string[] } {
  const start = html.search(new RegExp(`role="radiogroup"[^>]*aria-label(?:ledby)?="${label}"`));
  if (start < 0) return { found: false, radios: [], checked: [] };
  const rest = html.slice(start);
  const end = rest.search(/<\/div>/);
  const body = rest.slice(0, end);
  const radios = [...body.matchAll(/role="radio"[^>]*?(?:aria-label="([^"]*)"[^>]*)?>([^<]*)</g)].map((m) => m[1] ?? m[2]);
  const checked = [...body.matchAll(/role="radio" aria-checked="true"[^>]*?(?:aria-label="([^"]*)"[^>]*)?>([^<]*)</g)].map((m) => m[1] ?? m[2]);
  return { found: true, radios, checked };
}

describe('AppearancePicker (AC00.5, AC00.21)', () => {
  it('new style: Style, Colour (4 swatches) and Mode (Dark, Light, System), in that order', () => {
    const html = render({ ui: 'glados', accent: 'ember', mode: 'system' });
    const style = group(html, 'Style');
    const colour = group(html, 'appset-colour-label');
    const mode = group(html, 'Mode');
    expect(style.found && colour.found && mode.found).toBe(true);
    expect(colour.radios).toEqual(['Ice', 'Lime', 'Ember', 'Mint']);
    expect(colour.checked).toEqual(['Ember']);
    expect(mode.radios).toEqual(['Dark', 'Light', 'System']);
    expect(mode.checked).toEqual(['System']);
    expect(html.indexOf('aria-label="Style"')).toBeLessThan(html.indexOf('appset-colour-label'));
    expect(html.indexOf('appset-colour-label')).toBeLessThan(html.indexOf('aria-label="Mode"'));
    // System states what it follows; the rollout line is honest about coverage.
    expect(html).toContain('following your OS:');
    expect(html).toContain(`0 of ${G_ROLLOUT_ROUTES.length} pages use the new widgets`);
    expect(html).toContain('Saved on this browser.');
    expect(html).not.toContain('data-theme-id');
  });

  it('each swatch is filled with its own accent token', () => {
    const html = render({ ui: 'glados', accent: 'ice', mode: 'dark' });
    for (const id of ACCENT_IDS) expect(html).toContain(`background:var(--g-swatch-${id})`);
  });

  it('Classic: Style and the five Classic theme cards, no Mode control', () => {
    const html = render({ ui: 'classic', accent: 'ice', mode: 'dark' });
    expect(group(html, 'Style').checked).toEqual(['Classic']);
    expect(group(html, 'Mode').found).toBe(false);
    expect(group(html, 'appset-colour-label').found).toBe(false);
    expect([...html.matchAll(/data-theme-id="([\w-]+)"/g)].map((m) => m[1])).toEqual([...THEMES]);
    expect(html).not.toContain('pages use the new widgets');
  });

  it('every group is a keyboard radiogroup: one tab stop, checked state exposed', () => {
    const html = render({ ui: 'glados', accent: 'lime', mode: 'light' });
    const stops = [...html.matchAll(/role="radio" aria-checked="(true|false)"[^>]*tabindex="(-?\d)"/g)];
    expect(stops.length).toBe(3 + 4 + 3);
    for (const [, checked, tab] of stops) expect(tab).toBe(checked === 'true' ? '0' : '-1');
  });
});

describe('swatch tokens equal each accent\'s hero-a gradient', () => {
  const block = topLevelRules(CSS_NO_COMMENTS).find(
    (r) => r.selectors.length === 1 && r.selectors[0] === ":root[data-ui='glados']" && /--g-swatch-/.test(r.body),
  );
  const decl = new Map(declarations(block?.body ?? ''));
  for (const id of ACCENT_IDS) {
    it(`--g-swatch-${id} = ${id} --g-hero-a`, () => {
      expect(decl.get(`--g-swatch-${id}`)).toBe(gCascade(id, 'dark').get('--g-hero-a'));
    });
  }
});

describe('rollout line (FR-13, edge 8)', () => {
  it('counts every audited page once', () => {
    expect([...G_ROLLOUT_ROUTES].sort()).toEqual([...new Set(AUDIT_ROUTES.map((r: string) => r.split('?')[0]))].sort());
  });
  it('counts only converted pages of the rollout', () => {
    expect(rolloutProgress([])).toEqual({ ready: 0, total: G_ROLLOUT_ROUTES.length });
    expect(rolloutProgress(['/creative-engine', '/nowhere'])).toEqual({ ready: 1, total: G_ROLLOUT_ROUTES.length });
    expect(rolloutLine({ ready: 3, total: 27 })).toBe('3 of 27 pages use the new widgets; the rest keep Classic widgets in your colours.');
    expect(rolloutLine({ ready: 27, total: 27 })).toBeNull();
  });
});

/** writeAppearance on a fake browser: cookie, storage mirror and <html> attributes. */
function fakeBrowser(store: Record<string, string>) {
  const attrs: Record<string, string> = {};
  const doc = { cookie: '', documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), getAttribute: (k: string) => attrs[k] ?? null } };
  const ls = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  return { attrs, doc };
}

describe('switching style keeps both sides (AC00.4)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('new style then back to Classic restores the stored Classic theme', () => {
    const store: Record<string, string> = { [THEME_STORAGE_KEY]: 'frost' };
    const { attrs, doc } = fakeBrowser(store);
    writeAppearance({ ui: 'glados', accent: 'ember', mode: 'light' });
    expect(attrs).toMatchObject({ 'data-ui': 'glados', 'data-accent': 'ember', 'data-mode': 'light', 'data-theme': 'light' });
    expect(doc.cookie).toContain(`${APPEARANCE_COOKIE}=glados.ember.light`);
    writeAppearance({ ui: 'classic', accent: 'ember', mode: 'light' });
    expect(attrs).toMatchObject({ 'data-ui': 'classic', 'data-theme': 'frost', 'data-mode': 'dark' });
    expect(store[THEME_STORAGE_KEY]).toBe('frost');
    // The new style's own choices survive the trip too.
    expect(store[STORAGE_KEYS.accent]).toBe('ember');
    expect(store[STORAGE_KEYS.mode]).toBe('light');
  });
});
