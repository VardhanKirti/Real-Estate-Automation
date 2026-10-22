/**
 * Pure bar geometry for the stage charts (SPEC S02 §5.3, X4).
 *
 * One rule for every stage column: height is linear in the measured value
 * (`h = max(minH, value / max * plotH)`), so a bar twice the dollars is twice
 * as tall. A zero or missing value draws a `minH` stub flagged `zero`, which
 * the renderer paints as a track-coloured honest zero (still clickable). No
 * offsets, no log scale: the headers carry the exact figures and the bars
 * must agree with them (AC02.13).
 *
 * Shared by the GladOS `GBarChart variant="stages"` and the Classic
 * PipelineChart when it is asked to size bars by a measure other than count.
 */

export type StageBar = {
  /** Rendered height in px, never below `minH`. */
  h: number;
  /** value / max, 0..1 (0 when the column or the whole chart is zero). */
  frac: number;
  /** True when the value is zero, negative or not a finite number: draw a stub. */
  zero: boolean;
};

/** A finite, non-negative number, or 0. */
function clean(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function stageBarGeometry(values: readonly number[], plotH: number, minH = 6): StageBar[] {
  const vals = values.map(clean);
  const max = Math.max(0, ...vals);
  const usable = Math.max(0, plotH);
  return vals.map((v) => {
    if (v === 0) return { h: minH, frac: 0, zero: true };
    const frac = v / max;
    return { h: Math.max(minH, frac * usable), frac, zero: false };
  });
}

export type StackSegment = {
  key: 'won' | 'lost';
  value: number;
  /** Offset from the top of the bar, px. */
  y: number;
  /** Segment height, px. */
  h: number;
};

/**
 * Splits a stacked Closed bar of total height `height` into won (top) over
 * lost (below), proportional to their values, with a `gap` px separator
 * between them. One non-zero part renders as one full-height segment with no
 * gap (S02 §8). Both zero returns no segments: the caller draws the stub.
 */
export function stackSegments(won: number, lost: number, height: number, gap = 2): StackSegment[] {
  const w = clean(won);
  const l = clean(lost);
  const H = Math.max(0, height);
  if (w === 0 && l === 0) return [];
  if (l === 0) return [{ key: 'won', value: w, y: 0, h: H }];
  if (w === 0) return [{ key: 'lost', value: l, y: 0, h: H }];
  // Too short to afford a gap: keep both parts, drop the separator.
  const g = H > gap + 2 ? gap : 0;
  const body = H - g;
  const wonH = (w / (w + l)) * body;
  return [
    { key: 'won', value: w, y: 0, h: wonH },
    { key: 'lost', value: l, y: wonH + g, h: body - wonH },
  ];
}

/* ── Kit data viz geometry (SPEC Phase 1 lane 1e, GP3) ───────────────────────
 * Pure helpers behind the components/g data viz. Every function here is unit
 * tested in tests/chart-geometry.test.ts; the components only draw.
 */

/** Clamp a value into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export type StackPart = { index: number; value: number; y: number; h: number };

/**
 * General stack: `values` from top to bottom inside a bar of `height` px,
 * proportional, with `gap` px between visible parts (S00 §5.3: a 2px gap
 * instead of strokes). Zero, negative and non-finite parts are skipped; one
 * visible part fills the bar with no gap. The gaps are dropped when the bar
 * is too short to afford them.
 */
export function stackParts(values: readonly number[], height: number, gap = 2): StackPart[] {
  const vis = values.map((v, index) => ({ index, value: clean(v) })).filter((p) => p.value > 0);
  const H = Math.max(0, height);
  if (vis.length === 0) return [];
  const gaps = vis.length - 1;
  const g = H > gaps * gap + vis.length * 2 ? gap : 0;
  const body = H - gaps * g;
  const total = vis.reduce((s, p) => s + p.value, 0);
  let y = 0;
  return vis.map((p) => {
    const h = (p.value / total) * body;
    const out = { index: p.index, value: p.value, y, h };
    y += h + g;
    return out;
  });
}

export type SignedBar = { y: number; h: number; neg: boolean; zero: boolean };

/**
 * Bars for a signed series (S02 §5.7 business chart, Net view). When every
 * value is ≥ 0 the baseline sits at the bottom of the plot; when any value
 * is negative the baseline is placed by the ratio of the largest positive to
 * the largest negative magnitude, and negative bars hang below it (a real
 * sign, not `abs`). `y` is the bar top in px from the plot top. A zero draws
 * a `minH` stub on the baseline, flagged.
 */
export function signedBars(values: readonly (number | null)[], plotH: number, minH = 4): { bars: SignedBar[]; baseline: number } {
  const vals = values.map((v) => (v !== null && Number.isFinite(v) ? v : 0));
  const pos = Math.max(0, ...vals);
  const neg = Math.max(0, ...vals.map((v) => -v));
  const H = Math.max(0, plotH);
  const span = pos + neg;
  const baseline = span === 0 ? H : (pos / span) * H;
  const unit = span === 0 ? 0 : H / span;
  const bars = vals.map((v) => {
    if (v === 0) return { y: baseline - (neg > 0 ? minH / 2 : minH), h: minH, neg: false, zero: true };
    const h = Math.max(minH, Math.abs(v) * unit);
    return v > 0 ? { y: baseline - h, h, neg: false, zero: false } : { y: baseline, h, neg: true, zero: false };
  });
  return { bars, baseline };
}

/** Index of the largest finite value, or -1. Ties go to the first. */
export function peakIndex(values: readonly (number | null)[]): number {
  let best = -1;
  let bestV = -Infinity;
  values.forEach((v, i) => {
    if (v !== null && Number.isFinite(v) && v > bestV) { best = i; bestV = v; }
  });
  return best;
}

/**
 * Which x labels to print. Default: at most 3 (S00 §5.3), first, middle and
 * last. `everyOtherAbove` (S02 Touches: every other label above 8 buckets)
 * keeps every other index plus the last instead, still capped at `max`.
 */
export function labelIndices(n: number, opts: { max?: number; everyOtherAbove?: number } = {}): number[] {
  if (n <= 0) return [];
  const { max = 3, everyOtherAbove } = opts;
  if (everyOtherAbove !== undefined) {
    if (n <= everyOtherAbove) return Array.from({ length: n }, (_, i) => i).slice(0, Math.max(max, n));
    const out: number[] = [];
    for (let i = 0; i < n; i += 2) out.push(i);
    if (out[out.length - 1] !== n - 1) out.push(n - 1);
    return out;
  }
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  if (max <= 1) return [n - 1];
  const out = new Set<number>();
  for (let k = 0; k < max; k++) out.add(Math.round((k * (n - 1)) / (max - 1)));
  return Array.from(out).sort((a, b) => a - b);
}

/** Min and max of the finite values; [0, 0] when none. `zero` pulls the range to include 0. */
export function extent(values: readonly (number | null)[], zero = true): [number, number] {
  const f = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (f.length === 0) return [0, 0];
  let lo = Math.min(...f);
  let hi = Math.max(...f);
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  return [lo, hi];
}

export type XY = { x: number; y: number };
export type PathSegment = { d: string; dashed: boolean };

/**
 * Line paths for one series. Value i maps to `xs[i]` and `yOf(v)`; a null
 * value breaks the line (honest gap, never interpolated). `carried[i]` marks
 * a value carried forward from an older snapshot (S03 F4): the segment that
 * ends on a carried point is drawn dashed. `step` draws horizontal then
 * vertical (S02 Touches). Consecutive segments of the same kind share one
 * path so the dash pattern runs on.
 */
export function seriesPaths(
  values: readonly (number | null)[],
  xs: readonly number[],
  yOf: (v: number) => number,
  opts: { step?: boolean; carried?: readonly boolean[] } = {},
): PathSegment[] {
  const { step = false, carried } = opts;
  const out: PathSegment[] = [];
  let cur: PathSegment | null = null;
  let prev: XY | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) { cur = null; prev = null; continue; }
    const p = { x: xs[i], y: yOf(v) };
    if (!prev) { prev = p; cur = null; continue; }
    const dashed = !!carried?.[i];
    if (!cur || cur.dashed !== dashed) {
      cur = { d: `M${r2(prev.x)} ${r2(prev.y)}`, dashed };
      out.push(cur);
    }
    cur.d += step ? ` H${r2(p.x)} V${r2(p.y)}` : ` L${r2(p.x)} ${r2(p.y)}`;
    prev = p;
  }
  return out;
}

/** Closed areas under one series down to `baseY`, split at null gaps (carried points still fill; the dash marks them). */
export function areaPaths(values: readonly (number | null)[], xs: readonly number[], yOf: (v: number) => number, baseY: number, step = false): string[] {
  const runs: XY[][] = [];
  let run: XY[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { if (run.length) runs.push(run); run = []; return; }
    run.push({ x: xs[i], y: yOf(v) });
  });
  if (run.length) runs.push(run);
  return runs.filter((q) => q.length > 1).map((q) => {
    let d = `M${r2(q[0].x)} ${r2(baseY)} L${r2(q[0].x)} ${r2(q[0].y)}`;
    for (let i = 1; i < q.length; i++) d += step ? ` H${r2(q[i].x)} V${r2(q[i].y)}` : ` L${r2(q[i].x)} ${r2(q[i].y)}`;
    return `${d} L${r2(q[q.length - 1].x)} ${r2(baseY)} Z`;
  });
}

/** Evenly spaced x positions across [left, right]; a single point sits in the middle. */
export function spreadX(n: number, left: number, right: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(left + right) / 2];
  const step = (right - left) / (n - 1);
  return Array.from({ length: n }, (_, i) => left + i * step);
}

/** Index of the x nearest to `x` (hover column lookup); -1 when empty. */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = -1;
  let bestD = Infinity;
  xs.forEach((xi, i) => {
    const d = Math.abs(xi - x);
    if (d < bestD) { best = i; bestD = d; }
  });
  return best;
}

/**
 * Left edge for a tooltip of width `tipW` centred on `x`, clamped `pad` px
 * inside a container `containerW` wide (S00 GChartTooltip: clamped 12px
 * inside its card). A tip wider than the room pins to the left pad.
 */
export function clampTip(x: number, tipW: number, containerW: number, pad = 12): number {
  const lo = pad;
  const hi = containerW - pad - tipW;
  if (hi < lo) return lo;
  return clamp(x - tipW / 2, lo, hi);
}

export type DonutArc = { index: number; start: number; end: number; value: number; frac: number };

/**
 * Donut slices in degrees, clockwise from 12 o'clock (S00 §5.3: round caps,
 * 2° gaps). A round cap extends each end by half the stroke, so each drawn
 * arc is trimmed by the cap angle to keep the *visible* gap at `gapDeg`. A
 * slice too small to survive the trim keeps a `minDeg` sliver centred on its
 * share. Zero and invalid values are skipped; one slice is a full ring.
 */
export function donutArcs(values: readonly number[], opts: { gapDeg?: number; strokePx?: number; radius?: number; minDeg?: number } = {}): DonutArc[] {
  const { gapDeg = 2, strokePx = 0, radius = 1, minDeg = 0.5 } = opts;
  const vis = values.map((v, index) => ({ index, value: clean(v) })).filter((p) => p.value > 0);
  const total = vis.reduce((s, p) => s + p.value, 0);
  if (total === 0) return [];
  if (vis.length === 1) return [{ index: vis[0].index, start: 0, end: 360, value: vis[0].value, frac: 1 }];
  const capDeg = radius > 0 ? (strokePx / 2 / radius) * (180 / Math.PI) : 0;
  const trim = gapDeg / 2 + capDeg;
  let a = 0;
  return vis.map((p) => {
    const span = (p.value / total) * 360;
    const mid = a + span / 2;
    let start = a + trim;
    let end = a + span - trim;
    if (end - start < minDeg) { start = mid - minDeg / 2; end = mid + minDeg / 2; }
    a += span;
    return { index: p.index, start, end, value: p.value, frac: p.value / total };
  });
}

/** Point on a circle at `deg` clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): XY {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG arc path from `start` to `end` degrees (clockwise from 12 o'clock). A full turn draws two half arcs. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const sweep = end - start;
  if (sweep <= 0) return '';
  if (sweep >= 359.999) {
    const a = polar(cx, cy, r, 0);
    const b = polar(cx, cy, r, 180);
    return `M${r2(a.x)} ${r2(a.y)} A${r2(r)} ${r2(r)} 0 1 1 ${r2(b.x)} ${r2(b.y)} A${r2(r)} ${r2(r)} 0 1 1 ${r2(a.x)} ${r2(a.y)}`;
  }
  const p0 = polar(cx, cy, r, start);
  const p1 = polar(cx, cy, r, end);
  return `M${r2(p0.x)} ${r2(p0.y)} A${r2(r)} ${r2(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${r2(p1.x)} ${r2(p1.y)}`;
}

/**
 * Dots lit per column (GDotMatrix). The busiest column (or `max`) fills all
 * `rows`; any non-zero column lights at least one dot, so a small count never
 * reads as zero; zero lights none.
 */
export function dotFill(values: readonly number[], rows: number, max?: number): number[] {
  const vals = values.map(clean);
  const m = max !== undefined && max > 0 ? max : Math.max(0, ...vals);
  return vals.map((v) => (v === 0 || m === 0 ? 0 : clamp(Math.round((v / m) * rows), 1, rows)));
}

/** Heat alpha (GP3 GHeatmap): .08 at `min`, 1 at `max`; null or non-finite is 0 (no fill). */
export function heatAlpha(v: number | null, min: number, max: number): number {
  if (v === null || !Number.isFinite(v)) return 0;
  if (max <= min) return v > 0 && v >= max ? 1 : 0.08;
  return r2(0.08 + 0.92 * clamp((v - min) / (max - min), 0, 1));
}

/** Radar polygon points: axis k at 360·k/n degrees, value/max of radius `r` (clamped to the rim). */
export function radarPoints(values: readonly (number | null)[], max: number, cx: number, cy: number, r: number): XY[] {
  const n = Math.max(1, values.length);
  return values.map((v, k) => {
    const f = max > 0 && v !== null && Number.isFinite(v) ? clamp(v / max, 0, 1) : 0;
    return polar(cx, cy, r * f, (360 * k) / n);
  });
}

export type Rect = { x: number; y: number; w: number; h: number };

function worst(row: number[], short: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  const mx = Math.max(...row);
  const mn = Math.min(...row);
  return s && mn ? Math.max((short * short * mx) / (s * s), (s * s) / (short * short * mn)) : Infinity;
}

/**
 * Squarified treemap (Bruls et al.), the algorithm in
 * `components/database/DatabaseExplorer.tsx`. `areas` must already be scaled
 * to the rect's area and sorted largest first.
 */
export function squarify(areas: readonly number[], r: Rect): Rect[] {
  const out: Rect[] = [];
  let { x, y, w, h } = r;
  let i = 0;
  while (i < areas.length) {
    const short = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], short) <= worst(row, short)) row.push(areas[j++]);
    const s = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      const cw = h ? s / h : 0;
      let cy = y;
      for (const a of row) { const ch = cw ? a / cw : 0; out.push({ x, y: cy, w: cw, h: ch }); cy += ch; }
      x += cw; w -= cw;
    } else {
      const rh = w ? s / w : 0;
      let cx = x;
      for (const a of row) { const rw = rh ? a / rh : 0; out.push({ x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; h -= rh;
    }
    i = j;
  }
  return out;
}

/** Scale positive `values` to fill `r` and squarify them; the result keeps input order (null for skipped values). */
export function treemapLayout(values: readonly number[], r: Rect): (Rect | null)[] {
  const idx = values.map((v, i) => ({ i, v: clean(v) })).filter((p) => p.v > 0).sort((a, b) => b.v - a.v);
  const total = idx.reduce((s, p) => s + p.v, 0);
  const out: (Rect | null)[] = values.map(() => null);
  if (total === 0 || r.w <= 0 || r.h <= 0) return out;
  const scale = (r.w * r.h) / total;
  const rects = squarify(idx.map((p) => p.v * scale), r);
  idx.forEach((p, k) => { out[p.i] = rects[k]; });
  return out;
}

/** Inset a rect by `gap / 2` on every side so neighbours sit `gap` apart (never below zero size). */
export function insetRect(q: Rect, gap: number): Rect {
  const g = gap / 2;
  return { x: q.x + g, y: q.y + g, w: Math.max(0, q.w - gap), h: Math.max(0, q.h - gap) };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
