import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LabRun, LabSource } from '@/lib/schemas';
import { invalidateModeCache } from '@/lib/paths';
import { ApifyError, type ApifyClient, type ApifyRun } from '@/lib/lab/apify-client';
import { advanceRuns, nextBackoffMs, POLL_THROTTLE_MS } from '@/lib/lab/sync';
import { dryPostItems } from '@/lib/lab/dry-items';
import { actorReports } from '@/lib/lab/measure/actors';
import { emptyStore } from './helpers/lab-measure-world';

/** 04 4.3a / 09.4.3: the advance job (AC-09-17, progress_json, the 3 s throttle, 429 backoff, verify routing). */
const KEYS = ['LAB_DRY', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-adv-'));
  process.env.GLADOS_ENV_LOCAL = path.join(dir, '.env.local');
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.DEMO_MODE = '0';
  invalidateModeCache();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
});

const NOW = new Date('2026-10-10T12:00:00.000Z');
const later = (s: number) => new Date(NOW.getTime() + s * 1000);
const src = (id: string, kind: LabSource['kind'], handle: string): LabSource => ({ id, kind, platform: 'tiktok', handle, url: null, displayName: handle, status: 'active', addedAt: NOW.toISOString(), reason: null, score: null });
const apifyRun = (over: Partial<ApifyRun> = {}): ApifyRun => ({ id: 'ar-1', actId: null, status: 'RUNNING', startedAt: null, finishedAt: null, defaultDatasetId: 'ds-1', usageTotalUsd: null, chargedEventCounts: null, statusMessage: null, runTimeSecs: null, maxTotalChargeUsd: null, ...over });

function fake(script: { run: () => ApifyRun; items?: unknown[]; datasetCount?: number | null }) {
  const calls: string[] = [];
  const client = {
    async getRun() {
      calls.push('getRun');
      return script.run();
    },
    async datasetInfo() {
      calls.push('datasetInfo');
      return { itemCount: script.datasetCount ?? null };
    },
    async datasetItems(_id: string, o: { offset?: number } = {}) {
      calls.push('datasetItems');
      return (o.offset ?? 0) === 0 ? (script.items ?? []) : [];
    },
  } as unknown as ApifyClient;
  return { client, calls };
}

function openRun(store: ReturnType<typeof emptyStore>['store'], over: Partial<LabRun> = {}): LabRun {
  store.sources.upsert(src('t', 'tracked', 'maker'));
  const run: LabRun = { id: 'lrun-1', kind: 'scrape', apifyRunId: 'ar-1', datasetId: 'ds-1', actor: 'clockworks/tiktok-scraper', input: { platform: 'tiktok', sourceIds: ['t'], limit: 50 }, status: 'running', items: null, costUsd: null, dry: false, startedAt: NOW.toISOString(), finishedAt: null, error: null, line: 'apify.sync', ...over };
  store.runs.insert(run);
  store.spend.add({ runId: run.id, provider: 'apify', line: 'apify.sync', units: 0, estUsd: null, actualUsd: null, dry: false, at: NOW.toISOString(), reservedUsd: 0.5 });
  return run;
}

describe('ABORTED and TIMED-OUT runs keep their items (AC-09-17)', () => {
  for (const status of ['ABORTED', 'TIMED-OUT'] as const) {
    test(`${status}: 40 dataset items ingest 40 posts and settle at usageTotalUsd`, async () => {
      const { store } = emptyStore();
      const run = openRun(store);
      const items = dryPostItems('tiktok', [{ handle: 'maker', existing: [] }], 40, NOW);
      const { client } = fake({ run: () => apifyRun({ status, usageTotalUsd: 0.1512, chargedEventCounts: { result: 40, 'actor-start': 1 } }), items });
      const r = await advanceRuns(store, client, { now: later(60) });
      expect(r.items).toBe(40);
      expect(store.posts.count()).toBe(40);
      expect(store.runs.get(run.id)).toMatchObject({ status: status === 'ABORTED' ? 'aborted' : 'timed_out', costUsd: 0.1512, items: 40 });
      expect(store.spend.forRun(run.id)[0]).toMatchObject({ actualUsd: 0.1512, actualSource: 'provider', events: { result: 40, 'actor-start': 1 } });
    });
  }
});

describe('progress_json for a running run (09.4.3)', () => {
  test('items from the primary charge event, cost and the actor message; one dataset call only when the event is missing', async () => {
    const { store } = emptyStore();
    const run = openRun(store);
    const a = fake({ run: () => apifyRun({ usageTotalUsd: 0.02, chargedEventCounts: { 'actor-start': 1, result: 17 }, statusMessage: 'Scraping profile 2 of 5' }) });
    await advanceRuns(store, a.client, { now: later(60) });
    expect(store.runs.get(run.id)!.progress).toMatchObject({ items: 17, usd: 0.02, statusMessage: 'Scraping profile 2 of 5', polledAt: later(60).toISOString(), events: { result: 17 } });
    expect(a.calls).toEqual(['getRun']);
    const b = fake({ run: () => apifyRun({ chargedEventCounts: { 'actor-start': 1 } }), datasetCount: 9 });
    await advanceRuns(store, b.client, { now: later(70) });
    expect(store.runs.get(run.id)!.progress!.items).toBe(9);
    expect(b.calls).toEqual(['getRun', 'datasetInfo']);
  });

  test('a second poll inside 3 s makes no Apify call', async () => {
    const { store } = emptyStore();
    openRun(store);
    const f = fake({ run: () => apifyRun({ chargedEventCounts: { result: 1 } }) });
    await advanceRuns(store, f.client, { now: later(60) });
    await advanceRuns(store, f.client, { now: new Date(later(60).getTime() + POLL_THROTTLE_MS - 1) });
    expect(f.calls).toEqual(['getRun']);
    await advanceRuns(store, f.client, { now: new Date(later(60).getTime() + POLL_THROTTLE_MS) });
    expect(f.calls).toEqual(['getRun', 'getRun']);
  });

  test('a 429 backs off 500 to 1000 ms, doubled on each 429, at most 60 s', async () => {
    const { store } = emptyStore();
    const run = openRun(store);
    const client = { async getRun() { throw new ApifyError('Apify GET /actor-runs answered 429', 429); } } as unknown as ApifyClient;
    await advanceRuns(store, client, { now: later(60), rand: () => 0.5 });
    const p1 = store.runs.get(run.id)!.progress!;
    expect(Date.parse(p1.backoffUntil!) - Date.parse(p1.polledAt!)).toBe(750);
    expect(nextBackoffMs(p1)).toBe(1500);
    expect(nextBackoffMs({ items: null, usd: null, statusMessage: null, polledAt: NOW.toISOString(), backoffUntil: later(50).toISOString() })).toBe(60_000);
    // inside a long backoff (past the 3 s throttle): no call
    store.runs.update(run.id, { progress: { ...p1, polledAt: later(60).toISOString(), backoffUntil: later(90).toISOString() } });
    let called = 0;
    const counting = { async getRun() { called++; return apifyRun(); } } as unknown as ApifyClient;
    await advanceRuns(store, counting, { now: later(70) });
    expect(called).toBe(0);
    await advanceRuns(store, counting, { now: later(91) });
    expect(called).toBe(1);
  });
});

describe('verify runs file their report on advance (04 2.3)', () => {
  test('a finished verify run writes actor_fields', async () => {
    const { store } = emptyStore();
    store.sources.upsert({ ...src('o', 'owned', 'studio'), platform: 'tiktok' });
    store.runs.insert({ id: 'lrun-v', kind: 'verify', apifyRunId: 'ar-1', datasetId: 'ds-1', actor: 'clockworks/tiktok-scraper', input: { platform: 'tiktok', actorId: 'clockworks/tiktok-scraper', kind: 'post', probe: false, sourceIds: ['o'], actorInput: {} }, status: 'running', items: null, costUsd: null, dry: false, startedAt: NOW.toISOString(), finishedAt: null, error: null, line: 'apify.verify' });
    const items = dryPostItems('tiktok', [{ handle: 'studio', existing: [] }], 3, NOW);
    const { client } = fake({ run: () => apifyRun({ status: 'SUCCEEDED', usageTotalUsd: 0.012 }), items });
    await advanceRuns(store, client, { now: later(60) });
    expect(actorReports(store)['clockworks/tiktok-scraper']).toMatchObject({ items: 3, usageTotalUsd: 0.012 });
    expect(store.metrics.byPost().size).toBe(3);
  });
});
