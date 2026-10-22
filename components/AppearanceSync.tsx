'use client';

import { useLayoutEffect } from 'react';
import {
  APPEARANCE_COOKIE,
  htmlAttributes,
  modeOverride,
  parseAppearanceCookie,
  resolveAppearance,
} from '@/lib/appearance';
import { THEME_STORAGE_KEY } from '@/lib/theme';

/**
 * Keeps <html> on the browser's own appearance after a server re-render.
 *
 * The server renders the <html> attributes from the cookie but cannot see
 * the Classic theme (localStorage) or the OS scheme, so it writes the
 * defaults for those (Console, dark). The head script corrects them before
 * the first paint; on a later `router.refresh()` that changes the server's
 * attributes (Settings switching style, for one) React writes the server
 * values back onto <html>, which would turn a Frost user Console. `server`
 * is the server's attribute set, so this re-renders exactly when React has
 * just rewritten them, and the layout effect re-applies the stored choice in
 * the same commit, before paint (SPEC S00 FR-2, AC00.4).
 */
export function AppearanceSync({ server }: { server: string }) {
  useLayoutEffect(() => {
    try {
      const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${APPEARANCE_COOKIE}=([^;]*)`));
      if (!m) return;
      let classicTheme: string | null = null;
      try {
        classicTheme = localStorage.getItem(THEME_STORAGE_KEY);
      } catch {}
      const r = resolveAppearance(parseAppearanceCookie(decodeURIComponent(m[1])), {
        classicTheme,
        prefersLight: window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false,
        forced: modeOverride(location.search),
      });
      const el = document.documentElement;
      for (const [k, v] of Object.entries(htmlAttributes(r))) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
    } catch {
      /* attributes stay as rendered */
    }
  }, [server]);
  return null;
}
