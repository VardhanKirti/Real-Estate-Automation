/**
 * UI theme. Console (design style 5 — docs/DESIGN-CONSOLE.md) is the single
 * design language as of 2026-08-20: Geist type, matte near-black surfaces,
 * violet accent, blue→ice→violet→orchid data ramp. The previous eight-theme
 * registry (Monolith, Terminal, GladOS mint, glass, …) lives on the
 * v2-monolith-backup branch.
 *
 * The registry shape is kept so a future colorway is a token block + one
 * entry here — the active theme still rides `data-theme` on <html>.
 */
export const THEMES = ['console', 'red', 'light', 'frost', 'grey-frost'] as const;
export type Theme = (typeof THEMES)[number];

/** What every fresh load gets until the user picks something else. */
export const DEFAULT_THEME: Theme = 'console';

/** Picker metadata: display name, one-line feel, [bg, accent, text] swatch. */
export const THEME_META: Record<Theme, { name: string; blurb: string; swatch: [string, string, string] }> = {
  console: { name: 'Console', blurb: 'matte teal-black, mint signal, Geist', swatch: ['#050b0c', '#00ffab', '#e9f0ed'] },
  red: { name: 'Red', blurb: 'the AdPilot colorway, OS-wide — warm black, red signal', swatch: ['#0a0507', '#ff4557', '#f0eaec'] },
  light: { name: 'White', blurb: 'paper white, graphite ink, the same signal mint held back to a readable green', swatch: ['#f4f5f7', '#0a8f63', '#15171a'] },
  frost: { name: 'Frost', blurb: 'black ground, blue-white ink and glow, the sidebar hover made into a whole theme', swatch: ['#06080c', '#9fc6ff', '#eaf4ff'] },
  'grey-frost': { name: 'Grey Frost', blurb: "Frost's ice ink, signal and glow on a soft grey ground", swatch: ['#18191d', '#9fc6ff', '#ecf2fa'] },
};

export const THEME_STORAGE_KEY = 'glados-theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Stored value wins if valid, otherwise the default (stale ids fall back). */
export function resolveInitialTheme(stored: string | null): Theme {
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/** Cycle the ring in registry order (kept for a future multi-theme picker). */
export function nextTheme(current: Theme): Theme {
  const i = THEMES.indexOf(current);
  return THEMES[(i + 1) % THEMES.length];
}

/*
 * The pre-paint script that applies the stored theme lives in lib/appearance.ts
 * (APPEARANCE_INIT_SCRIPT, SPEC S00 §7): it applies this Classic theme under
 * the Classic style and the derived one under the new style.
 */
