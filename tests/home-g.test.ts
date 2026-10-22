import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { G_READY, G_TREE_FILES, isGReady } from '@/lib/g-ready';
import { GLOBALS_CSS } from './helpers/theme-css';

/**
 * Home under the GladOS style (glados-ui SPEC S01, lane H): source assertions
 * for the tree's contract. The visual pass is scripts/g-audit.mjs on `/`.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const G = read('components/home/HomeG.tsx');
const CONSOLE = read('components/Home6Console.tsx');
const CHART = read('components/Home6Chart.tsx');
const BLOCK = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('/* ── S01 home (G)'), GLOBALS_CSS.indexOf('/* ── end S01 home (G) ── */')).replace(/\/\*[\s\S]*?\*\//g, '');

describe('Home (GladOS) is converted', () => {
  test('/ is in G_READY with its tree files, and only / matches it', () => {
    expect(G_READY).toContain('/');
    expect(G_TREE_FILES['/']).toEqual(['components/home/HomeG.tsx']);
    expect(isGReady('/')).toBe(true);
    expect(isGReady('/?x=1')).toBe(true);
  });

  test('the console fetches once and forks to the GladOS tree (X5)', () => {
    expect(CONSOLE).toContain("treeFor(getAppearance(), '/') === 'glados'");
    expect(CONSOLE.indexOf("treeFor(getAppearance(), '/') === 'glados'")).toBeLessThan(CONSOLE.indexOf('className="h6-home'));
    expect(read('app/page.tsx')).toMatch(/<Home6Console \/>/);
  });
});

describe('heroes (FR-1 to FR-4, C22)', () => {
  test('exactly two heroes: Revenue (a) and Inbound (b), each opening what it measures', () => {
    expect(G.match(/<GHeroCard/g)?.length).toBe(4); // a populated and an unconfigured form each
    expect(G).toMatch(/variant="a"[\s\S]{0,60}href="\/finances"/);
    expect(G).toMatch(/variant="b"[\s\S]{0,60}href="\/inbox"/);
    expect(G).toContain('`Revenue · ${period}`');
    expect(G).toContain("'Inbound · 24h'");
    expect(G).toContain('<GShareBar');
    expect(G).toContain('<GTickStrip');
  });

  test('empty heroes say what is missing and route to setup (honest or absent)', () => {
    expect(G).toMatch(/status="No payment processor connected"\s+setupHref=\{setupHrefFor\('stripe'\)\}/);
    expect(G).toMatch(/status="Comms not connected"\s+setupHref=\{setupHrefFor\('email'\)\}/);
    expect(G).toContain("'Quiet day · 0 in 24h'");
    expect(G).not.toContain('need reply');
  });
});

describe('cards (FR-5 to FR-15)', () => {
  test('the status pill comes from stateOfWorld, never a static Live', () => {
    expect(G).toContain('{status.pill.text}');
    expect(G).not.toMatch(/>\s*Live\s*</);
  });

  test('four stats, no Inbound stat; one place for the brain page count', () => {
    const stats = G.slice(G.indexOf('function Stats'), G.indexOf('function ActivityCard'));
    expect(stats.match(/<GStat/g)?.length).toBe(4);
    expect([...stats.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/integrations', '/agents', '/agents', '/brain']);
    expect(stats).not.toMatch(/inbound/i);
    // the page count renders in the stats row only (AC01.7): the type, the value and its source title
    expect(G.match(/brainPages/g)?.length).toBe(3);
  });

  test('agents: runs and recent runs are one card; rows deep-link to the agent (FR-10, C21)', () => {
    expect(G).not.toContain('Recent runs</');
    expect(G).toContain('runs.lastRunText');
    expect(G).toContain('`/agents?agent=${encodeURIComponent(r.agentId)}`');
    expect(G).toContain('`/agents?agent=${encodeURIComponent(a.id)}`');
  });

  test('agents live counts every active agent and says how many more (H3)', () => {
    expect(G).toContain('{live.active}');
    expect(G).toContain('`+${live.more} more`');
  });

  test('no G-Brain card: health, the doctor bar and its Details drawer left Home (founderos-ui F1)', () => {
    expect(G).not.toContain('function SystemCard');
    expect(G).not.toContain('<GDrawer');
    expect(G).not.toMatch(/Health · of 100|G-Brain health/);
  });

  test('every row still leads where it did (FR-17)', () => {
    expect(G).toContain('href="/drift"');
    expect(G).toContain('href="/roadmap"');
    expect(G).toContain('`/finances?category=${encodeURIComponent(id)}`');
    expect(CONSOLE).toContain("c.key === 'email' ? '/social/beehiiv'");
  });
});

describe('house rules', () => {
  test('kit only: no raw controls, no Classic classes, no SetupLink', () => {
    expect(G).not.toMatch(/<(button|input|select|textarea)\b/);
    expect(G).not.toMatch(/\b(h6-card|h6-row|h6-seg|glass-panel|ae-btn|c-btn|text-os-accent)\b/);
    expect(G).not.toContain('SetupLink');
    expect(G).not.toMatch(/<HomeCopyValue/);
  });

  test('tokens only: no literals in the tree, no --h6-* or Classic tokens in it or its CSS', () => {
    expect(G).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(G).not.toMatch(/--h6-|--text-|--mist-rgb|--accent\)/);
    expect(BLOCK.length).toBeGreaterThan(0);
    expect(BLOCK).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|--h6-|--text-|--mist-rgb/);
  });

  test('no glow: no box-shadow other than the kit shadow tokens in the block (AC01.11)', () => {
    for (const m of BLOCK.matchAll(/box-shadow:\s*([^;]+);/g)) expect(m[1]).toMatch(/^var\(--g-shadow(-sm)?\)$/);
  });

  test('the chart skin keeps Classic exact and gives the GladOS skin tokens only', () => {
    expect(CHART).toContain("classic: { grid: 'rgb(var(--mist-rgb) / 0.06)', axis: 'var(--text-3)', hover: 'rgb(var(--mist-rgb) / 0.05)' }");
    expect(CHART).toContain("g: { grid: 'var(--g-line)', axis: 'var(--g-muted)', hover: 'var(--g-track-soft)' }");
    expect(G).toContain('skin="g"');
  });
});
