import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Small parser over app/globals.css for the theme tests (S06 T3 to T5).
 * It attributes every custom property to the theme(s) and token scope named
 * in each selector, the way the cascade would apply them.
 */

export const GLOBALS_CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
export const CSS_NO_COMMENTS = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

export type Rule = { selectors: string[]; body: string };

/** Top-level rules as { selectors, body }; at-rule blocks (@media, @keyframes …) are skipped. */
export function topLevelRules(src: string = CSS_NO_COMMENTS): Rule[] {
  const out: Rule[] = [];
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
        if (!head.startsWith('@')) out.push({ selectors: splitSelectors(head), body: src.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

/** Split a selector list on top-level commas (not the ones inside :where()/:is()). */
export function splitSelectors(head: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of head) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Custom-property declarations of a rule body, in source order. */
export function declarations(body: string): [string, string][] {
  return [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
}

/** Token scopes the coverage test checks (S06 T3, G9). */
export type Scope = ':root' | '[data-adpilot]' | '.ae-paper' | 'paper-dark' | '.ae-octane';
export const BASE = 'base';

/**
 * Which theme and token scope a selector writes to. `:root` and
 * `:root[data-theme='console']` are the base; a selector with no theme prefix
 * is base for its scope. Returns null for scopes the coverage test ignores
 * (rule-level effects such as `.hoverable:hover`).
 */
export function classify(sel: string): { theme: string; scope: Scope } | null {
  let theme = BASE;
  let rest = sel;
  const m = sel.match(/^:root\[data-theme='([\w-]+)'\]\s*(.*)$/);
  if (m) {
    theme = m[1] === 'console' ? BASE : m[1];
    rest = m[2];
  } else if (sel.startsWith(':where(:root')) {
    // Balanced: the :where() may hold nested :not(…) groups.
    let depth = 0;
    let end = 0;
    for (let i = 0; i < sel.length; i++) {
      if (sel[i] === '(') depth++;
      else if (sel[i] === ')' && --depth === 0) { end = i + 1; break; }
    }
    const inner = sel.slice(0, end);
    rest = sel.slice(end).trim();
    // Paper dark follows the app mode on <html> (glados-ui S00 FR-9).
    if (rest === '.ae-paper' && /\[data-mode='dark'\]|:not\(\[data-mode\]\)/.test(inner)) return { theme, scope: 'paper-dark' };
  } else if (sel === ':root' || sel.startsWith(':root ')) {
    rest = sel.slice(5).trim();
  }
  if (rest === '') return { theme, scope: ':root' };
  if (/^\[data-adpilot\]$/.test(rest)) return { theme, scope: '[data-adpilot]' };
  if (/^\.ae-octane$/.test(rest)) return { theme, scope: '.ae-octane' };
  if (/^\.ae-paper$/.test(rest)) return { theme, scope: '.ae-paper' };
  if (/^(\[data-mode='dark'\]|:not\(\[data-mode\]\)) \.ae-paper$/.test(rest)) return { theme, scope: 'paper-dark' };
  return null;
}

/** scope -> theme -> token -> last declared value (cascade order). */
export function tokenMap(rules: Rule[] = topLevelRules()): Map<Scope, Map<string, Map<string, string>>> {
  const out = new Map<Scope, Map<string, Map<string, string>>>();
  for (const r of rules) {
    const decls = declarations(r.body);
    if (!decls.length) continue;
    for (const s of r.selectors) {
      const c = classify(s);
      if (!c) continue;
      if (!out.has(c.scope)) out.set(c.scope, new Map());
      const byTheme = out.get(c.scope)!;
      if (!byTheme.has(c.theme)) byTheme.set(c.theme, new Map());
      const t = byTheme.get(c.theme)!;
      for (const [k, v] of decls) t.set(k, v);
    }
  }
  return out;
}

/** The value a theme's root scope resolves a token to (own block, else base). */
export function rootValue(map: ReturnType<typeof tokenMap>, theme: string, token: string): string | undefined {
  const root = map.get(':root')!;
  return root.get(theme)?.get(token) ?? root.get(BASE)?.get(token);
}

/** Resolve var() references (one level deep is enough for colour tokens) against a theme's root scope. */
export function resolveColour(map: ReturnType<typeof tokenMap>, theme: string, token: string): string | undefined {
  let v = rootValue(map, theme, token);
  for (let i = 0; i < 4 && v?.startsWith('var('); i++) v = rootValue(map, theme, v.match(/var\((--[\w-]+)/)![1]);
  return v;
}

/** WCAG 2.x relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
