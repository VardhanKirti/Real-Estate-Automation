'use client';

import { useEffect, useState } from 'react';
import { currentAppearance, onAppearanceChange, type AppliedAppearance } from './appearance';

/**
 * Theme-aware palettes for components that hold colors in JS arrays (chart
 * series, comms channels, skill-tree pearls) — CSS vars can't reach those.
 * Categorical sets stay tellable-apart within each theme's family; the red
 * theme's warm set was picked for adjacent-pair distinctness.
 */

export type PaletteName = 'console' | 'red' | 'light' | 'frost' | 'grey-frost';

export type Palette = {
  name: PaletteName;
  /** Categorical series — assign in fixed order, never cycle. */
  series: string[];
  /** Channel identities for the comms feed. */
  channels: { email: string; whatsapp: string; slack: string };
  /** Decorative node pearls (skill tree, brain radial) — depth-ordered
   *  in red: core red fading to amber/cream at the leaves. */
  pearls: string[];
  /** Ambient page glow color for signature backgrounds. */
  glow: string;
  /** Optimal Engine observatory lobes: console hex → this theme's hex (identity on console). */
  observatory: Record<string, string>;
};

const CONSOLE: Palette = {
  name: 'console',
  series: ['#6e96f2', '#d9e4fb', '#6656e3', '#bd5fe8'],
  channels: { email: '#e5c06b', whatsapp: '#3fd968', slack: '#8b7ff0' },
  pearls: ['#00ffab', '#7fe8ff', '#b49cff', '#ffd47f', '#ff9ecb', '#9fffe0', '#cddbd5', '#8a90a8'],
  glow: 'rgba(0, 255, 171, 0.07)',
  observatory: {},
};

const RED: Palette = {
  name: 'red',
  series: ['#ff4557', '#ff8a3d', '#ffc861', '#ffe9c2'],
  channels: { email: '#ffc861', whatsapp: '#ff8a3d', slack: '#ffe9c2' }, // no purple under red (2026-09-15)
  pearls: ['#ff4557', '#ff6a4d', '#ff8a3d', '#ffab4f', '#ffc861', '#ffd98f', '#ffe9c2', '#a29597'],
  glow: 'rgba(255, 69, 87, 0.07)',
  observatory: {
    '#6e96f2': '#ff4557',
    '#6656e3': '#ff8a3d',
    '#bd5fe8': '#ffc861',
    '#8fb4f6': '#ff6a4d',
    '#3fd968': '#ffab4f',
    '#f2b33d': '#ffd98f',
    '#d9e4fb': '#ffe9c2',
    '#8a90a8': '#a29597',
  },
};

/* White: the same hues held back to read on paper; whatsapp stays its brand green. */
const LIGHT: Palette = {
  name: 'light',
  series: ['#4f7ee6', '#8fa9e8', '#5b4bd1', '#a548d6'],
  channels: { email: '#b7791f', whatsapp: '#1f9d4a', slack: '#6a5be0' },
  pearls: ['#0a8f63', '#1a86d0', '#6f3fb5', '#b7791f', '#c42a7a', '#148a5f', '#5d6470', '#8a919c', '#2f8f6a', '#8a3fb5'],
  glow: 'rgba(10, 143, 99, 0.07)',
  observatory: {
    '#6e96f2': '#4f7ee6',
    '#6656e3': '#5b4bd1',
    '#bd5fe8': '#a548d6',
    '#8fb4f6': '#2f6fd6',
    '#3fd968': '#1f9d4a',
    '#f2b33d': '#c98a1c',
    '#d9e4fb': '#8fa9e8',
    '#8a90a8': '#8a919c',
  },
};

/* Frost: blue-white only. No green anywhere; the cool status cyan stands in. */
const FROST: Palette = {
  name: 'frost',
  series: ['#9fc6ff', '#eaf4ff', '#6e96f2', '#c7b8ff'],
  channels: { email: '#ffd166', whatsapp: '#6ee7ff', slack: '#c7b8ff' },
  pearls: ['#eaf4ff', '#cfe4ff', '#9fc6ff', '#6e96f2', '#c7b8ff', '#6ee7ff', '#b9c6d8', '#6b7d96', '#d9e4fb', '#8fa6ff'],
  glow: 'rgba(120, 180, 255, 0.09)',
  observatory: {
    '#6e96f2': '#9fc6ff',
    '#6656e3': '#6e96f2',
    '#bd5fe8': '#c7b8ff',
    '#8fb4f6': '#cfe4ff',
    '#3fd968': '#6ee7ff',
    '#f2b33d': '#ffd166',
    '#d9e4fb': '#eaf4ff',
    '#8a90a8': '#8a94ad',
  },
};

/* Grey Frost: Frost's series, channels and pearls on a grey ground; the glow
   is a touch softer because the lighter ground already lifts it. */
const GREY_FROST: Palette = { ...FROST, name: 'grey-frost', glow: 'rgba(120, 180, 255, 0.07)' };

const PALETTES: Record<PaletteName, Palette> = { console: CONSOLE, red: RED, light: LIGHT, frost: FROST, 'grey-frost': GREY_FROST };

export function paletteFor(theme: string | null): Palette {
  return (theme && (PALETTES as Record<string, Palette>)[theme]) || CONSOLE;
}

/** How many `--g-series-*` slots the new style defines (SPEC X2: fixed order, never cycled). */
export const G_SERIES_SLOTS = 6;

/**
 * FR-12: the palette for the full appearance. Under Classic, or under the new
 * style on a page whose tokens are not defined yet, it is the (derived) theme's
 * palette. Under the new style the series come from the accent's
 * `--g-series-1..6` tokens, read through `readVar` (getComputedStyle on
 * <html>): CSS stays the one source of truth. A slot that does not resolve
 * leaves the theme's series in place rather than inventing a colour.
 */
export function paletteForAppearance(
  a: Pick<AppliedAppearance, 'ui' | 'theme'>,
  readVar: (name: string) => string = () => '',
): Palette {
  const base = paletteFor(a.theme);
  if (a.ui !== 'glados') return base;
  const series: string[] = [];
  for (let i = 1; i <= G_SERIES_SLOTS; i++) {
    const v = readVar(`--g-series-${i}`).trim();
    if (!v) break;
    series.push(v);
  }
  return series.length ? { ...base, series } : base;
}

const readRootVar = (name: string) =>
  typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name);

/**
 * The palette for <html>'s current appearance, re-read on every style, accent,
 * mode or theme change and on an OS scheme flip under System, through the one
 * shared observer (X3). Mounted after a flip, it reads on mount (edge 12).
 */
export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(CONSOLE);
  useEffect(() => {
    const read = (a: AppliedAppearance) => setPalette(paletteForAppearance(a, readRootVar));
    read(currentAppearance());
    return onAppearanceChange(read);
  }, []);
  return palette;
}
