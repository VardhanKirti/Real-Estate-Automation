import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SIDEBAR_PREFS,
  SIDEBAR_INIT_SCRIPT,
  SIDEBAR_STORAGE_KEY,
  applySidebarState,
  commitWidth,
  effectiveWidth,
  keyWidth,
  toggleWidth,
  isWorkspaceRoute,
  parseSidebarPrefs,
  readSidebarPrefs,
  resolveSidebar,
  sidebarMode,
  snapWidth,
  writeSidebarPrefs,
  WORKSPACE_ROUTES,
} from '@/lib/sidebar';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** A stub <html> that records what the script or helper writes. */
function stubRoot() {
  const vars: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  return {
    vars,
    attrs,
    style: { setProperty: (k: string, v: string) => void (vars[k] = v) },
    setAttribute: (k: string, v: string) => void (attrs[k] = v),
    removeAttribute: (k: string) => void delete attrs[k],
  };
}

/** Run SIDEBAR_INIT_SCRIPT in a sandbox with a stub document, storage and location. */
function runInit(pathname: string, stored: string | null | (() => never), opts: { preCanvas?: boolean; vw?: number } = {}) {
  const root = stubRoot();
  if (opts.preCanvas) root.attrs['data-canvas'] = '1';
  const localStorage = {
    getItem: (k: string) => {
      if (typeof stored === 'function') return stored();
      return k === SIDEBAR_STORAGE_KEY ? stored : null;
    },
  };
  new Function('document', 'localStorage', 'location', 'innerWidth', SIDEBAR_INIT_SCRIPT)(
    { documentElement: root },
    localStorage,
    { pathname },
    opts.vw ?? 1440,
  );
  return root;
}

describe('S09 sidebar model: constants and pure helpers', () => {
  test('workspace routes are the four full-height pages (layout only)', () => {
    expect([...WORKSPACE_ROUTES]).toEqual(['/workflows', '/wizard', '/blueprint', '/inbox']);
    for (const p of ['/wizard', '/workflows', '/workflows/abc', '/blueprint', '/inbox']) expect(isWorkspaceRoute(p), p).toBe(true);
    for (const p of ['/', '/workflowsx', '/brain', '/inbox/x', '/wizardry']) expect(isWorkspaceRoute(p), p).toBe(false);
  });

  test('snapWidth: rail threshold, minimum labelled width, magnets, clamp', () => {
    const cases: [number, number][] = [
      [40, 64], [100, 64], [123, 64], [124, 184], [150, 184], [225, 232], [240, 232],
      [250, 250], [310, 320], [400, 320], [NaN, 232], [Infinity, 232],
    ];
    for (const [raw, want] of cases) expect(snapWidth(raw), String(raw)).toBe(want);
  });

  test('effectiveWidth: viewport caps and room for the Wizard dock, never above stored', () => {
    expect(effectiveWidth(232, 700, 0)).toBe(64);
    expect(effectiveWidth(320, 1000, 0)).toBe(232);
    expect(effectiveWidth(232, 1440, 760)).toBe(64);
    expect(effectiveWidth(232, 1440, 380)).toBe(232);
    expect(effectiveWidth(300, 1600, 0)).toBe(300);
    expect(effectiveWidth(64, 1600, 0)).toBe(64);
  });

  test('sidebarMode switches at 120', () => {
    expect(sidebarMode(64)).toBe('rail');
    expect(sidebarMode(119)).toBe('rail');
    expect(sidebarMode(120)).toBe('full');
    expect(sidebarMode(232)).toBe('full');
  });
});

describe('S09 sidebar preference store', () => {
  test('defaults: v2, one width of 232 for every page, last full 232', () => {
    expect(DEFAULT_SIDEBAR_PREFS).toEqual({ v: 2, w: 232, lastFull: 232 });
    expect(SIDEBAR_STORAGE_KEY).toBe('glados-sidebar');
  });

  test('garbage, other versions and bad numbers fall back without throwing', () => {
    expect(parseSidebarPrefs(null)).toEqual(DEFAULT_SIDEBAR_PREFS);
    expect(parseSidebarPrefs('{not json')).toEqual(DEFAULT_SIDEBAR_PREFS);
    expect(parseSidebarPrefs('{"v":3,"w":300}')).toEqual(DEFAULT_SIDEBAR_PREFS);
    expect(parseSidebarPrefs('[]')).toEqual(DEFAULT_SIDEBAR_PREFS);
    expect(parseSidebarPrefs('{"v":2,"w":"wide","lastFull":64}')).toEqual({ v: 2, w: 232, lastFull: 232 });
    expect(parseSidebarPrefs('{"v":2,"w":300}')).toEqual({ v: 2, w: 300, lastFull: 232 });
  });

  test('v1 migrates to v2: keeps w and lastFull, drops canvasW', () => {
    expect(parseSidebarPrefs('{"v":1,"w":232,"canvasW":64,"lastFull":232}')).toEqual({ v: 2, w: 232, lastFull: 232 });
    expect(parseSidebarPrefs('{"v":1,"w":300,"canvasW":150,"lastFull":260}')).toEqual({ v: 2, w: 300, lastFull: 260 });
    expect(parseSidebarPrefs('{"v":1,"w":64,"canvasW":320,"lastFull":320}')).toEqual({ v: 2, w: 64, lastFull: 320 });
    expect(parseSidebarPrefs('{"v":1,"w":"wide","canvasW":999,"lastFull":64}')).toEqual({ v: 2, w: 232, lastFull: 232 });
    expect(parseSidebarPrefs('{"v":1,"w":250,"canvasW":64,"lastFull":250}')).not.toHaveProperty('canvasW');
  });

  test('read and write survive a throwing store', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSidebarPrefs(throwing)).toEqual(DEFAULT_SIDEBAR_PREFS);
    expect(writeSidebarPrefs(DEFAULT_SIDEBAR_PREFS, throwing)).toBe(false);
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(writeSidebarPrefs({ v: 2, w: 300, lastFull: 300 }, store)).toBe(true);
    expect(readSidebarPrefs(store)).toEqual({ v: 2, w: 300, lastFull: 300 });
    // a v1 value written by an older build reads back migrated
    mem.set(SIDEBAR_STORAGE_KEY, '{"v":1,"w":320,"canvasW":64,"lastFull":320}');
    expect(readSidebarPrefs(store)).toEqual({ v: 2, w: 320, lastFull: 320 });
  });

  test('resolveSidebar: the same width on workspace and normal routes; the route sets only the layout flag', () => {
    const prefs = { v: 2 as const, w: 300, lastFull: 300 };
    expect(resolveSidebar('/', prefs)).toEqual({ width: 300, mode: 'full', workspace: false });
    expect(resolveSidebar('/wizard', prefs)).toEqual({ width: 300, mode: 'full', workspace: true });
    expect(resolveSidebar('/workflows/x', DEFAULT_SIDEBAR_PREFS)).toEqual({ width: 232, mode: 'full', workspace: true });
    expect(resolveSidebar('/inbox', { ...prefs, w: 64 })).toEqual({ width: 64, mode: 'rail', workspace: true });
  });

  test('applySidebarState writes the variable and both flags on <html>', () => {
    const root = stubRoot();
    applySidebarState(root, { width: 64, mode: 'rail', workspace: true });
    expect(root.vars['--sidebar-w']).toBe('64px');
    expect(root.attrs).toEqual({ 'data-sidebar': 'rail', 'data-canvas': '1' });
    applySidebarState(root, { width: 232, mode: 'full', workspace: false });
    expect(root.vars['--sidebar-w']).toBe('232px');
    expect(root.attrs).toEqual({ 'data-sidebar': 'full' });
  });
});

describe('S09 SIDEBAR_INIT_SCRIPT (no first-paint shift)', () => {
  test('workspace route with nothing stored: 232 like every page, plus the layout flag', () => {
    const r = runInit('/wizard', null);
    expect(r.vars['--sidebar-w']).toBe('232px');
    expect(r.attrs).toEqual({ 'data-sidebar': 'full', 'data-canvas': '1' });
  });

  test('normal route with nothing stored: 232, full, no canvas flag', () => {
    const r = runInit('/', null, { preCanvas: true });
    expect(r.vars['--sidebar-w']).toBe('232px');
    expect(r.attrs).toEqual({ 'data-sidebar': 'full' });
  });

  test('one stored width applies on every page (v2 and a v1 value alike)', () => {
    for (const stored of [JSON.stringify({ v: 2, w: 300, lastFull: 300 }), JSON.stringify({ v: 1, w: 300, canvasW: 64, lastFull: 300 })]) {
      expect(runInit('/', stored).vars['--sidebar-w']).toBe('300px');
      const c = runInit('/workflows/abc', stored);
      expect(c.vars['--sidebar-w']).toBe('300px');
      expect(c.attrs).toEqual({ 'data-sidebar': 'full', 'data-canvas': '1' });
    }
    const rail = JSON.stringify({ v: 2, w: 64, lastFull: 232 });
    expect(runInit('/', rail).attrs).toEqual({ 'data-sidebar': 'rail' });
    expect(runInit('/blueprint', rail).attrs).toEqual({ 'data-sidebar': 'rail', 'data-canvas': '1' });
  });

  test('survives getItem throwing and invalid JSON (the default width on every route)', () => {
    const t = runInit('/inbox', () => {
      throw new Error('blocked');
    });
    expect(t.vars['--sidebar-w']).toBe('232px');
    expect(t.attrs['data-canvas']).toBe('1');
    const j = runInit('/', '{oops');
    expect(j.vars['--sidebar-w']).toBe('232px');
    expect(j.attrs['data-sidebar']).toBe('full');
  });

  test('agrees with resolveSidebar on every route and stored value', () => {
    const routes = ['/', '/wizard', '/workflows', '/workflows/a', '/blueprint', '/inbox', '/brain', '/workflowsx'];
    const stored = [
      null,
      '{bad',
      '{"v":2,"w":300}',
      '{"v":3,"w":300}',
      '{"v":2,"w":64,"lastFull":320}',
      '{"v":2,"w":184,"lastFull":184}',
      '{"v":2,"w":320,"lastFull":320}',
      '{"v":2,"w":"x","lastFull":232}',
      '{"v":1,"w":100,"canvasW":150,"lastFull":232}',
      '{"v":1,"w":225,"canvasW":310,"lastFull":232}',
      '{"v":1,"w":999,"canvasW":"x","lastFull":232}',
      '{"v":1,"w":250,"canvasW":64,"lastFull":250}',
    ];
    for (const vw of [1440, 1600, 1099, 1000, 790, 767, 500]) {
      for (const p of routes) {
        for (const s of stored) {
          const want = resolveSidebar(p, parseSidebarPrefs(s), vw);
          const got = runInit(p, s, { vw });
          const at = `${vw} ${p} ${s}`;
          expect(got.vars['--sidebar-w'], at).toBe(`${want.width}px`);
          expect(got.attrs['data-sidebar'], at).toBe(want.mode);
          expect(got.attrs['data-canvas'] === '1', at).toBe(want.workspace);
        }
      }
    }
  });

  test('applies the viewport caps before paint: 320 stored shows 232 under 1100 and the rail under 768', () => {
    const stored = JSON.stringify({ v: 2, w: 320, lastFull: 320 });
    expect(runInit('/', stored, { vw: 1600 }).vars['--sidebar-w']).toBe('320px');
    expect(runInit('/wizard', stored, { vw: 1000 }).vars['--sidebar-w']).toBe('232px');
    expect(runInit('/', stored, { vw: 1000 }).vars['--sidebar-w']).toBe('232px');
    expect(runInit('/', stored, { vw: 700 }).attrs['data-sidebar']).toBe('rail');
  });
});

describe('S09 commits, toggle and keyboard steps', () => {
  const prefs = { v: 2 as const, w: 232, lastFull: 232 };

  test('commitWidth stores the one width; a labelled width becomes lastFull, the rail does not', () => {
    expect(commitWidth(prefs, 300)).toEqual({ v: 2, w: 300, lastFull: 300 });
    expect(commitWidth({ ...prefs, lastFull: 300 }, 90)).toEqual({ v: 2, w: 64, lastFull: 300 });
    expect(commitWidth(prefs, 150).w).toBe(184);
  });

  test('toggleWidth: full → rail remembers the width; rail → lastFull', () => {
    const railed = toggleWidth({ ...prefs, w: 300, lastFull: 232 }, 300);
    expect(railed).toEqual({ v: 2, w: 64, lastFull: 300 });
    expect(toggleWidth(railed, 64)).toEqual({ v: 2, w: 300, lastFull: 300 });
    // shown capped below stored (small window): collapsing keeps the stored width as lastFull
    expect(toggleWidth({ ...prefs, w: 320 }, 232).lastFull).toBe(320);
  });

  test('keyWidth: ±16 (Shift ±64), Home/End, out of and back into the rail', () => {
    expect(keyWidth(232, 'ArrowRight')).toBe(248);
    expect(keyWidth(232, 'ArrowLeft')).toBe(216);
    expect(keyWidth(232, 'ArrowRight', true)).toBe(296);
    expect(keyWidth(312, 'ArrowRight')).toBe(320);
    expect(keyWidth(190, 'ArrowLeft')).toBe(64);
    expect(keyWidth(64, 'ArrowRight')).toBe(184);
    expect(keyWidth(64, 'ArrowLeft')).toBe(64);
    expect(keyWidth(250, 'Home')).toBe(64);
    expect(keyWidth(64, 'End')).toBe(320);
    expect(keyWidth(232, 'a')).toBeNull();
  });

  test('resolveSidebar with a viewport and the Wizard dock applies effectiveWidth', () => {
    expect(resolveSidebar('/', { ...prefs, w: 320 }, 1000).width).toBe(232);
    expect(resolveSidebar('/', prefs, 1440, 760).width).toBe(64);
    expect(resolveSidebar('/', prefs, 1440, 380).width).toBe(232);
    expect(resolveSidebar('/wizard', { ...prefs, w: 300 }, 1600)).toEqual({ width: 300, mode: 'full', workspace: true });
    // O9: the viewport rules apply equally on a workspace route
    expect(resolveSidebar('/wizard', { ...prefs, w: 320 }, 1000).width).toBe(232);
    expect(resolveSidebar('/inbox', prefs, 700).width).toBe(64);
  });
});

describe('S09 one-DOM sidebar (source)', () => {
  const src = read('components/Sidebar.tsx');

  test('one aside renders NAV_GROUPS for every width: no Rail component, no route-picked variant', () => {
    expect(src).not.toMatch(/function Rail\b/);
    expect(src).not.toContain('os-rail-btn');
    expect(src).toContain('visibleGroups(off).map');
    expect(src.match(/<aside\s/g)?.length).toBe(1);
    expect(src).toContain('id="os-sidebar"');
    expect(src).toContain('activeHref(pathname)');
    expect(src).toContain("aria-current={on ? 'page' : undefined}");
    expect(src).toContain('role="group"');
  });

  test('the handle is a focusable separator with live values; drag, double-click, keys', () => {
    expect(src).toContain('role="separator"');
    expect(src).toContain('tabIndex={0}');
    expect(src).toContain('aria-valuenow={shown}');
    expect(src).toContain('aria-valuemin={SIDEBAR_RAIL_W}');
    expect(src).toContain('aria-valuemax={SIDEBAR_MAX_W}');
    expect(src).toContain('onDoubleClick={toggle}');
    expect(src).toContain("pushEscape(() => endDrag(false, target), { id: 'sidebar-drag' })");
  });

  test('toggle is reachable four ways: handle, chevron, Cmd/Ctrl+\\, palette event', () => {
    expect(src).toMatch(/e\.metaKey \|\| e\.ctrlKey/);
    expect(src).toContain("e.key === '\\\\'");
    expect(src).toContain('SIDEBAR_TOGGLE_EVENT');
    expect(src).toContain('os-side-toggle');
  });

  test('nav links carry no native title (the styled tooltip replaces it); no raw colour in the shell chrome', () => {
    const links = src.slice(src.indexOf('<Link\n                      key={href}'), src.indexOf('</Link>', src.indexOf('<Link\n                      key={href}')));
    expect(links).not.toMatch(/\btitle=/);
    for (const f of ['components/Sidebar.tsx', 'components/Topbar.tsx', 'components/NavTooltip.tsx']) {
      expect(read(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });

  test('canvases refit after a committed change: sidebar:resize plus one synthetic resize', () => {
    expect(src).toContain("new Event('resize')");
    expect(src).toContain('SIDEBAR_RESIZE_EVENT');
  });
});

describe('S09 CSS', () => {
  const css = read('app/globals.css');
  const block = css.slice(css.indexOf('/* ── S09 resizable sidebar'), css.indexOf('/* ── end S09 resizable sidebar ── */'));

  test('rail and full modes key on html[data-sidebar] only; no route forces the rail (SPEC 4.2)', () => {
    expect(block).toContain("html[data-sidebar='rail'] .os-sidebar");
    expect(css).not.toMatch(/\.os-rail-btn\b/);
    // data-canvas sits in no rail selector and sets no width (Classic and GladOS)
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) ?? [];
    for (const rule of rules) {
      const sel = rule.slice(0, rule.indexOf('{'));
      if (/data-sidebar='rail'/.test(sel) || /--sidebar-w\s*:/.test(rule)) expect(sel, sel.trim()).not.toContain('data-canvas');
    }
    expect(css).not.toContain(".g-side[data-canvas='1'] a.g-side-item");
    expect(css).not.toContain(':not([data-canvas]))');
  });

  test('drag disables transitions; reduced motion makes resizing instant', () => {
    expect(block).toMatch(/html\.sidebar-dragging :is\([^)]*\.os-shell[^)]*\) \{\s*transition: none/);
    const reduced = block.slice(block.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.os-sidebar,[\s\S]*\.os-shell,[\s\S]*transition: none/);
  });

  test('touch: wider handle and an always-visible chevron', () => {
    expect(block).toMatch(/@media \(pointer: coarse\) \{\s*\.os-side-toggle \{\s*opacity: 1/);
  });

  test('scroll fades are alpha masks only', () => {
    expect(block).toMatch(/\.os-nav\[data-fade-bottom\] \{[^}]*mask-image: linear-gradient\(to bottom, #000/);
  });
});

describe('S09 plumbing: one width variable, set before paint', () => {
  test('layout injects SIDEBAR_INIT_SCRIPT right after the appearance script and has no hard-coded margin', () => {
    const layout = read('app/layout.tsx');
    expect(layout).not.toContain('ml-[232px]');
    const theme = layout.indexOf('__html: APPEARANCE_INIT_SCRIPT');
    const side = layout.indexOf('__html: SIDEBAR_INIT_SCRIPT');
    expect(theme).toBeGreaterThan(0);
    expect(side).toBeGreaterThan(theme);
    expect(layout.slice(0, layout.indexOf('<body'))).toContain('SIDEBAR_INIT_SCRIPT');
  });

  test('globals.css: one --sidebar-w, canvas flag on <html>, no hard-coded sidebar offsets', () => {
    const css = read('app/globals.css');
    expect(css).toMatch(/:root \{\s*--sidebar-w: 232px;\s*\}/);
    expect(css).toMatch(/\.os-shell \{\s*margin-left: var\(--sidebar-w\);\s*\}/);
    expect(css).not.toContain('body[data-canvas');
    expect(css).toContain("html[data-canvas='1'] .os-topbar");
    expect(css).not.toMatch(/left:\s*232px/);
    expect(css).not.toMatch(/left:\s*64px/);
    for (const sel of ['.bh-skeleton {', '.ib-page {']) {
      const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
      expect(block, sel).toContain('left: var(--sidebar-w)');
    }
  });

  test('fixed canvases and the /brain frame read --sidebar-w', () => {
    const canvas = read('components/workflow-canvas/canvas.css');
    expect(canvas).not.toMatch(/left:\s*64px/);
    expect(canvas).toMatch(/\.wfc \{[^}]*left: var\(--sidebar-w\)/);
    const brain = read('app/brain/page.tsx');
    expect(brain).not.toContain('232px');
    expect(brain).toContain('100vw - var(--sidebar-w) - var(--conductor-w, 0px)');
  });

  test('Sidebar uses isWorkspaceRoute for layout only, writes the flag on <html> (not <body>), and sizes from the variable', () => {
    const src = read('components/Sidebar.tsx');
    expect(src).toContain('isWorkspaceRoute(pathname)');
    expect(src).not.toMatch(/(canvas|workspace)\s*\?\s*SIDEBAR_RAIL_W/);
    expect(src).not.toContain('canvasRef');
    expect(src).not.toContain('document.body.dataset');
    expect(src).not.toContain('w-[232px]');
    expect(src).toContain('w-[var(--sidebar-w)]');
  });
});
