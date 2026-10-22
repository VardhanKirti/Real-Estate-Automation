import { describe, expect, test } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync } from 'node:fs';
import { GDiff, GLineChart, GRadar, GSwatch, GVizStage } from '@/components/g';
import { CSS_NO_COMMENTS } from './helpers/theme-css';

/**
 * Lane p3k (Phase 1-2 kit leftovers, §3.2, §3.3.5, §3.3.8): the viz
 * stand-in buttons, peak tags and empty lines are kit parts; the inactive
 * GTabs text and the selected timeline dot meet the kit rules in the kit
 * itself, so the Creative Engine needs no page patch.
 */

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const rule = (sel: string) => {
  const i = CSS_NO_COMMENTS.indexOf(`${sel} {`);
  expect(i, sel).toBeGreaterThanOrEqual(0);
  return CSS_NO_COMMENTS.slice(i, CSS_NO_COMMENTS.indexOf('}', i));
};

describe('viz controls are kit controls', () => {
  test('no .g-viz-btn or .g-viz-empty stand-ins remain', () => {
    const files = readdirSync('components/g').filter((f) => f.endsWith('.tsx'));
    for (const f of files) expect(readFileSync(`components/g/${f}`, 'utf8'), f).not.toMatch(/g-viz-btn|g-viz-empty/);
    expect(CSS_NO_COMMENTS).not.toMatch(/\.g-viz-(btn|empty)\b/);
  });

  test('GDiff Copy and GVizStage Full screen are GButton sm', () => {
    const diff = render(h(GDiff, { removed: ['a'], added: ['b'] }));
    expect(diff).toMatch(/data-g="GButton" data-variant="default" data-size="sm"[^>]*>.*Copy/);
    const stage = render(h(GVizStage, { height: 300, label: 'V' }, 'x'));
    expect(stage).toMatch(/aria-pressed="false"[^>]*data-g="GButton"|data-g="GButton"[^>]*aria-pressed="false"/);
  });

  test('empty lines inside viz are GEmpty', () => {
    expect(render(h(GDiff, { removed: [], added: [] }))).toContain('data-g="GEmpty"');
    expect(render(h(GRadar, { axes: [{ id: 'a', label: 'A' }], layers: [], label: 'R' }))).toContain('data-g="GEmpty"');
    expect(render(h(GLineChart, { labels: [], series: [], label: 'L', state: 'empty' }))).toContain('data-g="GEmpty"');
    const err = render(h(GLineChart, { labels: [], series: [], label: 'L', state: 'error', onRetry: () => {} }));
    expect(err).toMatch(/data-g="GButton"[^>]*>.*Retry/);
  });

  test('the step chart peak tag is a GTag', () => {
    const html = render(h(GLineChart, { labels: ['A', 'B', 'C'], series: [{ id: 't', label: 'T', values: [1, 9, 2] }], variant: 'step', peakLabel: (_i: number, v: number) => `${v} touches`, label: 'T' }));
    expect(html).toMatch(/class="g-xy-peaktag"[^>]*><span data-g="GTag"[^>]*>9 touches/);
  });
});

describe('kit contrast and rings, no engine patches', () => {
  test('inactive GTabs text reads --g-muted, never the non-text --g-dim (AC00.11)', () => {
    expect(rule('.g-tab')).toMatch(/color: var\(--g-muted\)/);
    expect(rule('.g-tab')).not.toMatch(/--g-dim/);
    expect(CSS_NO_COMMENTS).not.toMatch(/\.ae-dash-nav \.g-tab/);
  });

  test('the selected timeline dot is an outline ring, not a spread shadow (§3.3.8)', () => {
    for (const sel of [".g-tl-dot[data-selected]", ".g-tl-cluster[data-selected]"]) {
      expect(rule(sel)).toMatch(/outline: 2px solid var\(--g-ring\)/);
      expect(rule(sel)).not.toMatch(/box-shadow/);
    }
    expect(CSS_NO_COMMENTS).not.toMatch(/\.ce-g-tl \.g-tl-dot/);
  });
});

describe('GSwatch and toast actions', () => {
  test('GSwatch carries its own tooltip; the picker has no wrapping span', () => {
    const html = render(h(GSwatch, { name: 'Ice', fill: 'var(--g-swatch-ice)', selected: true, onSelect: () => {}, title: 'Ice: cool blue' }));
    expect(html).toMatch(/data-g="GSwatch"[^>]*title="Ice: cool blue"/);
    expect(readFileSync('components/AppearancePicker.tsx', 'utf8')).not.toMatch(/appset-swatch"/);
  });

  test('under GladOS the toast action is a GButton sm; Classic keeps its button', () => {
    const src = readFileSync('components/ui/Toast.tsx', 'utf8');
    expect(src).toMatch(/<GButton variant="sm" className="ui-toast-gaction"/);
    expect(src).toMatch(/useUiStyle\('classic'\) === 'glados'/);
    expect(CSS_NO_COMMENTS).not.toMatch(/\[data-ui='glados'\] \.ui-toast-action/);
  });
});
