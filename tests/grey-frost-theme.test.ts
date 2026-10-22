import { describe, expect, test } from 'vitest';
import { THEMES } from '@/lib/theme';
import { BASE, CSS_NO_COMMENTS, contrast, resolveColour, tokenMap, topLevelRules } from './helpers/theme-css';

/**
 * S06 T4 + T5: Grey Frost = Frost signal + grey ground.
 * The theme shares every Frost selector and overrides only ground, surface,
 * line, ink and shadow (SPEC S06 §5.1, §5.2); its text meets AA (§5.7).
 */

const RULES = topLevelRules();
const MAP = tokenMap(RULES);
const GF = ":root[data-theme='grey-frost']";
const FROST = ":root[data-theme='frost']";

/** Declarations Grey Frost makes on its own (not shared with Frost), per scope. */
function ownOnly(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of RULES) {
    const gf = r.selectors.filter((s) => s.startsWith(GF));
    if (!gf.length || r.selectors.some((s) => s.startsWith(FROST))) continue;
    for (const s of gf) {
      const rest = s.slice(GF.length).trim() || ':root';
      if (!out.has(rest)) out.set(rest, new Set());
      for (const m of r.body.matchAll(/(--[\w-]+)\s*:/g)) out.get(rest)!.add(m[1]);
    }
  }
  return out;
}

describe('Grey Frost theme (S06 T4)', () => {
  test('the root block declares the §5.2 ground family', () => {
    const want: Record<string, string> = {
      '--bg': '#18191d',
      '--bg-2': '#131417',
      '--surface': '#1f2126',
      '--surface-2': '#272a30',
      '--surface-3': '#30333a',
      '--elevated': '#22242a',
      '--elevated-border': '#3d414b',
      '--border': '#2c2f36',
      '--border-strong': '#3d414b',
      '--hairline': '#23252b',
      '--text': '#ecf2fa',
      '--text-2': '#a8b2c1',
      '--text-3': '#8b94a3',
      '--accent': '#9fc6ff',
      '--ok': '#6ee7ff',
      '--warn': '#ffd166',
      '--err': '#ff6b78',
      '--glow': '0 0 24px -6px rgba(120, 180, 255, 0.42)',
    };
    for (const [k, v] of Object.entries(want)) expect(MAP.get(':root')!.get('grey-frost')!.get(k), k).toBe(v);
  });

  test('the signal is Frost: accent, status and data hues resolve to the Frost values', () => {
    for (const k of ['--accent', '--accent-2', '--accent-rgb', '--ok', '--warn', '--ramp-1', '--ramp-3', '--brain-1', '--wf-on-a', '--fc-hero-a', '--bh-k-operator', '--ib-src-email', '--life-finances']) {
      expect(MAP.get(':root')!.get('grey-frost')!.get(k), k).toBe(MAP.get(':root')!.get('frost')!.get(k));
    }
  });

  test('its own blocks carry no green hex', () => {
    const own = RULES.filter((r) => r.selectors.some((s) => s.startsWith(GF))).map((r) => r.body).join('\n');
    expect(own).not.toMatch(/#(00ffab|3fd968|06c98a|0a7a58|00ac7c|4dffc4|23a94d|5fd3a2|7dffd4)/i);
  });

  test('every Frost selector is paired with grey-frost in the same rule', () => {
    const frostSel = RULES.flatMap((r) => r.selectors.filter((s) => s.startsWith(FROST)).map((s) => ({ s, r })));
    expect(frostSel.length).toBeGreaterThanOrEqual(22);
    for (const { s, r } of frostSel) expect(r.selectors, s).toContain(s.replace(FROST, GF));
  });

  test('own grey-frost blocks only move ground, surface, line, ink and shadow', () => {
    // Anything else (accent, status, data hues) must come from the shared Frost selector.
    const SIGNAL = /^--(accent(-2|-ink|-soft|-line|-rgb)?|ok|warn|ramp-\d|brain-[123]|life-|ib-src-|bh-k-|fc-(hero|meter|dots|line|cap|prompt)|wf-(on|hue|primary|human)|p-(green|lime|pink|orange)|o-(red|green|pink|check|blue|purple|yellow|cyan|lime|wire|node-[1-6]|spectrum|chrome-red|mark))/;
    const offenders: string[] = [];
    for (const [scope, tokens] of ownOnly()) for (const k of tokens) if (SIGNAL.test(k)) offenders.push(`${scope} ${k}`);
    expect(offenders).toEqual([]);
  });

  test('no Phase 1b stub copy is left (the theme is pairs + ground blocks only)', () => {
    expect(CSS_NO_COMMENTS).not.toMatch(/grey-frost registry stub/);
    const gfRootBlocks = RULES.filter((r) => r.selectors.length === 1 && r.selectors[0] === GF);
    for (const r of gfRootBlocks) expect(r.body, 'a grey-frost-only root block re-declaring the Frost accent').not.toMatch(/--accent:/);
  });

  test('--os-bg is declared on :root only', () => {
    const decl = RULES.filter((r) => /--os-bg\s*:/.test(r.body));
    expect(decl.map((r) => r.selectors)).toEqual([[':root']]);
  });

  test('AdPilot ground follows the OS ground under Grey Frost', () => {
    expect(MAP.get('[data-adpilot]')!.get('grey-frost')!.get('--ap-ground')).toBe('var(--os-bg)');
  });

  test('dark paper ground is the OS grey; cards sit one step above it (§5.4)', () => {
    const dark = MAP.get('paper-dark')!;
    expect(dark.get(BASE)!.get('--p-bg')).toBe('var(--ae-dark-ground, var(--os-bg))');
    expect(dark.get('grey-frost')!.get('--p-card')).toBe('#222429');
    expect(dark.get('grey-frost')!.get('--p-card-2')).toBe('#2a2d33');
  });

  test('Motion console window is grey under Grey Frost (§5.5)', () => {
    const o = MAP.get('.ae-octane')!.get('grey-frost')!;
    expect(o.get('--o-window')).toBe('#18191d');
    expect(o.get('--o-panel')).toBe('#1f2126');
  });
});

describe('text contrast (S06 T5, FR-b8)', () => {
  const INK = ['--text', '--text-2', '--text-3'];
  const GROUNDS = ['--bg', '--bg-2', '--surface', '--surface-2', '--elevated'];

  test.each(INK)('Grey Frost %s is at least 4.5:1 on every ground and surface', (ink) => {
    for (const g of GROUNDS) {
      const fg = resolveColour(MAP, 'grey-frost', ink)!;
      const bg = resolveColour(MAP, 'grey-frost', g)!;
      expect(contrast(fg, bg), `${ink} ${fg} on ${g} ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('Grey Frost paper ink is at least 4.5:1 on the dark paper cards', () => {
    const p = MAP.get('paper-dark')!.get('grey-frost')!;
    for (const ink of ['--p-ink', '--p-muted']) for (const card of ['--p-card', '--p-card-2']) expect(contrast(p.get(ink)!, p.get(card)!), `${ink} on ${card}`).toBeGreaterThanOrEqual(4.5);
  });

  test('Grey Frost status ink and the accent read on the ground', () => {
    for (const k of ['--accent', '--ok', '--warn', '--err', '--glass-label']) {
      expect(contrast(resolveColour(MAP, 'grey-frost', k)!, '#18191d'), k).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('report the other themes (visible, not blocking: Console --text-3 is 3.5:1 today)', () => {
    const rows: string[] = [];
    for (const t of THEMES.filter((x) => x !== 'grey-frost')) {
      for (const ink of INK) {
        const fg = resolveColour(MAP, t === 'console' ? BASE : t, ink);
        const vals = GROUNDS.map((g) => {
          const bg = resolveColour(MAP, t === 'console' ? BASE : t, g);
          return fg && bg && /^#[0-9a-f]{6}$/i.test(fg) && /^#[0-9a-f]{6}$/i.test(bg) ? contrast(fg, bg).toFixed(2) : '-';
        });
        rows.push(`${t} ${ink}: ${vals.join(' ')}`);
      }
    }
    console.info('contrast (bg bg-2 surface surface-2 elevated)\n' + rows.join('\n'));
    expect(rows.length).toBe((THEMES.length - 1) * INK.length);
  });
});
