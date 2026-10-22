import { describe, expect, test } from 'vitest';
import { LAB_JOB_IDS, type JobConfig, type LabJobId } from '@/lib/schemas';
import { LAB_ACTORS, capFit, estimatePlan, estimateRun, syncRunSpec, type PlanInputs, type PlanSelection } from '@/lib/lab/setup/estimate';
import { RECORDED_PRICES, currentEntry, priceOf, type PriceEvent } from '@/lib/lab/setup/pricing-book';
import { DEFAULT_JOB_CONFIG } from '@/lib/lab/setup/schedule';
import { GATE_PRIORS, type GateRates } from '@/lib/lab/setup/gates';

const NOW = new Date('2026-10-12T02:00:00.000Z');
const TZ = 'Australia/Sydney';
const prior = (value: number) => ({ value, source: 'prior' as const, n: 0, note: 'assumed' });
const RATES: GateRates = {
  postsPerWeek: prior(GATE_PRIORS.f),
  breakoutRate: prior(GATE_PRIORS.r),
  excluded: prior(GATE_PRIORS.q),
  topFamilyShare: prior(GATE_PRIORS.phi),
  valuePrevalence: prior(GATE_PRIORS.p0),
  read24Share: prior(GATE_PRIORS.u24),
  priorFitted: { instagram: false, tiktok: false, youtube: false, linkedin: false, twitter: false },
};
const schedule = Object.fromEntries(LAB_JOB_IDS.map((id) => [id, DEFAULT_JOB_CONFIG])) as Record<LabJobId, JobConfig>;
const selection = (ig: number, tt: number, yt: number, newThisMonth: PlanSelection['newThisMonth'] = []): PlanSelection => ({
  tracked: [
    { platform: 'instagram', count: ig },
    { platform: 'tiktok', count: tt },
    { platform: 'youtube', count: yt },
  ],
  owned: [],
  depth: { first: 50, cycle: 15 },
  addOns: { tiktokDownloads: false, comments: false },
  schedule,
  newThisMonth,
});
const inputs = (tier: 'FREE' | 'BRONZE', sel: PlanSelection): PlanInputs => ({
  books: { ...RECORDED_PRICES },
  tier: { tier, planId: tier === 'BRONZE' ? 'STARTER' : 'FREE', source: 'account', checkedAt: NOW.toISOString() },
  calibration: {},
  lineCaps: { 'apify.sync': 46, 'apify.snapshots': 22, 'apify.x': 10, 'apify.verify': 1, 'apify.radar_x': 15, 'apify.radar_tiktok': 3, 'apify.radar_producthunt': 1, stt: null, 'stt.controls': 3, comments: null, downloads: null, embed: null, llm: null },
  providerCaps: { apify: 98, stt: 13, comments: 0, downloads: 0, embed: 0, llm: null },
  spentThisMonth: { 'apify.sync': 0, 'apify.snapshots': 0, 'apify.x': 0, 'apify.verify': 0, 'apify.radar_x': 0, 'apify.radar_tiktok': 0, 'apify.radar_producthunt': 0, stt: 0, 'stt.controls': 0, comments: 0, downloads: 0, embed: 0, llm: 0 },
  current: sel,
  rates: RATES,
  now: NOW.toISOString(),
  tz: TZ,
});
const cents = (x: number) => Math.round(x * 100) / 100;

describe('AC-09-1: the 09.2.9 worked example reproduces to the cent', () => {
  test('25 creators on Starter: $1.021 a day, $0.817 low, $30.63 a month, fits the $46 cap', () => {
    const sel = selection(10, 10, 5);
    const plan = estimatePlan(inputs('BRONZE', sel), sel);
    const day = plan.perRun.reduce((a, r) => a + r.usd.point, 0);
    const low = plan.perRun.reduce((a, r) => a + r.usd.low, 0);
    const high = plan.perRun.reduce((a, r) => a + r.usd.high, 0);
    expect(Math.round(day * 1000) / 1000).toBe(1.021);
    expect(Math.round(low * 1000) / 1000).toBe(0.817);
    expect(Math.round(high * 1000) / 1000).toBe(1.021);
    // per run: Instagram $0.345, TikTok $0.451, YouTube $0.225
    expect(plan.perRun.map((r) => Math.round(r.usd.point * 1000) / 1000)).toEqual([0.345, 0.451, 0.225]);
    expect(plan.perJob[0]).toMatchObject({ job: 'sync' });
    expect(cents(plan.month.point)).toBe(30.63);
    expect(cents(plan.month.low)).toBe(24.51);
    expect(plan.perLine[0]).toMatchObject({ line: 'apify.sync', cap: 46, fit: 'fits', stopDay: null });
  });

  test('first reads of the 25 creators (50 posts each, once): $3.40', () => {
    const sel = selection(10, 10, 5, [{ platform: 'instagram', count: 10 }, { platform: 'tiktok', count: 10 }, { platform: 'youtube', count: 5 }]);
    expect(cents(estimatePlan(inputs('BRONZE', sel), sel).backfillOnce)).toBe(3.4);
  });

  test('the same set on the Free plan: $1.261 a day, $37.83 a month, tight', () => {
    const sel = selection(10, 10, 5);
    const plan = estimatePlan(inputs('FREE', sel), sel);
    expect(Math.round(plan.perRun.reduce((a, r) => a + r.usd.point, 0) * 1000) / 1000).toBe(1.261);
    expect(cents(plan.month.point)).toBe(37.83);
    expect(plan.perLine[0].fit).toBe('tight');
  });

  test('50 creators on Starter: $2.041 a day, $61.23 a month, over the $46 cap, stops on day 23', () => {
    const sel = selection(20, 20, 10);
    const plan = estimatePlan(inputs('BRONZE', sel), sel);
    expect(Math.round(plan.perRun.reduce((a, r) => a + r.usd.point, 0) * 1000) / 1000).toBe(2.041);
    expect(cents(plan.month.point)).toBe(61.23);
    expect(plan.perLine[0]).toMatchObject({ fit: 'over', stopDay: 23 });
    expect(capFit(61.23, 46)).toEqual({ fit: 'over', stopDay: 23 });
  });

  test('labels: account tier, assumed tier', () => {
    const sel = selection(1, 0, 0);
    expect(estimatePlan(inputs('BRONZE', sel), sel).label).toBe('Prices recorded on 11 Oct 2026.');
    const live = inputs('BRONZE', sel);
    live.books = Object.fromEntries(Object.entries(RECORDED_PRICES).map(([k, b]) => [k, { ...b, source: 'live' as const, fetchedAt: NOW.toISOString() }]));
    expect(estimatePlan(live, sel).label).toBe('Live prices for your Starter plan');
    live.tier = { tier: 'FREE', planId: null, source: 'assumed', checkedAt: null };
    expect(estimatePlan(live, sel).label).toBe("Free-plan prices. Paste your Apify key to use your plan's prices.");
  });
});

describe('AC-09-2: priceOf and currentEntry', () => {
  test('a tiered event missing the tier falls back to the FREE price', () => {
    const e: PriceEvent = { name: 'post', title: 'Post', flatUsd: null, tiered: { FREE: 0.0017, BRONZE: 0.0015 }, primary: true, oneTime: false };
    expect(priceOf(e, 'BRONZE')).toEqual({ usd: 0.0015, fallback: false });
    expect(priceOf(e, 'SILVER')).toEqual({ usd: 0.0017, fallback: true });
    expect(priceOf({ ...e, flatUsd: 0.0004, tiered: null }, 'GOLD')).toEqual({ usd: 0.0004, fallback: false });
  });
  test('currentEntry picks the latest startedAt at or before now and exposes a future one as next', () => {
    const raw = [{ startedAt: '2026-01-01T00:00:00Z', id: 'a' }, { startedAt: '2026-10-07T00:00:00Z', id: 'b' }, { startedAt: '2026-12-01T00:00:00Z', id: 'c' }, { startedAt: '2027-02-01T00:00:00Z', id: 'd' }];
    const { current, next } = currentEntry(raw, NOW);
    expect((current as { id: string }).id).toBe('b');
    expect((next as { id: string }).id).toBe('c');
    expect(currentEntry(raw.slice(0, 2), NOW).next).toBeNull();
  });
});

describe('AC-09-3: every LAB_ACTORS rule names an event in RECORDED_PRICES', () => {
  test('rule events exist (a renamed event fails here)', () => {
    for (const [actorId, model] of Object.entries(LAB_ACTORS)) {
      const names = new Set(RECORDED_PRICES[actorId]?.events.map((e) => e.name));
      for (const r of model.rules) expect(names.has(r.event), `${actorId} ${r.event}`).toBe(true);
    }
  });
  test('a book missing an event the rules name is model_stale and prices from the recorded book', () => {
    const book = { ...RECORDED_PRICES['apify/instagram-post-scraper'], source: 'live' as const, events: RECORDED_PRICES['apify/instagram-post-scraper'].events.filter((e) => e.name !== 'post-details') };
    const e = estimateRun(syncRunSpec('instagram', 10, 15), book, 'BRONZE', null);
    expect(e.state).toBe('model_stale');
    expect(e.priceSource).toBe('recorded');
    expect(Math.round(e.usd.point * 1000) / 1000).toBe(0.345);
  });
});

describe('AC-09-4: the tweet scraper bills 50 per query at the high bound only', () => {
  test('a query expecting 12 tweets: high bills 50, low does not', () => {
    const spec = { actorId: 'apidojo/tweet-scraper', line: 'apify.x' as const, targets: [{ handle: 'q', limit: 12, known: null }], queries: 1 };
    const e = estimateRun(spec, RECORDED_PRICES['apidojo/tweet-scraper'], 'FREE', null);
    expect(e.usd.high).toBeCloseTo(50 * 0.0004, 8);
    expect(e.usd.low).toBeLessThan(12 * 0.0004 + 1e-9);
    expect(e.items.known).toBe(false);
  });
  test('TikTok minimum: a reserve under $0.50 is needs_headroom', () => {
    const e = estimateRun({ ...syncRunSpec('tiktok', 1, 1), reserveUsd: 0.4 }, RECORDED_PRICES['clockworks/tiktok-scraper'], 'BRONZE', null);
    expect(e.state).toBe('needs_headroom');
  });
});
