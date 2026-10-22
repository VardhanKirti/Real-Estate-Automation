/**
 * Pure logic behind the Bennett Legacy kit, ported from FounderOS `kit/format.ts`
 * (v1 terminal.tsx, CountUp.tsx, slab.tsx, VolumeMeter.tsx). Kept out of the
 * components so it is unit-tested directly (tests/l-kit.test.ts).
 */

export type DotState = 'ok' | 'warn' | 'err' | 'off';

const DOT_FOR: Record<string, DotState> = {
  connected: 'ok',
  active: 'ok',
  live: 'ok',
  ok: 'ok',
  available: 'warn',
  warn: 'warn',
  training: 'warn',
  idle: 'warn',
  stale: 'warn',
  error: 'err',
  fail: 'err',
  err: 'err',
  not_configured: 'off',
  planned: 'off',
  off: 'off',
};

export function dotState(state: string): DotState {
  return DOT_FOR[state] ?? 'off';
}

/** One frame of a count: ease-out cubic from `from` to `to` at progress t (0..1). The last frame lands exactly. */
export function countFrame(from: number, to: number, t: number): number {
  if (t >= 1) return to;
  if (t <= 0) return from;
  const eased = 1 - Math.pow(1 - t, 3);
  return Math.round(from + (to - from) * eased);
}

export type CountKind = 'int' | 'usd' | 'usdCents' | 'tokens' | 'pct';

const FORMAT: Record<CountKind, (n: number) => string> = {
  int: (n) => Math.round(n).toLocaleString('en-US'),
  usd: (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
  usdCents: (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  tokens: (n) =>
    n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)),
  pct: (n) => `${Math.round(n)}%`,
};

export function formatCount(kind: CountKind, n: number): string {
  return FORMAT[kind](n);
}

/** A value is known when it is a finite number. Unknown reads "unknown", never 0. */
export function isKnown(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** How many of the insight card's 8 ticks a fraction lights. */
export function insightTicks(frac: number | null | undefined): number {
  if (!isKnown(frac) || frac <= 0) return 0;
  return Math.min(8, Math.round(frac * 8));
}

/** A meter's fill: known values clamp to [0.02, 1] (a real zero is a sliver); unknown is null and draws no bar. */
export function meterWidth(frac: number | null | undefined): number | null {
  if (!isKnown(frac)) return null;
  return frac > 0 ? Math.max(0.02, Math.min(1, frac)) : 0.02;
}

export type SeriesPoint = { label: string; count: number };

/** StepLine geometry against a W×H box, or null when there is nothing to draw. */
export function stepGeometry(series: SeriesPoint[], W = 600, H = 150) {
  const total = series.reduce((n, s) => n + s.count, 0);
  if (series.length === 0 || total === 0) return null;
  const max = Math.max(...series.map((b) => b.count), 1);
  const stepW = W / series.length;
  const pad = Math.round(H * 0.4);
  const y = (c: number) => H - Math.round(H * 0.09) - (c / max) * (H - pad);
  let path = `M 0 ${y(series[0].count)}`;
  series.forEach((_, i) => {
    path += ` H ${(i + 1) * stepW}`;
    if (i < series.length - 1) path += ` V ${y(series[i + 1].count)}`;
  });
  const peakIdx = series.reduce((bi, b, i) => (b.count > series[bi].count ? i : bi), 0);
  return { path, area: `${path} V ${H} H 0 Z`, peakIdx, peak: series[peakIdx], stepW, py: y(series[peakIdx].count), H, W };
}

/** DotMatrix columns: up to six dots, the tallest at the max. */
export function dotColumns(cols: SeriesPoint[]) {
  const max = Math.max(...cols.map((c) => c.count), 1);
  return cols.map((c) => ({
    label: c.label,
    dots: Math.max(c.count === 0 ? 0 : 1, Math.round((c.count / max) * 6)),
    strength: c.count === max ? 1 : c.count >= max * 0.6 ? 0.55 : 0.25,
  }));
}

// ── shared prop types ──────────────────────────────────────────────────
export type BadgeTone = 'default' | 'accent' | 'ok' | 'warn' | 'err';
export type Tone = 'ok' | 'warn' | 'err' | 'accent';
/** One meter row. `frac: null` means unknown: the row says so and draws no bar. `hue` is a CSS colour expression (a token). */
export type Meter = { label: string; frac: number | null; display: string; hue?: string };
export type StatChip = { tone?: Tone; text: string };

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
