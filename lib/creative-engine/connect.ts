/**
 * Connect Arcads field rules (SPEC G8 A6). Pure, shared by the sheet and the
 * setup route, so an empty or zero session cap can never be saved: a cap of 0
 * would block every generation without saying why.
 */

export const SESSION_CAP_MIN = 1;
export const SESSION_CAP_MAX = 100_000;

/** The cap a field holds, or null when it is not a whole number in range. */
export function parseCap(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= SESSION_CAP_MIN && n <= SESSION_CAP_MAX ? n : null;
}

/** The inline error for a cap field, or null when it is valid. */
export function capError(raw: string): string | null {
  if (parseCap(raw) !== null) return null;
  const t = raw.trim();
  if (/^\d+$/.test(t) && Number(t) > SESSION_CAP_MAX) return `Enter a whole number up to ${SESSION_CAP_MAX.toLocaleString('en-US')}`;
  return `Enter a whole number from ${SESSION_CAP_MIN}`;
}
