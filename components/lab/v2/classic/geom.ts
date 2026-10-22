/**
 * Geometry rounding for inline SVG paths and CSS positions in the Classic tree. Not number formatting:
 * these values never reach the reader as text. Rounding keeps server and client markup identical, so
 * hydration never sees float noise (48.98616553642112% vs 48.986165536421105%).
 */
export const r1 = (v: number): number => Math.round(v * 10) / 10;
export const r2 = (v: number): number => Math.round(v * 100) / 100;
