/**
 * Content Lab v2 motion constants and pure maths (docs/projects/content-lab/v2/spec/03-motion.md).
 *
 * Node-testable: no DOM, no React. Mirrored as CSS custom properties in the
 * `Content Lab v2 · motion` block of app/globals.css (AC-03-1).
 *
 * Lane F first cut; U1 added `COUNT_FORMAT` (03.4), which wraps section 01's formatters in
 * lib/lab/view/format.ts. This module defines no number formatter (AC-03-6).
 */
import { fmtCount, fmtRatio, fmtUsd } from '@/lib/lab/view/format';

export const LAB_EASE = {
  out: 'cubic-bezier(0.32, 0.72, 0, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  snap: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  linear: 'linear',
} as const;

export const LAB_DUR = {
  xs: 120,
  s: 200,
  m: 260,
  l: 420,
  enter: 240,
  intro: 700,
  drift: 24000,
  pulse: 900,
  seal: 180,
} as const;

export const LAB_MOTION = { ease: LAB_EASE, dur: LAB_DUR, introMaxAnimations: 80, restMaxAnimations: 3 } as const;
export type LabEase = keyof typeof LAB_EASE;
export type LabDur = keyof typeof LAB_DUR;

// ── 03.3 load sequence ─────────────────────────────────────────────────────────────
export type IntroStep = { id: string; delay: number; duration: number; stagger?: number; count?: number };
export const TODAY_INTRO: readonly IntroStep[] = [
  { id: 'aurora', delay: 0, duration: 420 },
  { id: 'hero-1', delay: 80, duration: 560 },
  { id: 'hero-2', delay: 120, duration: 520 },
  { id: 'dots', delay: 120, duration: 220, stagger: 14, count: 24 },
  { id: 'brief', delay: 200, duration: 380 },
  { id: 'window', delay: 260, duration: 380 },
  { id: 'delta', delay: 560, duration: 140 },
];

/** max(delay + (count - 1) * stagger + duration) over the steps. */
export function introEnd(steps: readonly IntroStep[]): number {
  let end = 0;
  for (const s of steps) {
    const last = s.delay + Math.max(0, (s.count ?? 1) - 1) * (s.stagger ?? 0) + s.duration;
    if (last > end) end = last;
  }
  return end;
}

export type LabIntroScope = 'aurora' | 'today';
export type IntroEnv = {
  reducedMotion: boolean;
  hidden: boolean;
  storage: Pick<Storage, 'getItem'> | null;
  memory: ReadonlySet<LabIntroScope>;
};
export const INTRO_KEYS: Record<LabIntroScope, string> = { aurora: 'lab.intro.aurora', today: 'lab.intro.today' };

/** The 03.3.2 truth table. */
export function shouldPlayIntro(scope: LabIntroScope, env: IntroEnv): boolean {
  if (env.reducedMotion) return false;
  if (env.hidden) return false;
  if (env.memory.has(scope)) return false;
  if (!env.storage) return true;
  try {
    return env.storage.getItem(INTRO_KEYS[scope]) !== '1';
  } catch {
    return true;
  }
}

// ── 03.4 count-up ──────────────────────────────────────────────────────────────────
export type CountKind = 'ratio' | 'count' | 'money';

/** The resting formatter per kind: the last count-up frame is exactly what 01's view prints (03.4). */
export const COUNT_FORMAT: Record<CountKind, (v: number) => string> = {
  ratio: fmtRatio,
  count: (v) => fmtCount(Math.round(v)),
  money: fmtUsd,
};

const clamp01 = (p: number) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0);

/** from + (to - from) * (1 - (1 - p)^3), p clamped to [0, 1]. */
export function countUpValue(from: number, to: number, p: number): number {
  const q = clamp01(p);
  return from + (to - from) * (1 - Math.pow(1 - q, 3));
}

/** One frame of text: the formatter of the final value at p >= 1, so the last frame equals the resting text. */
export function countUpFrame(from: number, to: number, p: number, fmt: (v: number) => string): string {
  return fmt(p >= 1 ? to : countUpValue(from, to, p));
}

// ── 03.12 shared-element sheet ─────────────────────────────────────────────────────
export type Rect = { x: number; y: number; w: number; h: number };

/** FLIP from the origin rect to the target rect, transform-origin 0 0. */
export function flipFrom(origin: Rect, target: Rect): { tx: number; ty: number; sx: number; sy: number } {
  return {
    tx: origin.x - target.x,
    ty: origin.y - target.y,
    sx: target.w ? origin.w / target.w : 1,
    sy: target.h ? origin.h / target.h : 1,
  };
}

/** A corner that reads as `r` px after the element is scaled by (sx, sy): `${r / sx}px / ${r / sy}px`, 1 dp. */
export function cornerRadiusAtScale(r: number, sx: number, sy: number): string {
  const a = sx ? r / sx : r;
  const b = sy ? r / sy : r;
  return `${a.toFixed(1)}px / ${b.toFixed(1)}px`;
}

/** False when the rect is null, empty, or less than half of its area lies inside the viewport. */
export function originUsable(r: Rect | null, viewport: { w: number; h: number }): boolean {
  if (!r || !(r.w > 0) || !(r.h > 0)) return false;
  const ix = Math.max(0, Math.min(r.x + r.w, viewport.w) - Math.max(r.x, 0));
  const iy = Math.max(0, Math.min(r.y + r.h, viewport.h) - Math.max(r.y, 0));
  return (ix * iy) / (r.w * r.h) >= 0.5;
}

// ── 03.7 period scrubber ───────────────────────────────────────────────────────────
/** Nearest tick index for a drag offset, clamped to [0, count - 1]. */
export function snapTick(offsetPx: number, tickPx: number, count: number): number {
  if (count <= 0 || !(tickPx > 0)) return 0;
  const i = Math.round(offsetPx / tickPx);
  return Math.min(count - 1, Math.max(0, i));
}

// ── Polish pass (lab2/motion): page entrance, popovers, text count-up ─────────────
/**
 * The per-page entrance (every Lab page, both trees): blocks rise and fade in order. Mirrored by the
 * `--lab-enter-*` custom properties in components/lab/v2/shared/lab-motion.css. The last block starts
 * at step * maxIndex, so the whole entrance ends by step * maxIndex + duration.
 */
export const LAB_ENTER = { duration: 360, step: 45, maxIndex: 6, rise: 10 } as const;
export function enterEnd(e: { duration: number; step: number; maxIndex: number } = LAB_ENTER): number {
  return e.step * e.maxIndex + e.duration;
}

/** Popover and menu open and close: scale and fade from their origin. */
export const LAB_POP = { in: 180, out: 120, scale: 0.96 } as const;

/** Hero count-up: duration and how long an un-hydrated numeral stays hidden before it shows at rest. */
export const LAB_COUNT = { duration: 700, hideMax: 1000 } as const;

/** The numeric run inside a formatted value: prefix, number, decimals, thousands grouping, suffix. */
export type NumParts = { pre: string; num: number; decimals: number; grouped: boolean; post: string };

/** Split '$1,204.50' into ('$', 1204.5, 2 decimals, grouped, ''). Null when the text holds no number. */
export function splitNumber(text: string): NumParts | null {
  const m = /^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(text);
  if (!m) return null;
  const raw = m[2];
  const num = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const dot = raw.indexOf('.');
  return { pre: m[1], num, decimals: dot < 0 ? 0 : raw.length - dot - 1, grouped: raw.includes(','), post: m[3] };
}

/**
 * One count-up frame of an already formatted value: the number eased up from 0 with the same decimals,
 * grouping, prefix and suffix. At p >= 1, or for text with no number, it returns the text unchanged, so
 * the last frame is exactly what the view printed (no formatter of its own, AC-03-6).
 */
export function countUpText(text: string, p: number): string {
  const parts = splitNumber(text);
  if (!parts || !(p < 1)) return text;
  const v = countUpValue(0, parts.num, p);
  const s = Math.abs(v).toFixed(parts.decimals);
  const [int, frac] = s.split('.');
  const intText = parts.grouped ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
  const sign = v < 0 && Number(s) !== 0 ? '-' : '';
  return `${parts.pre}${sign}${intText}${frac ? `.${frac}` : ''}${parts.post}`;
}
