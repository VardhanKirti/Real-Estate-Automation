/**
 * Routes that render WITHOUT the app shell (no sidebar, top bar, command
 * palette or Wizard dock). GladOS UI H37 / S05 F05.100: /login is the one page
 * a signed-out visitor reaches, so it must not show the console around it.
 * Middleware and the no-redirect rule on /login are unchanged.
 */
export const BARE_PATHS = ['/login'] as const;

export function isBarePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (BARE_PATHS as readonly string[]).includes(p);
}
