/**
 * FounderOS UI SPEC 4.2, fix (b): no page collapses or expands the sidebar on
 * its own. One stored width, the same on every route in the nav (SB-1); a
 * change made on any page holds on every other page (SB-2); the init script
 * paints exactly what the Sidebar will apply, so workspace pages do not jump
 * on first paint (SB-3); the viewport rules are unchanged and apply equally
 * to every route (SB-4, O9).
 */
import { describe, expect, test } from 'vitest';
import { NAV_EXTRA, NAV_ITEMS } from '@/lib/nav';
import {
  DEFAULT_SIDEBAR_PREFS,
  SIDEBAR_INIT_SCRIPT,
  SIDEBAR_STORAGE_KEY,
  WORKSPACE_ROUTES,
  commitWidth,
  effectiveWidth,
  parseSidebarPrefs,
  resolveSidebar,
  toggleWidth,
  type SidebarPrefs,
} from '@/lib/sidebar';

const ROUTES = [...new Set([...NAV_ITEMS, ...NAV_EXTRA].map((i) => i.href).concat([...WORKSPACE_ROUTES, '/workflows/abc']))];
const WIDTHS = [64, 184, 232, 320] as const; // rail, narrowest, default, widest
const prefsAt = (w: number): SidebarPrefs => ({ v: 2, w, lastFull: w >= 184 ? w : 232 });

function runInit(pathname: string, stored: string | null, vw: number) {
  const vars: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  const root = {
    style: { setProperty: (k: string, v: string) => void (vars[k] = v) },
    setAttribute: (k: string, v: string) => void (attrs[k] = v),
    removeAttribute: (k: string) => void delete attrs[k],
  };
  new Function('document', 'localStorage', 'location', 'innerWidth', SIDEBAR_INIT_SCRIPT)(
    { documentElement: root },
    { getItem: (k: string) => (k === SIDEBAR_STORAGE_KEY ? stored : null) },
    { pathname },
    vw,
  );
  return { vars, attrs };
}

describe('SPEC 4.2 fix (b): the sidebar respects the stored width on every page', () => {
  test('the nav includes the workspace routes (the walk covers them)', () => {
    for (const r of ['/workflows', '/wizard', '/blueprint', '/inbox']) expect(ROUTES, r).toContain(r);
  });

  test('SB-1: resolveSidebar(path, prefs).width is equal for every route, at rail, 184, 232 and 320', () => {
    for (const w of WIDTHS) {
      const prefs = prefsAt(w);
      const widths = new Set(ROUTES.map((p) => resolveSidebar(p, prefs).width));
      expect([...widths], `stored ${w}`).toEqual([w]);
      for (const vw of [1440, 1920]) {
        const shown = new Set(ROUTES.map((p) => resolveSidebar(p, prefs, vw).width));
        expect(shown.size, `stored ${w} at ${vw}`).toBe(1);
      }
    }
    // the default (nothing stored) is one width too, not the rail on workspaces
    expect(new Set(ROUTES.map((p) => resolveSidebar(p, DEFAULT_SIDEBAR_PREFS).width))).toEqual(new Set([232]));
  });

  test('SB-1 holds for a migrated v1 preference (its canvas width is dropped)', () => {
    const v1 = JSON.stringify({ v: 1, w: 232, canvasW: 64, lastFull: 232 });
    const prefs = parseSidebarPrefs(v1);
    expect(new Set(ROUTES.map((p) => resolveSidebar(p, prefs).width))).toEqual(new Set([232]));
    expect(new Set(ROUTES.map((p) => runInit(p, v1, 1440).vars['--sidebar-w']))).toEqual(new Set(['232px']));
  });

  test('SB-2: a toggle or a drag on any page holds on every other page', () => {
    for (const from of ROUTES) {
      const railed = toggleWidth(prefsAt(232), resolveSidebar(from, prefsAt(232), 1440).width);
      for (const to of ROUTES) expect(resolveSidebar(to, railed, 1440).width, `${from} → ${to}`).toBe(64);
      const back = toggleWidth(railed, resolveSidebar(from, railed, 1440).width);
      for (const to of ROUTES) expect(resolveSidebar(to, back, 1440).width, `${from} → ${to}`).toBe(232);
      const dragged = commitWidth(prefsAt(232), 300);
      for (const to of ROUTES) expect(resolveSidebar(to, dragged, 1440).width).toBe(300);
    }
  });

  test('SB-3: the init script paints what the Sidebar applies, on every route (no first-paint jump)', () => {
    for (const w of WIDTHS) {
      for (const stored of [JSON.stringify(prefsAt(w)), JSON.stringify({ v: 1, w, canvasW: 64, lastFull: 232 })]) {
        for (const vw of [1440, 1099, 900, 767]) {
          for (const p of ROUTES) {
            const want = resolveSidebar(p, parseSidebarPrefs(stored), vw);
            const got = runInit(p, stored, vw);
            expect(got.vars['--sidebar-w'], `${p} ${stored} ${vw}`).toBe(`${want.width}px`);
            expect(got.attrs['data-sidebar'], `${p} ${stored} ${vw}`).toBe(want.mode);
          }
        }
      }
    }
  });

  test('SB-4: viewport rules unchanged and identical on workspace and normal routes (O9)', () => {
    for (const w of WIDTHS) {
      for (const vw of [500, 767, 768, 900, 1099, 1100, 1440]) {
        for (const dock of [0, 380, 760]) {
          const want = effectiveWidth(w, vw, dock);
          for (const p of ROUTES) expect(resolveSidebar(p, prefsAt(w), vw, dock).width, `${p} ${w} ${vw} ${dock}`).toBe(want);
        }
      }
    }
    expect(effectiveWidth(232, 700, 0)).toBe(64); // rail under 768
    expect(effectiveWidth(320, 1000, 0)).toBe(232); // at most 232 under 1100
    expect(effectiveWidth(232, 1440, 760)).toBe(64); // dock squeeze under 560 of content
  });
});
