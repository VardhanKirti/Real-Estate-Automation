/**
 * Routes with their own Bennett Legacy tree (FounderOS ui merge SPEC §2.5, O1).
 *
 * Under `ui = legacy` a route listed here renders its Legacy tree
 * (`components/legacy/*` kit); every other route renders its Classic tree
 * under the Legacy skin (`data-theme='monolith'|'daylight'`, the L0 block in
 * app/globals.css) inside the LegacySlab frame. Same shape as G_READY: page
 * lanes add their routes in a one-line merge at lane exit, after
 * `scripts/l-audit.mjs` is clean on them. Keep it a plain string array
 * (scripts/l-audit.mjs parses the literal).
 *
 * lib/appearance.ts re-exports it, so code imports it from there.
 */
import { matchesReadyRoute } from './g-ready';

export const L_READY: string[] = ['/dev/l-kit', '/trading', '/usage', '/clients', '/lead-magnets', '/chats', '/wizard', '/login', '/lab', '/lab/radar', '/lab/breakouts', '/lab/playbook', '/lab/studio', '/lab/ledger', '/lab/creatorverse'];

/** True when `pathname` (query and hash ignored) has its own Legacy tree. */
export function isLReady(pathname: string, ready: readonly string[] = L_READY): boolean {
  const p = pathname.split(/[?#]/)[0] || '/';
  return ready.some((entry) => matchesReadyRoute(entry, p));
}

/**
 * Full-height workspaces: under Legacy they keep their own layout and are not
 * wrapped in the slab (SPEC §2.5). The canvases (lib/sidebar.ts CANVAS_ROUTES),
 * the Creative Engine, the Optimal Engine frame and the bare /login (the Content Lab
 * has its own Legacy tree on the slab since lane fo/l-lab, pages/lab.md),
 * plus /chats, the one FounderOS page drawn without a slab (pages/chats.md §8).
 */
export const L_NO_SLAB: string[] = ['/workflows', '/wizard', '/blueprint', '/inbox', '/creative-engine', '/brain', '/login', '/chats'];

/** True when `pathname` (or a sub-path of a listed workspace) renders without the slab. */
export function isLegacyWorkspace(pathname: string | null | undefined, list: readonly string[] = L_NO_SLAB): boolean {
  const p = (pathname ?? '/').split(/[?#]/)[0] || '/';
  return list.some((r) => p === r || p.startsWith(`${r}/`));
}
