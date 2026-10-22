import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { THEMES } from '@/lib/theme';

/**
 * AdPilot token contract (SPEC S01 §5.1, §9 AC01.1-AC01.4) and the shell
 * chrome accent (SPEC G1, S09 FR-18, §5 C15/C17/C32). Static checks over
 * app/globals.css and the components; the computed values are verified in
 * the browser by the screenshot pass.
 */

const root = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('app/globals.css');

type Rule = { selectors: string[]; body: string };

/** Innermost `selector { body }` rules, comments stripped, selectors normalised. */
function parseRules(src: string): Rule[] {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const stack: number[] = [];
  let lastEnd = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      stack.push(i);
    } else if (c === '}') {
      const open = stack.pop();
      if (open === undefined) continue;
      const body = text.slice(open + 1, i);
      if (!body.includes('{')) {
        const before = text.slice(0, open);
        const start = Math.max(before.lastIndexOf('}'), before.lastIndexOf('{'), before.lastIndexOf(';'), lastEnd - 1) + 1;
        const head = before.slice(start).trim();
        if (head && !head.startsWith('@')) {
          rules.push({ selectors: head.split(',').map((s) => s.replace(/\s+/g, ' ').trim()), body });
        }
      }
      lastEnd = i + 1;
    }
  }
  return rules;
}

const rules = parseRules(css);
const propsOf = (body: string) => new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const propsFor = (selector: string) => {
  const out = new Set<string>();
  for (const r of rules) if (r.selectors.includes(selector)) for (const p of propsOf(r.body)) out.add(p);
  return out;
};
const valueFor = (selector: string, prop: string) => {
  let v: string | undefined;
  for (const r of rules) {
    if (!r.selectors.includes(selector)) continue;
    const m = r.body.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
    if (m) v = m[1].trim();
  }
  return v;
};

const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/;
const BASE = '[data-adpilot]';
const themeSel = (t: string) => `:root[data-theme='${t}'] [data-adpilot]`;
// Console and Red run on the base block (AdPilot's own red).
const RED_FAMILY = new Set(['console', 'red']);

describe('AdPilot token contract (S01 §5.1)', () => {
  const base = propsFor(BASE);

  it('the base block declares the accent family and every --ap-* token', () => {
    for (const p of ['--accent', '--accent-2', '--accent-ink', '--accent-soft', '--accent-line', '--surface-2', '--hairline']) {
      expect(base.has(p), p).toBe(true);
    }
    for (const p of [
      '--ap-signal-rgb', '--ap-signal-2-rgb', '--ap-panel-bg', '--ap-panel-tint', '--ap-line', '--ap-line-strong',
      '--ap-track', '--ap-inset', '--ap-scrim', '--ap-bright-a', '--ap-bright-b', '--ap-bright-ink', '--ap-bright-ink-2',
      '--ap-ground', '--ap-dot', '--ap-error',
    ]) {
      expect(base.has(p), p).toBe(true);
    }
  });

  it('every theme (and the paired grey-frost selector) defines every token the base block defines', () => {
    const themes = new Set<string>([...THEMES, 'grey-frost']);
    for (const t of themes) {
      if (RED_FAMILY.has(t)) continue;
      const own = propsFor(themeSel(t));
      const missing = [...base].filter((p) => !own.has(p));
      expect(missing, `${t} is missing`).toEqual([]);
    }
  });

  it('the globe tokens are in the base block, so every theme must define them (S11 §5.1)', () => {
    for (const p of [
      '--ap-globe-rim-rgb', '--ap-globe-bleed-rgb', '--ap-globe-body', '--ap-globe-land-rgb',
      '--ap-pin', '--ap-pin-core', '--ap-pin-halo-rgb', '--ap-label-bg', '--ap-label-line',
    ]) {
      expect(base.has(p), p).toBe(true);
    }
  });

  it('globe rim: red in Console/Red and White, Frost blue in Frost and Grey Frost (Q-AP-5, Q-AP-6)', () => {
    expect(valueFor(BASE, '--ap-globe-rim-rgb')).toBe('255 52 72');
    expect(valueFor(themeSel('light'), '--ap-globe-rim-rgb')).toBe('207 37 55');
    expect(valueFor(themeSel('frost'), '--ap-globe-rim-rgb')).toBe('159 198 255');
    expect(valueFor(themeSel('grey-frost'), '--ap-globe-rim-rgb')).toBe('159 198 255');
    // White is a light globe, not a black disc on paper.
    expect(valueFor(themeSel('light'), '--ap-globe-body')).toBe('#eef0f3');
    expect(valueFor(themeSel('grey-frost'), '--ap-globe-body')).toBe('#15181d');
  });

  it('Frost and Grey Frost share one paired block (C17)', () => {
    const paired = rules.some((r) => r.selectors.includes(themeSel('frost')) && r.selectors.includes(themeSel('grey-frost')));
    expect(paired).toBe(true);
  });

  it('Frost inherits the theme accent instead of forcing red (AC01.1)', () => {
    for (const p of ['--accent', '--accent-2', '--accent-ink', '--accent-soft', '--accent-line', '--surface-2', '--hairline']) {
      expect(valueFor(themeSel('frost'), p), p).toBe('inherit');
    }
    expect(valueFor(themeSel('frost'), '--ap-signal-rgb')).toBe('159 198 255');
  });

  it('Console and Red keep the AdPilot red; White keeps a red on paper (AC01.2)', () => {
    expect(valueFor(BASE, '--accent')).toBe('#ff4557');
    expect(valueFor(BASE, '--ap-signal-rgb')).toBe('255 69 87');
    expect(valueFor(themeSel('light'), '--accent')).toBe('#cf2537');
    expect(valueFor(themeSel('light'), '--ap-signal-rgb')).toBe('255 69 87');
  });

  it('no .ap-* recipe holds a literal colour (AC01.4)', () => {
    const recipes = rules.filter((r) => r.selectors.some((s) => /\.ap-[a-z]/.test(s)));
    expect(recipes.length).toBeGreaterThanOrEqual(8);
    for (const r of recipes) {
      expect(LITERAL.test(r.body), `${r.selectors.join(', ')} { ${r.body.trim()} }`).toBe(false);
    }
  });

  it('the page no longer forces the red accent inline (R1)', () => {
    const page = read('app/adpilot/page.tsx');
    expect(page).not.toMatch(/RED_THEME/);
    expect(page).not.toMatch(/'--accent/);
  });
});

describe('AdPilot accent in the shell chrome (G1, S09 FR-18)', () => {
  const TOKENS = ['--adpilot-accent', '--adpilot-accent-soft', '--adpilot-accent-line', '--adpilot-border'];
  const rootSel = (t: string) => `:root[data-theme='${t}']`;

  it('every theme and the grey-frost pair define the --adpilot-* tokens (FR-G1.1)', () => {
    for (const t of new Set<string>([...THEMES, 'grey-frost'])) {
      const own = propsFor(rootSel(t));
      for (const p of TOKENS) expect(own.has(p), `${t} ${p}`).toBe(true);
    }
    const paired = rules.some((r) => r.selectors.includes(rootSel('frost')) && r.selectors.includes(rootSel('grey-frost')) && propsOf(r.body).has('--adpilot-accent'));
    expect(paired).toBe(true);
  });

  it('red in Console, Red and White; Frost blue in Frost and Grey Frost', () => {
    expect(valueFor(rootSel('console'), '--adpilot-accent')).toBe('#ff4557');
    expect(valueFor(rootSel('red'), '--adpilot-accent')).toBe('#ff4557');
    expect(valueFor(rootSel('light'), '--adpilot-accent')).toBe(valueFor(themeSel('light'), '--accent'));
    expect(valueFor(rootSel('frost'), '--adpilot-accent')).toBe('#9fc6ff');
    expect(valueFor(rootSel('grey-frost'), '--adpilot-accent')).toBe('#9fc6ff');
  });

  it('the Topbar and the active AdPilot pill read the tokens through class hooks (FR-G1.2)', () => {
    expect(valueFor(".os-topbar[data-route='adpilot']", '--accent')).toBe('var(--adpilot-accent)');
    expect(valueFor(".os-topbar[data-route='adpilot']", 'border-color')).toBe('var(--adpilot-border)');
    expect(valueFor(".os-sidebar a.os-nav-adpilot[aria-current='page']", '--accent')).toBe('var(--adpilot-accent)');
    expect(read('components/Topbar.tsx')).toMatch(/data-route=\{[^}]*'adpilot'/);
    expect(read('components/Sidebar.tsx')).toMatch(/os-nav-adpilot/);
    expect(read('components/Sidebar.tsx')).toMatch(/aria-current=\{\w+ \? 'page'/);
    // S12 (§5 C32): the class comes from the nav item's accent flag, so
    // AdPilot and Creative Engine share it without a hard-coded href.
    expect(read('components/Sidebar.tsx')).toMatch(/accent === 'adpilot' \? ' os-nav-adpilot'/);
  });

  it('no hex or rgba literal in Topbar.tsx or Sidebar.tsx (ACG1.3)', () => {
    for (const f of ['components/Topbar.tsx', 'components/Sidebar.tsx']) {
      const hits = read(f)
        .split('\n')
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l));
      expect(hits, f).toEqual([]);
    }
  });
});
