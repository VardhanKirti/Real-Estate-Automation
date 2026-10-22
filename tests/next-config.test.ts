import { describe, expect, test } from 'vitest';
import nextConfig from '../next.config.mjs';

describe('next.config redirects', () => {
  test('the old Ad Engine route 308s to Creative Engine (S02 FR-4)', async () => {
    const rules = await nextConfig.redirects!();
    expect(rules).toContainEqual({ source: '/ad-engine', destination: '/creative-engine', permanent: true });
    expect(rules).toContainEqual({ source: '/ad-engine/:path*', destination: '/creative-engine/:path*', permanent: true });
  });

  test('the removed Reference Model 307s to Blueprint; Personas has no rule (S12 FR-11, AC12.4)', async () => {
    const rules = await nextConfig.redirects!();
    expect(rules).toContainEqual({ source: '/reference', destination: '/blueprint', permanent: false });
    expect(rules.some((r) => r.source.startsWith('/personas'))).toBe(false);
    expect(rules).toHaveLength(4);
  });

  test('FounderOS /content/lead-magnets 308s to /lead-magnets (founderos-ui SPEC O2)', async () => {
    const rules = await nextConfig.redirects!();
    expect(rules).toContainEqual({ source: '/content/lead-magnets', destination: '/lead-magnets', permanent: true });
    expect(rules.some((r) => r.source === '/content')).toBe(false);
  });
});

describe('next.config rewrites', () => {
  test('pre-rename API and asset URLs are served by the creative-engine targets (S02 FR-5, FR-14)', async () => {
    const rules = await nextConfig.rewrites!();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules).toContainEqual({ source: '/api/ad-engine/:path*', destination: '/api/creative-engine/:path*' });
    expect(rules).toContainEqual({ source: '/content-media/ad-engine/:path*', destination: '/content-media/creative-engine/:path*' });
  });
});
