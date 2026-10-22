/**
 * One series colour per audience channel, on every page (SPEC C19).
 *
 * Data code never carries a colour: it carries a series index, and the UI
 * maps the index to the `--series-<n>` token (app/globals.css, "C19 series
 * index" block). Under the GladOS style those tokens resolve to
 * `--g-series-<n>`; under Classic they ride the active theme's chart ramp.
 *
 * Pure and dependency-free so client components can import it without
 * pulling server-only connector code into the browser bundle.
 */

/** Fixed channel → slot map. Never cycled, never reordered. */
export const SERIES_INDEX = {
  instagram: 1,
  tiktok: 2,
  youtube: 3,
  linkedin: 4,
  email: 5,
  twitter: 6,
} as const;

export type SeriesChannel = keyof typeof SERIES_INDEX;
export type SeriesSlot = (typeof SERIES_INDEX)[SeriesChannel];

/** Index for an aggregate line (all audience, total DMs): the accent. */
export const AGGREGATE_SERIES = 0;

/** Slot for a channel key, or null for a key the map does not track. */
export function seriesIndexFor(key: string): SeriesSlot | null {
  return Object.prototype.hasOwnProperty.call(SERIES_INDEX, key) ? SERIES_INDEX[key as SeriesChannel] : null;
}

/** CSS colour for a series index: 0 is the aggregate, 1..6 the channels;
 * anything else is the muted untracked colour. */
export function seriesColor(index: number | null): string {
  if (index === null || !Number.isInteger(index) || index < 0 || index > 6) return 'var(--series-muted)';
  return `var(--series-${index})`;
}

/** CSS colour for a channel key (unknown channels read muted). */
export function channelColor(key: string): string {
  return seriesColor(seriesIndexFor(key));
}
