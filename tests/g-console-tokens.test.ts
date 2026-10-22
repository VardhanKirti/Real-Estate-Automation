import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Motion console and workflow builder token alias pass (glados-ui SPEC S03
 * F38, F39, C27, AC03.19): under data-ui='glados' every --o-* token is an
 * alias of a --g-* token, scoped to .ae-octane; the console and builder
 * components carry no raw colour.
 */
const css = readFileSync('app/globals.css', 'utf8');
const start = css.indexOf("/* ── G console re-token");
const end = css.indexOf('/* ── end G console re-token ── */');
const block = css.slice(start, end);

describe('G console re-token (AC03.19)', () => {
  test('the block exists and is scoped to the GladOS style', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain(":root[data-ui='glados'] .ae-octane {");
  });

  test('every --o-* token in globals.css is re-defined as a --g-* alias under GladOS', () => {
    const all = new Set([...css.matchAll(/(--o-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const decl = new Map([...block.matchAll(/(--o-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const missing = [...all].filter((t) => !decl.has(t));
    expect(missing).toEqual([]);
    for (const [t, v] of decl) {
      expect(v, t).toMatch(/var\(--g-/);
      expect(v, t).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });

  test('console and builder components carry no raw hex', () => {
    const files = [
      'components/creative-engine/MotionConsole.tsx',
      'components/creative-engine/octane-rows.tsx',
      'components/creative-engine/WorkflowCanvas.tsx',
      ...readdirSync('components/creative-engine/workflow').filter((f) => f.endsWith('.tsx')).map((f) => `components/creative-engine/workflow/${f}`),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}\b/);
  });

  test('part colours are tokens, so the GladOS block can re-key them', () => {
    const mc = readFileSync('components/creative-engine/MotionConsole.tsx', 'utf8');
    for (let i = 1; i <= 5; i++) expect(mc).toContain(`var(--o-part-${i})`);
  });
});
