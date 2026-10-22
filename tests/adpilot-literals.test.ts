import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * AdPilot components hold no colour literal (SPEC S01 §9 AC01.3, F2): every
 * fill reads a token through an `.ap-*` class in app/globals.css. Only the
 * dot-grid mask alpha (`#000` inside a mask-image gradient) is allowed.
 * The globe (S11) builds canvas fills from `-rgb` token channels through one
 * helper (`rgb(${...} / a)`), which is a computed fill, not a literal.
 */

const root = path.resolve(__dirname, '..');
const FILES = [
  'components/adpilot/AdPilotDeck.tsx',
  'components/adpilot/AdLibrary.tsx',
  'app/adpilot/page.tsx',
  'components/adpilot/Globe.tsx',
  'components/adpilot/projection.ts',
];
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\b(?:bg|text|border|from|to|via)-(?:black|white)\b|\b(?:bg|text|border|from)-\[#/;
const ALLOWED = /mask-?image|`rgb\(\$\{c\[0\]\}/i;

describe('AdPilot component literals (AC01.3)', () => {
  for (const f of FILES) {
    it(`${f} reads only tokens`, () => {
      const hits = fs
        .readFileSync(path.join(root, f), 'utf8')
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => LITERAL.test(line) && !ALLOWED.test(line));
      expect(hits).toEqual([]);
    });
  }

  it('the search placeholder carries no example concept (AC01.20)', () => {
    const lib = fs.readFileSync(path.join(root, 'components/adpilot/AdLibrary.tsx'), 'utf8');
    expect(lib).not.toMatch(/replacing staff/i);
    expect(lib).toContain('Describe a concept to search proven ads');
  });

  it('every .ap-* class the components use is defined in globals.css', () => {
    const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
    const defined = new Set([...css.matchAll(/\.(ap-[a-z0-9-]+)/g)].map((m) => m[1]));
    for (const f of FILES) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      const used = new Set([...src.matchAll(/(?<![-\w])(ap-[a-z0-9-]+)\b/g)].map((m) => m[1]));
      // ids and storage keys share the prefix; only class names must resolve.
      for (const c of used) {
        if (/^ap-(concept|domain|domain-err|ask|tab|tabpanel|library|results|dossier-title|dots|city|globe-[a-z]+-rgb|globe-body|pin|pin-core|pin-halo-rgb|signal-rgb)$/.test(c)) continue;
        expect(defined.has(c), `${f}: .${c}`).toBe(true);
      }
    }
  });
});
