import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadClassicControls,
  parseGReady,
  readGReady,
  scanSourceForClassicControls,
} from '../scripts/g-audit/_lib.mjs';

/**
 * Classic-control source guard (docs/projects/glados-ui/SPEC.md GP4, FR-GP4.4, ACGP4.2).
 * Every GladOS-tree file of every route in G_READY is scanned for Classic control class names
 * (scripts/g-audit/classic-controls.json) and for <button>/<input>/<select>/<textarea> written
 * without a kit component. G_READY and the route → files registry (G_TREE_FILES) are read from
 * lib/appearance.ts, else lib/g-ready.ts; with neither, the registry is empty and the scan passes.
 * The runtime half of the guard is `node scripts/g-audit.mjs --controls`.
 */

const root = path.resolve(__dirname, '..');
const CFG = loadClassicControls(root);
const REG = readGReady(root);

/** Known exceptions, by file and line, each with its reason. Keep it short. */
const ALLOW: { file: string; line: number; reason: string }[] = [
  // kitify names the Classic class only to remove it and add the kit one in its place (GP4.1)
  { file: 'components/workflow-canvas/kit.ts', line: 15, reason: 'kitify detects the engine topbar button class to swap it for g-btn' },
  { file: 'components/workflow-canvas/kit.ts', line: 16, reason: 'kitify removes the engine topbar button class before adding g-btn' },
  { file: 'components/workflow-canvas/kit.ts', line: 18, reason: 'kitify swaps the engine primary class for g-btn-ink' },
];
const allowed = (file: string, line: number) => ALLOW.some((a) => a.file === file && a.line === line);
/**
 * Content Lab v2 (01 1, 02): its controls are 02's own lab2 components (ActionPill, RoundButton,
 * Segmented, Sheet), styled by the --lab-* token block, so a raw <button> there is the design system,
 * not a Classic leftover. Classic class names are still refused in those files.
 */
const OWN_CONTROLS = (file: string, kind: string) => file.startsWith('components/lab/v2/') && kind === 'raw-control';

describe('Classic-control source guard (GP4)', () => {
  it('every G_READY route registers its GladOS-tree files, and they exist', () => {
    for (const route of REG.routes) {
      const files = REG.files[route] ?? REG.files[route.split('?')[0]] ?? [];
      expect(files, `${route} has no G_TREE_FILES entry in ${REG.source}`).not.toEqual([]);
      for (const f of files) expect(fs.existsSync(path.join(root, f)), `${route}: ${f} missing`).toBe(true);
    }
  });

  const scanned = [...new Set(REG.routes.flatMap((r) => REG.files[r] ?? REG.files[r.split('?')[0]] ?? []))];
  for (const file of scanned) {
    it(`${file} uses kit controls only`, () => {
      const p = path.join(root, file);
      if (!fs.existsSync(p)) return; // reported by the registry test above
      const hits = scanSourceForClassicControls(fs.readFileSync(p, 'utf8'), CFG)
        .filter((h) => !allowed(file, h.line) && !OWN_CONTROLS(file, h.kind))
        .map((h) => `${file}:${h.line} ${h.kind} ${h.token} · ${h.text}`);
      expect(hits).toEqual([]);
    });
  }

  it('allow-list entries carry a reason and point at a scanned file', () => {
    for (const a of ALLOW) {
      expect(a.reason.trim().length).toBeGreaterThan(10);
      expect(scanned).toContain(a.file);
    }
  });
});

describe('the scanner itself (ACGP4.2)', () => {
  const kit = `import { GButton, GChip } from '@/components/g';
export function Filters() {
  // the old .ae-chip row lived here
  return (<div className="g-row"><GChip pressed>Open only</GChip><GButton size="sm">Save</GButton></div>);
}`;

  it('passes a GladOS-tree file built from the kit', () => {
    expect(scanSourceForClassicControls(kit, CFG)).toEqual([]);
  });

  it('fails when an .ae-chip literal is added', () => {
    const bad = kit.replace('<GChip pressed>Open only</GChip>', '<span className="ae-chip on">Open only</span>');
    const hits = scanSourceForClassicControls(bad, CFG);
    expect(hits.map((h) => [h.line, h.kind, h.token])).toEqual([[4, 'classic-class', 'ae-chip']]);
  });

  it('fails on a raw control element and on Classic classes inside template strings', () => {
    const hits = scanSourceForClassicControls('const a = <button onClick={go}>Go</button>;\nconst c = `ib-seg ${on ? "ib-seg-btn" : ""}`;', CFG);
    expect(hits.map((h) => h.token)).toEqual(['<button>', 'ib-seg', 'ib-seg-btn']);
  });

  it('fails glass-* and Classic utilities on control tags only', () => {
    const src = '<div className="glass-panel">x</div>\n<a href="/x" className="rounded-lg-t border-os-border">x</a>\n<Link href="/y" className="glass-chip">y</Link>';
    const hits = scanSourceForClassicControls(src, CFG).map((h) => [h.line, h.token]);
    expect(hits).toEqual([[2, 'rounded-lg-t on <a>'], [2, 'border-os-border on <a>'], [3, 'glass-chip on <Link>']]);
  });

  it('matches whole class tokens only', () => {
    // fc-chips is listed, c-chip is listed; neither may match inside a longer or prefixed name
    expect(scanSourceForClassicControls('className="fc-chips"', CFG).map((h) => h.token)).toEqual(['fc-chips']);
    expect(scanSourceForClassicControls('className="tfc-chipsy ae-btn-ghost g-btn"', CFG)).toEqual([]);
  });

  it('reads G_READY and G_TREE_FILES from registry source', () => {
    const src = `export const G_READY: string[] = ['/creative-engine', "/funnel"];
export const G_TREE_FILES: Record<string, string[]> = {
  '/creative-engine': ['components/creative-engine/DashboardG.tsx'],
  '/funnel': ['app/funnel/FunnelG.tsx', 'components/funnel/StagesG.tsx'],
};`;
    expect(parseGReady(src)).toEqual({
      routes: ['/creative-engine', '/funnel'],
      files: {
        '/creative-engine': ['components/creative-engine/DashboardG.tsx'],
        '/funnel': ['app/funnel/FunnelG.tsx', 'components/funnel/StagesG.tsx'],
      },
    });
    expect(parseGReady('export const THEMES = []')).toEqual({ routes: [], files: {} });
  });
});

describe('classic-controls.json', () => {
  const css = ['app/globals.css', 'components/funnel/funnel.css', 'components/workflow-canvas/canvas.css']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
    .join('\n');

  it('lists only classes that exist in the Classic stylesheets', () => {
    const missing = [...CFG.classes, ...CFG.onControlOnly].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(missing).toEqual([]);
  });

  it('never lists a kit class as Classic', () => {
    expect([...CFG.classes, ...CFG.onControlOnly, ...CFG.utilityOnControl].filter((c) => c.startsWith('g-'))).toEqual([]);
  });
});
