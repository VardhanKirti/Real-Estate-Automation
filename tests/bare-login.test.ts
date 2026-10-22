import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const { isBarePath, BARE_PATHS } = await import('@/lib/bare-routes');
const { ShellOnly, ShellColumn } = await import('@/components/ShellGate');

const LAYOUT = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');

/**
 * GladOS UI H37 (S05 F05.100, AC05.18, C32): /login renders without the app
 * shell in both styles. The browser check (no sidebar nav, no Wizard launcher
 * in the DOM) runs in the lane's Playwright pass; this pins the logic.
 */
describe('bare /login (H37)', () => {
  beforeEach(() => {
    pathname = '/';
  });

  test('isBarePath matches /login only', () => {
    expect(BARE_PATHS).toEqual(['/login']);
    expect(isBarePath('/login')).toBe(true);
    expect(isBarePath('/login/')).toBe(true);
    for (const p of ['/', '/setup', '/loginx', '/login/extra', '', null, undefined]) expect(isBarePath(p), String(p)).toBe(false);
  });

  test('ShellOnly hides its children on /login and keeps them elsewhere', () => {
    const el = () => createElement(ShellOnly, null, createElement('nav', { id: 'chrome' }));
    pathname = '/login';
    expect(renderToStaticMarkup(el())).toBe('');
    pathname = '/funnel';
    expect(renderToStaticMarkup(el())).toContain('id="chrome"');
  });

  test('ShellColumn drops the os-shell margins on /login', () => {
    const el = () => createElement(ShellColumn, { className: 'os-shell x', style: { marginRight: '1px' } }, 'body');
    pathname = '/login';
    const bare = renderToStaticMarkup(el());
    expect(bare).not.toContain('os-shell');
    expect(bare).not.toContain('margin-right');
    expect(bare).toContain('data-shell="bare"');
    pathname = '/';
    expect(renderToStaticMarkup(el())).toContain('class="os-shell x"');
  });

  test('every piece of shell chrome in the root layout sits inside ShellOnly', () => {
    for (const tag of ['<Sidebar ', '<Topbar ', '<CommandPalette ', '<ConductorPanel ']) {
      const at = LAYOUT.indexOf(tag);
      expect(at, tag).toBeGreaterThan(-1);
      const open = LAYOUT.lastIndexOf('<ShellOnly>', at);
      const close = LAYOUT.lastIndexOf('</ShellOnly>', at);
      expect(open, tag).toBeGreaterThan(close);
    }
    expect(LAYOUT).toMatch(/<ShellColumn className="os-shell /);
  });
});
