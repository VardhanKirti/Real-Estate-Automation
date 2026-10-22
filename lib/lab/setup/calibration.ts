/**
 * Self-calibration of cost estimates (09.2.5). Every gated live Apify run freezes a run_cost
 * forecast at reserve time (lib/lab/spend.ts) and is graded here when it settles. Two separate
 * errors, because they have different causes:
 *   volume  items / E: how many items came back against how many were expected;
 *   price   usageTotalUsd / sum(chargedEventCounts[e] x p(e)): whether Apify billed what the
 *           price book says for the counted events (should be 1.00).
 * The factors are shrunk toward 1 (estimate.ts `shrink`) and apply from n 5.
 */
import type { LabStore } from '@/lib/lab/store';
import { ApifyTierSchema } from '@/lib/schemas';
import { CALIBRATION_MIN_N } from '@/lib/lab/setup/estimate';
import { loadPriceBook, priceOf, resolveTier } from '@/lib/lab/setup/pricing';
import { runCostForecast } from '@/lib/lab/setup/forecast-rows';

export type ActorCalibration = {
  actorId: string;
  /** settled live runs with an estimate, last 20 */
  n: number;
  /** items / E, null under n 5 */
  volume: { med: number; p10: number; p90: number } | null;
  /** actual usageTotalUsd / sum(chargedEventCounts[e] x p(e)), null under n 5 */
  price: { med: number; p10: number; p90: number } | null;
  /** median |actual - point| / actual */
  medAbsPctErr: number | null;
  /** runs with low <= actual <= high */
  inRange: { k: number; m: number } | null;
};

/** Linear-interpolated quantile of a sorted copy. */
export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const band = (xs: number[]) => (xs.length ? { med: r4(quantile(xs, 0.5)!), p10: r4(quantile(xs, 0.1)!), p90: r4(quantile(xs, 0.9)!) } : null);

/** The last 20 settled live runs of one actor that carried an estimate. */
export function calibrationFor(store: LabStore, actorId: string, now: Date = new Date()): ActorCalibration {
  const rows = store.forecasts
    .all('run_cost')
    .filter((f) => f.status === 'graded' && !f.dry && f.actual !== null && (f.inputs as { actorId?: unknown }).actorId === actorId)
    .sort((a, b) => b.frozenAt.localeCompare(a.frozenAt))
    .slice(0, 20);
  const n = rows.length;
  const volumes: number[] = [];
  const prices: number[] = [];
  const errs: number[] = [];
  let k = 0;
  const book = loadPriceBook(store, actorId, now);
  for (const f of rows) {
    const actual = f.actual!;
    if (f.expectedItems && f.expectedItems > 0 && f.actualItems !== null) volumes.push(f.actualItems / f.expectedItems);
    if (actual > 0) errs.push(Math.abs(actual - f.predicted) / actual);
    if ((f.lo === null || actual >= f.lo - 1e-9) && (f.hi === null || actual <= f.hi + 1e-9)) k++;
    const tierRaw = ApifyTierSchema.safeParse((f.inputs as { tier?: unknown }).tier);
    const tier = tierRaw.success ? tierRaw.data : resolveTier(store).tier;
    const events = store.spend.forRun(f.subject).find((s) => s.events)?.events ?? null;
    if (events) {
      const billed = Object.entries(events).reduce((a, [name, count]) => {
        const e = book.events.find((x) => x.name === name);
        return a + (e ? priceOf(e, tier).usd * count : 0);
      }, 0);
      if (billed > 0) prices.push(actual / billed);
    }
  }
  const enough = n >= CALIBRATION_MIN_N;
  return {
    actorId,
    n,
    volume: enough ? band(volumes) : null,
    price: enough ? band(prices) : null,
    medAbsPctErr: enough && errs.length ? r4(quantile(errs, 0.5)!) : null,
    inRange: enough ? { k, m: n } : null,
  };
}

/**
 * Grade a run's frozen run_cost forecast at settle (08.6.3 item 3). lib/lab/spend.ts settleSpend
 * calls it inside its own transaction, so calibration and the spend row never disagree.
 * No forecast (a v1 run, a dry run) is a no-op.
 */
export function gradeCostForecast(store: LabStore, runId: string, actualUsd: number, opts: { items?: number | null; now?: Date } = {}): void {
  const f = runCostForecast(store, runId);
  if (!f) return;
  store.forecasts.grade(f.id, { actual: actualUsd, actualItems: opts.items ?? null, status: 'graded', gradedAt: (opts.now ?? new Date()).toISOString() });
}

/** The accuracy line under an actor's spend line (09.2.5, 09.8). */
export function accuracyLine(cal: ActorCalibration, label?: string): string {
  if (cal.n < CALIBRATION_MIN_N || cal.medAbsPctErr === null || !cal.inRange) return `Estimate accuracy: not enough yet (${cal.n} of 5 runs).`;
  const pct = Math.round(cal.medAbsPctErr * 100);
  return label
    ? `Estimates for ${label}: typically off by ${pct}%, ${cal.inRange.k} of ${cal.inRange.m} runs inside the range (n ${cal.n}).`
    : `Estimates checked against ${cal.n} of your runs: typically off by ${pct}%, ${cal.inRange.k} of ${cal.n} inside the range.`;
}
