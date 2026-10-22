/**
 * Number formatting for display (SPEC X3, S10 FR-22). Pure, locale fixed to
 * en-US so server and browser render the same string.
 *
 *   formatFull(12431)        "12,431"
 *   formatCompact(9999)      "9,999"     under 10,000: the full value
 *   formatCompact(29_412)    "29.4K"     under 100 of a unit: one decimal
 *   formatCompact(631_000)   "631K"      100 or more of a unit: none
 *   formatCompact(1_240_000) "1.2M"      then M and B the same way
 *   formatUsdCompact(-1500)  "-$1,500"
 *
 * A trailing ".0" is dropped ("10K", not "10.0K"), and a value that rounds up
 * to the next unit is promoted ("999,960" reads "1M", not "1000K"). Compact
 * output is a whole number below 10,000; callers that need the exact value
 * put formatFull in the title and aria-label. Non-finite input renders as an
 * em dash, never as "NaN".
 */

const ABSENT = '—';

/** Smallest unit first. */
const UNITS: { size: number; suffix: string }[] = [
  { size: 1e3, suffix: 'K' },
  { size: 1e6, suffix: 'M' },
  { size: 1e9, suffix: 'B' },
];

export function formatFull(n: number): string {
  if (!Number.isFinite(n)) return ABSENT;
  return n.toLocaleString('en-US');
}

function scaled(abs: number, size: number): number {
  const v = abs / size;
  return v < 100 ? Math.round(v * 10) / 10 : Math.round(v);
}

function compactAbs(abs: number): string {
  if (abs < 10_000) return Math.round(abs).toLocaleString('en-US');
  for (let i = 0; i < UNITS.length; i++) {
    const { size, suffix } = UNITS[i];
    const v = scaled(abs, size);
    // Promote "1000K" to "1M"; the last unit keeps growing ("1,234B").
    if (v >= 1000 && i < UNITS.length - 1) continue;
    const text = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1);
    return `${text}${suffix}`;
  }
  return Math.round(abs).toLocaleString('en-US');
}

function signed(n: number, body: string, prefix = ''): string {
  return n < 0 && body !== '0' ? `-${prefix}${body}` : `${prefix}${body}`;
}

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return ABSENT;
  return signed(n, compactAbs(Math.abs(n)));
}

export function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n)) return ABSENT;
  return signed(n, compactAbs(Math.abs(n)), '$');
}
