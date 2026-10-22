import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Bundle contract: the heavy interaction-driven visualizations must reach the
 * browser via next/dynamic with ssr:false and a dimension-matched placeholder,
 * so route First Load JS stays lean and nothing shifts when they hydrate.
 * (Home/comms graphs are lightweight hand-rolled SVG with no heavy deps, so
 * they are intentionally left eager.)
 */
describe('code-splitting the heavy graphs', () => {
  test('BrainGraphView loads KnowledgeGraph lazily, client-only', () => {
    const src = read('components/BrainGraphView.tsx');
    expect(src).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/KnowledgeGraph'\)/);
    expect(src).toMatch(/ssr:\s*false/);
    // dimension-matched skeleton: the wheel canvas is 680px tall
    expect(src).toContain('h-[680px]');
    // no eager import remains
    expect(src).not.toMatch(/import \{ KnowledgeGraph \}/);
  });

  test('the Neural view is cut and archived (GladOS UI H34, AC05.5)', () => {
    const src = read('components/BrainGraphView.tsx');
    // no Neural control and no import of the archived engine
    expect(src).not.toMatch(/label: 'Neural'|NeuralGraph'\)/);
    expect(src).not.toMatch(/aria-pressed/);
    expect(existsSync(join(process.cwd(), 'components/NeuralGraph.tsx'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'lib/neural-layout.ts'))).toBe(false);
    for (const f of ['NeuralGraph.tsx', 'NeuralDetail.tsx', 'neural-layout.ts', 'README.md']) {
      expect(existsSync(join(process.cwd(), 'archive/neural-graph', f)), f).toBe(true);
    }
  });

  test('the social page pulls AudienceConsistency through a lazy client wrapper', () => {
    expect(existsSync(join(process.cwd(), 'components/AudienceConsistencyLazy.tsx'))).toBe(true);
    const lazy = read('components/AudienceConsistencyLazy.tsx');
    expect(lazy).toContain("'use client'");
    expect(lazy).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/AudienceConsistency'\)/);
    expect(lazy).toMatch(/ssr:\s*false/);
    expect(lazy).toContain('rounded-lg-t border border-os-border bg-os-surface'); // card-shaped placeholder
    const page = read('app/social/page.tsx');
    expect(page).toContain('AudienceConsistencyLazy');
    expect(page).not.toMatch(/from '@\/components\/AudienceConsistency';/);
  });

  test('the funnel page carries no heavy board: the retired visualizations stay gone', () => {
    const page = read('app/funnel/page.tsx');
    expect(page).not.toMatch(/FunnelNeural|FunnelRadialLazy|FunnelSpaceLazy|FunnelBoardLazy|FunnelJourneyBoard/);
    for (const f of ['FunnelNeural', 'FunnelRadial', 'FunnelSpace', 'FunnelJourneyBoard', 'FunnelBoardLazy', 'FunnelNodeCard']) {
      expect(existsSync(join(process.cwd(), `components/${f}.tsx`))).toBe(false);
    }
  });
});
