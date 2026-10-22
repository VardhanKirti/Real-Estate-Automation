import { describe, expect, test } from 'vitest';
import {
  arcPath, areaPaths, clampTip, donutArcs, dotFill, extent, heatAlpha, insetRect, labelIndices, nearestIndex, peakIndex, polar,
  radarPoints, seriesPaths, signedBars, spreadX, squarify, stackParts, stageBarGeometry, stackSegments, treemapLayout,
} from '@/lib/chart-geometry';

describe('stageBarGeometry (S02 §5.3)', () => {
  test('heights are linear in the value: the tallest column fills the plot', () => {
    const [a, b, c] = stageBarGeometry([200, 100, 50], 200);
    expect(a.h).toBe(200);
    expect(b.h).toBe(100);
    expect(c.h).toBe(50);
    expect(a.frac).toBe(1);
  });

  test('AC02.13: $121.5K needs approval is 3.33x the $36.5K awaiting bar', () => {
    const [, awaiting, approval] = stageBarGeometry([254_000, 36_500, 121_500, 89_500], 200);
    expect(approval.h / awaiting.h).toBeCloseTo(121_500 / 36_500, 5);
    expect(Math.abs(approval.h / awaiting.h - 3.33) / 3.33).toBeLessThan(0.02);
  });

  test('a tiny non-zero value keeps the minimum height and is not a zero', () => {
    const [, tiny] = stageBarGeometry([1_000_000, 1], 200, 6);
    expect(tiny.h).toBe(6);
    expect(tiny.zero).toBe(false);
  });

  test('zero, negative and non-finite values draw a flagged stub', () => {
    const bars = stageBarGeometry([100, 0, -5, Number.NaN], 200, 6);
    expect(bars.slice(1).every((b) => b.zero && b.h === 6 && b.frac === 0)).toBe(true);
    expect(bars[0].zero).toBe(false);
  });

  test('an all-zero chart is all stubs, never a divide-by-zero', () => {
    const bars = stageBarGeometry([0, 0, 0], 180);
    expect(bars.every((b) => b.zero && Number.isFinite(b.h))).toBe(true);
  });

  test('empty input returns no bars', () => {
    expect(stageBarGeometry([], 200)).toEqual([]);
  });
});

describe('stackSegments', () => {
  test('won sits on top of lost, proportional, with a 2px gap', () => {
    const [won, lost] = stackSegments(48_500, 41_000, 100);
    expect(won.key).toBe('won');
    expect(won.y).toBe(0);
    expect(lost.key).toBe('lost');
    expect(lost.y).toBeCloseTo(won.h + 2, 6);
    expect(won.h + 2 + lost.h).toBeCloseTo(100, 6);
    expect(won.h / lost.h).toBeCloseTo(48_500 / 41_000, 6);
  });

  test('only won or only lost: one full-height segment, no gap', () => {
    expect(stackSegments(10, 0, 80)).toEqual([{ key: 'won', value: 10, y: 0, h: 80 }]);
    expect(stackSegments(0, 10, 80)).toEqual([{ key: 'lost', value: 10, y: 0, h: 80 }]);
  });

  test('nothing closed: no segments (the caller draws the stub)', () => {
    expect(stackSegments(0, 0, 80)).toEqual([]);
  });

  test('a stub-height bar drops the gap rather than going negative', () => {
    const segs = stackSegments(1, 1, 3);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.h >= 0)).toBe(true);
    expect(segs[0].h + segs[1].h).toBeCloseTo(3, 6);
  });
});

describe('ACGP3.4: stages measure="usd" heights are proportional and zero is a 6px stub', () => {
  test('every non-zero bar is value / max × plot within 2%', () => {
    const usd = [254_000, 36_500, 121_500, 89_500, 0];
    const bars = stageBarGeometry(usd, 200);
    usd.forEach((v, i) => {
      if (v === 0) { expect(bars[i].h).toBe(6); expect(bars[i].zero).toBe(true); return; }
      const want = (v / 254_000) * 200;
      expect(Math.abs(bars[i].h - want) / want).toBeLessThan(0.02);
    });
  });
});

describe('stackParts (GStackedBar)', () => {
  test('parts are proportional, top to bottom, with 2px gaps that fill the bar exactly', () => {
    const parts = stackParts([30, 10, 0, 60], 104, 2);
    expect(parts.map((p) => p.index)).toEqual([0, 1, 3]);
    expect(parts[0].y).toBe(0);
    expect(parts[1].y).toBeCloseTo(parts[0].h + 2, 6);
    const last = parts[parts.length - 1];
    expect(last.y + last.h).toBeCloseTo(104, 6);
    expect(parts[0].h / parts[2].h).toBeCloseTo(30 / 60, 6);
  });
  test('one part fills with no gap; nothing visible returns none; a tiny bar drops the gaps', () => {
    expect(stackParts([0, 5], 50)).toEqual([{ index: 1, value: 5, y: 0, h: 50 }]);
    expect(stackParts([0, -1, Number.NaN], 50)).toEqual([]);
    const t = stackParts([1, 1, 1], 5, 2);
    expect(t.reduce((s, p) => s + p.h, 0)).toBeCloseTo(5, 6);
  });
});

describe('signedBars (series variant, Net)', () => {
  test('all positive: baseline at the bottom, heights linear', () => {
    const { bars, baseline } = signedBars([50, 100], 100);
    expect(baseline).toBe(100);
    expect(bars[1].h).toBe(100);
    expect(bars[0].h).toBe(50);
    expect(bars[0].y).toBe(50);
  });
  test('negative values hang below a split baseline (a real sign, not abs)', () => {
    const { bars, baseline } = signedBars([75, -25], 100);
    expect(baseline).toBe(75);
    expect(bars[0]).toMatchObject({ y: 0, h: 75, neg: false });
    expect(bars[1]).toMatchObject({ y: 75, h: 25, neg: true });
  });
  test('zero and null draw a flagged stub on the baseline', () => {
    const { bars } = signedBars([0, null, 10], 100, 4);
    expect(bars[0].zero && bars[1].zero).toBe(true);
    expect(bars[0].h).toBe(4);
  });
});

describe('axes and cursors', () => {
  test('peakIndex: first largest finite value', () => {
    expect(peakIndex([1, 5, null, 5, Number.NaN])).toBe(1);
    expect(peakIndex([null])).toBe(-1);
  });
  test('labelIndices: at most 3 (first, middle, last)', () => {
    expect(labelIndices(10)).toEqual([0, 5, 9]);
    expect(labelIndices(2)).toEqual([0, 1]);
    expect(labelIndices(0)).toEqual([]);
  });
  test('labelIndices: every other above the threshold, always the last', () => {
    expect(labelIndices(6, { everyOtherAbove: 8 })).toEqual([0, 1, 2, 3, 4, 5]);
    expect(labelIndices(10, { everyOtherAbove: 8 })).toEqual([0, 2, 4, 6, 8, 9]);
  });
  test('extent includes zero by default and ignores null', () => {
    expect(extent([3, null, 7])).toEqual([0, 7]);
    expect(extent([3, 7], false)).toEqual([3, 7]);
    expect(extent([])).toEqual([0, 0]);
  });
  test('spreadX and nearestIndex', () => {
    expect(spreadX(3, 0, 100)).toEqual([0, 50, 100]);
    expect(spreadX(1, 0, 100)).toEqual([50]);
    expect(nearestIndex([0, 50, 100], 70)).toBe(1);
    expect(nearestIndex([], 5)).toBe(-1);
  });
  test('clampTip keeps the tip 12px inside its card', () => {
    expect(clampTip(10, 100, 400)).toBe(12);
    expect(clampTip(395, 100, 400)).toBe(288);
    expect(clampTip(200, 100, 400)).toBe(150);
    expect(clampTip(50, 500, 400)).toBe(12);
  });
});

describe('seriesPaths and areaPaths (GLineChart / GAreaChart)', () => {
  const xs = [0, 10, 20, 30];
  const yOf = (v: number) => 100 - v;
  test('a null breaks the line, never interpolated; a lone point draws nothing', () => {
    const segs = seriesPaths([1, 2, null, 4], xs, yOf);
    expect(segs).toHaveLength(1);
    expect(segs[0].d).toBe('M0 99 L10 98');
  });
  test('carried points dash the segment that ends on them (S03 F4)', () => {
    const segs = seriesPaths([1, 2, 2, 2], xs, yOf, { carried: [false, false, true, true] });
    expect(segs.map((s) => s.dashed)).toEqual([false, true]);
    expect(segs[1].d).toBe('M10 98 L20 98 L30 98');
  });
  test('step draws horizontal then vertical', () => {
    expect(seriesPaths([1, 3], [0, 10], yOf, { step: true })[0].d).toBe('M0 99 H10 V97');
  });
  test('areas close down to the baseline and split at gaps', () => {
    const a = areaPaths([1, 2, null, 4, 5], [0, 10, 20, 30, 40], yOf, 100);
    expect(a).toHaveLength(2);
    expect(a[0]).toBe('M0 100 L0 99 L10 98 L10 100 Z');
  });
});

describe('donutArcs (GDonut: round caps, 2° visible gaps)', () => {
  test('slices are proportional and trimmed by half the gap', () => {
    const arcs = donutArcs([1, 1], { gapDeg: 2, strokePx: 0, radius: 80 });
    expect(arcs[0]).toMatchObject({ start: 1, end: 179, frac: 0.5 });
    expect(arcs[1]).toMatchObject({ start: 181, end: 359 });
  });
  test('round caps widen the trim so the visible gap stays 2°', () => {
    const r = 80;
    const sw = 16;
    const cap = (sw / 2 / r) * (180 / Math.PI);
    const arcs = donutArcs([1, 1], { gapDeg: 2, strokePx: sw, radius: r });
    expect(arcs[0].start).toBeCloseTo(1 + cap, 6);
    expect(arcs[1].start - arcs[0].end - 2 * cap).toBeCloseTo(2, 6);
  });
  test('one slice is a full ring; zeros are skipped; a tiny slice keeps a sliver', () => {
    expect(donutArcs([0, 7])).toEqual([{ index: 1, start: 0, end: 360, value: 7, frac: 1 }]);
    expect(donutArcs([0, 0])).toEqual([]);
    const tiny = donutArcs([1000, 1], { gapDeg: 2, strokePx: 16, radius: 80 })[1];
    expect(tiny.end - tiny.start).toBeCloseTo(0.5, 6);
  });
  test('arcPath and polar', () => {
    const p = polar(50, 50, 10, 0);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(40);
    expect(arcPath(50, 50, 10, 0, 90)).toBe('M50 40 A10 10 0 0 1 60 50');
    expect(arcPath(50, 50, 10, 0, 360)).toContain('A10 10 0 1 1 50 60');
    expect(arcPath(50, 50, 10, 10, 10)).toBe('');
  });
});

describe('dotFill, heatAlpha, radarPoints', () => {
  test('the busiest column fills; a small non-zero lights one dot; zero lights none', () => {
    expect(dotFill([24, 12, 1, 0], 6)).toEqual([6, 3, 1, 0]);
    expect(dotFill([3], 6, 6)).toEqual([3]);
    expect(dotFill([0, 0], 6)).toEqual([0, 0]);
  });
  test('heat alpha runs .08 to 1; null draws nothing', () => {
    expect(heatAlpha(0, 0, 10)).toBe(0.08);
    expect(heatAlpha(10, 0, 10)).toBe(1);
    expect(heatAlpha(5, 0, 10)).toBe(0.54);
    expect(heatAlpha(null, 0, 10)).toBe(0);
  });
  test('radar points sit on their axis at value / max of the radius', () => {
    const [a, b] = radarPoints([100, 50, null, 200], 100, 0, 0, 10);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(-10);
    expect(b.x).toBeCloseTo(5);
    expect(b.y).toBeCloseTo(0);
  });
});

describe('squarify / treemapLayout (GTreemap)', () => {
  test('rects tile the area exactly and stay inside it', () => {
    const rects = treemapLayout([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 600, h: 400 });
    const area = rects.reduce((s, q) => s + (q ? q.w * q.h : 0), 0);
    expect(area).toBeCloseTo(240_000, 3);
    for (const q of rects) {
      expect(q!.x).toBeGreaterThanOrEqual(-1e-6);
      expect(q!.x + q!.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(q!.y + q!.h).toBeLessThanOrEqual(400 + 1e-6);
    }
  });
  test('each block area is proportional to its value, in input order', () => {
    const rects = treemapLayout([1, 3, 0], { x: 0, y: 0, w: 100, h: 100 });
    expect(rects[2]).toBeNull();
    expect((rects[1]!.w * rects[1]!.h) / (rects[0]!.w * rects[0]!.h)).toBeCloseTo(3, 6);
  });
  test('one item fills the rect', () => {
    expect(squarify([100], { x: 0, y: 0, w: 10, h: 10 })).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  });
  test('insetRect keeps neighbours a gap apart and never goes negative', () => {
    expect(insetRect({ x: 0, y: 0, w: 100, h: 50 }, 4)).toEqual({ x: 2, y: 2, w: 96, h: 46 });
    expect(insetRect({ x: 0, y: 0, w: 2, h: 2 }, 4)).toMatchObject({ w: 0, h: 0 });
  });
});
