/**
 * One module for every period-over-period delta (SPEC X4, C41). Three rules,
 * applied the same way on every page, so no surface can print a dishonest
 * change again:
 *
 *  1. Big swings off a tiny base read as money or a count, not a percentage:
 *     when |pct| > 999 or the previous value is 0, the delta is absolute
 *     ("+$351.9K vs previous", "+$374K vs nothing before"). S02 FR-F6, H12.
 *  2. Under a small base the delta is hidden, not shown: `deltaIfMeaningful`
 *     returns null when the previous window holds fewer than `min` items.
 *     S04 F-T3, H26 (kills "↑850%" and "0m ↓100%").
 *  3. A change under 0.05% is flat: neutral tone, never red or green.
 *     S01 FR-12.
 *
 * Pure: no React, no DOM. `GDelta` (and the Classic trees until they retire)
 * render the result; the arrow and colour are presentation.
 */
import { formatCompact, formatFull, formatUsdCompact } from '@/lib/format-number';

/** Above this many percent a percentage stops being informative. */
export const MAX_PCT = 999;
/** Under this many percent (absolute) a change reads as flat. */
export const FLAT_PCT = 0.05;

export type DeltaTone = 'ok' | 'err' | 'neutral';
export type DeltaDirection = 'up' | 'down' | 'flat';

export type Delta = {
  /** `pct` renders a percentage; `abs` renders the absolute change (rule 1). */
  kind: 'pct' | 'abs';
  /** Raw percentage change; null when the previous value is 0. */
  pct: number | null;
  /** cur - prev, always set. */
  abs: number;
  direction: DeltaDirection;
  tone: DeltaTone;
  /** Display text without an arrow: "+1.4%", "-12%", "+$351.9K vs previous". */
  text: string;
  /** Full values for the hover title: "Previous $12,000 · now $13,400". */
  title: string;
};

export type DeltaOptions = {
  /** Format absolute deltas and the title as USD. */
  money?: boolean;
};

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Percentage change, or null when there is no base to compare against. */
export function deltaPct(cur: number, prev: number): number | null {
  if (!finite(cur) || !finite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Tone by sign; anything under FLAT_PCT is neutral (rule 3). A null pct (no base) is neutral. */
export function deltaTone(pct: number | null): DeltaTone {
  if (pct == null || !Number.isFinite(pct) || Math.abs(pct) < FLAT_PCT) return 'neutral';
  return pct > 0 ? 'ok' : 'err';
}

function directionOf(n: number, flat: boolean): DeltaDirection {
  if (flat || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

/** "+1.4%" under 10%, "+12%" from 10%, "0.0%" when flat. */
export function formatPct(pct: number): string {
  if (Math.abs(pct) < FLAT_PCT) return '0.0%';
  const body = Math.abs(pct) < 10 ? Math.abs(pct).toFixed(1) : String(Math.round(Math.abs(pct)));
  return `${pct > 0 ? '+' : '-'}${body}%`;
}

function formatAbs(abs: number, money: boolean): string {
  const body = money ? formatUsdCompact(Math.abs(abs)) : formatCompact(Math.abs(abs));
  if (abs === 0) return body;
  return `${abs > 0 ? '+' : '-'}${body}`;
}

function fullValue(n: number, money: boolean): string {
  return money ? `$${formatFull(Math.round(n))}` : formatFull(n);
}

/**
 * The delta between `cur` and `prev`, percentage or absolute by rule 1.
 * Returns null when either side is missing (compare off), so the caller hides
 * the pill instead of printing "+0".
 */
export function formatDelta(cur: number | null | undefined, prev: number | null | undefined, opts: DeltaOptions = {}): Delta | null {
  if (!finite(cur) || !finite(prev)) return null;
  const money = Boolean(opts.money);
  const abs = cur - prev;
  const pct = deltaPct(cur, prev);
  const title = `Previous ${fullValue(prev, money)} · now ${fullValue(cur, money)}`;

  if (pct == null || Math.abs(pct) > MAX_PCT) {
    const suffix = prev === 0 ? 'vs nothing before' : 'vs previous';
    // 0 -> 0 is no change at all, not "+0 vs nothing before".
    if (abs === 0) return { kind: 'pct', pct: 0, abs, direction: 'flat', tone: 'neutral', text: formatPct(0), title };
    return {
      kind: 'abs',
      pct,
      abs,
      direction: directionOf(abs, false),
      tone: abs > 0 ? 'ok' : 'err',
      text: `${formatAbs(abs, money)} ${suffix}`,
      title,
    };
  }

  const flat = Math.abs(pct) < FLAT_PCT;
  return { kind: 'pct', pct, abs, direction: directionOf(pct, flat), tone: deltaTone(pct), text: formatPct(pct), title };
}

/**
 * Rule 2: the delta only when the previous window is a meaningful base
 * (`prev >= min` and > 0); null otherwise, so the caller hides it.
 */
export function deltaIfMeaningful(cur: number | null | undefined, prev: number | null | undefined, min: number, opts: DeltaOptions = {}): Delta | null {
  if (!finite(cur) || !finite(prev) || prev <= 0 || prev < min) return null;
  return formatDelta(cur, prev, opts);
}
