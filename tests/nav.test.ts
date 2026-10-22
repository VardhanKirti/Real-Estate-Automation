import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_GROUPS, NAV_ITEMS, NAV_ORDER, NAV_EXTRA, DIGIT_VIEWS, WizardIcon, activeHref, groupOf, navTooltip } from '@/lib/nav';
import { EXTERNAL_COMMANDS, filterCommands, viewCommands } from '@/lib/palette';

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const hrefsOf = (id: string) => NAV_GROUPS.find((g) => g.id === id)!.items.map((i) => i.href);
const pageFor = (href: string) => (href === '/' ? 'app/page.tsx' : `app/${href.replace(/^\//, '')}/page.tsx`);

describe('nav model (SPEC S12 tree A)', () => {
  test('six groups in order; the command group at the top is untitled', () => {
    expect(NAV_GROUPS.map((g) => [g.id, g.title])).toEqual([
      ['command', null],
      ['revenue', 'Revenue'],
      ['growth', 'Growth'],
      ['workforce', 'Workforce'],
      ['knowledge', 'Knowledge'],
      ['system', 'System'],
    ]);
    // Accessible name for the untitled group (role="group" aria-label).
    expect(NAV_GROUPS[0].label).toBe('Command');
  });

  test('exact items per group (29 in all)', () => {
    expect(hrefsOf('command')).toEqual(['/', '/wizard', '/inbox']);
    expect(hrefsOf('revenue')).toEqual(['/funnel', '/brand-deals', '/clients', '/finances', '/trading']);
    expect(hrefsOf('growth')).toEqual(['/social', '/adpilot', '/creative-engine', '/analytics', '/lab', '/lead-magnets']);
    expect(hrefsOf('workforce')).toEqual(['/agents', '/chats', '/tasks', '/workflows', '/skills', '/compute']);
    expect(hrefsOf('knowledge')).toEqual(['/brain', '/database', '/knowledge', '/drift']);
    expect(hrefsOf('system')).toEqual(['/setup', '/integrations', '/usage', '/blueprint', '/roadmap']);
    expect(NAV_ITEMS).toHaveLength(29);
  });

  test('labels: Brain Files on /database, Creative Engine, Workforce not "Agents > Agents"', () => {
    const label = (href: string) => NAV_ITEMS.find((i) => i.href === href)?.label;
    expect(label('/database')).toBe('Brain Files');
    expect(label('/creative-engine')).toBe('Creative Engine');
    expect(label('/inbox')).toBe('Comms');
    // Q-KNO-3 (glados-ui SPEC C33): the label is Settings; the route stays /setup.
    expect(label('/setup')).toBe('Settings');
    expect(NAV_GROUPS.find((g) => g.id === 'workforce')!.title).not.toBe('Agents');
  });

  test('NAV_ORDER is NAV_GROUPS flattened; no duplicate hrefs across the nav and NAV_EXTRA', () => {
    expect(NAV_ORDER).toEqual(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)));
    const all = [...NAV_ORDER, ...NAV_EXTRA.map((i) => i.href)];
    expect(new Set(all).size).toBe(all.length);
  });

  test('placement: Brain Files and Blueprint are not workforce; Compute is (Brody, 2026-10-13: the machines agents run on)', () => {
    for (const href of ['/database', '/blueprint']) expect(hrefsOf('workforce')).not.toContain(href);
    expect(groupOf('/blueprint')?.id).toBe('system');
    expect(groupOf('/compute')?.id).toBe('workforce');
    expect(groupOf('/database')?.id).toBe('knowledge');
  });

  test('placement: Workflows is how the workforce runs; Analytics measures growth; Finances is revenue', () => {
    expect(groupOf('/workflows')?.id).toBe('workforce');
    expect(groupOf('/analytics')?.id).toBe('growth');
    expect(groupOf('/finances')?.id).toBe('revenue');
  });

  test('placement: Content Lab directly after Analytics in Growth (content-lab SPEC §9), past the digit shortcuts', () => {
    expect(groupOf('/lab')?.id).toBe('growth');
    expect(NAV_ORDER.indexOf('/lab')).toBe(NAV_ORDER.indexOf('/analytics') + 1);
    expect(DIGIT_VIEWS).not.toContain('/lab');
    expect(NAV_ITEMS.find((i) => i.href === '/lab')?.label).toBe('Content Lab');
  });

  test('placement (founderos-ui SPEC 2.1): Clients after Brand Deals in Revenue; Lead Magnets after Content Lab in Growth', () => {
    expect(groupOf('/clients')?.id).toBe('revenue');
    expect(NAV_ORDER.indexOf('/clients')).toBe(NAV_ORDER.indexOf('/brand-deals') + 1);
    expect(NAV_ITEMS.find((i) => i.href === '/clients')?.label).toBe('Clients');
    expect(groupOf('/lead-magnets')?.id).toBe('growth');
    expect(NAV_ORDER.indexOf('/lead-magnets')).toBe(NAV_ORDER.indexOf('/lab') + 1);
    expect(NAV_ITEMS.find((i) => i.href === '/lead-magnets')?.label).toBe('Lead Magnets');
  });

  test('placement: Creative Engine directly after AdPilot (S02); Brand Deals directly after Funnel', () => {
    expect(NAV_ORDER.indexOf('/creative-engine')).toBe(NAV_ORDER.indexOf('/adpilot') + 1);
    expect(NAV_ORDER.indexOf('/brand-deals')).toBe(NAV_ORDER.indexOf('/funnel') + 1);
  });

  test('removed surfaces are gone: Reference Model and Personas', () => {
    const all = [...NAV_ORDER, ...NAV_EXTRA.map((i) => i.href)];
    expect(all).not.toContain('/reference');
    expect(all).not.toContain('/personas');
    const labels = [...NAV_ITEMS, ...NAV_EXTRA].map((i) => i.label).concat(NAV_GROUPS.map((g) => g.title ?? ''));
    for (const gone of ['Reference Model', 'Personas', 'Variants', 'Intelligence', 'Operate']) expect(labels).not.toContain(gone);
  });

  test('every nav and palette-only view is a real page route', () => {
    for (const { href } of [...NAV_ITEMS, ...NAV_EXTRA]) {
      expect(existsSync(path.join(process.cwd(), pageFor(href))), `${href} should have a page.tsx`).toBe(true);
    }
  });

  test('every item has search keywords', () => {
    for (const i of [...NAV_ITEMS, ...NAV_EXTRA]) expect(i.keywords.trim().length, i.href).toBeGreaterThan(0);
  });

  test('the Wizard item uses the one exported Wizard glyph (S08 FR-1, C31)', () => {
    expect(NAV_ITEMS.find((i) => i.href === '/wizard')?.icon).toBe(WizardIcon);
  });

  test('AdPilot and Creative Engine carry the G1 accent flag; nothing else does (C32)', () => {
    expect(NAV_ITEMS.filter((i) => i.accent === 'adpilot').map((i) => i.href)).toEqual(['/adpilot', '/creative-engine']);
  });
});

describe('digit shortcuts', () => {
  test('1–9: the first nine visible views minus AdPilot (founderos-ui SPEC 2.1): Clients 6, Trading 8, Social 9', () => {
    expect(DIGIT_VIEWS).toEqual([
      '/', '/wizard', '/inbox', '/funnel', '/brand-deals', '/clients', '/finances', '/trading', '/social',
    ]);
    expect(DIGIT_VIEWS).not.toContain('/creative-engine');
  });

  test('regression: Social and Finances stay digit-reachable (Content retired 2026-09-17, archive/content-page)', () => {
    for (const href of ['/social', '/finances']) expect(DIGIT_VIEWS, `${href} must be reachable by digit`).toContain(href);
  });

  test('CommandPalette consumes the shared DIGIT_VIEWS (no private stale copy)', () => {
    const src = read('components/CommandPalette.tsx');
    expect(src).toMatch(/from '@\/lib\/nav'/);
    expect(src).not.toMatch(/const DIGIT_VIEWS\s*=/);
  });
});

describe('activeHref: one highlight, longest prefix', () => {
  const cases: [string, string | null][] = [
    ['/', '/'],
    ['/funnel', '/funnel'],
    ['/agents/setup/crm-pulse', '/agents'],
    ['/integrations/whatsapp', '/integrations'],
    ['/social/beehiiv', '/social'],
    ['/social/instagram', '/social'],
    ['/workflows/abc', '/workflows'],
    ['/creative-engine', '/creative-engine'],
    ['/creative-engine?engine=runs', '/creative-engine'],
    ['/ad-engine', '/creative-engine'],
    ['/org', '/agents'],
    ['/database', '/database'],
    ['/login', null],
    ['/personas', null],
    ['/reference', null],
    ['/nope', null],
  ];
  test.each(cases)('%s → %s', (pathname, want) => {
    expect(activeHref(pathname)).toBe(want);
  });

  test('"/" never matches a nested path', () => {
    expect(activeHref('/funnel/x')).toBe('/funnel');
    expect(activeHref('/unknown/x')).toBeNull();
  });

  test('/creative-engine highlights Creative Engine, never AdPilot', () => {
    expect(activeHref('/creative-engine/anything')).not.toBe('/adpilot');
  });
});

describe('command palette mirrors the nav (S12 FR-3, C34)', () => {
  const cmds = [...viewCommands(), ...EXTERNAL_COMMANDS];

  test('every nav label returns its own view as the top result (AC12.10)', () => {
    for (const item of [...NAV_ITEMS, ...NAV_EXTRA]) {
      expect(filterCommands(cmds, item.label)[0]?.href, item.label).toBe(item.href);
    }
  });

  test('old words and new views are findable', () => {
    const top = (q: string) => filterCommands(cmds, q)[0]?.href;
    expect(top('funnel')).toBe('/funnel');
    expect(top('drift')).toBe('/drift');
    expect(top('compute')).toBe('/compute');
    expect(top('brain files')).toBe('/database');
    expect(top('database')).toBe('/database');
    expect(top('ad engine')).toBe('/creative-engine');
    expect(top('org chart')).toBe('/org');
    expect(top('reference')).toBe('/blueprint');
    expect(top('settings')).toBe('/setup');
    expect(top('setup')).toBe('/setup');
    expect(top('appearance')).toBe('/setup');
  });

  test('group titles are searchable', () => {
    const system = filterCommands(cmds, 'system').map((c) => c.href);
    for (const href of hrefsOf('system')) expect(system).toContain(href);
  });

  test('derived ids are stable (nav-<label slug>)', () => {
    expect(viewCommands().find((c) => c.href === '/creative-engine')?.id).toBe('nav-creative-engine');
  });

  test('app/layout.tsx and lib/palette.ts hand-write no view list (only external https links)', () => {
    // Agent and tool rows in layout.tsx point at /agents and /integrations;
    // what must never come back is a literal view command.
    for (const rel of ['app/layout.tsx', 'lib/palette.ts']) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/hint:\s*'view'\s*}/);
      expect(src, rel).not.toMatch(/id:\s*'nav-/);
    }
    expect(read('lib/palette.ts')).not.toMatch(/href:\s*'\//);
    for (const c of EXTERNAL_COMMANDS) expect(c.href).toMatch(/^https:\/\//);
  });
});

describe('palette action commands (S09 FR-15)', () => {
  test('CommandPalette fires an action command as a window event instead of navigating', () => {
    const src = read('components/CommandPalette.tsx');
    expect(src).toMatch(/if \(command\.action\) window\.dispatchEvent\(new CustomEvent\(command\.action\)\)/);
  });
});

describe('sidebar tooltips (S09 FR-14, S12 §4.4)', () => {
  test('rail: the first item of a titled group names its group; digit chips follow DIGIT_VIEWS', () => {
    expect(navTooltip('/funnel', 'rail')).toEqual({ group: 'Revenue', label: 'Funnel', digit: 4 });
    expect(navTooltip('/brand-deals', 'rail')).toEqual({ group: null, label: 'Brand Deals', digit: 5 });
    expect(navTooltip('/', 'rail')).toEqual({ group: null, label: 'Home', digit: 1 });
    expect(navTooltip('/adpilot', 'rail')?.digit).toBeNull();
    expect(navTooltip('/funnel', 'full')?.group).toBeNull();
    expect(navTooltip('/nope', 'rail')).toBeNull();
  });
});

describe('AC-01-3 Content Lab stays active on every /lab/* page', () => {
  test.each(['/lab', '/lab/radar', '/lab/breakouts', '/lab/playbook', '/lab/studio', '/lab/ledger', '/lab/creatorverse'])('%s', (p) => {
    expect(activeHref(p)).toBe('/lab');
  });
});
