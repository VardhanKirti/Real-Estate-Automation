import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeApify } from '@/lib/connectors/apify';
import { parseHandle } from '@/lib/lab/sources';
import { describeLabContext } from '@/lib/screen-context';
import { invalidateModeCache } from '@/lib/paths';

/**
 * Content Lab connector and API routes. A temp database, a temp .env.local with a BLANK
 * APIFY_API_TOKEN (so no credential file on this machine can configure it), Filming off.
 * POSTs that would spend are only exercised in LAB_DRY=1.
 */
const KEYS = ['GLADOS_DB', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE', 'LAB_DRY', 'APIFY_API_TOKEN', 'OPENAI_API_KEY'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let envFile: string;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-api-'));
  for (const k of KEYS) delete process.env[k];
  process.env.GLADOS_DB = path.join(dir, 'test.db');
  envFile = path.join(dir, '.env.local');
  fs.writeFileSync(envFile, 'APIFY_API_TOKEN=\nOPENAI_API_KEY=\n');
  process.env.GLADOS_ENV_LOCAL = envFile;
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.DEMO_MODE = '0';
  invalidateModeCache();
});
afterAll(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
});
beforeEach(() => {
  delete process.env.LAB_DRY;
});

const post = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('Apify connector', () => {
  test('no token: Not configured, and no capability list or configHref, so the tile offers Connect (paste the key)', () => {
    const s = describeApify({ token: false, stt: false, facts: null });
    expect(s).toMatchObject({ id: 'apify', name: 'Apify', state: 'not_configured' });
    expect(s.capabilities).toBeUndefined();
    expect(s.configHref).toBeUndefined();
  });

  test('token set: four capabilities, Configure goes to the Lab sources', () => {
    const s = describeApify({ token: true, stt: true, facts: null });
    expect(s.capabilities?.map((c) => c.id)).toEqual(['own-scrape', 'creator-scrape', 'search', 'transcription-source']);
    expect(s.configHref).toBe('/lab?tab=sources');
  });

  test('token set: connected; no STT key leaves transcription not configured; facts in the detail', () => {
    const s = describeApify({ token: true, stt: false, facts: { owned: 2, tracked: 0, lastRunAt: null, monthSpentUsd: 3.2, capUsd: 30, dry: true } });
    expect(s.state).toBe('connected');
    expect(s.detail).toBe('Dry: fixtures, no charges · $3.20 of $30 this month · never run');
    expect(s.capabilities?.find((c) => c.id === 'transcription-source')?.state).toBe('not_configured');
    expect(s.capabilities?.find((c) => c.id === 'own-scrape')?.detail).toBe('2 accounts added');
  });

  test('a BLANK APIFY_API_TOKEN in .env.local is not configured, whatever the credential files hold (creds fix)', async () => {
    const { apifyStatus, apifyConfigured } = await import('@/lib/connectors/apify');
    expect(apifyConfigured()).toBe(false);
    expect((await apifyStatus()).state).toBe('not_configured');
  });

  test('the connections board lists it', async () => {
    const { INTEGRATIONS } = await import('@/lib/integrations-catalog');
    expect(INTEGRATIONS.find((i) => i.slug === 'apify')).toMatchObject({ connectorId: 'apify', envKeys: ['APIFY_API_TOKEN'] });
    const { demoConnector } = await import('@/lib/demo-mode');
    expect(demoConnector('apify')?.detail).toContain('no charges');
  });
});

describe('source handles', () => {
  test('bare handles need a platform; profile URLs carry their own', () => {
    expect(parseHandle('@Maker.One', 'tiktok')).toEqual({ platform: 'tiktok', handle: 'maker.one', url: null });
    expect(parseHandle('maker')).toBeNull();
    expect(parseHandle('https://www.tiktok.com/@maker.one?lang=en')).toMatchObject({ platform: 'tiktok', handle: 'maker.one' });
    expect(parseHandle('https://www.youtube.com/@SomeChannel/videos')).toMatchObject({ platform: 'youtube', handle: 'somechannel' });
    expect(parseHandle('https://www.linkedin.com/in/some-person/')).toMatchObject({ platform: 'linkedin', handle: 'some-person' });
    expect(parseHandle('https://x.com/someone')).toMatchObject({ platform: 'twitter', handle: 'someone' });
    expect(parseHandle('https://example.com/someone')).toBeNull();
    expect(parseHandle('bad handle!', 'tiktok')).toBeNull();
  });
});

describe('API routes', { timeout: 30_000 }, () => {
  test('GET /api/lab on a blank, unconfigured install: not_configured with the setup card; v1 ?tab= answers 410', async () => {
    const { GET } = await import('@/app/api/lab/route');
    const body = (await (await GET(new Request('http://localhost/api/lab?page=today'))).json()) as { view: { frame: { mode: { state: string }; emptyCard: { setupHref: string } | null }; yourPosts?: unknown } };
    expect(body.view.frame.mode.state).toBe('not_configured');
    expect(body.view.frame.emptyCard?.setupHref).toMatch(/setup=keys/);
    expect((await GET(new Request('http://localhost/api/lab?tab=all'))).status).toBe(410);
  });

  test('GET ?sample=1 serves the fixture world, flagged sample; specimen and script resolve by fixture id', async () => {
    const { GET } = await import('@/app/api/lab/route');
    const body = (await (await GET(new Request('http://localhost/api/lab?page=today&sample=1'))).json()) as { view: { frame: { mode: { sample: boolean; fixtureName: string; state: string } }; yourPosts: { tiles: unknown[] } } };
    expect(body.view.frame.mode).toMatchObject({ sample: true, state: 'ready' });
    expect(body.view.frame.mode.fixtureName).toMatch(/fictional/);
    const spec = await (await import('@/app/api/lab/specimen/route')).GET(new Request('http://localhost/api/lab/specimen?post=fx-p-0001&sample=1'));
    expect(spec.status).toBe(200);
    const missing = await (await import('@/app/api/lab/specimen/route')).GET(new Request('http://localhost/api/lab/specimen?post=nope&sample=1'));
    expect(missing.status).toBe(404);
    const script = await (await import('@/app/api/lab/script/route')).GET(new Request('http://localhost/api/lab/script?id=fx-script-1&sample=1'));
    expect(((await script.json()) as { script: { version: number } }).script.version).toBe(3);
  });

  test('writes against the sample are refused (it is a read-only preview); without ?sample a fixture id is simply unknown', async () => {
    const { POST } = await import('@/app/api/lab/suggestions/route');
    const body = { id: 'fx-s-suggested-tiktok-yukihollander', action: 'accept' };
    const refused = await POST(post('http://localhost/api/lab/suggestions?sample=1', body));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/read-only/);
    expect((await POST(post('http://localhost/api/lab/suggestions', body))).status).toBe(404);
    const { POST: runNow } = await import('@/app/api/lab/run/route');
    expect((await runNow(post('http://localhost/api/lab/run?sample=1', {}))).status).toBe(409);
  });

  test('POST /api/lab/run: not configured and not dry → 409 with the setup href; nothing recorded', async () => {
    const { POST } = await import('@/app/api/lab/run/route');
    const res = await POST(post('http://localhost/api/lab/run', {}));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { setupHref: string }).setupHref).toBe('/integrations#apify');
    const { getDb } = await import('@/lib/data');
    expect(getDb().lab.runs.recent()).toHaveLength(0);
  });

  test('add a source, then a LAB_DRY=1 Run now does the whole cycle on fixtures: scrape, transcribe, dissect, measure, all dry and 0-cost', async () => {
    const { POST: addSource } = await import('@/app/api/lab/sources/route');
    const added = await addSource(post('http://localhost/api/lab/sources', { kind: 'owned', handle: 'https://www.tiktok.com/@test.studio' }));
    expect(added.status).toBe(200);
    expect(((await added.json()) as { source: { platform: string; handle: string } }).source).toMatchObject({ platform: 'tiktok', handle: 'test.studio' });
    const bad = await addSource(post('http://localhost/api/lab/sources', { kind: 'owned', handle: 'nohost' }));
    expect(bad.status).toBe(400);

    process.env.LAB_DRY = '1';
    const { POST: runNow } = await import('@/app/api/lab/run/route');
    const preview = await runNow(post('http://localhost/api/lab/run', { preview: true }));
    expect(((await preview.json()) as { plan: unknown[] }).plan).toEqual([expect.objectContaining({ actor: 'clockworks/tiktok-scraper', handles: ['test.studio'], limit: 50, maxItems: 50 })]);
    const { getDb } = await import('@/lib/data');
    expect(getDb().lab.runs.recent()).toHaveLength(0); // a preview starts nothing

    const res = await runNow(post('http://localhost/api/lab/run', {}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dry: boolean; pending: number; ingested: number; analysis: { dissected: number; transcribed: number }; runs: { actor: string; dry: boolean; costText: string; status: string }[] };
    expect(body).toMatchObject({ dry: true, pending: 0, ingested: 50 });
    expect(body.runs).toEqual([expect.objectContaining({ actor: 'clockworks/tiktok-scraper', dry: true, costText: 'dry', status: 'succeeded' })]);
    expect(body.analysis.dissected).toBe(40); // DISSECT_PER_CYCLE
    expect(body.analysis.transcribed).toBe(30); // TRANSCRIBE_PER_CYCLE
    const lab = getDb().lab;
    expect(lab.posts.count()).toBe(50);
    expect(lab.spend.all().map((r) => r.provider).sort()).toEqual(['apify', 'llm', 'stt']);
    expect(lab.spend.all().every((r) => r.dry && r.actualUsd === 0)).toBe(true);
    const runs = (await (await (await import('@/app/api/lab/runs/route')).GET(new Request('http://localhost/api/lab/runs'))).json()) as { runs: { kind: string }[]; advanced: number; spend: { dry: boolean } };
    expect(runs.runs.map((r) => r.kind).sort()).toEqual(['dissect', 'scrape', 'transcribe']);
    expect(runs.advanced).toBe(0);
    expect(runs.spend.dry).toBe(true);
  });

  test('sources: feeds, pause, resume, remove, rename, set_kind', async () => {
    const { POST } = await import('@/app/api/lab/sources/route');
    const feed = await POST(post('http://localhost/api/lab/sources', { kind: 'feed', platform: 'reddit', handle: 'r/LocalLLaMA' }));
    expect(feed.status).toBe(200);
    const f = ((await feed.json()) as { source: { id: string; kind: string; platform: string; handle: string } }).source;
    expect(f).toMatchObject({ kind: 'feed', platform: 'reddit', handle: 'localllama' });
    expect((await POST(post('http://localhost/api/lab/sources', { kind: 'feed', platform: 'tiktok', handle: 'x' }))).status).toBe(400);
    const tracked = ((await (await POST(post('http://localhost/api/lab/sources', { kind: 'tracked', platform: 'youtube', handle: '@SomeMaker' }))).json()) as { source: { id: string } }).source;
    const act = async (b: Record<string, unknown>) => ((await (await POST(post('http://localhost/api/lab/sources', b))).json()) as { source: { status: string; displayName: string; kind: string } }).source;
    expect((await act({ action: 'pause', id: tracked.id })).status).toBe('paused');
    expect((await act({ action: 'resume', id: tracked.id })).status).toBe('active');
    expect((await act({ action: 'rename', id: tracked.id, displayName: 'Some Maker' })).displayName).toBe('Some Maker');
    expect((await act({ action: 'set_kind', id: tracked.id, kind: 'owned' })).kind).toBe('owned');
    expect((await act({ action: 'set_kind', id: tracked.id, kind: 'tracked' })).kind).toBe('tracked');
    expect((await act({ action: 'remove', id: tracked.id })).status).toBe('dismissed');
    // re-adding a removed source brings it back
    const back = ((await (await POST(post('http://localhost/api/lab/sources', { kind: 'tracked', platform: 'youtube', handle: 'somemaker' }))).json()) as { existed: boolean; source: { status: string } });
    expect(back).toMatchObject({ existed: true, source: { status: 'active' } });
    expect((await POST(post('http://localhost/api/lab/sources', { action: 'set_kind', id: f.id, kind: 'owned' }))).status).toBe(400);
    expect((await POST(post('http://localhost/api/lab/sources', { action: 'pause', id: 'nope' }))).status).toBe(404);
    // leave the world as the later tests expect it: one owned account, no tracked creators
    await act({ action: 'remove', id: tracked.id });
  });

  test('a configured live Run now starts the Apify run through the gate (fake fetch); the runs read advances it and settles the actual charge', async () => {
    fs.writeFileSync(envFile, 'APIFY_API_TOKEN=apify_test_not_real\nOPENAI_API_KEY=\n');
    const realFetch = globalThis.fetch;
    const seen: { url: string; method: string; body?: string }[] = [];
    const items = (await import('@/lib/lab/dry-items')).dryPostItems('tiktok', [{ handle: 'test.studio', existing: [] }], 3, new Date());
    let state = 'RUNNING';
    globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
      seen.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body });
      const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
      if (!String(url).startsWith('https://api.apify.com/v2/')) return new Response('blocked in test', { status: 599 });
      if (String(url).includes('/acts/')) return ok({ data: { id: 'run-1', status: 'READY', defaultDatasetId: 'ds-1' } });
      if (String(url).includes('/actor-runs/')) return ok({ data: { id: 'run-1', status: state, defaultDatasetId: 'ds-1', usageTotalUsd: state === 'SUCCEEDED' ? 0.0123 : null } });
      if (String(url).includes('/datasets/')) return ok(items);
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    try {
      const { getDb } = await import('@/lib/data');
      const lab = getDb().lab;
      const before = lab.runs.recent(100).length;
      const { POST } = await import('@/app/api/lab/run/route');
      const res = await POST(post('http://localhost/api/lab/run', { platforms: ['tiktok'] }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { dry: boolean; pending: number }).pending).toBe(1);
      expect(seen[0]).toMatchObject({ method: 'POST' });
      expect(seen[0].url).toMatch(/^https:\/\/api\.apify\.com\/v2\/acts\/clockworks~tiktok-scraper\/runs\?maxItems=15&maxTotalChargeUsd=0\.5$/); // v2 reserve lowered by the estimate, held at the TikTok actor minimum $0.50 (08.6.3, 09.2.6)
      expect(JSON.parse(seen[0].body!)).toMatchObject({ profiles: ['test.studio'], resultsPerPage: 15 });
      const run = lab.runs.recent(1)[0];
      expect(run).toMatchObject({ status: 'running', apifyRunId: 'run-1', dry: false });
      expect(lab.runs.recent(100).length).toBe(before + 1);

      // too young to poll
      const { GET } = await import('@/app/api/lab/runs/route');
      expect(((await (await GET(new Request('http://localhost/api/lab/runs'))).json()) as { advanced: number }).advanced).toBe(0);
      // age it, finish it on Apify's side, read again
      lab.runs.update(run.id, { startedAt: new Date(Date.now() - 60_000).toISOString() });
      state = 'SUCCEEDED';
      const after = (await (await GET(new Request('http://localhost/api/lab/runs'))).json()) as { advanced: number; finished: number };
      expect(after).toMatchObject({ advanced: 1, finished: 1 });
      expect(lab.runs.get(run.id)).toMatchObject({ status: 'succeeded', costUsd: 0.0123, items: 3 });
      expect(lab.spend.all().find((r) => r.runId === run.id)).toMatchObject({ actualUsd: 0.0123, dry: false });
      expect(seen.every((r) => r.url.startsWith('https://api.apify.com/v2/'))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      fs.writeFileSync(envFile, 'APIFY_API_TOKEN=\nOPENAI_API_KEY=\n');
    }
  });

  test('ideas and scripts: status actions, a dry script draft, the Wizard prefill; nothing built is a 501 any more', async () => {
    const { getDb } = await import('@/lib/data');
    const lab = getDb().lab;
    lab.ideas.upsert({ id: 'i1', title: 't', clusterId: null, angle: 'a', tension: null, formatFamily: 'tutorial_walkthrough', strand: [], hookRecs: [], evidence: [], timing: null, fit: 0.5, thin: true, status: 'open', dismissReason: null, createdAt: new Date().toISOString(), actedOnAt: null });
    const { POST: ideas } = await import('@/app/api/lab/ideas/route');
    expect((await ideas(post('http://localhost/api/lab/ideas', { id: 'i1', action: 'dismiss', reason: 'not my format' }))).status).toBe(200);
    expect(lab.ideas.get('i1')).toMatchObject({ status: 'dismissed', dismissReason: 'not my format' });
    const wiz = await ideas(post('http://localhost/api/lab/ideas', { id: 'i1', action: 'ask_wizard' }));
    expect(wiz.status).toBe(200);
    expect(((await wiz.json()) as { wizard: { text: string; broadcast: boolean } }).wizard).toMatchObject({ broadcast: false, text: expect.stringMatching(/^Content Lab idea: t\./) });
    process.env.LAB_DRY = '1';
    const ws = await ideas(post('http://localhost/api/lab/ideas', { id: 'i1', action: 'write_script', durationS: 30 }));
    expect(ws.status).toBe(200);
    const w = (await ws.json()) as { scriptId: string; dry: boolean; gatePassed: boolean };
    expect(w).toMatchObject({ dry: true, gatePassed: true });
    expect(lab.scripts.latestVersion(w.scriptId)?.body.durationS).toBe(30);
    const { POST: scripts } = await import('@/app/api/lab/scripts/route');
    const regen = await scripts(post('http://localhost/api/lab/scripts', { action: 'regenerate_section', id: w.scriptId, section: 1 }));
    expect(((await regen.json()) as { version: number }).version).toBe(2);
    expect((await scripts(post('http://localhost/api/lab/scripts', { action: 'generate', ideaId: 'nope' }))).status).toBe(404);
    expect((await scripts(post('http://localhost/api/lab/scripts', { action: 'save_edit', id: w.scriptId, body: { nonsense: true } }))).status).toBe(400);
    expect((await scripts(post('http://localhost/api/lab/scripts', { action: 'mark_published', id: 'nope', postId: 'x' }))).status).toBe(404);
    // the dry runs are on the ledger at zero cost (AC6)
    expect(lab.spend.all().filter((r) => r.provider === 'llm').every((r) => r.dry && r.actualUsd === 0)).toBe(true);
  });

  test('the Wizard screen context describes the lab', async () => {
    const { getDb } = await import('@/lib/data');
    expect(describeLabContext('Content Lab', getDb().lab)).toMatch(/^Content Lab: 1 of your accounts, 0 tracked creators, 50 posts scraped; 0 new breakouts this week; 0 open trends; 0 ideas queued\.$/);
  });
});
