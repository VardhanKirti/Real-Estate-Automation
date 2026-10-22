/**
 * Sidebar width model (SPEC S09). One CSS variable, `--sidebar-w` on <html>,
 * drives the sidebar, the content column margin and every fixed page that sits
 * beside the sidebar (Blueprint, Comms, the workflow editor, the Optimal Engine frame).
 *
 * This module holds the constants, the pure helpers the drag/toggle UI uses,
 * the per-browser preference store (localStorage `glados-sidebar`, every access
 * wrapped so a blocked store never throws), and SIDEBAR_INIT_SCRIPT, which
 * applies the width before first paint so no page shifts on load.
 *
 * One stored width for every page (FounderOS UI SPEC 4.2, fix b): no route
 * picks its own width. Workspace routes only change the layout (no topbar,
 * full-height column, `data-canvas`); what is shown differs from what is
 * stored only through the viewport rules in effectiveWidth.
 */

export const SIDEBAR_RAIL_W = 64; // icon rail
export const SIDEBAR_MIN_FULL_W = 184; // narrowest labelled sidebar
export const SIDEBAR_DEFAULT_W = 232; // today's width
export const SIDEBAR_MAX_W = 320;
export const SIDEBAR_RAIL_THRESHOLD = 124; // release below this snaps to rail
export const SIDEBAR_MODE_BREAK = 120; // under this the layout is the rail
export const SIDEBAR_SNAP = [64, 232, 320] as const; // magnet points
export const SIDEBAR_SNAP_RADIUS = 12;
export const SIDEBAR_STORAGE_KEY = 'glados-sidebar';
/**
 * Routes that open as a full-height workspace (no Topbar, no width cap on the
 * content column, `data-canvas` on <html>). Layout only: nothing reads this
 * for the sidebar width. `/workflows` also matches `/workflows/*`.
 */
export const WORKSPACE_ROUTES = ['/workflows', '/wizard', '/blueprint', '/inbox'] as const;

/** Effective-width rules (FR-9). */
export const SIDEBAR_RAIL_VIEWPORT = 768; // under this: always the rail
export const SIDEBAR_CAP_VIEWPORT = 1100; // under this: at most the default width
export const SIDEBAR_MIN_CONTENT = 560; // content narrower than this: rail

export type SidebarMode = 'rail' | 'full';

/**
 * v2: one width for every page. v1 (`{v:1, w, canvasW, lastFull}`) had a
 * second width for workspace pages; parseSidebarPrefs migrates it by keeping
 * `w` and `lastFull` and dropping `canvasW`.
 */
export type SidebarPrefs = {
  v: 2;
  /** Width on every page. */
  w: number;
  /** Last labelled width, used when toggling out of the rail. */
  lastFull: number;
};

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  v: 2,
  w: SIDEBAR_DEFAULT_W,
  lastFull: SIDEBAR_DEFAULT_W,
};

export function isWorkspaceRoute(pathname: string): boolean {
  return WORKSPACE_ROUTES.some((r) => pathname === r || (r === '/workflows' && pathname.startsWith('/workflows/')));
}

/**
 * Where a released drag lands (FR-5): under 124 → rail; 124 to 183 → 184;
 * within 12px of 232 or 320 → that point; otherwise the rounded value,
 * clamped 64 to 320. Anything that is not a finite number → the default.
 */
export function snapWidth(raw: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return SIDEBAR_DEFAULT_W;
  const w = Math.round(raw);
  if (w < SIDEBAR_RAIL_THRESHOLD) return SIDEBAR_RAIL_W;
  if (w < SIDEBAR_MIN_FULL_W) return SIDEBAR_MIN_FULL_W;
  for (const p of SIDEBAR_SNAP) {
    if (p >= SIDEBAR_MIN_FULL_W && Math.abs(w - p) <= SIDEBAR_SNAP_RADIUS) return p;
  }
  return Math.min(w, SIDEBAR_MAX_W);
}

/**
 * What is shown, given what is stored (FR-9). Never rewrites storage.
 * Under 768px: rail. Under 1100px: at most 232. If the content column would
 * be narrower than 560px (with the Wizard dock open): rail.
 */
export function effectiveWidth(stored: number, viewportW: number, conductorW: number): number {
  const s = snapWidth(stored);
  if (s === SIDEBAR_RAIL_W) return s;
  if (viewportW < SIDEBAR_RAIL_VIEWPORT) return SIDEBAR_RAIL_W;
  const w = viewportW < SIDEBAR_CAP_VIEWPORT ? Math.min(s, SIDEBAR_DEFAULT_W) : s;
  if (viewportW - w - (conductorW > 0 ? conductorW : 0) < SIDEBAR_MIN_CONTENT) return SIDEBAR_RAIL_W;
  return w;
}

export function sidebarMode(w: number): SidebarMode {
  return w < SIDEBAR_MODE_BREAK ? 'rail' : 'full';
}

/**
 * Parse the stored JSON. v2 is read as is; v1 is migrated (its `canvasW` is
 * dropped). Garbage, other versions or bad numbers fall back to defaults.
 */
export function parseSidebarPrefs(raw: string | null | undefined): SidebarPrefs {
  if (!raw) return { ...DEFAULT_SIDEBAR_PREFS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SIDEBAR_PREFS };
  }
  if (!data || typeof data !== 'object' || ![1, 2].includes((data as { v?: unknown }).v as number)) return { ...DEFAULT_SIDEBAR_PREFS };
  const d = data as Record<string, unknown>;
  const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? snapWidth(x) : fallback);
  const lastFull = num(d.lastFull, SIDEBAR_DEFAULT_W);
  return {
    v: 2,
    w: num(d.w, SIDEBAR_DEFAULT_W),
    lastFull: lastFull >= SIDEBAR_MIN_FULL_W ? lastFull : SIDEBAR_DEFAULT_W,
  };
}

/** Read the stored preference. Never throws (private windows, blocked storage). */
export function readSidebarPrefs(storage?: Pick<Storage, 'getItem'> | null): SidebarPrefs {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return parseSidebarPrefs(s ? s.getItem(SIDEBAR_STORAGE_KEY) : null);
  } catch {
    return { ...DEFAULT_SIDEBAR_PREFS };
  }
}

/** Persist the preference. Returns false when storage is unavailable; never throws. */
export function writeSidebarPrefs(prefs: SidebarPrefs, storage?: Pick<Storage, 'setItem'> | null): boolean {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return false;
    s.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/** `workspace` is layout only (data-canvas on <html>); it never changes `width`. */
export type SidebarState = { width: number; mode: SidebarMode; workspace: boolean };

/** The stored width. The same on every page. */
export function storedWidth(prefs: SidebarPrefs): number {
  return prefs.w;
}

/**
 * The width to show on a route: the one stored width, through effectiveWidth
 * (viewport caps and, when given, room for the Wizard dock). Without a
 * viewport (tests, server) the stored width is shown as is. The route only
 * decides `workspace` (layout), never the width.
 */
export function resolveSidebar(pathname: string, prefs: SidebarPrefs, viewportW?: number, conductorW = 0): SidebarState {
  const stored = storedWidth(prefs);
  const width = typeof viewportW === 'number' && viewportW > 0 ? effectiveWidth(stored, viewportW, conductorW) : stored;
  return { width, mode: sidebarMode(width), workspace: isWorkspaceRoute(pathname) };
}

/**
 * Store a committed width (end of a drag, a toggle, a keyboard step). It holds
 * on every page. A labelled width also becomes `lastFull`, the width the
 * toggle returns to from the rail.
 */
export function commitWidth(prefs: SidebarPrefs, width: number): SidebarPrefs {
  const w = snapWidth(width);
  const next: SidebarPrefs = { ...prefs, w };
  if (w >= SIDEBAR_MIN_FULL_W) next.lastFull = w;
  return next;
}

/**
 * Rail ↔ last full width (FR-6). `shown` is what is on screen (it may be capped
 * below the stored width): from a labelled sidebar it goes to the rail and
 * remembers the stored labelled width; from the rail it returns to `lastFull`.
 */
export function toggleWidth(prefs: SidebarPrefs, shown: number): SidebarPrefs {
  if (sidebarMode(shown) === 'full') {
    const stored = storedWidth(prefs);
    const lastFull = stored >= SIDEBAR_MIN_FULL_W ? stored : shown >= SIDEBAR_MIN_FULL_W ? snapWidth(shown) : prefs.lastFull;
    return { ...prefs, w: SIDEBAR_RAIL_W, lastFull };
  }
  return commitWidth(prefs, prefs.lastFull >= SIDEBAR_MIN_FULL_W ? prefs.lastFull : SIDEBAR_DEFAULT_W);
}

/** Keyboard on the separator (FR-8). Returns the next width, or null for keys it does not handle. */
export function keyWidth(current: number, key: string, shift = false): number | null {
  const step = shift ? 64 : 16;
  const rail = sidebarMode(current) === 'rail';
  switch (key) {
    case 'Home':
      return SIDEBAR_RAIL_W;
    case 'End':
      return SIDEBAR_MAX_W;
    case 'ArrowRight':
      // out of the rail the first step lands on the narrowest labelled width
      return rail ? SIDEBAR_MIN_FULL_W : Math.min(SIDEBAR_MAX_W, Math.round(current) + step);
    case 'ArrowLeft': {
      if (rail) return SIDEBAR_RAIL_W;
      const w = Math.round(current) - step;
      // arrows reach 184 to 320 exactly; below the narrowest labelled width is the rail
      return w < SIDEBAR_MIN_FULL_W ? SIDEBAR_RAIL_W : w;
    }
    default:
      return null;
  }
}

type RootLike = {
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

/** Write the state onto <html>: `--sidebar-w`, `data-sidebar`, and `data-canvas` (workspace layout). */
export function applySidebarState(root: RootLike, state: SidebarState): void {
  root.style.setProperty('--sidebar-w', `${state.width}px`);
  root.setAttribute('data-sidebar', state.mode);
  if (state.workspace) root.setAttribute('data-canvas', '1');
  else root.removeAttribute('data-canvas');
}

/**
 * More than a scrollbar between innerWidth and the root's clientWidth means a mobile browser widened
 * its layout viewport to fit overflowing content (a chart's pre-measure SVG on /inbox made it 941 at
 * 390); the device width is clientWidth then. Below this, the gap is a desktop scrollbar.
 */
export const VIEWPORT_INFLATION_PX = 32;

/** The window width the sidebar sizes against (see VIEWPORT_INFLATION_PX). */
export function viewportWidth(win: { innerWidth: number; document: { documentElement: { clientWidth: number } } } = window): number {
  const iw = win.innerWidth;
  const cw = win.document.documentElement.clientWidth;
  return cw > 0 && iw - cw > VIEWPORT_INFLATION_PX ? cw : iw;
}

/**
 * Inline-able <head> script (FR-11): applies the one stored width (v2, or a
 * v1 value's `w`), with the viewport caps of effectiveWidth (the Wizard dock
 * is closed on load), before first paint, and marks workspace routes with
 * `data-canvas` for the layout. Generated from the constants above so the two
 * never drift (tests/sidebar.test.ts runs it against resolveSidebar). On any
 * error it applies the default width, the same on every route.
 */
export const SIDEBAR_INIT_SCRIPT = `(function(){var d=document.documentElement,p='/';try{p=location.pathname||'/';}catch(e){}var c=p==='/workflows'||p.indexOf('/workflows/')===0||${JSON.stringify(
  WORKSPACE_ROUTES.filter((r) => r !== '/workflows'),
)}.indexOf(p)>=0;var w=${SIDEBAR_DEFAULT_W};try{var s=JSON.parse(localStorage.getItem('${SIDEBAR_STORAGE_KEY}')||'null');if(s&&(s.v===1||s.v===2)){var x=s.w;if(typeof x==='number'&&isFinite(x)){x=Math.round(x);if(x<${SIDEBAR_RAIL_THRESHOLD})x=${SIDEBAR_RAIL_W};else if(x<${SIDEBAR_MIN_FULL_W})x=${SIDEBAR_MIN_FULL_W};else{var m=${JSON.stringify(
  SIDEBAR_SNAP.filter((p) => p >= SIDEBAR_MIN_FULL_W),
)};for(var i=0;i<m.length;i++){if(Math.abs(x-m[i])<=${SIDEBAR_SNAP_RADIUS}){x=m[i];break;}}if(x>${SIDEBAR_MAX_W})x=${SIDEBAR_MAX_W};}w=x;}}}catch(e){}try{var v=innerWidth,cw=d.clientWidth;if(cw>0&&v-cw>${VIEWPORT_INFLATION_PX})v=cw;if(w>${SIDEBAR_RAIL_W}&&v>0){if(v<${SIDEBAR_RAIL_VIEWPORT})w=${SIDEBAR_RAIL_W};else{if(v<${SIDEBAR_CAP_VIEWPORT}&&w>${SIDEBAR_DEFAULT_W})w=${SIDEBAR_DEFAULT_W};if(v-w<${SIDEBAR_MIN_CONTENT})w=${SIDEBAR_RAIL_W};}}}catch(e){}try{d.style.setProperty('--sidebar-w',w+'px');d.setAttribute('data-sidebar',w<${SIDEBAR_MODE_BREAK}?'rail':'full');if(c)d.setAttribute('data-canvas','1');else d.removeAttribute('data-canvas');}catch(e){}})();`;
