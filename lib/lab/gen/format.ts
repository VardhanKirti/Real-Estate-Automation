/**
 * The few number-to-text rules lane G's domain views need, matching 01's format rules (C7):
 * ratios always print one decimal (`12.6x`), and under n 5 a number reads `not enough yet`.
 * When lane V's `lib/lab/view/format.ts` lands these should become imports from it.
 */
export const MIN_N = 5;
export const NOT_ENOUGH = 'not enough yet';

/** One decimal, always: 1.4x, 12.6x. */
export const x1 = (r: number): string => `${(Math.round(r * 10) / 10).toFixed(1)}x`;

/** Whole percent of a 0..1 share. */
export const pct0 = (p: number): string => `${Math.round(p * 100)}%`;
