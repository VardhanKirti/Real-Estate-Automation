import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_ITEMS, DIGIT_VIEWS } from '@/lib/nav';
import { viewCommands, filterCommands } from '@/lib/palette';
import { ENGINE_HREF, ENGINE_NAME } from '@/lib/creative-engine/name';

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('Creative Engine rename, phase A (S02)', () => {
  test('nav item reads Creative Engine, directly after AdPilot (AC02.1)', () => {
    expect(NAV_ITEMS.find((n) => n.href === '/creative-engine')?.label).toBe('Creative Engine');
    const hrefs = NAV_ITEMS.map((n) => n.href);
    expect(hrefs.indexOf(ENGINE_HREF)).toBe(hrefs.indexOf('/adpilot') + 1);
    expect(hrefs).not.toContain('/ad-engine');
  });

  test('the Creative Engine page exists; since Clients and Trading joined Revenue it sits past digit 9 and opens from the nav or ⌘K (founderos-ui SPEC 2.1)', () => {
    expect(DIGIT_VIEWS).not.toContain(ENGINE_HREF);
    expect(NAV_ITEMS.some((i) => i.href === ENGINE_HREF)).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'app/creative-engine/page.tsx'))).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'app/ad-engine/page.tsx'))).toBe(false);
  });

  test('⌘K "ad engine" lists Creative Engine first (AC02.6)', () => {
    const hit = filterCommands(viewCommands(), 'ad engine')[0];
    expect(hit?.href).toBe(ENGINE_HREF);
    expect(hit?.label).toBe(ENGINE_NAME);
    expect(filterCommands(viewCommands(), 'creative')[0]?.href).toBe(ENGINE_HREF);
  });

  test('page has no inert header tag and no "Ad engine" copy (C3, AC02.2)', () => {
    const page = read('app/creative-engine/page.tsx');
    expect(page).not.toMatch(/ae-tag/);
    expect(page).not.toMatch(/Paid media/);
    expect(page).toMatch(/data-creative-engine/);
    const dash = read('components/creative-engine/Dashboard.tsx');
    expect(dash).not.toMatch(/['"]Ad engine['"]/);
    // The engine no longer owns a mode switch (glados-ui S00 FR-9): it never writes data-mode.
    expect(dash).not.toMatch(/setAttribute\('data-mode'/);
  });

  test('AdPilot links to the new route by constant (AC02.7)', () => {
    const src = read('app/adpilot/page.tsx');
    expect(src).toMatch(/href=\{ENGINE_HREF\}/);
    expect(src).not.toMatch(/href="\/ad-engine"/);
  });

  test('no user-visible "Ad Engine" left in the key hint or Arcads fallback copy (FR-11)', () => {
    expect(read('lib/keys.ts')).not.toMatch(/Ad Engine/);
    expect(read('lib/creative-engine/generate.ts')).not.toMatch(/GladOS Ad Engine/);
  });
});
