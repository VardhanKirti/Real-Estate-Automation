import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderWithRouter } from './helpers/render-client';

/**
 * Brand-safe style label (glados-ui SPEC §3.6, S00 FR-1, AC00.6, C39).
 * The new UI style is shown to users as BRAND.name: "GladOS" only on the
 * private build (GLADOS_BRAND=glados), "FounderOS" on the client build. No
 * client-visible string in the kit, the Settings picker, /setup or the shell
 * may carry the literal "GladOS"; the id `glados` lives only in attributes,
 * storage and code.
 */

const root = path.resolve(__dirname, '..');

function walk(rel: string): string[] {
  return readdirSync(path.join(root, rel)).flatMap((name) => {
    const r = `${rel}/${name}`;
    return statSync(path.join(root, r)).isDirectory() ? walk(r) : /\.tsx?$/.test(name) ? [r] : [];
  });
}

/** Files whose strings reach the user under the new style. Converted pages join through G_READY lanes. */
const SCANNED = [
  ...walk('components/g'),
  'components/AppearancePicker.tsx',
  'app/setup/page.tsx',
  'lib/system-setup.ts',
  'components/Sidebar.tsx',
  'components/Topbar.tsx',
  'components/CommandPalette.tsx',
  'components/ConductorPanel.tsx',
  'components/ui/Toast.tsx',
];

/** Source with block and line comments removed (a `//` inside a string, as in a URL, is kept). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1');
}

describe('no literal "GladOS" in client-visible source (AC00.6, C39)', () => {
  it('the comment stripper keeps strings and drops comments', () => {
    expect(stripComments("const a = 'GladOS'; // GladOS")).toContain("'GladOS'");
    expect(stripComments('/* GladOS */ x')).not.toContain('GladOS');
    expect(stripComments("// the GladOS style\nconst u = 'https://x.y'")).toBe("\nconst u = 'https://x.y'");
  });

  for (const file of SCANNED) {
    it(`${file} has no "GladOS" outside comments`, () => {
      const hits = stripComments(readFileSync(path.join(root, file), 'utf8'))
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /GladOS/.test(line))
        .map(({ line, i }) => `${file}:${i + 1} ${line.trim()}`);
      expect(hits).toEqual([]);
    });
  }
});

const STORED = { glados: { ui: 'glados', accent: 'ice', mode: 'dark' }, classic: { ui: 'classic', accent: 'ice', mode: 'dark' } } as const;
const ROLLOUT = { ready: 0, total: 27 };

/** Render the picker with GLADOS_BRAND set (or unset) before lib/brand.ts is evaluated. */
async function renderPicker(brand: string | undefined, ui: 'glados' | 'classic'): Promise<string> {
  vi.resetModules();
  vi.stubEnv('GLADOS_BRAND', brand ?? '');
  const { AppearancePicker } = await import('@/components/AppearancePicker');
  return renderWithRouter(createElement(AppearancePicker, { initial: STORED[ui], rollout: ROLLOUT }));
}

describe('the Style option reads BRAND.name (AC00.6)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  for (const ui of ['glados', 'classic'] as const) {
    it(`client build (GLADOS_BRAND unset), Style = ${ui}: "FounderOS", never "GladOS"`, async () => {
      const html = await renderPicker(undefined, ui);
      expect(html).toMatch(/role="radio"[^>]*>FounderOS</);
      expect(html).not.toMatch(/GladOS/);
    });

    it(`private build (GLADOS_BRAND=glados), Style = ${ui}: "GladOS"`, async () => {
      const html = await renderPicker('glados', ui);
      expect(html).toMatch(/role="radio"[^>]*>GladOS</);
      expect(html).not.toMatch(/FounderOS/);
    });
  }
});

describe('/setup on the client build has no "GladOS" text node (AC00.6)', () => {
  beforeAll(() => {
    process.env.GLADOS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'glados-brand-')), 'test.db');
    process.env.GBRAIN_BIN = path.join(tmpdir(), 'glados-no-gbrain-cli');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('renders Appearance first with a FounderOS style option', async () => {
    vi.resetModules();
    vi.stubEnv('GLADOS_BRAND', '');
    const { default: Page } = await import('@/app/setup/page');
    const html = renderWithRouter((await Page()) as ReactElement);
    const text = html.replace(/<[^>]+>/g, '\n');
    expect(text).not.toMatch(/GladOS/);
    expect(html).toContain('>FounderOS<');
    // S05 F05.90: Appearance is the first section heading on the page.
    const firstSection = html.indexOf('Appearance');
    for (const later of ['Bring-up', 'Recording', 'Security']) {
      const at = html.indexOf(later);
      expect(at, later).toBeGreaterThan(firstSection);
    }
  }, 20_000);
});
