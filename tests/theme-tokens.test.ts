import { describe, expect, test } from 'vitest';
import { THEMES } from '@/lib/theme';
import { BASE, classify, tokenMap, type Scope } from './helpers/theme-css';

/**
 * S06 T3 (and G9): every theme defines every token.
 *
 * For each token scope, U is the union of tokens any non-Console theme
 * overrides. Every non-Console theme must resolve each token in U through its
 * own block or a shared selector (`:root[data-theme='frost'],
 * :root[data-theme='grey-frost']`). A theme that misses one silently inherits
 * the Console value, which is how mint/teal leaks into the other colourways.
 * The only exceptions are listed below, each with its reason. A sixth theme
 * fails here until it defines the set, because THEMES is the loop variable.
 */

const SCOPES: Scope[] = [':root', '[data-adpilot]', '.ae-paper', 'paper-dark', '.ae-octane'];

type Allow = { themes: string[] | '*'; scope: Scope; tokens: string[] | '*'; reason: string };

const DARK_NEUTRAL_OCTANE = ['--o-chrome', '--o-veil', '--o-bevel-hi', '--o-bevel-lo', '--o-shadow-sm', '--o-shadow-node', '--o-shadow-node-hover', '--o-shadow-wf', '--o-shadow-wf-hi'];

const ALLOW: Allow[] = [
  { themes: '*', scope: ':root', tokens: ['--fc-token-bg', '--fc-token-line', '--fc-token-ink'], reason: 'amber is the warn family in every dark theme; only White re-keys it for paper contrast (S06 edge 15)' },
  { themes: '*', scope: ':root', tokens: ['--ae-dark-ground'], reason: 'White only: every other theme\'s dark paper falls back to its OS ground through --os-bg (S06 FR-a1, FR-a2)' },
  { themes: ['red', 'frost'], scope: ':root', tokens: ['--ib-w-lift', '--ib-w-lift-hi', '--cx-1', '--cx-2', '--cx-3'], reason: 'neutral black lift shadows are the base for black-ground themes; White and Grey Frost soften them for lighter grounds' },
  { themes: ['red'], scope: ':root', tokens: ['--glow', '--grid', '--shadow-pop'], reason: 'Red is matte like Console: no glow, no grid, neutral black popover shadow' },
  { themes: ['red'], scope: '[data-adpilot]', tokens: '*', reason: 'the base [data-adpilot] block IS the red family (S01 §5.1 Console/Red column)' },
  { themes: ['light'], scope: '.ae-paper', tokens: '*', reason: 'White wears the base light-paper hues; only Red and Frost re-key the paper signal' },
  { themes: ['red', 'light', 'frost'], scope: 'paper-dark', tokens: '*', reason: 'dark paper cards keep today\'s neutral values in Console, Red, White and Frost; only Grey Frost lifts them (S06 FR-a3)' },
  { themes: ['red'], scope: '.ae-octane', tokens: '*', reason: 'the base Motion console window is neutral black with a red signal; Red re-keys only its greens and purples' },
  { themes: ['light'], scope: '.ae-octane', tokens: ['--o-spectrum', '--o-chrome-red'], reason: 'the spectrum and red chrome swatches depict true colour and stay literal on White' },
  { themes: ['frost', 'grey-frost'], scope: '.ae-octane', tokens: DARK_NEUTRAL_OCTANE, reason: 'neutral silver chrome, black scrim, bevels and node shadows are the base for every dark window (S06 §5.5 "base value")' },
  { themes: ['frost'], scope: '.ae-octane', tokens: ['--o-shadow-pop', '--o-shadow-gate'], reason: 'Frost keeps the base black popover shadows; Grey Frost softens them on grey (S06 §5.5)' },
];

function allowed(theme: string, scope: Scope, token: string): boolean {
  return ALLOW.some((a) => a.scope === scope && (a.themes === '*' || a.themes.includes(theme)) && (a.tokens === '*' || a.tokens.includes(token)));
}

const MAP = tokenMap();
const COLOURWAYS = THEMES.filter((t) => t !== 'console');

describe('every theme defines every token (S06 T3)', () => {
  for (const scope of SCOPES) {
    const byTheme = MAP.get(scope);
    test(`${scope} scope is parsed`, () => {
      expect(byTheme?.get(BASE)?.size ?? 0, `${scope} base tokens`).toBeGreaterThan(0);
    });
    const U = new Set<string>();
    for (const t of COLOURWAYS) for (const k of byTheme?.get(t)?.keys() ?? []) U.add(k);
    test.each([...COLOURWAYS])(`%s resolves every ${scope} token another theme overrides`, (t) => {
      const own = byTheme?.get(t) ?? new Map();
      const missing = [...U].filter((k) => !own.has(k) && !allowed(t, scope, k));
      expect(missing, `${t} falls through to Console for these ${scope} tokens`).toEqual([]);
    });
  }

  test('Grey Frost needs no exception Frost does not also have (Frost signal + grey ground)', () => {
    for (const a of ALLOW) {
      if (a.themes === '*' || !a.themes.includes('grey-frost')) continue;
      expect(a.themes, a.reason).toContain('frost');
    }
  });

  test('no theme declares a token the base does not define (typo guard)', () => {
    const rootBase = MAP.get(':root')!.get(BASE)!;
    const typos: string[] = [];
    for (const scope of SCOPES) {
      const byTheme = MAP.get(scope)!;
      const base = byTheme.get(BASE) ?? new Map();
      for (const t of COLOURWAYS) {
        for (const k of byTheme.get(t)?.keys() ?? []) {
          if (base.has(k) || rootBase.has(k) || k === '--ae-dark-ground') continue;
          typos.push(`${t} ${scope} ${k}`);
        }
      }
    }
    expect(typos).toEqual([]);
  });

  test('every exception still names a real gap (stale entries are removed)', () => {
    for (const a of ALLOW) {
      if (a.tokens === '*') continue;
      const base = MAP.get(a.scope)!.get(BASE)!;
      const rootBase = MAP.get(':root')!.get(BASE)!;
      for (const k of a.tokens) expect(base.has(k) || rootBase.has(k) || k === '--ae-dark-ground', `${a.scope} ${k}`).toBe(true);
    }
  });

  /**
   * G9: the token families this project adds or relies on, so a lane that
   * adds a family without theme values is caught. A family listed here must
   * be overridden by at least one colourway (otherwise it is theme
   * independent and belongs nowhere near this list).
   */
  const FAMILIES: [Scope, string][] = [
    [':root', '--glass-'],
    [':root', '--wf-'],
    [':root', '--h6-'],
    [':root', '--gbr-'],
    [':root', '--kg-'],
    [':root', '--life-'],
    [':root', '--bh-'],
    [':root', '--ib-src-'],
    [':root', '--ib-w-'],
    [':root', '--cx-'],
    [':root', '--fc-'],
    [':root', '--adpilot-'],
    [':root', '--viz-'],
    ['[data-adpilot]', '--ap-'],
    ['.ae-paper', '--p-'],
    ['paper-dark', '--p-'],
    ['.ae-octane', '--o-'],
  ];
  test.each(FAMILIES)('%s %s family is themed', (scope, prefix) => {
    const byTheme = MAP.get(scope)!;
    const themed = COLOURWAYS.some((t) => [...(byTheme.get(t)?.keys() ?? [])].some((k) => k.startsWith(prefix)));
    expect(themed).toBe(true);
  });
});

describe('paper-dark scope follows the app mode on <html> (glados-ui S00 FR-9, C10)', () => {
  test('the dark paper selectors are :root[data-mode] scopes, not a per-element data-mode', () => {
    expect(classify(":where(:root[data-mode='dark']) .ae-paper")).toEqual({ theme: BASE, scope: 'paper-dark' });
    expect(classify(":where(:root:not([data-mode]):not([data-theme='light'])) .ae-paper")).toEqual({ theme: BASE, scope: 'paper-dark' });
    expect(classify(":root[data-theme='grey-frost'][data-mode='dark'] .ae-paper")).toEqual({ theme: 'grey-frost', scope: 'paper-dark' });
    expect(classify(":root[data-theme='grey-frost']:not([data-mode]) .ae-paper")).toEqual({ theme: 'grey-frost', scope: 'paper-dark' });
    // The retired Auto and per-element forms no longer count as dark paper.
    expect(classify(".ae-paper[data-mode='dark']")).toBeNull();
    expect(classify("[data-mode='auto'] .ae-paper")).toBeNull();
    // Light mode is the base paper, never the dark scope.
    expect(classify(":where(:root[data-mode='light']) .ae-paper")).toEqual({ theme: BASE, scope: '.ae-paper' });
  });

  test('the parsed dark paper base comes from the :root[data-mode] rule', () => {
    expect(MAP.get('paper-dark')!.get(BASE)!.get('--p-card')).toBe('#17171a');
  });
});
