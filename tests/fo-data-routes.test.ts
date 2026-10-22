import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import fs, { mkdtempSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { invalidateModeCache } from '@/lib/paths';
import { getDb } from '@/lib/data';

/**
 * FounderOS merge, fo/data: every new route's contract (SPEC §2.3, AC-12,
 * AC-13, and the page checks T-2, T-5, U-1, U-5, CL-2, CL-3, LM-1, LM-2,
 * H-3, H-4, A-1, A-2). One temp database for the file; each test sets its own
 * .env.local.
 */

let dir = '';
beforeAll(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'glados-foroutes-'));
  process.env.GLADOS_DB = path.join(root, 'test.db');
  process.env.CLAUDE_PROJECTS_DIR = path.join(root, 'none');
  process.env.CODEX_SESSIONS_DIR = path.join(root, 'none');
  process.env.FUNNEL_PROVIDER = 'seed';
});
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'glados-foroutes-env-'));
  vi.stubEnv('GLADOS_ENV_LOCAL', path.join(dir, '.env.local'));
  vi.stubEnv('GLADOS_MODE_FILE', path.join(dir, '.glados-mode'));
  vi.stubEnv('DEMO_MODE', '0');
  invalidateModeCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  invalidateModeCache();
});

const envLocal = (lines: string) => writeFileSync(path.join(dir, '.env.local'), lines);
const PASSWORD = 'GLADOS_PASSWORD_HASH=x\nGLADOS_SESSION_SECRET=sess\n';
const json = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const NOW = new Date().toISOString();
const snapshot = (over: Record<string, unknown> = {}) => ({
  capturedAt: NOW, accountId: 'agentic', accountLabel: 'Agentic', accountValueUsd: 2480, buyingPowerUsd: 610, cashUsd: 610, dayPnlUsd: -8, totalPnlUsd: 94, source: 'markets-agent', ...over,
});

describe('trading', () => {
  test('push: no token with a password set is 401 and writes nothing; a bad body is 400; >200 positions is 400 (T-2)', async () => {
    const { POST } = await import('@/app/api/trading/snapshot/route');
    envLocal(`${PASSWORD}TRADING_PUSH_TOKEN=tok\n`);
    expect((await POST(json('/api/trading/snapshot', 'POST', { snapshot: snapshot() }))).status).toBe(401);
    expect((await POST(json('/api/trading/snapshot', 'POST', { snapshot: snapshot() }, { authorization: 'Bearer wrong' }))).status).toBe(401);
    expect((await POST(json('/api/trading/snapshot', 'POST', { snapshot: { accountId: 'x' } }, { authorization: 'Bearer tok' }))).status).toBe(400);
    const position = { symbol: 'S', quantity: 1, avgCostUsd: 1, marketValueUsd: 1, unrealizedPnlUsd: 0 };
    expect((await POST(json('/api/trading/snapshot', 'POST', { snapshot: snapshot(), positions: Array.from({ length: 201 }, () => position) }, { authorization: 'Bearer tok' }))).status).toBe(400);
    expect(getDb().trading.isEmpty()).toBe(true);
  });

  test('push: a valid push writes snapshot, positions, orders, activity and analysis; GET shows it', async () => {
    const { POST } = await import('@/app/api/trading/snapshot/route');
    const { GET } = await import('@/app/api/trading/route');
    envLocal('TRADING_PUSH_TOKEN=tok\n');
    const res = await POST(
      json('/api/trading/snapshot', 'POST', {
        snapshot: snapshot(),
        positions: [{ symbol: 'SPY', quantity: 2, avgCostUsd: 560, marketValueUsd: 1140, unrealizedPnlUsd: 20 }],
        openOrders: [{ id: 'o1', symbol: 'AMD', side: 'buy', type: 'limit', state: 'queued', quantity: 1, filledQuantity: 0, dollarAmountUsd: null, limitPriceUsd: 148, placedAgent: 'Markets', createdAt: NOW }],
        activity: [{ id: 't1', at: NOW, agent: 'Markets', action: 'buy', symbol: 'SPY', quantity: 2, priceUsd: 560, rationale: 'r', status: 'filled' }],
        analysis: { id: 'an1', at: NOW, agent: 'Markets', examined: 4, signals: 1, notes: 'n', rows: [] },
      }, { authorization: 'Bearer tok' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, via: 'token', positions: 1, openOrders: 1, activity: 1, analysis: true });
    const body = await (await GET(new Request('http://localhost/api/trading?sample=1'))).json();
    expect(body).toMatchObject({ mode: 'live', sample: false, status: { state: 'connected' }, phantomStatus: { state: 'not_configured' }, limits: null });
    expect(body.positions).toHaveLength(1);
    expect(body.openOrders).toHaveLength(1);
    expect(body.analysis.id).toBe('an1');
    expect(body.view.agent.tradeCount).toBe(1);
  });

  test('limits: GET null until saved; PATCH clamps and returns the clamped list; autopilot on needs confirm (T-5); a token cannot PATCH', async () => {
    const { GET, PATCH } = await import('@/app/api/trading/limits/route');
    envLocal('TRADING_PUSH_TOKEN=tok\n');
    expect(await (await GET(json('/api/trading/limits', 'GET', undefined, { authorization: 'Bearer tok' }))).json()).toEqual({ limits: null });
    expect((await PATCH(json('/api/trading/limits', 'PATCH', { maxTradesPerDay: 2 }))).status).toBe(400); // nothing stored: all 7 required
    const full = { maxDeployedCapitalUsd: 2000, maxNotionalPerTradeUsd: 500, maxPositionPctOfSleeve: 140, maxRiskPctPerTrade: 1, maxConcurrentPositions: 5, maxTradesPerDay: 2, minSleeveValueUsd: 1000 };
    const saved = await (await PATCH(json('/api/trading/limits', 'PATCH', full))).json();
    expect(saved.clamped).toEqual(['maxPositionPctOfSleeve']);
    expect(saved.limits.maxPositionPctOfSleeve).toBe(100);
    expect(saved.limits.autopilot).toBe(false);
    expect((await PATCH(json('/api/trading/limits', 'PATCH', { autopilot: true }))).status).toBe(409);
    expect(getDb().trading.limits()?.autopilot).toBe(false);
    expect((await (await PATCH(json('/api/trading/limits', 'PATCH', { autopilot: true, confirm: true }))).json()).limits.autopilot).toBe(true);
    expect((await PATCH(json('/api/trading/limits', 'PATCH', { autopilot: false }))).status).toBe(200); // off needs no confirm
    expect((await PATCH(json('/api/trading/limits', 'PATCH', full, { authorization: 'Bearer tok' }))).status).toBe(403);
  });
});

describe('usage', () => {
  test('push: a bad token is 401 and writes nothing (U-5); a good one stores', async () => {
    const { POST } = await import('@/app/api/usage/push/route');
    envLocal(`${PASSWORD}USAGE_PUSH_TOKEN=ut\n`);
    const body = { machine: 'mini', readings: [{ plan: 'claude', day: '2026-10-13', model: 'opus', input: 10, output: 5, cacheWrite: 1 }] };
    expect((await POST(json('/api/usage/push', 'POST', body, { authorization: 'Bearer nope' }))).status).toBe(401);
    expect(getDb().usageReadings.count()).toBe(0);
    const ok = await POST(json('/api/usage/push', 'POST', body, { authorization: 'Bearer ut' }));
    expect(await ok.json()).toEqual({ ok: true, machine: 'mini', stored: 1 });
  });

  test('in demo mode it answers the badged sample and reads nothing under the home directory (U-1)', async () => {
    const { GET } = await import('@/app/api/usage/route');
    vi.stubEnv('DEMO_MODE', '1');
    vi.stubEnv('CLAUDE_PROJECTS_DIR', '');
    vi.stubEnv('CODEX_SESSIONS_DIR', '');
    const home = os.homedir();
    const touched: string[] = [];
    for (const fn of ['readdirSync', 'existsSync', 'statSync', 'openSync'] as const) {
      const orig = fs[fn] as (...a: unknown[]) => unknown;
      vi.spyOn(fs, fn).mockImplementation(((p: unknown, ...rest: unknown[]) => {
        if (typeof p === 'string' && p.startsWith(home)) touched.push(p);
        return orig(p, ...rest);
      }) as never);
    }
    const body = await (await GET(new Request('http://localhost/api/usage'))).json();
    expect(body).toMatchObject({ available: true, mode: 'sample', sample: true });
    expect(touched).toEqual([]);
  });
});

describe('clients', () => {
  test('confirm by hand, draft a request with no outbound call (CL-2), launch gated (CL-3), status change', async () => {
    const confirm = (await import('@/app/api/clients/confirm/route')).POST;
    const work = (await import('@/app/api/clients/work/route')).POST;
    const launch = (await import('@/app/api/clients/work/[id]/launch/route')).POST;
    const patch = (await import('@/app/api/clients/work/[id]/route')).PATCH;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect((await work(json('/api/clients/work', 'POST', { clientId: 'nobody', brief: 'x' }))).status).toBe(404);
    const created = await confirm(json('/api/clients/confirm', 'POST', { name: 'Northwind Studio', retainer: true }));
    expect(created.status).toBe(201);
    const clientId = (await created.json()).client.clientId as string;
    expect(clientId).toMatch(/^manual-/);
    expect((await confirm(json('/api/clients/confirm', 'POST', { name: 'Deal', source: 'attio' }))).status).toBe(400);

    const w = await work(json('/api/clients/work', 'POST', { clientId, brief: 'Three hooks for the launch reel' }));
    expect(w.status).toBe(201);
    const id = (await w.json()).work.id as string;
    expect(getDb().clientWork.get(id)?.status).toBe('draft');
    expect(fetchSpy).not.toHaveBeenCalled();

    const ctx = { params: { id } };
    expect((await launch(json(`/api/clients/work/${id}/launch`, 'POST', { confirm: true }), ctx)).status).toBe(403);
    envLocal('GLADOS_WRITES=1\n');
    expect((await launch(json(`/api/clients/work/${id}/launch`, 'POST', {}), ctx)).status).toBe(409);
    expect((await launch(json(`/api/clients/work/${id}/launch`, 'POST', { confirm: true }), ctx)).status).toBe(503); // Superset not configured
    expect(getDb().clientWork.get(id)?.status).toBe('draft');

    const done = await patch(json(`/api/clients/work/${id}`, 'PATCH', { status: 'done' }), ctx);
    expect((await done.json()).work.finishedAt).toBeTruthy();
    expect((await patch(json('/api/clients/work/x', 'PATCH', { status: 'shipped' }), { params: { id: 'x' } })).status).toBe(400);

    const un = await confirm(json('/api/clients/confirm', 'POST', { clientId, confirmed: false }));
    expect(await un.json()).toEqual({ ok: true, clientId, confirmed: false });
    const { GET } = await import('@/app/api/clients/route');
    const payload = await (await GET(new Request('http://localhost/api/clients'))).json();
    expect(payload.roster).toEqual([]); // CL-1: only confirmed clients
    expect(payload.writes).toBe(true);
    expect(payload.attio.state).toBe('not_configured');
  });
});

describe('lead magnets', () => {
  test('register, validate (LM-1), filter, patch, delete only the record (LM-2)', async () => {
    const { GET, POST } = await import('@/app/api/lead-magnets/route');
    const item = await import('@/app/api/lead-magnets/[id]/route');
    expect((await POST(json('/api/lead-magnets', 'POST', { name: 'Kit', liveUrl: 'http://example.com', destination: 'email' }))).status).toBe(400);
    expect((await POST(json('/api/lead-magnets', 'POST', { name: '', liveUrl: 'https://example.com', destination: 'email' }))).status).toBe(400);
    const res = await POST(json('/api/lead-magnets', 'POST', { name: 'Kit', offer: 'Ten workflows', liveUrl: 'https://example.com/kit', destination: 'email', status: 'live', wentLiveAt: '2026-10-10' }));
    expect(res.status).toBe(201);
    const id = (await res.json()).magnet.id as string;
    const list = await (await GET(new Request('http://localhost/api/lead-magnets?status=live'))).json();
    expect(list.magnets.map((m: { id: string }) => m.id)).toEqual([id]);
    expect(list.view.captures).toMatchObject({ tracked: false, reason: 'trakyo_not_configured' });
    expect((await GET(new Request('http://localhost/api/lead-magnets?status=nope'))).status).toBe(400);
    const ctx = { params: { id } };
    expect((await (await item.PATCH(json(`/api/lead-magnets/${id}`, 'PATCH', { status: 'paused' }), ctx)).json()).magnet.status).toBe('paused');
    expect((await item.PATCH(json(`/api/lead-magnets/${id}`, 'PATCH', { liveUrl: 'ftp://x' }), ctx)).status).toBe(400);
    expect((await item.DELETE(json(`/api/lead-magnets/${id}`, 'DELETE'), ctx)).status).toBe(200);
    expect((await item.DELETE(json(`/api/lead-magnets/${id}`, 'DELETE'), ctx)).status).toBe(404);
  });
});

describe('chats', () => {
  test('rail pins the Wizard; a thread reads agent_messages; an unknown agent is 404', async () => {
    const rail = (await import('@/app/api/chats/route')).GET;
    const thread = (await import('@/app/api/chats/[agentId]/route')).GET;
    getDb().agentMessages.insert({ id: 'm1', agentId: 'daily-briefing', role: 'user', content: 'Summarise yesterday', toolCalls: [], createdAt: NOW });
    const body = await (await rail(new Request('http://localhost/api/chats'))).json();
    expect(body.threads[0]).toMatchObject({ agentId: 'conductor', pinned: true });
    expect(body.threads[1]).toMatchObject({ agentId: 'daily-briefing', lastMessage: 'Summarise yesterday' });
    expect(body.model.state).toMatch(/configured/);
    const t = await (await thread(new Request('http://localhost/api/chats/daily-briefing'), { params: { agentId: 'daily-briefing' } })).json();
    expect(t.messages.map((m: { id: string }) => m.id)).toEqual(['m1']);
    expect((await thread(new Request('http://localhost/api/chats/nope'), { params: { agentId: 'nope' } })).status).toBe(404);
  });
});

describe('interject (H-3, H-4)', () => {
  test('a task lands in agent_tasks and Undo removes it; a relay is assigned to the agent', async () => {
    const { POST, DELETE } = await import('@/app/api/interject/route');
    const res = await POST(json('/api/interject', 'POST', { text: 'todo: send the invoice' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ kind: 'task', undo: true });
    expect(getDb().agentTasks.get(body.id)).toMatchObject({ title: 'send the invoice', ownerKind: 'me', agentId: null });
    expect((await DELETE(json('/api/interject', 'DELETE', { id: body.id }))).status).toBe(200);
    expect(getDb().agentTasks.get(body.id)).toBeNull();
    const relay = await (await POST(json('/api/interject', 'POST', { text: 'tell Daily Briefing to add the Q3 numbers' }))).json();
    expect(relay).toMatchObject({ kind: 'relay', agentId: 'daily-briefing' });
    expect(getDb().agentTasks.get(relay.id)?.agentId).toBe('daily-briefing');
    expect((await POST(json('/api/interject', 'POST', { text: '' }))).status).toBe(400);
  });
});

describe('comms digest', () => {
  test('GET is null on a blank install with the cron off; read marks and undo', async () => {
    const { GET } = await import('@/app/api/comms/digest/route');
    const read = await import('@/app/api/comms/digest/read/route');
    const empty = await (await GET(new Request('http://localhost/api/comms/digest'))).json();
    expect(empty).toMatchObject({ digest: null, read: false, cron: { enabled: false, schedule: '0 7 * * *' }, sample: false });
    getDb().commsDigests.insert({ id: 'd1', date: '2026-10-13', body: { entries: [] }, createdAt: NOW });
    expect((await read.POST(json('/api/comms/digest/read', 'POST', { digestId: 'nope' }))).status).toBe(404);
    await read.POST(json('/api/comms/digest/read', 'POST', { digestId: 'd1' }));
    expect((await (await GET(new Request('http://localhost/api/comms/digest'))).json()).read).toBe(true);
    await read.DELETE(json('/api/comms/digest/read', 'DELETE', { digestId: 'd1' }));
    expect((await (await GET(new Request('http://localhost/api/comms/digest'))).json()).read).toBe(false);
  });
});

describe('recordings', () => {
  test('Plaud ingest is token-gated and idempotent; the archive lists it with no Fathom request', async () => {
    const { POST } = await import('@/app/api/plaud/ingest/route');
    const { GET } = await import('@/app/api/calls/archive/route');
    envLocal(`${PASSWORD}PLAUD_INGEST_TOKEN=pt\n`);
    const body = { recordings: [{ externalId: 'p1', title: 'Site walk', startedAt: NOW, durationS: 840 }] };
    expect((await POST(json('/api/plaud/ingest', 'POST', body))).status).toBe(401);
    expect((await POST(json('/api/plaud/ingest', 'POST', { recordings: [] }, { authorization: 'Bearer pt' }))).status).toBe(400);
    await POST(json('/api/plaud/ingest', 'POST', body, { authorization: 'Bearer pt' }));
    await POST(json('/api/plaud/ingest', 'POST', body, { authorization: 'Bearer pt' }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const list = await (await GET(new Request('http://localhost/api/calls/archive?source=plaud'))).json();
    expect(list.recordings).toHaveLength(1);
    expect(list.sources).toMatchObject({ plaud: { configured: true }, fathom: { configured: false, setupHref: '/integrations#fathom' } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('agents: deliverables and failover', () => {
  test('one decision per run (A-1); a rejection needs a reason; unknown run is 404', async () => {
    const { POST } = await import('@/app/api/agents/deliverables/decision/route');
    getDb().agentRuns.insert({ id: 'run-1', agentId: 'daily-briefing', startedAt: NOW, finishedAt: NOW, ok: true, summary: 'Brief' });
    expect((await POST(json('/x', 'POST', { runId: 'nope', decision: 'approved' }))).status).toBe(404);
    expect((await POST(json('/x', 'POST', { runId: 'run-1', decision: 'rejected' }))).status).toBe(400);
    expect((await POST(json('/x', 'POST', { runId: 'run-1', decision: 'approved' }))).status).toBe(201);
    expect((await POST(json('/x', 'POST', { runId: 'run-1', decision: 'rejected', reason: 'late' }))).status).toBe(409);
  });

  test('failover needs a confirm and logs the change to run history (A-2); an unknown agent is 404', async () => {
    const { PATCH } = await import('@/app/api/agents/[id]/failover/route');
    const db = getDb();
    db.agents.insert({ id: 'seat-1', departmentId: db.departments.all()[0].id, name: 'Seat', role: '', status: 'active', tier: 'worker', description: '', model: 'claude-opus', tools: [], parentId: null, instance: 'builtin' });
    const ctx = { params: { id: 'seat-1' } };
    expect((await PATCH(json('/x', 'PATCH', { model: 'claude-sonnet' }), ctx)).status).toBe(409);
    expect(db.agents.get('seat-1')?.model).toBe('claude-opus');
    expect((await PATCH(json('/x', 'PATCH', { model: 'claude-sonnet', confirm: true }), ctx)).status).toBe(200);
    expect(db.agents.get('seat-1')?.model).toBe('claude-sonnet');
    expect(db.agentRuns.byAgent('seat-1')[0].summary).toMatch(/Failover: model claude-opus → claude-sonnet/);
    expect((await PATCH(json('/x', 'PATCH', { model: 'x', confirm: true }), { params: { id: 'ghost' } })).status).toBe(404);
  });
});

describe('cron runner (GLADOS_CRON, off by default)', () => {
  test('GET is a dry run listing the 07:00 digest; POST tick and Run now are 403 when off, 409 without confirm when on', async () => {
    const tick = await import('@/app/api/cron/tick/route');
    const run = (await import('@/app/api/cron/run/route')).POST;
    const plan = await (await tick.GET()).json();
    expect(plan.enabled).toBe(false);
    expect(plan.jobs[0]).toMatchObject({ id: 'system:comms-digest', schedule: '0 7 * * *', system: true });
    expect((await tick.POST()).status).toBe(403);
    expect((await run(json('/api/cron/run', 'POST', { cronId: 'system:comms-digest', confirm: true }))).status).toBe(403);
    envLocal('GLADOS_CRON=1\n');
    expect((await run(json('/api/cron/run', 'POST', { cronId: 'system:comms-digest' }))).status).toBe(409);
    expect((await run(json('/api/cron/run', 'POST', { cronId: 'nope', confirm: true }))).status).toBe(404);
  });

  test('the runner fires due jobs once per window and records every firing, failures included', async () => {
    const { runDue, fireJob, cronJobs, DIGEST_CRON_ID } = await import('@/lib/cron-runner');
    const db = getDb();
    // yesterday 07:05 local: the real startedAt of the firing is always after that window opened
    const at7 = new Date(Date.now() - 86_400_000);
    at7.setHours(7, 5, 0, 0);
    const ran: string[] = [];
    const runner = async (job: { id: string }) => {
      ran.push(job.id);
      if (job.id === DIGEST_CRON_ID) throw new Error('feed down');
      return { ok: true, summary: 'ok' };
    };
    const first = await runDue(db, runner, at7);
    expect(first.ran).toEqual([expect.objectContaining({ cronId: DIGEST_CRON_ID, ok: false, summary: 'feed down' })]);
    const again = await runDue(db, runner, new Date(at7.getTime() + 60_000));
    expect(again.due).toBe(0); // served once in this window, even though it failed
    const manual = await fireJob(db, cronJobs(db)[0], async () => ({ ok: true, summary: 'by hand' }), 'manual');
    expect(manual.ok).toBe(true);
    expect(db.cronRuns.byCron(DIGEST_CRON_ID).map((r) => r.trigger)).toEqual(['manual', 'schedule']);
    expect(ran).toEqual([DIGEST_CRON_ID]);
  });
});

describe('trakyo links (GLADOS_WRITES, off by default)', () => {
  test('403 when off; 409 without confirm; 503 without a key; GET says not_configured with no request', async () => {
    const { GET, POST } = await import('@/app/api/trakyo/links/route');
    vi.stubEnv('TRAKYO_API_KEY', '');
    const body = { link: { url: 'https://example.com', contentItemId: 'ci_1' } };
    expect((await POST(json('/api/trakyo/links', 'POST', { ...body, confirm: true }))).status).toBe(403);
    envLocal('GLADOS_WRITES=1\n');
    expect((await POST(json('/api/trakyo/links', 'POST', body))).status).toBe(409);
    expect((await POST(json('/api/trakyo/links', 'POST', { ...body, confirm: true }))).status).toBe(503);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await (await GET()).json()).toMatchObject({ state: 'not_configured', writes: true, sample: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Sample and Filming (AC-12): badged fixtures, zero outbound requests', () => {
  test('?sample=1 on a blank feature answers the fixture', async () => {
    const lm = (await import('@/app/api/lead-magnets/route')).GET;
    for (const m of getDb().leadMagnets.all()) getDb().leadMagnets.remove(m.id);
    const body = await (await lm(new Request('http://localhost/api/lead-magnets?sample=1'))).json();
    expect(body).toMatchObject({ mode: 'sample', sample: true });
    expect(body.magnets.length).toBeGreaterThan(0);
  });

  test('Filming: every new GET carries the Sample badge and no request leaves the box; Usage is the sample', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    vi.stubEnv('PHANTOM_WALLET_ADDRESS', 'So11111111111111111111111111111111111111112');
    vi.stubEnv('FATHOM_API_KEY', 'fk');
    vi.stubEnv('TRAKYO_API_KEY', 'tky');
    invalidateModeCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const reads: [string, () => Promise<Response>][] = [
      ['trading', async () => (await import('@/app/api/trading/route')).GET(new Request('http://localhost/api/trading'))],
      ['clients', async () => (await import('@/app/api/clients/route')).GET(new Request('http://localhost/api/clients'))],
      ['lead-magnets', async () => (await import('@/app/api/lead-magnets/route')).GET(new Request('http://localhost/api/lead-magnets'))],
      ['chats', async () => (await import('@/app/api/chats/route')).GET(new Request('http://localhost/api/chats'))],
      ['comms/digest', async () => (await import('@/app/api/comms/digest/route')).GET(new Request('http://localhost/api/comms/digest'))],
      ['calls/archive', async () => (await import('@/app/api/calls/archive/route')).GET(new Request('http://localhost/api/calls/archive'))],
      ['trakyo/links', async () => (await import('@/app/api/trakyo/links/route')).GET()],
    ];
    for (const [name, read] of reads) {
      const body = await (await read()).json();
      expect(body.sample, name).toBe(true);
    }
    const usage = await (await (await import('@/app/api/usage/route')).GET(new Request('http://localhost/api/usage'))).json();
    expect(usage).toMatchObject({ available: true, sample: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
