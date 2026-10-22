/**
 * Server half of the appearance model (SPEC S00 FR-2, FR-15). Kept apart from
 * lib/appearance.ts because next/headers may only be imported by server code.
 *
 * Reading the cookie opts the caller into dynamic rendering. The root layout
 * reads it once for the <html> attributes; a page.tsx that forks trees reads it
 * again through `getAppearance()` (React dedupes nothing here, but the cost is
 * one header parse).
 */
import { cookies } from 'next/headers';
import { APPEARANCE_COOKIE, parseAppearanceCookie, resolveAppearance, type Appearance, type AppliedAppearance } from './appearance';

/**
 * The applied appearance as the server can know it: the cookie's three axes,
 * `system` rendered as dark (edge 4), and the Classic theme as the default
 * (localStorage is client-only; the head script corrects both before paint).
 */
export function getAppearance(): AppliedAppearance {
  return resolveAppearance(getStoredAppearance());
}

/**
 * The stored choice itself (Settings needs the stored mode, which may be
 * `system`, and the accent kept while the style is Classic).
 */
export function getStoredAppearance(): Appearance {
  let raw: string | undefined;
  try {
    raw = cookies().get(APPEARANCE_COOKIE)?.value;
  } catch {
    raw = undefined; // outside a request (build-time tooling): defaults
  }
  return parseAppearanceCookie(raw);
}
