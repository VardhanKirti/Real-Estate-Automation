/**
 * Bennett Legacy coverage of the GladOS-only pages (founderos-ui pages/wizard.md, login.md, lab.md;
 * lane fo/l-only). Static renders: the Legacy trees keep every action of the Classic tree, carry no
 * GladOS kit marker, and the shared Lab primitives switch their kit name with the style.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { WizardWorkspace } from '@/components/wizard/WizardWorkspace';
import { WizardL } from '@/components/wizard/WizardL';
import { NoPasswordL } from '@/components/login/LoginL';
import { LabStyleProvider } from '@/components/lab/v2/shared/kitMark';
import { ActionPill, RoundButton, Tile } from '@/components/lab/v2/shared';
import { frameToday } from '@/lib/lab/view/frames';
import { WizardProjectSchema } from '@/lib/wizard/store';
import type { CrewSnapshot } from '@/lib/wizard/crew';
import { L_READY, isLReady, isLegacyWorkspace } from '@/lib/l-ready';
import { renderWithRouter } from './helpers/render-client';

const at = '2026-10-12T10:00:00.000Z';
const project = WizardProjectSchema.parse({
  id: 'p1',
  name: 'Ship the launch post',
  createdAt: at,
  updatedAt: at,
  messages: [
    { role: 'user', text: 'Draft the post', at },
    { role: 'wizard', text: 'On it.', at },
  ],
  tasks: [{ id: 't1', title: 'Draft', createdAt: at }],
});
const crew: CrewSnapshot = { rows: [], designed: [], departments: [], totalRuns: 0, okRate: null, windowDays: 60 };
const props = { agents: [], departments: [], initialProjects: [project], initialCrew: crew };

/** Every button's visible label or aria-label, de-duplicated. */
function actions(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const aria = /aria-label="([^"]+)"/.exec(m[1])?.[1];
    const label = (aria ?? m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().toLowerCase();
    if (label) out.add(label);
  }
  return out;
}

describe('/wizard Legacy tree (pages/wizard.md)', () => {
  const classic = renderWithRouter(h(WizardWorkspace, props));
  const legacy = renderWithRouter(h(WizardL, props));

  it('W-2 every action in the Classic tree exists in the Legacy tree', () => {
    const want = actions(classic);
    const got = actions(legacy);
    // The Classic header's tabs and Create an agent are re-drawn as Legacy controls with the same names.
    for (const a of want) expect(got, a).toContain(a);
    expect(want.size).toBeGreaterThan(3);
  });

  it('W-3 no GladOS kit class or data-g in the Legacy DOM', () => {
    expect(legacy).not.toMatch(/\bdata-g=/);
    expect(legacy).not.toMatch(/class="[^"]*\bg-[a-z]/);
  });

  it('carries the FO eyebrow and the Legacy shell', () => {
    expect(legacy).toContain('// CONDUCTOR · PROJECTS · SESSIONS');
    expect(legacy).toContain('data-l="Shell"');
  });

  it('is registered: own Legacy tree, no slab (full-height workspace)', () => {
    expect(isLReady('/wizard')).toBe(true);
    expect(isLegacyWorkspace('/wizard')).toBe(true);
  });
});

describe('/login Legacy tree (pages/login.md)', () => {
  it('L-1 submits through the shared useLogin (same /api/auth/login as the other trees)', () => {
    const src = readFileSync(join(process.cwd(), 'components/login/LoginL.tsx'), 'utf8');
    expect(src).toMatch(/import \{ useLogin \} from '@\/components\/LoginForm'/);
    expect(src).not.toMatch(/fetch\(/);
  });

  it('no password: says so and links to Settings security, no working-looking password box', () => {
    const html = renderWithRouter(h(NoPasswordL, { brandName: 'GladOS' }));
    expect(html).toContain('No password is set');
    expect(html).toContain('href="/setup#security"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toMatch(/\bdata-g=/);
  });

  it('is registered in L_READY', () => {
    expect(L_READY).toContain('/login');
  });
});

describe('Content Lab under Legacy (pages/lab.md)', () => {
  const d = frameToday('default');
  const tile = { ...d.yourPosts[0], state: 'ready' as const };
  const legacy = (el: ReturnType<typeof h>) => renderWithRouter(h(LabStyleProvider, { legacy: true, children: el }));

  it('shared primitives carry data-l kit names under Legacy, never data-g', () => {
    for (const el of [h(Tile, tile), h(ActionPill, { label: 'Add source', href: '?x=1' }), h(RoundButton, { label: 'Setup', icon: 'menu', href: '?setup=keys' })]) {
      const out = legacy(el);
      expect(out).not.toMatch(/\bdata-g=/);
      expect(out).toMatch(/data-l="Lab[A-Za-z]+"/);
    }
  });

  it('GladOS and Classic keep data-g (AC-02-11 unchanged)', () => {
    expect(renderWithRouter(h(Tile, tile))).toContain('data-g="LabTile"');
    expect(renderWithRouter(h(LabStyleProvider, { legacy: false, children: h(Tile, tile) }))).toContain('data-g="LabTile"');
  });

  it('the Lab forks on treeFor, not usesGTree', () => {
    const src = readFileSync(join(process.cwd(), 'app/lab/_render.tsx'), 'utf8');
    expect(src).toContain("treeFor(getAppearance(), '/lab')");
    expect(src).not.toContain('usesGTree');
  });
});
