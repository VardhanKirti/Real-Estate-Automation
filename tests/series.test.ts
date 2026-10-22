import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AGGREGATE_SERIES, SERIES_INDEX, channelColor, seriesColor, seriesIndexFor } from '@/lib/series';
import { openDb } from '@/lib/db';
import { audienceSeries, postingSeries, PLATFORM_SERIES } from '@/lib/social';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('one series colour per channel (SPEC C19)', () => {
  test('the channel map is fixed: instagram 1, tiktok 2, youtube 3, linkedin 4, email 5, twitter 6', () => {
    expect(SERIES_INDEX).toEqual({ instagram: 1, tiktok: 2, youtube: 3, linkedin: 4, email: 5, twitter: 6 });
    expect(AGGREGATE_SERIES).toBe(0);
    expect(seriesIndexFor('twitter')).toBe(6);
    expect(seriesIndexFor('facebook')).toBeNull();
    for (const [platform, slot] of Object.entries(PLATFORM_SERIES)) expect(slot).toBe(seriesIndexFor(platform));
  });

  test('indices map to --series-<n> tokens; unknown keys read muted', () => {
    expect(seriesColor(0)).toBe('var(--series-0)');
    expect(seriesColor(6)).toBe('var(--series-6)');
    expect(seriesColor(7)).toBe('var(--series-muted)');
    expect(seriesColor(null)).toBe('var(--series-muted)');
    expect(channelColor('instagram')).toBe('var(--series-1)');
    expect(channelColor('facebook')).toBe('var(--series-muted)');
  });

  test('globals.css defines every slot, GladOS first with a Classic ramp fallback', () => {
    const css = read('app/globals.css');
    expect(css).toContain('var(--g-accent, var(--accent))');
    for (let n = 1; n <= 6; n++) expect(css).toMatch(new RegExp(`--series-${n}: var\\(--g-series-${n}, var\\(--`));
    expect(css).toContain('--series-muted:');
  });

  test('data code emits series indices, never colours', () => {
    const db = openDb(':memory:');
    try {
      db.social.upsertAccount({ platform: 'tiktok', handle: '@x', url: null, order: 1 });
      db.social.insertSnapshot({ platform: 'tiktok', capturedAt: '2026-06-12', followers: 10, source: 'test' });
      const { channels, all } = audienceSeries(db);
      expect(all.series).toBe(AGGREGATE_SERIES);
      expect(channels.find((c) => c.key === 'tiktok')?.series).toBe(2);
      for (const c of [all, ...channels]) expect(c).not.toHaveProperty('color');
    } finally {
      db.close();
    }
    for (const s of postingSeries('2026-06-14', 7)) expect(s.series).toBe(seriesIndexFor(s.key));
  });

  test('no consumer keeps its own per-channel palette or a brand hex', () => {
    for (const file of [
      'lib/social.ts',
      'app/api/social/series/route.ts',
      'components/SocialStatStrip.tsx',
      'components/AudienceConsistency.tsx',
      'components/Home6Console.tsx',
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/PLATFORM_COLORS|EMAIL_COLOR|DM_COLOR|ALL_AUDIENCE_COLOR|CHART_COLORS/);
      expect(src, file).not.toMatch(/#e1306c|#25f4ee|#1d9bf0|#ff4d4d|#0a85c2|#8b7cff|#3df08c|#5ec9f8/i);
    }
  });
});
