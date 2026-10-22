/**
 * Content Lab geometry (SPEC §5.2): the pure layout maths behind the three signature
 * elements, shared by the Classic and GladOS trees so both draw the same Strand, the
 * same Field and the same Tide. No React, no DOM, no colour: inputs are view-model
 * numbers (lib/lab/view.ts), outputs are percentages or pixels inside a box the caller
 * chooses. Everything here is deterministic and unit-tested (tests/lab-geometry.test.ts).
 *
 * - Strand: `strandLayout` turns a StrandView's beats into drawable segments. Beats keep
 *   their share of the runtime, except that a beat too thin to see is widened to
 *   `minPct` and the rest are scaled down to make room, so every beat stays visible and
 *   the bar still sums to 100. The hook span and rehook ticks are remapped onto the
 *   same widened axis so the underline and ticks line up with their segments.
 * - Field: `logScale` maps a positive value onto a pixel range on a log10 axis
 *   (clamped to the domain), `logTicks` picks 1-2-5 ticks inside a domain,
 *   `fieldLayout` places every point (dot radius from the view's 0-1 `r`), and
 *   `quadrantLayout` splits the plot at the niche medians and anchors the four labels.
 * - Tide: `stackSeries` stacks series bottom to top and `areaPath` draws one band.
 */

export type Box = { x: number; y: number; w: number; h: number };

/* ── Strand ─────────────────────────────────────────────────────────────── */

export type StrandBeatIn = { type: string; startPct: number; endPct: number };
export type StrandSegment<B extends StrandBeatIn = StrandBeatIn> = { beat: B; index: number; leftPct: number; widthPct: number };
export type StrandLayout<B extends StrandBeatIn = StrandBeatIn> = {
  segments: StrandSegment<B>[];
  /** The hook underline on the drawn axis, or null. */
  hook: { leftPct: number; widthPct: number } | null;
  /** Rehook tick positions on the drawn axis. */
  ticks: number[];
};

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Lay a strand out on a 0-100 axis. `minPct` (default 1.5) is the narrowest a beat may
 * draw; widening is paid for proportionally by the beats wider than the minimum.
 * Beats are expected sorted and non-overlapping (the view guarantees it); gaps between
 * them are kept as gaps.
 */
export function strandLayout<B extends StrandBeatIn>(
  beats: readonly B[],
  marks: { hook?: { startPct: number; endPct: number } | null; rehookTicks?: readonly number[] } = {},
  minPct = 1.5,
): StrandLayout<B> {
  const raw = beats.map((b) => Math.max(0, b.endPct - b.startPct));
  const total = raw.reduce((a, w) => a + w, 0);
  if (beats.length === 0 || total <= 0) return { segments: [], hook: null, ticks: [] };
  const floor = Math.min(minPct, total / beats.length);
  const thin = raw.map((w) => w < floor);
  const need = raw.reduce((a, w, i) => a + (thin[i] ? floor - w : 0), 0);
  const wideTotal = raw.reduce((a, w, i) => a + (thin[i] ? 0 : w - floor), 0);
  const widths = raw.map((w, i) => (thin[i] ? floor : wideTotal > 0 ? w - ((w - floor) / wideTotal) * need : w));

  // drawn position of every original breakpoint, so marks can be remapped piecewise-linearly
  const segments: StrandSegment<B>[] = [];
  const map: { from: [number, number]; to: [number, number] }[] = [];
  let cursor = beats[0].startPct;
  beats.forEach((b, i) => {
    const gap = i === 0 ? 0 : Math.max(0, b.startPct - beats[i - 1].endPct);
    cursor += gap;
    segments.push({ beat: b, index: i, leftPct: round(cursor), widthPct: round(widths[i]) });
    map.push({ from: [b.startPct, b.endPct], to: [cursor, cursor + widths[i]] });
    cursor += widths[i];
  });
  const remap = (p: number): number => {
    for (const m of map) {
      if (p >= m.from[0] && p <= m.from[1]) {
        const span = m.from[1] - m.from[0];
        return round(span > 0 ? m.to[0] + ((p - m.from[0]) / span) * (m.to[1] - m.to[0]) : m.to[0]);
      }
    }
    return round(p);
  };
  const hook = marks.hook ? { leftPct: remap(marks.hook.startPct), widthPct: round(remap(marks.hook.endPct) - remap(marks.hook.startPct)) } : null;
  return { segments, hook, ticks: (marks.rehookTicks ?? []).map(remap) };
}

/* ── Field: log axes ────────────────────────────────────────────────────── */

/** Clamp a domain to positive, ordered, non-degenerate bounds (log-safe). */
export function safeDomain(d: readonly [number, number]): [number, number] {
  let lo = Number.isFinite(d[0]) && d[0] > 0 ? d[0] : 1e-3;
  let hi = Number.isFinite(d[1]) && d[1] > 0 ? d[1] : lo * 10;
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi / lo < 1.0001) { lo /= 2; hi *= 2; }
  return [lo, hi];
}

/** A log10 scale from `domain` onto `range` (pixels; range may run downwards for a y axis). Values clamp to the domain; output is rounded to 3 decimals. */
export function logScale(domain: readonly [number, number], range: readonly [number, number]): (v: number) => number {
  const [lo, hi] = safeDomain(domain);
  const a = Math.log10(lo);
  const span = Math.log10(hi) - a;
  return (v: number) => {
    const c = Math.min(hi, Math.max(lo, Number.isFinite(v) && v > 0 ? v : lo));
    // rounded so server and browser render the same attribute text (their log10 can differ in the last bit)
    return round(range[0] + ((Math.log10(c) - a) / span) * (range[1] - range[0]), 3);
  };
}

/**
 * Ticks on a log axis: the 1-2-5 sequence inside the domain. When that yields more than
 * `max` ticks only the powers of ten are kept; when it yields fewer than two the domain
 * ends are returned so an axis always has a label at each end.
 */
export function logTicks(domain: readonly [number, number], max = 7): number[] {
  const [lo, hi] = safeDomain(domain);
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(Number(v.toPrecision(6)));
    }
  }
  if (out.length > max) {
    const decades = out.filter((v) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9);
    if (decades.length >= 2) return decades;
  }
  return out.length >= 2 ? out : [Number(lo.toPrecision(3)), Number(hi.toPrecision(3))];
}

/** "0.1x", "1x", "20x" for breakout ticks. */
export const ratioTick = (v: number): string => `${Number(v.toPrecision(2))}x`;
/** "1%", "2%", "10%" (or "0.5%") for depth ticks. */
export const pctTick = (v: number): string => `${Number((v * 100).toPrecision(2))}%`;

export type FieldPointIn = { x: number; y: number; r: number };
export type PlacedPoint<P extends FieldPointIn = FieldPointIn> = P & { px: number; py: number; pr: number };

/**
 * Place points inside the plot box: x and y on log scales, radius between rMin and rMax
 * by the view's 0-1 `r`. Larger dots come first so small ones draw on top.
 */
export function fieldLayout<P extends FieldPointIn>(
  points: readonly P[],
  domain: { x: readonly [number, number]; y: readonly [number, number] },
  plot: Box,
  radius: { min: number; max: number } = { min: 2.5, max: 7 },
): PlacedPoint<P>[] {
  const sx = logScale(domain.x, [plot.x, plot.x + plot.w]);
  const sy = logScale(domain.y, [plot.y + plot.h, plot.y]);
  return points
    .map((p) => ({ ...p, px: round(sx(p.x), 2), py: round(sy(p.y), 2), pr: round(radius.min + Math.min(1, Math.max(0, p.r)) * (radius.max - radius.min), 2) }))
    .sort((a, b) => b.pr - a.pr);
}

export type Quadrant = 'ideal' | 'loyal' | 'clickbait' | 'dud';
export type QuadrantLayout = {
  /** x of the vertical median line, or null when there is no breakout median */
  vx: number | null;
  /** y of the horizontal median line, or null when there is no depth median */
  hy: number | null;
  /** One rect per quadrant with a label anchor in its outer corner. */
  quads: Record<Quadrant, Box & { lx: number; ly: number; align: 'start' | 'end' }>;
};

/**
 * Split the plot at the medians. Depth (y) up, breakout (x) right:
 * loyal = deep but not broad (top left), ideal = both (top right),
 * dud = neither (bottom left), clickbait = broad but shallow (bottom right).
 * Labels sit `inset` px inside each quadrant's outer corner.
 */
export function quadrantLayout(
  domain: { x: readonly [number, number]; y: readonly [number, number] },
  medians: { breakout: number | null; depth: number | null },
  plot: Box,
  inset = 10,
): QuadrantLayout {
  const sx = logScale(domain.x, [plot.x, plot.x + plot.w]);
  const sy = logScale(domain.y, [plot.y + plot.h, plot.y]);
  const vx = medians.breakout !== null && medians.breakout > 0 ? round(sx(medians.breakout), 2) : null;
  const hy = medians.depth !== null && medians.depth > 0 ? round(sy(medians.depth), 2) : null;
  const mx = vx ?? plot.x + plot.w / 2;
  const my = hy ?? plot.y + plot.h / 2;
  const right = plot.x + plot.w;
  const bottom = plot.y + plot.h;
  return {
    vx,
    hy,
    quads: {
      loyal: { x: plot.x, y: plot.y, w: mx - plot.x, h: my - plot.y, lx: plot.x + inset, ly: plot.y + inset, align: 'start' },
      ideal: { x: mx, y: plot.y, w: right - mx, h: my - plot.y, lx: right - inset, ly: plot.y + inset, align: 'end' },
      dud: { x: plot.x, y: my, w: mx - plot.x, h: bottom - my, lx: plot.x + inset, ly: bottom - inset, align: 'start' },
      clickbait: { x: mx, y: my, w: right - mx, h: bottom - my, lx: right - inset, ly: bottom - inset, align: 'end' },
    },
  };
}

/** The point nearest to (x, y) within `within` px, or null (hover and tap on a dense field). */
export function nearestPoint<P extends { px: number; py: number }>(points: readonly P[], x: number, y: number, within = 14): P | null {
  let best: P | null = null;
  let bd = within * within;
  for (const p of points) {
    const d = (p.px - x) ** 2 + (p.py - y) ** 2;
    if (d <= bd) { bd = d; best = p; }
  }
  return best;
}

/* ── Tide: stacked areas ────────────────────────────────────────────────── */

export type StackedBand = { lower: number[]; upper: number[] };

/** Stack series bottom to top (index 0 at the bottom); negative or missing values count as 0. */
export function stackSeries(series: readonly (readonly number[])[]): { bands: StackedBand[]; max: number } {
  const len = Math.max(0, ...series.map((s) => s.length));
  const base = new Array<number>(len).fill(0);
  const bands = series.map((s) => {
    const lower = base.slice();
    for (let i = 0; i < len; i++) base[i] += Math.max(0, Number.isFinite(s[i]) ? s[i] : 0);
    return { lower, upper: base.slice() };
  });
  return { bands, max: Math.max(0, ...base) };
}

/** SVG path for one stacked band inside `box`, values scaled by `max` (straight segments). */
export function areaPath(band: StackedBand, max: number, box: Box): string {
  const n = band.upper.length;
  if (n === 0) return '';
  const x = (i: number) => round(n === 1 ? box.x + box.w / 2 : box.x + (i / (n - 1)) * box.w, 2);
  const y = (v: number) => round(box.y + box.h - (max > 0 ? v / max : 0) * box.h, 2);
  const top = band.upper.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  const bottom = band.lower.map((v, i) => `L${x(i)},${y(v)}`).reverse().join(' ');
  return `${top} ${bottom} Z`;
}
