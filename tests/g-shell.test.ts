import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { undoTarget, type ToastItem } from '@/components/ui/Toast';

/**
 * Lane 2b: the shell under the GladOS style (docs/projects/glados-ui/SPEC.md
 * S00 §5.5, FR-16, GP4.5, C40). Source checks; the rendered shell is checked
 * with the Classic-control guard in scripts/g-audit.mjs once routes are in G_READY.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SHELL: Record<string, string[]> = {
  'components/Sidebar.tsx': ['GSidebar', 'GSidebarItem'],
  'components/Topbar.tsx': ['GTopbar'],
  'components/CommandPalette.tsx': ['GPalette'],
  'components/ConductorPanel.tsx': ['GWizardDock', 'GLauncher'],
};

describe('GladOS shell (S00 §5.5)', () => {
  for (const [file, names] of Object.entries(SHELL)) {
    it(`${file} renders its GladOS tree from the live style and marks it with data-g`, () => {
      const src = read(file);
      expect(src).toContain("from '@/lib/use-ui-style'");
      expect(src).toMatch(/useUiStyle\(ui\) === 'glados'/);
      for (const n of names) expect(src).toMatch(new RegExp(`['"]${n}['"]`));
    });
    it(`${file} has no client-visible "GladOS" literal (the style name is BRAND.name, §3.6)`, () => {
      expect(stripComments(read(file))).not.toMatch(/GladOS/);
    });
  }

  it('the root layout hands every shell piece the cookie style, so the first paint matches', () => {
    const src = read('app/layout.tsx');
    for (const tag of ['<Sidebar ', '<Topbar ', '<CommandPalette ', '<ConductorPanel ']) {
      const at = src.indexOf(tag);
      expect(at, tag).toBeGreaterThan(-1);
      expect(src.slice(at, src.indexOf('/>', at)), tag).toContain('ui={ui}');
    }
  });

  it('the shell controls are kit controls under GladOS (GP4.5)', () => {
    // edge toggle, top bar search and Wizard buttons, dock actions, launcher: GButton; palette: GSearch + GRow; composer: GAsk + GChip
    expect(read('components/Sidebar.tsx')).toMatch(/<GButton[\s\S]*?className="os-side-toggle g-side-toggle"/);
    const top = read('components/Topbar.tsx');
    expect(top.match(/<GButton/g)?.length).toBe(2);
    const pal = read('components/CommandPalette.tsx');
    expect(pal).toContain('<GSearch');
    expect(pal).toContain('<GRow');
    expect(pal).toContain('<GEmpty');
    const dock = read('components/ConductorPanel.tsx');
    expect(dock).toContain('<GAsk');
    expect(dock).toContain('<GChip');
    expect(dock).toMatch(/className=\{`g-launch/);
  });

  it('the 2b CSS block is tokens only: no literal colour, no mono', () => {
    const css = read('app/globals.css');
    const start = css.indexOf('/* ── 2b GladOS shell');
    const end = css.indexOf('/* ── end 2b GladOS shell ── */');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = stripComments(css.slice(start, end));
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(body).not.toMatch(/font-mono|--font-mono/);
    // everything GladOS-only paints from --g-* tokens; the Classic broadcast chip reads Classic tokens
    expect(body).toMatch(/:root\[data-ui='glados'\] \.os-sidebar\.g-side \{[^}]*var\(--g-bg\)/);
  });

  it('the sidebar keeps its S09 behaviour hooks in both styles', () => {
    const src = read('components/Sidebar.tsx');
    for (const hook of ['os-side-handle', 'os-side-toggle', 'os-nav-link', 'os-nav-label', 'onPointerDown={onHandleDown}', 'onDoubleClick={toggle}']) expect(src).toContain(hook);
  });
});

describe('toast Undo shortcut (C40)', () => {
  const item = (id: number, label?: string): ToastItem => ({ id, text: 't', tone: 'info', ms: 5000, action: label ? { label, onClick: () => {} } : undefined });
  it('picks the newest toast whose action is an Undo', () => {
    expect(undoTarget([item(1, 'Undo'), item(2), item(3, 'Undo')])?.id).toBe(3);
    expect(undoTarget([item(1, 'Undo'), item(2, 'Open')])?.id).toBe(1);
  });
  it('nothing to undo: null', () => {
    expect(undoTarget([])).toBeNull();
    expect(undoTarget([item(1), item(2, 'Retry')])).toBeNull();
  });
});
