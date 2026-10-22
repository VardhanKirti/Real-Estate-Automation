import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ForeplayClient, ForeplayError, type FetchLike, type ForeplayAd } from '@/lib/foreplay/client';
import { adStore } from '@/lib/foreplay/store';
import {
  daysRunning,
  diffBrandAds,
  digest,
  driverFingerprint,
  hookLine,
  velocitySignal,
  winners,
} from '@/lib/foreplay/signals';
import { runSyncCycle } from '@/lib/foreplay/sync';
import { addWatchDomain, addWatchEntry, readWatchEntries, removeWatchEntry, writeWatchEntries } from '@/lib/foreplay/watchlist';
import { bestHook, mineConcept, naiveProbes } from '@/lib/foreplay/mine';
import { buildBrandDossier, renderDossier } from '@/lib/foreplay/dossier';

/* ------------------------------ test fixtures ------------------------------ */

const DAY = 86_400;

function ad(over: Partial<ForeplayAd> & { id: string }): ForeplayAd {
  const defaults = {
    name: 'Test Brand',
    brand_id: 'b1',
    live: true,
    running_duration: { seconds: 5 * DAY },
    timestamped_transcription: [{ startTime: 0, endTime: 3, sentence: 'This tool replaced my entire editing team' }],
    display_format: 'video',
  };
  return { ...defaults, ...over } as ForeplayAd;
}

function envelope(data: unknown) {
  return { metadata: { success: true, status_code: 200 }, data, error: null };
}

/** Route-matching fake fetch: no network, records calls. */
function fakeFetch(routes: Record<string, unknown>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + (u.search ? `?${u.searchParams.toString()}` : ''));
    const hit = Object.entries(routes).find(([route]) => u.pathname === route);
    if (!hit) return { ok: false, status: 404, json: async () => ({ message: 'no route' }) };
    const body = typeof hit[1] === 'function' ? (hit[1] as (u: URL) => unknown)(u) : hit[1];
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch: impl, calls };
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adscout-'));
  process.env.ADSCOUT_STORE_DIR = tmpDir;
});
afterEach(() => {
  delete process.env.ADSCOUT_STORE_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* --------------------------------- client --------------------------------- */

describe('ForeplayClient', () => {
  it('parses the envelope and counts calls', async () => {
    const { fetch } = fakeFetch({
      '/api/usage': envelope({ total_credits: 10000, remaining_credits: 9677 }),
    });
    const client = new ForeplayClient('k', fetch);
    const usage = await client.usage();
    expect(usage.remaining_credits).toBe(9677);
    expect(client.callCount).toBe(1);
  });

  it('throws a typed error on HTTP failure', async () => {
    const impl: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({ message: 'bad key' }) });
    const client = new ForeplayClient('k', impl);
    await expect(client.usage()).rejects.toThrow(ForeplayError);
    await expect(client.usage()).rejects.toThrow(/bad key/);
  });

  it('pages spyder brands in 10s and stops on a short page', async () => {
    const { fetch, calls } = fakeFetch({
      '/api/spyder/brands': (u: URL) =>
        envelope(
          u.searchParams.get('offset') === '0'
            ? Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, name: `Brand ${i}` }))
            : [{ id: 'b10', name: 'Brand 10' }],
        ),
    });
    const client = new ForeplayClient('k', fetch);
    const brands = await client.spyderBrands();
    expect(brands).toHaveLength(11);
    expect(calls).toHaveLength(2);
  });

  it('tolerates unknown extra fields on ads (spec drift)', async () => {
    const { fetch } = fakeFetch({
      '/api/spyder/brand/ads': envelope([{ ...ad({ id: 'a1' }), some_new_field: { deep: true } }]),
    });
    const client = new ForeplayClient('k', fetch);
    const ads = await client.spyderBrandAds('b1');
    expect(ads[0].id).toBe('a1');
    expect((ads[0] as Record<string, unknown>).some_new_field).toEqual({ deep: true });
  });
});

/* --------------------------------- signals --------------------------------- */

describe('signals', () => {
  const at = '2026-09-14T07:00:00.000Z';

  it('flags a young live ad on first sight as a launch, not the back catalog', () => {
    const signals = diffBrandAds({
      brandId: 'b1',
      brandName: 'Genspark',
      prev: [],
      next: [
        ad({ id: 'new', running_duration: { seconds: 2 * DAY } }),
        ad({ id: 'old', running_duration: { seconds: 200 * DAY } }),
      ],
      at,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ type: 'new_launch', adId: 'new' });
    expect(signals[0].message).toContain('Genspark');
  });

  it('flags winner threshold crossings only when live and only once per threshold', () => {
    const prev = [ad({ id: 'a', running_duration: { seconds: 28 * DAY } })];
    const next = [ad({ id: 'a', running_duration: { seconds: 31 * DAY } })];
    const signals = diffBrandAds({ brandId: 'b1', brandName: 'X', prev, next, at });
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('winner');
    expect(signals[0].message).toContain('30 days');

    const dead = diffBrandAds({
      brandId: 'b1',
      brandName: 'X',
      prev,
      next: [ad({ id: 'a', live: false, running_duration: { seconds: 31 * DAY } })],
      at,
    });
    expect(dead.every((s) => s.type !== 'winner')).toBe(true);
  });

  it('flags a live→off transition as killed', () => {
    const signals = diffBrandAds({
      brandId: 'b1',
      brandName: 'X',
      prev: [ad({ id: 'a' })],
      next: [ad({ id: 'a', live: false })],
      at,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('killed');
  });

  it('computes velocity spikes against the trailing mean and skips tiny bases', () => {
    const series = (counts: number[]) =>
      counts.map((active_count, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, active_count }));
    const spike = velocitySignal({ brandId: 'b1', brandName: 'X', series: series([10, 10, 10, 10, 10, 10, 10, 15]), at });
    expect(spike?.type).toBe('velocity_spike');
    const drop = velocitySignal({ brandId: 'b1', brandName: 'X', series: series([10, 10, 10, 10, 10, 10, 10, 5]), at });
    expect(drop?.type).toBe('velocity_drop');
    expect(velocitySignal({ brandId: 'b1', brandName: 'X', series: series([1, 1, 1, 1, 1, 1, 1, 2]), at })).toBeNull();
    expect(velocitySignal({ brandId: 'b1', brandName: 'X', series: series([10, 15]), at })).toBeNull();
  });

  it('extracts hook lines and rejects junk transcripts', () => {
    expect(hookLine(ad({ id: 'a' }))).toBe('This tool replaced my entire editing team');
    expect(
      hookLine(ad({ id: 'b', timestamped_transcription: [{ startTime: 0, endTime: 1, sentence: ' Thanks for watching!' }] })),
    ).toBeNull();
    expect(hookLine(ad({ id: 'c', timestamped_transcription: [], full_transcription: null }))).toBeNull();
  });

  it('ranks winners by longevity, live only', () => {
    const list = winners(
      [
        ad({ id: 'a', running_duration: { seconds: 40 * DAY } }),
        ad({ id: 'b', running_duration: { seconds: 90 * DAY }, live: false }),
        ad({ id: 'c', running_duration: { seconds: 70 * DAY } }),
        ad({ id: 'd', running_duration: { seconds: 3 * DAY } }),
      ],
      21,
    );
    expect(list.map((a) => a.id)).toEqual(['c', 'a']);
    expect(daysRunning(list[0])).toBe(70);
  });

  it('averages emotional drivers across ads', () => {
    const fp = driverFingerprint([
      ad({ id: 'a', emotional_drivers: { urgency: 8, curiosity: 6 } }),
      ad({ id: 'b', emotional_drivers: { urgency: 4 } }),
    ]);
    expect(fp.urgency).toBe(6);
    expect(fp.curiosity).toBe(6);
  });

  it('digest reads as sentences, not codes', () => {
    expect(digest([])).toBe('No changes across the watchlist.');
  });
});

/* ---------------------------------- store ---------------------------------- */

describe('adStore', () => {
  it('round-trips snapshots and merges analytics by date', () => {
    adStore.writeBrandAds('b/1', [ad({ id: 'a' })]); // slash must not escape the dir
    expect(adStore.readBrandAds('b/1')).toHaveLength(1);
    adStore.writeAnalytics('b1', [{ date: '2026-09-01', active_count: 5 }]);
    adStore.writeAnalytics('b1', [
      { date: '2026-09-01', active_count: 6 },
      { date: '2026-09-02', active_count: 7 },
    ]);
    const series = adStore.readAnalytics('b1');
    expect(series).toHaveLength(2);
    expect(series[0].active_count).toBe(6);
  });

  it('caps the rolling signal log', () => {
    const mk = (i: number) => ({ type: 'killed' as const, brandId: 'b', brandName: 'B', message: `${i}`, at: 'now' });
    adStore.appendSignals(Array.from({ length: 30 }, (_, i) => mk(i)), 25);
    expect(adStore.readSignals()).toHaveLength(25);
  });
});

/* ----------------------------------- sync ---------------------------------- */

describe('runSyncCycle (local watchlist)', () => {
  const seedWatch = () =>
    writeWatchEntries([{ id: 'b1', name: 'Genspark', addedAt: '2026-09-14T00:00:00.000Z' }]);

  it('runs a full cycle: watchlist -> live ads (both ends) + analytics -> signals -> usage', async () => {
    seedWatch();
    const { fetch, calls } = fakeFetch({
      '/api/brand/getAdsByBrandId': envelope([ad({ id: 'fresh', running_duration: { seconds: 1 * DAY } })]),
      '/api/brand/analytics': envelope([
        { date: '2026-09-10', active_count: 10 },
        { date: '2026-09-11', active_count: 10 },
        { date: '2026-09-12', active_count: 10 },
        { date: '2026-09-13', active_count: 10 },
        { date: '2026-09-14', active_count: 20 },
      ]),
      '/api/usage': envelope({ total_credits: 10000, remaining_credits: 9600 }),
    });
    const result = await runSyncCycle(new ForeplayClient('k', fetch), new Date('2026-09-14T07:00:00Z'));

    expect(result.brands).toBe(1);
    expect(result.signals.map((s) => s.type).sort()).toEqual(['new_launch', 'velocity_spike']);
    expect(result.remainingCredits).toBe(9600);
    // two ad pulls (newest + oldest) + analytics + usage
    expect(calls.filter((c) => c.includes('getAdsByBrandId'))).toHaveLength(2);
    expect(adStore.readMeta().lastSyncAt).toBe('2026-09-14T07:00:00.000Z');
  });

  it('infers killed for a previously-live ad absent from an untruncated live pull', async () => {
    seedWatch();
    adStore.writeBrandAds('b1', [ad({ id: 'gone', running_duration: { seconds: 40 * DAY } })]);
    const { fetch } = fakeFetch({
      '/api/brand/getAdsByBrandId': envelope([ad({ id: 'other', running_duration: { seconds: 50 * DAY } })]),
      '/api/brand/analytics': envelope([]),
      '/api/usage': envelope({ total_credits: 10000, remaining_credits: 9599 }),
    });
    const result = await runSyncCycle(new ForeplayClient('k', fetch));
    expect(result.signals.some((s) => s.type === 'killed' && s.adId === 'gone')).toBe(true);
    const stored = adStore.readBrandAds('b1');
    expect(stored.find((a) => a.id === 'gone')?.live).toBe(false);
    expect(stored.find((a) => a.id === 'other')?.live).toBe(true);
  });

  it('a failed usage read never fails the cycle', async () => {
    writeWatchEntries([]);
    const { fetch } = fakeFetch({});
    const result = await runSyncCycle(new ForeplayClient('k', fetch));
    expect(result.brands).toBe(0);
    expect(result.remainingCredits).toBeNull();
  });
});

describe('watchlist', () => {
  it('adds by id once, removes, and round-trips through the store', () => {
    writeWatchEntries([]);
    addWatchEntry({ id: 'b9', name: 'Skool' });
    addWatchEntry({ id: 'b9', name: 'Skool' });
    expect(readWatchEntries()).toHaveLength(1);
    removeWatchEntry('b9');
    expect(readWatchEntries()).toHaveLength(0);
  });

  it('adds by domain via one resolve call, picking the biggest profile', async () => {
    writeWatchEntries([]);
    const { fetch } = fakeFetch({
      '/api/brand/getBrandsByDomain': envelope([
        { id: 'small', name: 'Side Page', ads_count: 3 },
        { id: 'big', name: 'Main Page', ads_count: 300 },
      ]),
    });
    const entry = await addWatchDomain(new ForeplayClient('k', fetch), 'https://example.com/path');
    expect(entry?.id).toBe('big');
    expect(entry?.domain).toBe('example.com');
    expect(readWatchEntries()).toHaveLength(1);
  });
});

describe('mine', () => {
  it('pools probes, dedupes, filters by the API-side longevity filter, ranks by days', async () => {
    const { fetch, calls } = fakeFetch({
      '/api/discovery/ads': (u: URL) =>
        envelope(
          u.searchParams.get('query') === 'probe one'
            ? [ad({ id: 'x', running_duration: { seconds: 60 * DAY } }), ad({ id: 'y', running_duration: { seconds: 25 * DAY } })]
            : [ad({ id: 'x', running_duration: { seconds: 60 * DAY } })],
        ),
    });
    const result = await mineConcept(new ForeplayClient('k', fetch), 'concept', ['probe one', 'probe two']);
    expect(result.pooled).toBe(2);
    expect(result.winners[0].ad.id).toBe('x');
    expect(result.winners[0].probes).toEqual(['probe one', 'probe two']);
    expect(calls.every((c) => c.includes('running_duration_min_days=21'))).toBe(true);
  });

  it('naiveProbes fall back deterministically and bestHook prefers spoken over text', () => {
    expect(naiveProbes('founders replacing staff with AI agents').length).toBeGreaterThanOrEqual(2);
    const spoken = bestHook(ad({ id: 'a' }));
    expect(spoken.source).toBe('spoken');
    const text = bestHook(
      ad({ id: 'b', timestamped_transcription: [], full_transcription: null, description: 'If you run a B2B service business…<br />rest' }),
    );
    expect(text.source).toBe('text');
    expect(text.hook).toContain('B2B service');
  });
});

/* --------------------------------- dossier --------------------------------- */

describe('brand dossier', () => {
  it('builds and renders the sponsor view: pages, velocity, winners, whitelist signal', async () => {
    const { fetch } = fakeFetch({
      '/api/brand/getBrandsByDomain': envelope([
        { id: 'p1', name: 'Genspark', ads_count: 50, active_ads_count: 12 },
        { id: 'p2', name: 'Some Creator', ads_count: 8, active_ads_count: 3 },
      ]),
      '/api/brand/getAdsByBrandId': envelope([
        ad({ id: 'hero', brand_id: 'p1', running_duration: { seconds: 60 * DAY }, emotional_drivers: { urgency: 8 } }),
        ad({ id: 'ugc', brand_id: 'p2', running_duration: { seconds: 12 * DAY } }),
      ]),
      '/api/brand/analytics': envelope([
        { date: '2026-09-13', active_count: 10 },
        { date: '2026-09-14', active_count: 12 },
      ]),
    });
    const dossier = await buildBrandDossier(new ForeplayClient('k', fetch), 'genspark.ai');
    expect(dossier).not.toBeNull();
    expect(dossier!.multiPage).toBe(true);
    expect(dossier!.topAds[0].id).toBe('hero');
    expect(dossier!.topAds[0].daysRunning).toBe(60);

    const text = renderDossier(dossier!);
    expect(text).toContain('genspark.ai');
    expect(text).toContain('usage rights');
    expect(text).toContain('60d LIVE');
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it('returns null when the domain has no brand profiles', async () => {
    const { fetch } = fakeFetch({ '/api/brand/getBrandsByDomain': envelope([]) });
    expect(await buildBrandDossier(new ForeplayClient('k', fetch), 'nobody.example')).toBeNull();
  });
});

/* --------------------------- saved + personalization ----------------------- */

import { readSavedAds, saveAd, unsaveAd } from '@/lib/foreplay/saved';
import { forYou, meanDrivers, NICHE_KEYWORDS } from '@/lib/foreplay/personal';
import { toWallAd } from '@/lib/foreplay/wall';

describe('saved ads', () => {
  it('saves once, reads back, and unsaves', () => {
    const wall = toWallAd(ad({ id: 's1' }), 'Skool');
    saveAd(wall);
    saveAd(wall);
    expect(readSavedAds()).toHaveLength(1);
    expect(readSavedAds()[0].ad.brand).toBe('Skool');
    unsaveAd('s1');
    expect(readSavedAds()).toHaveLength(0);
  });
});

describe('for-you scoring', () => {
  const wallAd = (id: string, hook: string, days: number, drivers: Record<string, number> = {}) =>
    toWallAd(
      ad({
        id,
        timestamped_transcription: [{ startTime: 0, endTime: 2, sentence: hook }],
        running_duration: { seconds: days * DAY },
        emotional_drivers: drivers,
      }),
      'Brand',
    );

  it('ranks niche + longevity above off-topic short-lived ads', () => {
    const niche = wallAd('a', 'I replaced my whole business with AI agents', 80);
    const offTopic = wallAd('b', 'The best hiking boots of the winter season', 10);
    const ranked = forYou([offTopic, niche], []);
    expect(ranked[0].ad.id).toBe('a');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('saves teach the feed: driver similarity pulls matching ads up', () => {
    const saved = [wallAd('s', 'anything', 30, { urgency: 9, curiosity: 8 })];
    const similar = wallAd('x', 'plain hook words', 30, { urgency: 8, curiosity: 7 });
    const different = wallAd('y', 'plain hook words', 30, { nostalgia: 9, security: 8 });
    const ranked = forYou([different, similar], saved.map((s) => s));
    expect(ranked[0].ad.id).toBe('x');
  });

  it('excludes already-saved ads and computes mean drivers', () => {
    const s = wallAd('s', 'ai agents', 30, { urgency: 8 });
    expect(forYou([s], [s])).toHaveLength(0);
    expect(meanDrivers([s]).urgency).toBe(8);
    expect(NICHE_KEYWORDS).toContain('agents');
  });
});

describe('mine filters', () => {
  it('passes minDays and format through to discovery', async () => {
    const { fetch, calls } = fakeFetch({ '/api/discovery/ads': envelope([]) });
    await mineConcept(new ForeplayClient('k', fetch), 'c', ['p'], { minDays: 60, format: 'video' });
    expect(calls[0]).toContain('running_duration_min_days=60');
    expect(calls[0]).toContain('display_format=video');
  });
});
