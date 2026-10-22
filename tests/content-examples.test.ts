import { describe, expect, it } from 'vitest';
import {
  alreadySentTo,
  fitsBrand,
  manychatTotals,
  readExamples,
  selectForBrand,
  type BrandCapability,
} from '@/lib/content-examples';

// An invented store: tests never read the operator's data/ folder.
const store = readExamples('tests/fixtures/content-examples.json');

// A brand that lives entirely in the browser: no API,
// no MCP, so a tool-build pitch is not deliverable for them.
const webOnly = { name: 'Browserly', capabilities: ['web-app'] as BrandCapability[] };
// A brand with an API worth building against.
const withApi = { name: 'Acme', capabilities: ['api', 'web-app', 'github'] as BrandCapability[] };

describe('the store', () => {
  it('parses — every record is schema-valid', () => {
    expect(store.examples).toHaveLength(3);
    expect(store.manychatRuns).toHaveLength(2);
    expect(store.sends).toHaveLength(1);
  });

  it('never guesses a hook type for a video nobody watched', () => {
    expect(store.examples.every((e) => e.hookType === null)).toBe(true);
  });
});

describe('fitsBrand', () => {
  it('withholds a tool-build from a web-only brand, with the reason', () => {
    const build = store.examples.find((e) => e.id === 'ex-build')!;
    const v = fitsBrand(build, webOnly);
    expect(v.fits).toBe(false);
    expect(v.reason).toContain('no api');
  });

  it('allows the same example for a brand with an API', () => {
    const build = store.examples.find((e) => e.id === 'ex-build')!;
    expect(fitsBrand(build, withApi).fits).toBe(true);
  });

  it('lets requirement-free work through to anyone', () => {
    const ad = store.examples.find((e) => e.id === 'ex-ad')!;
    expect(fitsBrand(ad, webOnly).fits).toBe(true);
  });
});

describe('selectForBrand', () => {
  it('drops the unbuildable formats for a web-only brand', () => {
    const ids = selectForBrand(store, webOnly).map((r) => r.example.id);
    expect(ids).not.toContain('ex-build');
    expect(ids).toContain('ex-ad');
  });

  it('ranks the most specific fit first', () => {
    const picked = selectForBrand(store, withApi);
    expect(picked[0].example.requires.length).toBeGreaterThanOrEqual(
      picked[picked.length - 1].example.requires.length,
    );
  });
});

describe('manychatTotals', () => {
  it('sums the real numbers and weights CTR by volume', () => {
    const t = manychatTotals(store);
    expect(t.flows).toBe(2);
    expect(t.runs).toBe(1100);
    // Weighted, so the small 80% flow cannot inflate the headline.
    expect(t.avgCtrPct).toBeCloseTo(52.7, 1);
  });
});

describe('alreadySentTo', () => {
  it('knows what a brand has already seen, case-insensitively', () => {
    expect(alreadySentTo(store, 'acme').size).toBe(2);
    expect(alreadySentTo(store, 'Browserly').size).toBe(0);
  });
});
