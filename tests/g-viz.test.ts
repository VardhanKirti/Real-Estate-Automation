import { describe, expect, test } from 'vitest';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  G_VIZ_PRIMITIVES, GAreaChart, GBar, GBarChart, GBlob, GChartTooltip, GDiff, GDonut, GDotCloud, GDotMatrix, GDriverBars, GFunnelStep,
  GHeatmap, GLegend, GLineChart, GRadar, GRingGauge, GRings, GRuler, GShareBar, GSparkline, GStackedBar, GTickStrip, GTimelineStrip,
  GTreemap, GVizStage, funnelConversions,
} from '@/components/g';

/**
 * Lane 1e (SPEC S00 §5.3, GP3, ACGP3.1, ACGP3.3, AC00.13): every data viz
 * primitive renders default, empty, loading and error without throwing and
 * carries its data-g; the source holds no colour literal, no mono class and
 * no brand literal.
 */

const render = (el: ReactElement) => renderToStaticMarkup(el);
const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const STATES = ['loading', 'empty', 'error'] as const;

const stages = [
  { id: 'announced', label: 'Announced', value: 254_000, count: 25 },
  { id: 'awaiting', label: 'Awaiting brand', value: 36_500, count: 2 },
  { id: 'approval', label: 'Needs approval', value: 121_500, count: 13 },
  { id: 'closed', label: 'Closed', value: 89_500, won: 48_500, lost: 41_000, count: 9 },
];

const cases: Record<string, () => ReactElement> = {
  GBar: () => h(GBar, { label: 'Runs succeeded · 7d', value: 41, max: 48 }),
  GDriverBars: () => h(GDriverBars, { rows: [{ id: 'a', label: 'Organic', value: 3, onClick: () => {} }, { id: 'b', label: 'Ads', value: 1 }] }),
  GRuler: () => h(GRuler, { label: 'Median 34 of 90 days', value: 34, max: 90 }),
  GDotCloud: () => h(GDotCloud, { total: 48, lit: 12, label: '48 pooled · 12 proven' }),
  GRings: () => h(GRings, { value: 2, status: 'ok', label: '2 runs in flight · Arcads connected' }),
  GBlob: () => h(GBlob, { state: 'ready', label: 'Brief ready' }),
  GSparkline: () => h(GSparkline, { values: [1, 3, 2, 5], label: 'Followers · 30d' }),
  GLineChart: () => h(GLineChart, { labels: ['May', 'Jun', 'Jul'], series: [{ id: 't', label: 'Touches', values: [10, 222, 40] }], variant: 'step', peakLabel: (_i: number, v: number) => `${v} touches`, label: 'Touches' }),
  GAreaChart: () => h(GAreaChart, { labels: ['1', '2', '3'], series: [{ id: 'a', label: 'Audience', values: [1, 2, 2], carried: [false, false, true] }], syncId: 's', label: 'Audience' }),
  GBarChart: () => h(GBarChart, { variant: 'stages', columns: stages, measure: 'usd', selected: 'approval', onSelect: () => {}, countNoun: ['deal', 'deals'], label: 'Pipeline' }),
  GStackedBar: () => h(GStackedBar, { columns: [{ id: 'a', label: 'Mon', parts: [2, 3] }], keys: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], label: 'Stack' }),
  GDonut: () => h(GDonut, { slices: [{ id: 'a', label: 'Payroll', value: 3 }, { id: 'b', label: 'Tools', value: 1 }], label: 'Expenses' }),
  GFunnelStep: () => h(GFunnelStep, { stages: [{ id: 'a', label: 'First touch', count: 127 }, { id: 'b', label: 'Engaged', count: 111 }], label: 'Funnel' }),
  GTimelineStrip: () => h(GTimelineStrip, { events: [{ id: 'e', at: NOW - 3600_000, status: 'sent', title: 'Fictional Co' }], spanMs: 7 * 86_400_000, agoLabel: '7 d ago', now: NOW, readOnly: true, label: 'Send activity' }),
  GTickStrip: () => h(GTickStrip, { label: 'Inbound · 24h', values: [1, 0, 3, null] }),
  GShareBar: () => h(GShareBar, { segments: [{ id: 'a', label: 'A', value: 3 }, { id: 'b', label: 'B', value: 1 }], label: 'Share' }),
  GDotMatrix: () => h(GDotMatrix, { columns: 'MTWTFSS'.split('').map((d, i) => ({ id: `${i}`, label: d, value: i, title: `${d} · ${i}` })), label: 'Weekday leads' }),
  GRingGauge: () => h(GRingGauge, { value: 2.4, max: 4, reference: 1, label: 'ROAS · 30d', scaleCaption: '0 to 4x' }),
  GRadar: () => h(GRadar, { axes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], layers: [{ id: 'l', label: 'Now', values: [50, 80, 30] }], label: 'Pillars' }),
  GTreemap: () => h(GTreemap, { blocks: [{ id: 'a', label: 'docs', value: 3, kind: 'md' }, { id: 'b', label: 'img', value: 1, kind: 'img' }], kinds: [{ id: 'md', label: 'Markdown' }, { id: 'img', label: 'Images' }], label: 'Files' }),
  GHeatmap: () => h(GHeatmap, { rows: ['a', 'b'], cols: ['x', 'y'], values: [[1, 2], [null, 4]], label: 'Matrix' }),
  GDiff: () => h(GDiff, { removed: ['old line'], added: ['new line'], file: 'docs/canon.md' }),
  GVizStage: () => h(GVizStage, { height: 320, label: 'Brain radial', hudTopLeft: 'Brain' }, h('div', null, 'canvas')),
  GLegend: () => h(GLegend, { items: [{ id: 'a', label: 'Agents', count: 4, color: 'cat-1', on: true }], onToggle: () => {}, label: 'Kinds' }),
  GChartTooltip: () => h(GChartTooltip, { x: 100, y: 50, containerWidth: 400, title: 'Aug', lines: ['222 touches'] }),
};

describe('ACGP3.1: every lane 1e primitive is exported and renders its data-g', () => {
  test('the case table covers G_VIZ_PRIMITIVES exactly', () => {
    expect(Object.keys(cases).sort()).toEqual([...G_VIZ_PRIMITIVES].sort());
  });
  for (const name of G_VIZ_PRIMITIVES) {
    test(`${name} default render`, () => {
      const html = render(cases[name]());
      expect(html).toContain(`data-g="${name}"`);
    });
  }
});

describe('ACGP3.3: states render without throwing at their final size', () => {
  const stateful: Record<string, (s: (typeof STATES)[number]) => ReactElement> = {
    GDriverBars: (state) => h(GDriverBars, { rows: [], state }),
    GLineChart: (state) => h(GLineChart, { labels: [], series: [], label: 'L', state }),
    GAreaChart: (state) => h(GAreaChart, { labels: [], series: [], label: 'A', state }),
    GBarChart: (state) => h(GBarChart, { variant: 'stages', columns: [], measure: 'usd', label: 'P', state }),
    GStackedBar: (state) => h(GStackedBar, { columns: [], keys: [], label: 'S', state }),
    GDonut: (state) => h(GDonut, { slices: [], label: 'D', state }),
    GFunnelStep: (state) => h(GFunnelStep, { stages: [], label: 'F', state }),
    GTimelineStrip: (state) => h(GTimelineStrip, { events: [], spanMs: 86_400_000, agoLabel: '24 h ago', label: 'T', state }),
    GDotMatrix: (state) => h(GDotMatrix, { columns: [], label: 'M', state }),
    GRadar: (state) => h(GRadar, { axes: [], layers: [], label: 'R', state }),
    GTreemap: (state) => h(GTreemap, { blocks: [], kinds: [], label: 'T', state }),
    GHeatmap: (state) => h(GHeatmap, { rows: [], cols: [], values: [], label: 'H', state }),
    GVizStage: (state) => h(GVizStage, { height: 300, label: 'V', state }),
  };
  for (const [name, el] of Object.entries(stateful)) {
    for (const s of STATES) {
      test(`${name} ${s}`, () => {
        const html = render(el(s));
        expect(html).toContain(`data-g="${name}"`);
        if (s === 'loading') expect(html).toContain('aria-busy="true"');
        if (s === 'error') expect(html).toContain('role="alert"');
      });
    }
  }
  test('a custom empty slot (a page GEmpty with its SetupLink) replaces the default line', () => {
    const html = render(h(GBarChart, { variant: 'series', bars: [], label: 'Income', empty: h('a', { href: '/setup#stripe' }, 'Set up') }));
    expect(html).toContain('href="/setup#stripe"');
  });
});

describe('honest or absent', () => {
  test('GRings needs a value and a status, and says both', () => {
    const html = render(h(GRings, { value: 5, status: 'err', label: '5 runs in flight · Arcads error' }));
    expect(html).toContain('5 runs in flight');
    expect((html.match(/data-on="true"/g) ?? []).length).toBe(3);
    expect(html).toContain('data-status="err"');
  });
  test('GBar null is "no data", never a zero fill', () => {
    const html = render(h(GBar, { label: 'Open rate', value: null }));
    expect(html).toContain('no data');
    expect(html).not.toContain('<i');
  });
  test('GRingGauge null reads "—"', () => {
    expect(render(h(GRingGauge, { value: null, max: 4, label: 'ROAS' }))).toContain('—');
  });
  test('GDonut with one slice renders a stat, not a ring', () => {
    const html = render(h(GDonut, { slices: [{ id: 'a', label: 'Payroll', value: 3 }, { id: 'b', label: 'Tools', value: 0 }], label: 'Expenses' }));
    expect(html).toContain('data-single');
    expect(html).not.toContain('<svg');
  });
  test('GSparkline with under two points draws the empty track and says no data', () => {
    expect(render(h(GSparkline, { values: [4], label: 'Spark' }))).toContain('no data');
  });
  test('GDotMatrix all-zero says so', () => {
    const html = render(h(GDotMatrix, { columns: [{ id: 'a', label: 'M', value: 0, title: 'Mondays · 0' }], label: 'Leads' }));
    expect(html).toContain('None in this range');
  });
  test('display-only stages are not buttons; with onSelect they are a radiogroup', () => {
    const ro = render(h(GBarChart, { variant: 'stages', columns: stages, measure: 'usd', label: 'P' }));
    expect(ro).not.toContain('<button');
    const rw = render(h(GBarChart, { variant: 'stages', columns: stages, measure: 'usd', selected: 'approval', onSelect: () => {}, label: 'P' }));
    expect(rw).toContain('role="radiogroup"');
    expect(rw).toContain('aria-checked="true"');
    expect(rw).toContain('$48.5K won');
  });
  test('GFunnelStep prints conversions and marks the worst step', () => {
    const html = render(h(GFunnelStep, { stages: [
      { id: 'a', label: 'First touch', count: 127 }, { id: 'b', label: 'Engaged', count: 111 }, { id: 'c', label: 'Nurtured', count: 90 }, { id: 'd', label: 'Opted in', count: 72 },
    ], label: 'Funnel' }));
    expect(html).toContain('87%');
    expect(html).toContain('data-tone="warn"');
    expect(funnelConversions([{ count: 10 }, { count: 5 }, { count: 0 }, { count: 3 }])).toEqual([null, 0.5, 0, null]);
  });
  test('GTimelineStrip with nothing in range says so and stays a slider', () => {
    const html = render(h(GTimelineStrip, { events: [], spanMs: 86_400_000, agoLabel: '24 h ago', now: NOW, readOnly: true, label: 'Sends' }));
    expect(html).toContain('role="slider"');
    expect(html).toContain('Nothing in this range');
  });
});

describe('AC00.13 and house rules: source scan of the lane 1e files', () => {
  const dir = path.join(process.cwd(), 'components/g');
  const files = readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f));
  const vizFiles = ['viz.ts', 'viz-shared.tsx', 'XYChart.tsx', 'BarStages.tsx', 'BarSeries.tsx', ...[...G_VIZ_PRIMITIVES].map((n) => `${n}.tsx`)];
  test('every lane 1e file exists', () => {
    for (const f of vizFiles) expect(files).toContain(f);
  });
  for (const f of vizFiles) {
    test(`${f}: no colour literal, no mono utility, no brand literal, no emoji`, () => {
      const src = readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
      expect(src).not.toMatch(/\b(rgba?|hsla?)\(/);
      expect(src).not.toMatch(/\b(font-mono|text-white|bg-black)\b/);
      expect(src).not.toMatch(/\b(?:bg|text|border|fill|stroke)-\[#/);
      expect(src).not.toMatch(/GladOS/);
      expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  }
  test('the lane 1e CSS block reads tokens only', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
    const start = css.indexOf('/* ── G kit data viz (lane 1e');
    const end = css.indexOf('/* ── end G kit data viz (lane 1e) ── */');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\b(rgba?|hsla?)\(/);
    // no outer glow: every box-shadow is a token, inset, a ring in --g-ring or a card-colour halo
    for (const m of block.matchAll(/box-shadow:\s*([^;]+);/g)) {
      expect(m[1]).toMatch(/^(var\(--g-shadow(-sm)?\)|none|inset |0 0 0 \dpx var\(--g-(ring|card-2)\))/);
    }
  });
});
