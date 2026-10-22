import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as G from '@/components/g';
import type { GHeroCardProps, GStatProps } from '@/components/g';
import {
  DOT_CHARSET,
  DOT_GLYPHS,
  dotText,
  dotWidth,
  fitDotSize,
  nextSort,
  prefersDots,
  rovingIndex,
  sortRows,
  swipeCloses,
  textareaHeight,
} from '@/components/g/logic';
import { ToastStack, toToastItem } from '@/components/ui/Toast';
import { KitGallery } from '@/app/dev/g-kit/KitGallery';

/**
 * The G kit, part 1 (SPEC S00 §5.3, X1, GP3; lane 1d). Static renders in
 * node; keyboard, focus and overlay behaviour are checked in the browser on
 * /dev/g-kit (the gallery renders every primitive in every state).
 */

const root = path.resolve(__dirname, '..');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const dataG = (markup: string) => new Set([...markup.matchAll(/data-g="([A-Za-z]+)"/g)].map((m) => m[1]));

// Static markup skips layout effects by design; React's SSR warning about them is noise here.
const realError = console.error;
const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
  if (!String(a[0]).includes('useLayoutEffect does nothing on the server')) realError(...a);
});
afterAll(() => spy.mockRestore());

/** X1 rows with status S00 or GP3 that lane 1d builds (data viz is lane 1e, the shell is Phase 2). */
const X1_PART1 = [
  'GPage', 'GDisplay', 'GSectionHeader', 'GEyebrow',
  'GCard', 'GCardRaised', 'GWell', 'GHeroCard',
  'GStat', 'GDotNumber', 'GBigNumber', 'GDelta',
  'GButton', 'GPill', 'GPillNav', 'GChip', 'GSegmented', 'GTabs', 'GBadge', 'GTag', 'GToggle', 'GCheck',
  'GInput', 'GSelect', 'GField', 'GSearch', 'GTextarea', 'GDateTime', 'GAsk', 'GSwatch',
  'GList', 'GRow', 'GTable', 'GKeyValue',
  'GSheet', 'GDrawer', 'GDialog', 'GPopover', 'GMenu', 'GTooltip', 'GToast',
  'GEmpty', 'GProgress', 'GSkeleton', 'GErrorLine', 'GSampleBadge',
];

/** Overlays render only into a portal once mounted in a browser (and toasts only when raised). */
const BROWSER_ONLY = ['GSheet', 'GDrawer', 'GDialog', 'GToast'];

describe('kit exports (AC00.15, ACGP3.1)', () => {
  it('G_KIT_PART1 is exactly the lane-1d rows of X1', () => {
    expect([...G.G_KIT_PART1].sort()).toEqual([...X1_PART1].sort());
  });

  it('every primitive is exported from components/g/index.ts', () => {
    for (const name of X1_PART1) expect(['function', 'object'], name).toContain(typeof (G as Record<string, unknown>)[name]);
  });

  it('every primitive carries its data-g in source', () => {
    const src = ['Frame', 'Surfaces', 'Numbers', 'Controls', 'Inputs', 'Lists', 'States', 'Overlays']
      .map((f) => readFileSync(path.join(root, 'components/g', `${f}.tsx`), 'utf8'))
      .concat(readFileSync(path.join(root, 'components/ui/Toast.tsx'), 'utf8'))
      .join('\n');
    for (const name of X1_PART1) expect(src.includes(`'data-g': '${name}'`) || src.includes(`data-g="${name}"`) || src.includes(`surface('${name}'`) || src.includes(`: '${name}'}`), name).toBe(true);
  });
});

describe('the gallery renders every primitive (AC00.15)', () => {
  const markup = html(h(KitGallery));
  const seen = dataG(markup);
  it('every non-overlay primitive appears with its data-g', () => {
    const missing = X1_PART1.filter((n) => !BROWSER_ONLY.includes(n) && !seen.has(n));
    expect(missing).toEqual([]);
  });
  it('carries a Sample badge: every number on it is a fixture', () => {
    expect(markup).toContain('data-sample-badge');
  });
  it('the shared toast is the kit GToast', () => {
    const t = html(h(ToastStack, { items: [toToastItem({ text: 'Removed', tone: 'ok', action: { label: 'Undo', onClick: () => {} } }, 1)], onDismiss: () => {} }));
    expect(t).toContain('data-g="GToast"');
  });
});

describe('GDotNumber (C7, ACGP3.2)', () => {
  it('has a 5×7 glyph for every C7 character', () => {
    for (const c of DOT_CHARSET) {
      expect(DOT_GLYPHS[c], c).toHaveLength(7);
      for (const row of DOT_GLYPHS[c]) expect(row).toMatch(/^[01]{5}$/);
    }
  });
  it('renders every glyph as dots, never text', () => {
    const m = html(h(G.GDotNumber, { value: DOT_CHARSET, size: 4 }));
    expect(m).toContain('<svg');
    expect(m).not.toContain('g-dotnum-text');
    expect(m).toContain(`aria-label="${DOT_CHARSET}"`);
  });
  it('uppercases units, keeps the x multiplier, refuses unknown characters', () => {
    expect(dotText('$158k')).toBe('$158K');
    expect(dotText('1.2m')).toBe('1.2M');
    expect(dotText('2.29x')).toBe('2.29x');
    expect(dotText('1.2 days')).toBeNull();
    const m = html(h(G.GDotNumber, { value: '1.2 days' }));
    expect(m).toContain('1.2 days');
    expect(m).toContain('g-dotnum-text');
  });
  it('null is the not-applicable bar, never 0', () => {
    const m = html(h(G.GDotNumber, { value: null }));
    expect(m).toContain('aria-label="Not applicable"');
  });
  it('auto-fit never overflows: $631K at 120, 225, 290, 400', () => {
    const chars = '$631K'.length;
    const expected: Record<number, number | null> = { 120: null, 225: 5, 290: 7, 400: 7 };
    for (const [w, size] of Object.entries(expected)) {
      const fit = fitDotSize(chars, Number(w));
      expect(fit, `width ${w}`).toBe(size);
      if (fit !== null) expect(dotWidth(chars, fit)).toBeLessThanOrEqual(Number(w));
    }
  });
  it('auto-fit holds for every width and length (exact geometry, not the 8.6 estimate)', () => {
    for (let chars = 1; chars <= 12; chars++) {
      for (let w = 10; w <= 900; w += 7) {
        const fit = fitDotSize(chars, w);
        if (fit === null) expect(dotWidth(chars, 3)).toBeGreaterThan(w);
        else expect(dotWidth(chars, fit)).toBeLessThanOrEqual(w);
      }
    }
  });
  it('C6: dots up to six characters, text beyond', () => {
    expect(prefersDots('$631K')).toBe(true);
    expect(prefersDots('12,431')).toBe(true);
    expect(prefersDots('12,431,000')).toBe(false);
    const stat = html(h(G.GStat, { value: '12,431,000', label: 'Reach', source: 'Fixture' }));
    expect(stat).toContain('g-stat-text');
  });
});

describe('GStat and GHeroCard honesty (FR-18, AC00.16)', () => {
  it('GStat: null is a dash with its source in the title; unconfigured names the key', () => {
    const m = html(h(G.GStat, { value: null, label: 'Payouts', source: 'Stripe payouts', state: 'unconfigured', missing: 'STRIPE_SECRET_KEY' }));
    expect(m).toContain('title="Stripe payouts · not configured: STRIPE_SECRET_KEY"');
    expect(m).toContain('aria-label="Not configured"');
    expect(html(h(G.GStat, { value: null, label: 'Replies', source: 'x' }))).toContain('aria-label="Not applicable"');
  });
  it('GStat with href is a link to where the number lives; without one it is display-only', () => {
    expect(html(h(G.GStat, { value: 12, label: 'Leads', source: 'x', href: '/funnel' }))).toMatch(/^<a[^>]*href="\/funnel"/);
    expect(html(h(G.GStat, { value: 12, label: 'Leads', source: 'x' }))).toMatch(/^<div/);
  });
  it('GHeroCard unconfigured renders a div with a Set up link (anchors never nest)', () => {
    const m = html(h(G.GHeroCard, { caption: 'Payments', setupHref: '/integrations#stripe' }));
    expect(m).toMatch(/^<div[^>]*data-g="GHeroCard"/);
    expect(m).toContain('href="/integrations#stripe"');
    expect(m).toContain('Not configured');
    expect((m.match(/<a /g) ?? []).length).toBe(1);
  });
  it('required props are enforced by the type system', () => {
    // @ts-expect-error a hero with neither a value nor an action is decoration
    const noValue: GHeroCardProps = { caption: 'x' };
    // @ts-expect-error a stat must say where its number comes from
    const noSource: GStatProps = { value: 1, label: 'x' };
    expect(noValue && noSource).toBeTruthy();
  });
});

describe('GDelta on lib/delta (C41)', () => {
  it('percent, flat, absolute above 999%, absolute off a zero base, small base hidden', () => {
    expect(html(h(G.GDelta, { cur: 101.4, prev: 100 }))).toContain('+1.4%');
    expect(html(h(G.GDelta, { cur: 100.01, prev: 100 }))).toContain('data-tone="neutral"');
    expect(html(h(G.GDelta, { cur: 375000, prev: 22000, money: true }))).toContain('vs previous');
    expect(html(h(G.GDelta, { cur: 12, prev: 0 }))).toContain('vs nothing before');
    expect(html(h(G.GDelta, { cur: 19, prev: 2, min: 5 }))).toBe('');
    expect(html(h(G.GDelta, { cur: 88, prev: 100, window: 'vs previous 30 days' }))).toContain('vs previous 30 days');
  });
});

describe('controls and states', () => {
  it('GButton: href renders a link; disabled renders a disabled button with its reason', () => {
    expect(html(h(G.GButton, { href: '/setup' }, 'Open'))).toMatch(/^<a[^>]*href="\/setup"/);
    const off = html(h(G.GButton, { href: '/setup', disabled: true, disabledReason: 'No key yet' }, 'Open'));
    expect(off).toMatch(/^<button[^>]*disabled/);
    expect(off).toContain('title="No key yet"');
  });
  it('GButton busy keeps its label in the DOM (width kept) and is not clickable', () => {
    const m = html(h(G.GButton, { busy: true }, 'Save'));
    expect(m).toContain('data-busy="true"');
    expect(m).toContain('disabled');
    expect(m).toContain('Save');
  });
  it('GSegmented is a radiogroup with one tab stop', () => {
    const m = html(h(G.GSegmented, { label: 'Range', value: 'b', onChange: () => {}, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }));
    expect(m).toContain('role="radiogroup"');
    expect(m.match(/tabindex="0"/g)).toHaveLength(1);
    expect(m).toMatch(/aria-checked="true"[^>]*tabindex="0"/);
  });
  it('GEmpty unconfigured carries the Not configured tag and a Set up link', () => {
    const m = html(h(G.GEmpty, { kind: 'unconfigured', title: 'Not connected', setupHref: '/integrations#zernio', setupHint: 'set ZERNIO_API_KEY' }));
    expect(m).toContain('Not configured');
    expect(m).toContain('href="/integrations#zernio"');
    expect(m).toContain('title="set ZERNIO_API_KEY"');
  });
  it('GSampleBadge names its fixture', () => {
    expect(html(h(G.GSampleBadge, { fixture: 'demo store' }))).toContain('title="Sample data: demo store"');
  });
  it('closed overlays render nothing; open ones wait for the browser portal', () => {
    expect(html(h(G.GSheet, { open: false, onClose: () => {}, title: 'x' }))).toBe('');
    expect(html(h(G.GSheet, { open: true, onClose: () => {}, title: 'x' }))).toBe('');
  });
});

describe('pure helpers', () => {
  it('rovingIndex: arrows wrap and skip disabled; Home/End; other keys ignored', () => {
    const dis = [false, true, false, false];
    expect(rovingIndex('ArrowRight', 0, dis)).toBe(2);
    expect(rovingIndex('ArrowLeft', 0, dis)).toBe(3);
    expect(rovingIndex('ArrowRight', 3, dis)).toBe(0);
    expect(rovingIndex('Home', 3, [true, false, false])).toBe(1);
    expect(rovingIndex('End', 0, [false, false, true])).toBe(1);
    expect(rovingIndex('ArrowDown', 0, dis)).toBeNull();
    expect(rovingIndex('ArrowDown', 0, dis, 'vertical')).toBe(2);
    expect(rovingIndex('a', 0, dis)).toBeNull();
  });
  it('swipeCloses: 80px to the right, mostly horizontal', () => {
    expect(swipeCloses(80, 10)).toBe(true);
    expect(swipeCloses(79, 0)).toBe(false);
    expect(swipeCloses(120, 100)).toBe(false);
    expect(swipeCloses(-120, 0)).toBe(false);
  });
  it('table sort: numbers start descending, text ascending; nulls last; stable', () => {
    expect(nextSort(null, 'v', true)).toEqual({ key: 'v', dir: 'desc' });
    expect(nextSort(null, 'n', false)).toEqual({ key: 'n', dir: 'asc' });
    expect(nextSort({ key: 'v', dir: 'desc' }, 'v', true)).toEqual({ key: 'v', dir: 'asc' });
    const rows = [{ v: 2 }, { v: null }, { v: 9 }, { v: 2 }];
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([9, 2, 2, null]);
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([2, 2, 9, null]);
  });
  it('textarea grows to 8 lines, then scrolls', () => {
    expect(textareaHeight(40, 20, 18)).toBe(40);
    expect(textareaHeight(10, 20, 18)).toBe(38);
    expect(textareaHeight(900, 20, 18)).toBe(178);
  });
});
