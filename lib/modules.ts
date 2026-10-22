/**
 * Modules: which sidebar views this install shows (Settings → Modules).
 *
 * A module is one sidebar item. Switching one off hides it from the sidebar,
 * the ⌘K palette and the digit keys, and its page shows a short "switched off"
 * notice instead of its content. Nothing is deleted: its data, routes and
 * connectors stay, and switching it back on restores it as it was.
 *
 * Client-safe. The stored choice is read and written by lib/modules-server.ts.
 */
import { NAV_GROUPS, NAV_ITEMS, activeHref, type NavGroup } from '@/lib/nav';

/** Always on: Home is the landing page, Settings is where modules come back. */
export const CORE_MODULES: readonly string[] = ['/', '/setup'];

/** Off on a fresh install (Brody, 2026-10-13). */
export const DEFAULT_OFF: readonly string[] = [];

export function isToggleable(href: string): boolean {
  return !CORE_MODULES.includes(href) && NAV_ITEMS.some((i) => i.href === href);
}

/** Known, toggleable hrefs only, each once, in nav order. */
export function normalizeOff(list: readonly unknown[]): string[] {
  const want = new Set(list.filter((x): x is string => typeof x === 'string'));
  return NAV_ITEMS.map((i) => i.href).filter((h) => want.has(h) && isToggleable(h));
}

/** The sidebar groups with switched-off items removed; an emptied group drops out. */
export function visibleGroups(off: readonly string[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !off.includes(i.href)) })).filter((g) => g.items.length > 0);
}

/** The switched-off module a pathname belongs to, or null when it is on (or not a module page). */
export function offModuleFor(pathname: string, off: readonly string[]): string | null {
  const href = activeHref(pathname);
  return href && off.includes(href) ? href : null;
}
