/**
 * Colour maths for the GladOS token tests (docs/projects/glados-ui/SPEC.md
 * S00 §5.1, §5.2, X2, AC00.10 to AC00.12, ACGP3.6).
 *
 * - `gCascade` resolves every `--g-*` token for one accent × mode the way the
 *   browser cascade does for the G0 token block (specificity, then source order).
 * - `sampleHero` rasterises a hero `background` (radial and linear gradient
 *   layers, as authored in the token block) at a point, so the hero label and
 *   numeral contrast is checked against every pixel of its zone, not only the
 *   colour stops.
 *
 * Accepted gradient grammar (the token block is written in it on purpose, and
 * the test fails if a value falls outside it):
 *   linear-gradient(<deg>deg, <colour> <pct>%, …)
 *   radial-gradient(<rx>% <ry>% at <cx>% <cy>%, <colour> <pct>%, …)
 * where <colour> is #rrggbb or rgba(r, g, b, a).
 */

import { CSS_NO_COMMENTS, declarations, splitSelectors, topLevelRules } from './theme-css';

export type RGBA = [number, number, number, number];

/* ── parsing ─────────────────────────────────────────────────────────────── */

export function parseColour(s: string): RGBA | null {
  const v = s.trim();
  const h = v.match(/^#([0-9a-f]{6})$/i);
  if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const r = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (r) return [Number(r[1]), Number(r[2]), Number(r[3]), r[4] === undefined ? 1 : Number(r[4])];
  return null;
}

/** Split on commas at paren depth 0. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let d = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') d++;
    if (c === ')') d--;
    if (c === ',' && d === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

type Stop = { c: RGBA; pos: number };
export type Layer =
  | { type: 'linear'; deg: number; stops: Stop[] }
  | { type: 'radial'; rx: number; ry: number; cx: number; cy: number; stops: Stop[] };

function parseStops(parts: string[]): Stop[] {
  return parts.map((p) => {
    const m = p.match(/^(#[0-9a-f]{6}|rgba?\([^)]*\))\s+(-?[\d.]+)%$/i);
    if (!m) throw new Error(`colour stop outside the token grammar: "${p}"`);
    return { c: parseColour(m[1])!, pos: Number(m[2]) / 100 };
  });
}

/** Parse a hero `background` value into layers (first = top). Throws outside the grammar. */
export function parseBackground(value: string): Layer[] {
  return splitTop(value).map((layer) => {
    const m = layer.match(/^(radial|linear)-gradient\(([\s\S]*)\)$/);
    if (!m) throw new Error(`layer outside the token grammar: "${layer}"`);
    const args = splitTop(m[2]);
    if (m[1] === 'linear') {
      const a = args[0].match(/^(-?[\d.]+)deg$/);
      if (!a) throw new Error(`linear-gradient needs an angle in deg: "${layer}"`);
      return { type: 'linear', deg: Number(a[1]), stops: parseStops(args.slice(1)) };
    }
    const g = args[0].match(/^([\d.]+)%\s+([\d.]+)%\s+at\s+(-?[\d.]+)%\s+(-?[\d.]+)%$/);
    if (!g) throw new Error(`radial-gradient needs "<rx>% <ry>% at <cx>% <cy>%": "${layer}"`);
    return {
      type: 'radial',
      rx: Number(g[1]) / 100,
      ry: Number(g[2]) / 100,
      cx: Number(g[3]) / 100,
      cy: Number(g[4]) / 100,
      stops: parseStops(args.slice(1)),
    };
  });
}

/* ── rasterising ─────────────────────────────────────────────────────────── */

/** Interpolate stops in premultiplied alpha (CSS Images 4 §3.5.3). */
function colourAt(stops: Stop[], t: number): RGBA {
  if (t <= stops[0].pos) return stops[0].c;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].pos) {
      const a = stops[i - 1];
      const b = stops[i];
      const f = b.pos === a.pos ? 1 : (t - a.pos) / (b.pos - a.pos);
      const alpha = a.c[3] + (b.c[3] - a.c[3]) * f;
      if (alpha === 0) return [0, 0, 0, 0];
      const ch = [0, 1, 2].map((k) => (a.c[k] * a.c[3] + (b.c[k] * b.c[3] - a.c[k] * a.c[3]) * f) / alpha);
      return [ch[0], ch[1], ch[2], alpha];
    }
  }
  return stops[stops.length - 1].c;
}

/** The composited sRGB colour of a background at pixel (x, y) of a W×H box. */
export function sampleBackground(layers: Layer[], W: number, H: number, x: number, y: number): [number, number, number] {
  let out: [number, number, number] | null = null;
  for (const L of [...layers].reverse()) {
    let c: RGBA;
    if (L.type === 'linear') {
      // CSS gradient line: through the centre at the given angle, length |W sin| + |H cos|.
      const r = (L.deg * Math.PI) / 180;
      const dx = Math.sin(r);
      const dy = -Math.cos(r);
      const len = Math.abs(W * dx) + Math.abs(H * dy);
      c = colourAt(L.stops, ((x - W / 2) * dx + (y - H / 2) * dy) / len + 0.5);
    } else {
      // Explicit ellipse radii as percentages of the box; stops are fractions of the ending shape.
      c = colourAt(L.stops, Math.hypot((x - L.cx * W) / (L.rx * W), (y - L.cy * H) / (L.ry * H)));
    }
    const a = c[3];
    out = out === null ? [c[0], c[1], c[2]] : (out.map((v, k) => c[k] * a + v * (1 - a)) as [number, number, number]);
  }
  return out!;
}

/* ── WCAG ────────────────────────────────────────────────────────────────── */

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const lum = (c: readonly number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export function ratio(a: readonly number[], b: readonly number[]): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Alpha-composite `fg` (may be translucent) over an opaque `bg`. */
export function over(fg: RGBA, bg: readonly number[]): [number, number, number] {
  return [0, 1, 2].map((k) => fg[k] * fg[3] + bg[k] * (1 - fg[3])) as [number, number, number];
}

/** CIE76 ΔE between two sRGB colours (D65). */
export function deltaE(a: readonly number[], b: readonly number[]): number {
  const lab = (c: readonly number[]) => {
    const [r, g, bl] = [lin(c[0]), lin(c[1]), lin(c[2])];
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/* ── hero zones (S00 §5.3 GHeroCard anatomy, FR-19) ───────────────────────── */

/**
 * Where GHeroCard puts each element, as fractions of the card box. The token
 * block authors every hero gradient so these zones hold their contrast; lane
 * 1d's GHeroCard must keep its caption, numeral and status inside them.
 *   caption: centred 13px line under the 24px top inset
 *   numeral: the 7px-dot GDotNumber (49px glyph) centred in the card
 *   status:  13px line under the numeral
 * The bottom strip (GRuler / GDotCloud / GSparkline) carries the glow and is
 * non-text.
 */
export const HERO_ZONES = {
  caption: { x: [0.08, 0.92], y: [0.06, 0.24] },
  numeral: { x: [0.12, 0.88], y: [0.3, 0.62] },
  status: { x: [0.08, 0.92], y: [0.6, 0.74] },
} as const;

/** Box sizes a hero renders at: rail `sm` (min-h 236), two-up and wide `md` (min-h 250). */
export const HERO_BOXES: [number, number][] = [
  [225, 236],
  [300, 250],
  [420, 250],
  [560, 280],
];

/** Lowest contrast of `ink` against any sampled pixel of `zone` in every box. */
export function worstContrast(bg: string, ink: RGBA, zone: { x: readonly number[]; y: readonly number[] }): number {
  const layers = parseBackground(bg);
  let worst = Infinity;
  for (const [W, H] of HERO_BOXES)
    for (let i = 0; i <= 24; i++)
      for (let j = 0; j <= 12; j++) {
        const x = W * (zone.x[0] + ((zone.x[1] - zone.x[0]) * i) / 24);
        const y = H * (zone.y[0] + ((zone.y[1] - zone.y[0]) * j) / 12);
        const px = sampleBackground(layers, W, H, x, y);
        worst = Math.min(worst, ratio(ink[3] < 1 ? over(ink, px) : ink, px));
      }
  return worst;
}

/* ── the G0 cascade ──────────────────────────────────────────────────────── */

export const G_SCOPE = ":root[data-ui='glados']";

type GRule = { sel: string; spec: number; order: number; decls: [string, string][] };

/**
 * Every top-level rule whose selector is the G scope plus only these
 * qualifiers: [data-mode='light'|'dark'], [data-accent='<id>'], :not([data-accent]).
 */
export function gRules(src: string = CSS_NO_COMMENTS): GRule[] {
  const out: GRule[] = [];
  let order = 0;
  for (const r of topLevelRules(src)) {
    const decls = declarations(r.body);
    for (const sel of r.selectors) {
      if (!sel.startsWith(G_SCOPE)) continue;
      const rest = sel.slice(G_SCOPE.length);
      if (!/^(\[data-mode='(light|dark)'\]|\[data-accent='[\w-]+'\]|:not\(\[data-accent\]\))*$/.test(rest)) continue;
      out.push({ sel, spec: 2 + (rest.match(/\[/g)?.length ?? 0), order: order++, decls });
    }
  }
  return out;
}

function matches(sel: string, accent: string | null, mode: 'dark' | 'light'): boolean {
  const rest = sel.slice(G_SCOPE.length);
  for (const m of rest.matchAll(/\[data-mode='(\w+)'\]/g)) if (m[1] !== mode) return false;
  for (const m of rest.matchAll(/\[data-accent='([\w-]+)'\]/g)) if (m[1] !== accent) return false;
  if (rest.includes(':not([data-accent])') && accent !== null) return false;
  return true;
}

/** Declared `--g-*` (and `--ease`, `color-scheme`) values for one accent × mode, after the cascade. */
export function gCascade(accent: string | null, mode: 'dark' | 'light', rules = gRules()): Map<string, string> {
  const hit = rules.filter((r) => matches(r.sel, accent, mode)).sort((a, b) => a.spec - b.spec || a.order - b.order);
  const out = new Map<string, string>();
  for (const r of hit) for (const [k, v] of r.decls) out.set(k, v);
  return out;
}

/** Substitute var() references (with fallbacks) until the value has none. */
export function resolve(env: Map<string, string>, value: string, depth = 0): string {
  if (depth > 8) throw new Error(`var() cycle in ${value}`);
  const m = value.match(/var\((--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/);
  if (!m) return value;
  const sub = env.get(m[1]) ?? m[2]?.trim();
  if (sub === undefined) throw new Error(`unresolved ${m[1]}`);
  return resolve(env, value.replace(m[0], sub), depth + 1);
}

/** A resolved token as an opaque colour; `color-mix(in srgb, X p%, transparent)` → X at p alpha. */
export function tokenColour(env: Map<string, string>, token: string): RGBA {
  const v = resolve(env, `var(${token})`).trim();
  const direct = parseColour(v);
  if (direct) return direct;
  const mix = v.match(/^color-mix\(in srgb,\s*(#[0-9a-f]{6}|rgba?\([^)]*\))\s+([\d.]+)%,\s*transparent\)$/i);
  if (mix) {
    const c = parseColour(mix[1])!;
    return [c[0], c[1], c[2], c[3] * (Number(mix[2]) / 100)];
  }
  throw new Error(`${token} is not a colour the test can read: ${v}`);
}

export { splitSelectors };
