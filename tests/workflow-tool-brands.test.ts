import { describe, expect, test } from 'vitest';
import { openDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { hasBrandMark } from '@/lib/brand-logos';
import { TOOL_BRANDS, toolBrand } from '@/lib/workflow-tool-brands';

describe('workflow tool brands', () => {
  test('every registered workflow tool brand resolves to a real brand mark', () => {
    const tools = Object.keys(TOOL_BRANDS);
    expect(tools.length).toBeGreaterThanOrEqual(10);
    for (const t of tools) {
      const b = toolBrand(t);
      expect(hasBrandMark(b.slug, b.name), `brand slug '${b.slug}' (tool '${t}') has no mark`).toBe(true);
    }
  });

  test('display names are human, not raw ids', () => {
    expect(toolBrand('ghl').name).toBe('GoHighLevel');
    expect(toolBrand('calendar').name).toBe('Google Calendar');
    expect(toolBrand('gmail').slug).toBe('gmail');
  });

  test('unknown tools degrade to an identity brand (lettermark fallback downstream)', () => {
    expect(toolBrand('mystery-tool')).toEqual({ slug: 'mystery-tool', name: 'mystery-tool' });
  });
});
