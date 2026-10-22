import { describe, expect, test } from 'vitest';
import { LAB_JOB_IDS, type JobConfig, type LabJobId } from '@/lib/schemas';
import { GATE_PRIORS, muQ, nInterval, predictGates, wilson90, poissonQuantile, type GateCounts, type GateEta, type GateRates } from '@/lib/lab/setup/gates';
import { DEFAULT_JOB_CONFIG } from '@/lib/lab/setup/schedule';
import type { PlanSelection } from '@/lib/lab/setup/estimate';

const NOW = new Date('2026-10-12T02:00:00.000Z');
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
const sel = (ig: number, tt: number, yt: number): PlanSelection => ({
  tracked: [{ platform: 'instagram', count: ig }, { platform: 'tiktok', count: tt }, { platform: 'youtube', count: yt }],
  owned: [],
  depth: { first: 50, cycle: 15 },
  addOns: { tiktokDownloads: false, comments: false },
  schedule,
  newThisMonth: [],
});
const EMPTY: GateCounts = { casesTopFamily: 0, casesWithTopValue: 0, pairs24h: { instagram: 0, tiktok: 0, youtube: 0, linkedin: 0, twitter: 0 }, matchedPerCreator: {}, activeTracked: 0 };
const find = (gates: GateEta[], gate: string, platform = 'all') => gates.find((g) => g.gate === gate && g.platform === platform)!;
const weeks = (d: number) => Math.round((d / 7) * 10) / 10;

describe('AC-09-10: Poisson quantiles and Wilson', () => {
  test('mu_q(8) is 4.66, 7.67, 11.77 at q 0.1, 0.5, 0.9', () => {
    expect(muQ(0.1, 8)).toBeCloseTo(4.66, 2);
    expect(muQ(0.5, 8)).toBeCloseTo(7.67, 2);
    expect(muQ(0.9, 8)).toBeCloseTo(11.77, 2);
  });
  test('Wilson at k 5, n 100 is 0.0245 to 0.0992; the 09.3.3 ranges at p 0.05', () => {
    const [lo, hi] = wilson90(5, 100)!;
    expect(lo).toBeCloseTo(0.0245, 4);
    expect(hi).toBeCloseTo(0.0992, 4);
    const [lo40, hi40] = wilson90(2, 40)!;
    expect(Math.round(lo40 * 1000) / 10).toBe(1.7);
    expect(Math.round(hi40 * 1000) / 10).toBe(14);
  });
});

describe('AC-09-9: the 09.3.5 table reproduces', () => {
  test('25 creators (8, 8, 9): every row', () => {
    const g = predictGates(RATES, sel(8, 8, 9), EMPTY, NOW, null);
    const b = find(g, 'breakouts_week');
    expect(b.rate).toBe(5);
    expect(b.rateRange).toEqual([2, 9]);
    expect(poissonQuantile(0.05, 5)).toBe(2);
    const base = find(g, 'baseline_24h', 'instagram');
    // about 12 days (7 to 20)
    expect([base.days!.lo, base.days!.med, base.days!.hi].map(Math.round)).toEqual([7, 12, 20]);
    expect(base.blockedReason).toBeNull();
    const fit = find(g, 'forecast_fit_24h', 'instagram');
    expect(fit.days!.med).toBeCloseTo(13.2, 1);
    expect(Math.round(fit.days!.lo)).toBe(12);
    expect(Math.round(fit.days!.hi)).toBe(15);
    const strong = find(g, 'profile_strong');
    expect(weeks(strong.days!.med)).toBe(12);
    expect(Math.round(weeks(strong.days!.lo))).toBe(9);
    expect(Math.round(weeks(strong.days!.hi))).toBe(17);
    expect(strong.interval!.widthFactor).toBe(3.69);
    const moderate = find(g, 'profile_moderate');
    expect(Math.round(weeks(moderate.days!.med))).toBe(23);
    expect(Math.round(weeks(moderate.days!.lo))).toBe(19);
    expect(Math.round(weeks(moderate.days!.hi))).toBe(28);
    expect(moderate.interval!.widthFactor).toBe(2.5);
    expect(find(g, 'radar_crowd').state).toBe('met');
  });
  test('50 creators (17, 17, 16)', () => {
    const g = predictGates(RATES, sel(17, 17, 16), EMPTY, NOW, null);
    expect(find(g, 'breakouts_week').rate).toBe(10);
    expect(find(g, 'breakouts_week').rateRange).toEqual([5, 15]);
    expect(find(g, 'forecast_fit_24h', 'instagram').days!.med).toBeCloseTo(10.2, 1);
    expect(Math.round(weeks(find(g, 'profile_strong').days!.med))).toBe(7);
    expect(Math.round(weeks(find(g, 'profile_moderate').days!.med))).toBe(13);
    expect(find(g, 'profile_strong').interval!.widthFactor).toBe(3.69);
  });
  test('n_int is 16 strong and 36 moderate at p0 0.18', () => {
    expect(nInterval(4, 0.18)).toBe(16);
    expect(nInterval(2.5, 0.18)).toBe(36);
  });
});

describe('AC-09-11: a fitted prior needs 8 creators on the platform', () => {
  test('7 Instagram creators: n_need 10 and the prior is named; 8: n_need 5', () => {
    const seven = find(predictGates(RATES, sel(7, 8, 8), EMPTY, NOW, null), 'baseline_24h', 'instagram');
    expect(seven.blockedReason).toBe('Needs 8 creators on Instagram for a fitted prior');
    expect(seven.days!.med).toBeCloseTo(1 + muQ(0.5, 10) / (3 / 7), 1);
    const eight = find(predictGates(RATES, sel(8, 8, 8), EMPTY, NOW, null), 'baseline_24h', 'instagram');
    expect(eight.blockedReason).toBeNull();
    expect(eight.days!.med).toBeCloseTo(1 + muQ(0.5, 5) / (3 / 7), 1);
  });
});

describe('AC-09-12: counts already in the store are subtracted', () => {
  test('8 cases with the top value and n_now >= n_int: profile_strong is met', () => {
    const g = predictGates(RATES, sel(8, 8, 9), { ...EMPTY, casesTopFamily: 16, casesWithTopValue: 8 }, NOW, null);
    expect(find(g, 'profile_strong').state).toBe('met');
    expect(find(g, 'profile_moderate').state).toBe('predicted');
    expect(find(g, 'profile_family').state).toBe('met');
  });
  test('the Lab record scales predicted days', () => {
    const a = find(predictGates(RATES, sel(8, 8, 9), EMPTY, NOW, null), 'profile_family').days!.med;
    const b = find(predictGates(RATES, sel(8, 8, 9), EMPTY, NOW, 1.5), 'profile_family').days!.med;
    expect(b).toBeCloseTo(a * 1.5, 0);
  });
  test('under 5 creators the radar row names the count', () => {
    expect(find(predictGates(RATES, sel(2, 1, 0), EMPTY, NOW, null), 'radar_crowd')).toMatchObject({ state: 'blocked', blockedReason: 'Needs 5 creators who post (you have 3)' });
  });
});
