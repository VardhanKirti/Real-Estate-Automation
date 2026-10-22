/**
 * The Run confirm's estimate (09.2.8 B): `GET /api/lab/run?plan=1` prices the actual plan
 * (planScrape), not the selection, and the same estimate is handed to the gate for each started
 * run (lower reserve, frozen run_cost forecast; 09.2.6, 09.3.6). No network call.
 */
import type { LabStore } from '@/lib/lab/store';
import type { ProfileGroup, ScrapeGroup, SyncPlan } from '@/lib/lab/sync';
import type { GateEstimate } from '@/lib/lab/spend';
import { headroom, runMaxUsd } from '@/lib/lab/spend';
import { capFit, estimateRun, priceLabel, type PlanEstimate, type RunEstimate, type RunSpec } from '@/lib/lab/setup/estimate';
import { RECORDED_PRICES } from '@/lib/lab/setup/pricing-book';
import { planInputs } from '@/lib/lab/setup/planner';

const floorCents = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
const groupKey = (g: ScrapeGroup | ProfileGroup) => `${g.kind}|${g.platform}|${g.actorId}|${g.sources.map((s) => s.id).join(',')}`;

/** The run spec of one planned group. */
export function groupSpec(g: ScrapeGroup | ProfileGroup, reserveUsd?: number): RunSpec {
  const limit = g.kind === 'scrape' ? g.limit : 1;
  return {
    actorId: g.actorId,
    line: 'apify.sync',
    targets: g.sources.map((s) => ({ handle: s.handle, limit, known: g.kind === 'profile' ? 1 : null })),
    ...(g.platform === 'twitter' ? { queries: g.sources.length } : {}),
    ...(g.platform === 'tiktok' ? { downloadVideos: Boolean((g.actorInput as { shouldDownloadVideos?: unknown }).shouldDownloadVideos) } : {}),
    ...(reserveUsd !== undefined ? { reserveUsd } : {}),
  };
}

export type RunPlanEstimate = { estimate: PlanEstimate; perGroup: Map<string, RunEstimate>; estimateFor: (g: ScrapeGroup | ProfileGroup) => GateEstimate | null };

/** Price a planned scrape; `recorded` (dry, Filming, sample) prices from RECORDED_PRICES. */
export function estimateSyncPlan(store: LabStore, plan: SyncPlan, now: Date, opts: { recorded?: boolean } = {}): RunPlanEstimate {
  const inputs = planInputs(store, now, { recorded: opts.recorded });
  const h = headroom(store, 'apify.sync', now);
  const reserve = floorCents(Math.min(runMaxUsd(), h.line ?? Infinity, h.provider ?? Infinity));
  const perGroup = new Map<string, RunEstimate>();
  for (const g of [...plan.scrapes, ...plan.profiles]) {
    const book = inputs.books[g.actorId] ?? RECORDED_PRICES[g.actorId];
    if (!book) continue;
    const e = estimateRun(groupSpec(g, reserve), book, inputs.tier.tier, inputs.calibration[g.actorId] ?? null);
    perGroup.set(groupKey(g), { ...e, tierSource: inputs.tier.source });
  }
  const perRun = [...perGroup.values()];
  const sum = (k: 'low' | 'point' | 'high') => Math.round(perRun.reduce((a, r) => a + r.usd[k], 0) * 10_000) / 10_000;
  const month = { low: sum('low'), point: sum('point'), high: sum('high') };
  const spent = inputs.spentThisMonth['apify.sync'] ?? 0;
  const cap = inputs.lineCaps['apify.sync'] ?? null;
  const fit = capFit(spent + month.point, cap);
  const estimate: PlanEstimate = {
    perRun,
    perJob: [{ job: 'sync', runsPerMonth: 1, usd: month }],
    perLine: [{ line: 'apify.sync', usd: { low: spent + month.low, point: spent + month.point, high: spent + month.high }, cap, fit: fit.fit, stopDay: fit.stopDay }],
    month,
    backfillOnce: 0,
    label: priceLabel(inputs, { sample: opts.recorded }),
  };
  return {
    estimate,
    perGroup,
    estimateFor: (g) => {
      const e = perGroup.get(groupKey(g));
      if (!e) return null;
      const book = inputs.books[g.actorId] ?? RECORDED_PRICES[g.actorId];
      return { point: e.usd.point, high: e.usd.high, low: e.usd.low, minMaxTotalChargeUsd: book?.minMaxTotalChargeUsd ?? null, expectedItems: e.items.expected, known: e.items.known, inputs: { tier: e.tier, priceSource: e.priceSource, platform: g.platform } };
    },
  };
}

export const planGroupKey = groupKey;
