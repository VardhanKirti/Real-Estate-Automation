import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { sampleRuns } from '@/lib/creative-engine/demo';
import { placeRuns, rangeFor } from '@/lib/creative-engine/timeline';

/**
 * SPEC S07 house rules the timeline unit tests do not reach: the stat row
 * markup, the "not applicable" glyph, the hero ink tokens (C22) and the
 * sample's run history (AC07.4).
 */
const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const dashboard = read('components/creative-engine/Dashboard.tsx');
const timelineUi = read('components/creative-engine/EngineTimeline.tsx');
const css = read('app/globals.css');
const s07 = css.slice(css.indexOf('/* ── S07 stat row'), css.indexOf('/* ── end S07 ── */'));

describe('stat row (F1, F2, F7, C5)', () => {
  test('the row is the .ae-stats grid, not a scrolling flex row', () => {
    expect(dashboard).toContain('className="ae-stats"');
    expect(dashboard).not.toMatch(/flex-nowrap[^"]*overflow-x-auto/);
    expect(s07).toMatch(/\.ae-stats \{[^}]*overflow: visible/);
    expect(s07).toMatch(/@container ae-main \(max-width: 559px\)/);
  });
  test('each stat is a button and an empty stat is a true 0, not a dash', () => {
    // Classic draws the paper stat button (classic.tsx); the kit's GStat is a button when it has onClick
    expect(read('components/creative-engine/classic.tsx')).toMatch(/<button type="button" className="ae-stat"/);
    expect(read('components/creative-engine/skin-dash.tsx')).toMatch(/<GStat [^>]*onClick=\{onOpen\}/);
    expect(dashboard).not.toMatch(/<Stat value=\{[^}]*'—'/);
  });
  test('the — glyph is a full-width bar, so it never reads as an ellipsis', () => {
    expect(read('components/creative-engine/primitives.tsx')).toContain(`'—': ['00000', '00000', '00000', '11111', '00000', '00000', '00000']`);
  });
});

describe('tokens (§3.2, C22)', () => {
  test('no raw colour in the dashboard numerals or the timeline UI', () => {
    expect(dashboard).not.toMatch(/color="#fff"|rgba\(255, ?255, ?255/);
    expect(timelineUi).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
  test('--p-on-hero* is stated for the base paper, Red, and Frost paired with Grey Frost', () => {
    for (const sel of ['.ae-paper {', ":root[data-theme='red'] .ae-paper {", ":root[data-theme='frost'] .ae-paper, :root[data-theme='grey-frost'] .ae-paper {"]) {
      const at = s07.indexOf(sel);
      expect(at, sel).toBeGreaterThanOrEqual(0);
      const block = s07.slice(at, s07.indexOf('}', at));
      for (const t of ['--p-on-hero:', '--p-on-hero-dim:', '--p-on-hero-faint:']) expect(block, `${sel} ${t}`).toContain(t);
    }
  });
  test('new motion honours reduced motion', () => {
    const rm = s07.slice(s07.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const c of ['.ae-tl-thumb', '.ae-tl-caret', '.ae-rt-thumb', '.ae-tl-tip', '.ae-bstat[data-open]', '.ae-stat-badge']) expect(rm, c).toContain(c);
  });
});

describe('sample history (AC07.4)', () => {
  test('sample runs spread over weeks, open on 30 d, and draw as separate dots', () => {
    const runs = sampleRuns();
    expect(rangeFor(runs)).toBe('30d');
    const p = placeRuns(runs, '30d', 564);
    expect(p.earlier).toBe(0);
    expect(p.clusters).toHaveLength(0);
    expect(p.dots).toHaveLength(runs.length);
  });
});
