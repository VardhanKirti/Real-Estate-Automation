import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import { invalidateModeCache } from '@/lib/paths';
import { checklistView, markPlanPreviewed, type ChecklistStepId } from '@/lib/lab/setup/checklist';
import type { LabHealthResult } from '@/lib/lab/setup/health';

const fresh = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};
const KEYS = ['LAB_DRY', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE', 'APIFY_API_TOKEN'] as const;
let saved: Record<string, string | undefined>;
let envFile: string;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-check-'));
  envFile = path.join(dir, '.env.local');
  fs.writeFileSync(envFile, 'APIFY_API_TOKEN=\n');
  process.env.GLADOS_ENV_LOCAL = envFile;
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.DEMO_MODE = '0';
  invalidateModeCache();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
});

const T = '2026-10-12T01:00:00.000Z';
const okHealth = (...ids: string[]): LabHealthResult[] => ids.map((id) => ({ id: id as LabHealthResult['id'], state: 'ok', detail: 'ok', checkedAt: T, network: true }));
const src = (store: LabStore, id: string, kind: 'owned' | 'tracked') => store.sources.upsert({ id, kind, platform: 'instagram', handle: id, url: null, displayName: id, status: 'active', addedAt: T, reason: null, score: null });
const stateOf = (store: LabStore, health: LabHealthResult[], dry = false) => Object.fromEntries(checklistView(store, { health, dry, privateInstance: false, now: new Date(T) }).steps.map((s) => [s.id, s.state])) as Record<ChecklistStepId, string>;
const REQUIRED: ChecklistStepId[] = ['key_apify', 'key_apify_ok', 'owned_added', 'tracked_added', 'plan_previewed', 'first_live_run', 'first_cost_settled', 'posts_measured', 'radar_live'];

function scrapeRun(store: LabStore, id: string, dry: boolean) {
  store.runs.insert({ id, kind: 'scrape', apifyRunId: dry ? null : `a-${id}`, datasetId: null, actor: 'apify/instagram-post-scraper', input: { platform: 'instagram', sourceIds: ['own-1'] }, status: 'succeeded', items: 3, costUsd: dry ? 0 : 0.01, dry, startedAt: T, finishedAt: T, error: null, line: 'apify.sync', job: null, scheduled: false, batchId: null, progress: null });
}

describe('AC-08-10: first-run checklist detection', () => {
  test('a store built step by step moves each required step from todo to done in order', () => {
    const store = fresh();
    let health: LabHealthResult[] = [];
    const done = () => REQUIRED.filter((id) => stateOf(store, health)[id] === 'done');
    expect(stateOf(store, health).key_apify).toBe('todo');
    expect(stateOf(store, health).plan_previewed).toBe('blocked');

    fs.writeFileSync(envFile, 'APIFY_API_TOKEN=apify_api_TESTONLY\n');
    expect(done()).toEqual(['key_apify']);
    health = okHealth('apify.auth');
    expect(done()).toEqual(['key_apify', 'key_apify_ok']);
    src(store, 'own-1', 'owned');
    for (let k = 0; k < 4; k++) src(store, `trk-${k}`, 'tracked');
    expect(stateOf(store, health).tracked_added).toBe('todo');
    src(store, 'trk-4', 'tracked');
    expect(done()).toEqual(REQUIRED.slice(0, 4));
    markPlanPreviewed(store, new Date(T));
    expect(done()).toEqual(REQUIRED.slice(0, 5));
    expect(stateOf(store, health).first_cost_settled).toBe('blocked');
    scrapeRun(store, 'run-live', false);
    expect(done()).toEqual(REQUIRED.slice(0, 6));
    store.spend.add({ runId: 'run-live', provider: 'apify', line: 'apify.sync', units: 3, estUsd: 0.01, actualUsd: 0.012, dry: false, at: T, actualSource: 'provider', settledAt: T });
    expect(done()).toEqual(REQUIRED.slice(0, 7));
    store.posts.upsert({ id: 'p1', sourceId: 'own-1', platform: 'instagram', externalId: 'x1', url: 'https://example.com/p/x1', postedAt: T, caption: '', contentType: 'reel', thumbnailUrl: null, mediaUrl: null, durationS: null, isOwned: true });
    store.metrics.add({ postId: 'p1', capturedAt: T, views: 100, likes: 1, comments: 0, shares: null, saves: null });
    expect(done()).toEqual(REQUIRED.slice(0, 8));
    store.priors.set({ key: 'job:radar.hn', value: { lastAt: T, lastOkAt: T, lastDetail: 'ok', fails: 0, skippedReason: null, dry: false }, n: 0, supersedesDefault: false, updatedAt: T });
    const v = checklistView(store, { health, dry: false, privateInstance: false, now: new Date(T) });
    expect(done()).toEqual(REQUIRED);
    expect(v.steps.find((s) => s.id === 'scheduled')).toMatchObject({ state: 'skipped', required: false });
    expect(v.complete).toBe(true);
    expect(store.priors.get('checklist:complete')).toBeTruthy();
  });

  test('a dry run row never ticks steps 6 to 9', () => {
    const store = fresh();
    fs.writeFileSync(envFile, 'APIFY_API_TOKEN=apify_api_TESTONLY\n');
    src(store, 'own-1', 'owned');
    markPlanPreviewed(store, new Date(T));
    scrapeRun(store, 'run-dry', true);
    store.spend.add({ runId: 'run-dry', provider: 'apify', line: 'apify.sync', units: 3, estUsd: 0, actualUsd: 0, dry: true, at: T, actualSource: 'dry' });
    store.priors.set({ key: 'job:radar.hn', value: { lastAt: T, lastOkAt: T, lastDetail: 'ok', fails: 0, skippedReason: null, dry: true }, n: 0, supersedesDefault: false, updatedAt: T });
    const s = stateOf(store, okHealth('apify.auth'));
    for (const id of ['first_live_run', 'first_cost_settled', 'posts_measured', 'radar_live'] as const) expect(s[id], id).not.toBe('done');
  });

  test('complete only with every required step done; in dry every step is skipped with the dry line', () => {
    const store = fresh();
    const v = checklistView(store, { health: [], dry: true, dryLabel: 'LAB_DRY=1 · fixtures, no charges', privateInstance: true, now: new Date(T) });
    expect(v.steps.every((s) => s.state === 'skipped')).toBe(true);
    expect(v.steps[0].detail).toBe('Checklist counts live runs only. This is LAB_DRY=1 · fixtures, no charges.');
    expect(v.complete).toBe(false);
    const priv = checklistView(store, { health: [], dry: false, privateInstance: true, now: new Date(T) });
    expect(priv.steps.find((s) => s.id === 'scheduled')!.required).toBe(true);
    expect(priv.requiredTotal).toBe(10);
  });
});
