/** TS constants for the shared Lab v2 components (02 section 1). Colours live only in app/globals.css. */

export const GLASS_BUDGET = 12;

export const LAB_BREAKPOINTS = { phone: 600, tablet: 1100 } as const;

export const DOT = { size: 3, pitch: 8, groupGap: 16, rows: 5 } as const;

export const VIZ = {
  tile: { w: 88, h: 32 },
} as const;

/** Group emphasis opacity on lit dots (02 section 6). */
export const DOT_EMPHASIS = { current: 1, prev: 0.55, context: 0.28 } as const;

/** Narrative window colour step (02 section 7.1): 0..1 rounded to 0.05. */
export function stepWindowT(t: number | undefined | null): number {
  const v = typeof t === 'number' && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return Math.round(v * 20) / 20;
}
