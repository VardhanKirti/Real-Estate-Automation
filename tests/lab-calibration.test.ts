import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore } from '@/lib/lab/store';
import { invalidateModeCache } from '@/lib/paths';
import { gatedCall, settleSpend } from '@/lib/lab/spend';
import { accuracyLine, calibrationFor } from '@/lib/lab/setup/calibration';
import { estimateRun, shrink, syncRunSpec } from '@/lib/lab/setup/estimate';
import { RECORDED_PRICES } from '@/lib/lab/setup/pricing-book';

const fresh = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};
const KEYS = ['LAB_DRY', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE', 'LAB_APIFY_CAP_USD', 'LAB_APIFY_SYNC_CAP_USD', 'LAB_RUN_MAX_USD'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-cal-'));
  process.env.GLADOS_ENV_LOCAL = path.join(dir, '.env.local');
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.DEMO_MODE = '0';
  invalidateModeCache();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
});

const IG = 'apify/instagram-post-scraper';
const BOOK = RECORDED_PRICES[IG];

/** One gated live Instagram run with a frozen estimate, settled at `items` returned and billed at book prices. */
async function settledRun(store: ReturnType<typeof fresh>, at: Date, items: number) {
  const est = estimateRun(syncRunSpec('instagram', 10, 15), BOOK, 'BRONZE', null);
  const g = await gatedCall(store, { provider: 'apify', line: 'apify.sync', kind: 'scrape', actor: IG, now: at, estimate: { point: est.usd.point, high: est.usd.high, low: est.usd.low, minMaxTotalChargeUsd: BOOK.minMaxTotalChargeUsd, expectedItems: est.items.expected, known: true, inputs: { tier: 'BRONZE' } } }, {
    live: async () => ({ result: null, units: 0, actualUsd: null, pending: true, apifyRunId: `a-${at.getTime()}` }),
    dry: () => ({ result: null }),
  });
  const usage = Math.round(items * 0.0023 * 1e6) / 1e6;
  settleSpend(store, g.run.id, usage, { items, events: { post: items, 'post-details': items }, now: new Date(at.getTime() + 60_000) });
  return g.run.id;
}

describe('AC-09-6: self-calibration', () => {
  test('a gated live run freezes a run_cost forecast and settle grades it in the same transaction', async () => {
    const store = fresh();
    const id = await settledRun(store, new Date('2026-10-01T00:00:00Z'), 138);
    const f = store.forecasts.bySubject(id)[0];
    expect(f).toMatchObject({ kind: 'run_cost', status: 'graded', expectedItems: 150, actualItems: 138 });
    expect(f.actual).toBeCloseTo(138 * 0.0023, 6);
    expect(store.spend.forRun(id)[0]).toMatchObject({ actualSource: 'provider' });
  });

  test('10 settled runs at 92% of expected items reproduce the shrunk volume factor 0.947', async () => {
    const store = fresh();
    for (let k = 0; k < 10; k++) await settledRun(store, new Date(Date.UTC(2026, 9, 1 + k)), 138);
    const cal = calibrationFor(store, IG, new Date('2026-10-12T00:00:00Z'));
    expect(cal.n).toBe(10);
    expect(cal.volume!.med).toBeCloseTo(0.92, 4);
    expect(cal.price!.med).toBeCloseTo(1, 4);
    expect(Math.round(shrink(10, cal.volume!.med) * 1000) / 1000).toBe(0.947);
    const est = estimateRun(syncRunSpec('instagram', 10, 15), BOOK, 'BRONZE', cal);
    expect(est.calibrated).toEqual({ n: 10, applied: true });
    expect(Math.round(est.usd.point * 1000) / 1000).toBe(0.327);
    expect(accuracyLine(cal)).toMatch(/^Estimates checked against 10 of your runs: typically off by \d+%, \d+ of 10 inside the range\.$/);
  });

  test('under 5 runs nothing applies and the accuracy line reads not enough yet', async () => {
    const store = fresh();
    for (let k = 0; k < 4; k++) await settledRun(store, new Date(Date.UTC(2026, 9, 1 + k)), 138);
    const cal = calibrationFor(store, IG);
    expect(cal).toMatchObject({ n: 4, volume: null, price: null, inRange: null });
    expect(estimateRun(syncRunSpec('instagram', 10, 15), BOOK, 'BRONZE', cal).calibrated).toEqual({ n: 4, applied: false });
    expect(accuracyLine(cal)).toBe('Estimate accuracy: not enough yet (4 of 5 runs).');
  });
});
