import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SAMPLE_PRODUCT, sampleCampaign, sampleCatalog, sampleHealth, sampleRuns, sampleSaved, sampleSignals, sampleWatchlist } from '@/lib/creative-engine/demo';
import { DRY_POOL } from '@/lib/creative-engine/fixtures';
// Same list as tests/no-personal-data.test.ts (importing that file would re-run its suite).
const FICTIONAL_NAMES = new Set(['Lumen Desk', 'Northwind Tools', 'Kestrel Systems', 'Orbit Labs', 'Pinion', 'Halyard']);

/** S03 FR-8/FR-9, S04 B25, SPEC §5 C9: one fictional sample world. */

const blob = JSON.stringify({ c: sampleCampaign(), r: sampleRuns(), h: sampleHealth(), s: sampleSaved(), w: sampleWatchlist(), g: sampleSignals(), k: sampleCatalog() });

describe('sample world', () => {
  test('counts stay fixed so every widget populates', () => {
    const c = sampleCampaign();
    expect(c.angles).toHaveLength(4);
    expect(c.angles.filter((a) => a.selected)).toHaveLength(2);
    expect(c.scripts).toHaveLength(2);
    expect(c.briefs).toHaveLength(1);
    expect(sampleRuns().filter((r) => r.status === 'running')).toHaveLength(1);
  });
  test('the lamp concept, the fictional product, no brand or loaded claim', () => {
    const c = sampleCampaign();
    expect(c.concept.product).toBe(SAMPLE_PRODUCT);
    expect(c.concept.text).toMatch(/desk lamp/);
    expect(blob).not.toMatch(/GladOS|FounderOS|GLADOS|FOUNDEROS/);
    expect(blob).not.toMatch(/replac(ing|e|ed) (staff|my|three|the role)/i);
    expect(blob).not.toMatch(/—/);
  });
  test('every brand in the sample is a documented fictional name', () => {
    const brands = new Set<string>([...sampleCampaign().research!.pool.map((a) => a.brand), ...sampleSaved().map((s) => s.ad.brand), ...sampleWatchlist().map((w) => w.name), ...sampleSignals().map((s) => s.brandName), ...DRY_POOL.map((a) => a.brand)]);
    for (const b of brands) expect(FICTIONAL_NAMES.has(b)).toBe(true);
  });
  test('no real watched brand appears (read from data/ at runtime when present)', () => {
    const file = path.join(process.cwd(), 'data', 'ad-intel', 'watchlist.json');
    if (!fs.existsSync(file)) return;
    const real = (JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string }[]).map((w) => w.name).filter((n): n is string => !!n && n.length > 3 && !FICTIONAL_NAMES.has(n));
    for (const n of real) expect(blob.includes(n)).toBe(false);
  });
  test('the dry fixtures no longer carry the staff-replacement theme', () => {
    expect(JSON.stringify(DRY_POOL)).not.toMatch(/replace staff|ops team|ops manager/i);
  });
});

describe('sample visibility (FR-8)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'components/creative-engine/Dashboard.tsx'), 'utf8');
  test('Try the sample shows only on a blank store', () => {
    expect(src).toMatch(/campaigns\.length === 0 \? <Btn href=\{`\$\{ENGINE_HREF\}\?sample=1`\}/);
  });
});
