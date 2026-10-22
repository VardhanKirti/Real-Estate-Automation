/**
 * Credits and count wording for the Creative Engine (SPEC X3, §5 C10). One
 * rule everywhere credits show: the Dashboard pill, the credits hero, the UGC
 * studio, the Credits drawer, the Motion console readout and the run gate.
 *
 *   |n| >= 10  rounded integer with en-US separators   961.97 -> "962", 5763 -> "5,763"
 *   |n| <  10  one decimal, a trailing ".0" dropped     2.5 -> "2.5", 3 -> "3"
 *
 * Pure, no imports: safe on server and client.
 */

const ABSENT = '—';

function noNegZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

export function fmtCredits(n: number): string {
  if (!Number.isFinite(n)) return ABSENT;
  if (Math.abs(n) >= 10) return noNegZero(Math.round(n)).toLocaleString('en-US');
  // 9.96 rounds to 10 and reads "10", the same as the integer branch.
  return String(noNegZero(Math.round(n * 10) / 10));
}

/**
 * `plural(1, 'charge')` -> "1 charge"; `plural(3, 'charge')` -> "3 charges".
 * Irregular words pass their plural: `plural(2, 'query', 'queries')`.
 * The count uses en-US separators ("1,200 credits").
 */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  const count = Number.isFinite(n) ? n.toLocaleString('en-US') : ABSENT;
  return `${count} ${n === 1 ? word : pluralWord}`;
}

/**
 * A brand's initials for a thumbnail with no image (S04 B32): the first
 * letters of the first two words ("Northwind Tools" -> "NT"), or the first
 * two letters of a one-word name ("Pinion" -> "PI"). Never a word fragment
 * that reads as a word, like "No".
 */
export function brandInitials(brand: string): string {
  const words = brand.trim().split(/[\s\-_.]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
