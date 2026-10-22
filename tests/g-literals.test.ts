import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * House rules for the G kit (SPEC S00 AC00.13, §3.3.1, §3.3.7, C24, X2):
 * every colour is a --g-* token, never a literal; no mono outside
 * `data-mono-ok`; and every token the kit names is a canonical X2 token
 * (aliases are documentation only). Scans components/g/**, the dev gallery
 * and the "1d G kit" block of app/globals.css.
 */

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

function walk(dir: string): string[] {
  const abs = path.join(root, dir);
  return readdirSync(abs).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : /\.(tsx?|css)$/.test(name) ? [rel] : [];
  });
}

const KIT_FILES = [...walk('components/g'), ...walk('app/dev/g-kit')];

function kitCssBlock(): string {
  const css = read('app/globals.css');
  const start = css.indexOf('/* ── 1d G kit');
  const end = css.indexOf('/* ── end 1d G kit ── */');
  expect(start, '1d G kit block start marker').toBeGreaterThan(-1);
  expect(end, '1d G kit block end marker').toBeGreaterThan(start);
  return css.slice(start, end);
}

/** Canonical X2 tokens (SPEC §4 X2). A fifth palette or a new token is added here and in the token block. */
const X2 = new Set<string>([
  ...['bg', 'bg-lift', 'card', 'card-2', 'well'],
  ...['ink', 'ink-inverse', 'muted', 'dim'],
  ...['line', 'ring', 'track', 'track-soft', 'scrim', 'shadow', 'shadow-sm'],
  ...['ok', 'warn', 'err', 'ok-soft', 'warn-soft', 'err-soft'],
  ...['accent', 'accent-rgb', 'accent-2', 'accent-soft', 'badge', 'badge-ink'],
  ...['hero-a', 'hero-b', 'hero-c', 'hero-a-ink', 'hero-b-ink', 'hero-c-ink', 'on-hero', 'on-hero-dim', 'on-hero-faint'],
  ...[1, 2, 3, 4, 5, 6].map((n) => `series-${n}`),
  ...Array.from({ length: 11 }, (_, i) => `cat-${i + 1}`),
  ...['state-ready', 'state-approved', 'state-draft', 'state-sent'],
  ...['viz-stage', 'viz-ink', 'viz-hud'],
  ...['diff-del-bg', 'diff-del-fg', 'diff-add-bg', 'diff-add-fg'],
  ...['r-card', 'r-nested', 'r-well', 'r-input', 'r-pill'],
  ...['fs-display', 'fs-section', 'fs-title', 'fs-card', 'fs-body', 'fs-cap', 'fs-faint', 'fw-light', 'fw-body', 'fw-badge'],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `space-${n}`),
  ...['dur-colour', 'dur-lift', 'dur-sheet', 'dur-arrive'],
].map((t) => `--g-${t}`));

const COLOUR_LITERALS: [string, RegExp][] = [
  ['hex colour', /#[0-9a-fA-F]{3,8}\b/],
  ['rgb()/rgba()', /\brgba?\(/],
  ['hsl()/hsla()', /\bhsla?\(/],
  ['Tailwind arbitrary colour', /\b(?:bg|text|border|fill|stroke|ring|from|via|to|shadow|outline|decoration|accent|caret)-\[(?:#|rgb|hsl)/],
  [
    'Tailwind palette colour',
    /\b(?:bg|text|border|fill|stroke|ring|from|via|to|shadow|outline|decoration|accent|caret)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/,
  ],
];
const MONO = /font-mono|Geist Mono|monospace|--font-mono/;

describe('G kit: no literal colours (AC00.13)', () => {
  it('the guard catches each kind of literal it claims to', () => {
    const caught = (s: string) => COLOUR_LITERALS.some(([, re]) => re.test(s));
    for (const bad of ['color: #fff', "background: 'rgba(0,0,0,.4)'", 'hsl(200 50% 50%)', 'bg-[#123456]', 'text-white', 'bg-black', 'border-slate-700']) {
      expect(caught(bad), bad).toBe(true);
    }
    for (const ok of ['var(--g-ink)', 'text-[11.5px]', 'href="/integrations#stripe"', 'gap-5']) expect(caught(ok), ok).toBe(false);
    expect(MONO.test('className="font-mono"')).toBe(true);
  });

  for (const file of KIT_FILES) {
    it(`${file} has no literal colour`, () => {
      const hits: string[] = [];
      read(file)
        .split('\n')
        .forEach((line, i) => {
          for (const [kind, re] of COLOUR_LITERALS) if (re.test(line)) hits.push(`${file}:${i + 1} ${kind}: ${line.trim().slice(0, 100)}`);
        });
      expect(hits).toEqual([]);
    });
  }

  it('the 1d CSS block has no literal colour, named colour or mono', () => {
    const hits: string[] = [];
    kitCssBlock()
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\*|\*)/.test(line)) return; // comments
        for (const [kind, re] of COLOUR_LITERALS) if (re.test(line)) hits.push(`+${i} ${kind}`);
        if (/:\s*(?:white|black)\b|,\s*(?:white|black)\b/.test(line)) hits.push(`+${i} named colour`);
        if (MONO.test(line)) hits.push(`+${i} mono`);
      });
    expect(hits).toEqual([]);
  });

  it('the 1d CSS block reads only kit variables (--g-*, its own --gk-*, --ease, --launcher-clear)', () => {
    const vars = [...kitCssBlock().matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
    const bad = vars.filter((v) => !/^--g-|^--gk-/.test(v) && v !== '--ease' && v !== '--launcher-clear');
    expect([...new Set(bad)]).toEqual([]);
  });
});

describe('G kit: no mono outside data-mono-ok (C24)', () => {
  for (const file of KIT_FILES.filter((f) => !f.endsWith('.css'))) {
    it(`${file} uses no mono`, () => {
      const hits = read(file)
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => MONO.test(line) && !line.includes('data-mono-ok'))
        .map(({ line, i }) => `${file}:${i + 1} ${line.trim().slice(0, 100)}`);
      expect(hits).toEqual([]);
    });
  }
});

describe('G kit: canonical token names only (X2)', () => {
  it('every --g-* name the kit references is in X2', () => {
    const sources = [kitCssBlock(), ...KIT_FILES.filter((f) => !f.endsWith('.css')).map(read)];
    const names = new Set(sources.flatMap((s) => [...s.matchAll(/--g-[a-z0-9-]*[a-z0-9]\b(?![-$])/g)].map((m) => m[0])));
    // A template (`--g-hero-${k}`) leaves a trailing dash and is not matched.
    const unknown = [...names].filter((n) => !X2.has(n));
    expect(unknown).toEqual([]);
  });
});
