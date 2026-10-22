import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invalidateSwr, lastSwr, swr } from '@/lib/swr';
import { attioClients } from '@/lib/connectors/attio';
import { zernioLiveAccounts } from '@/lib/connectors/zernio';
import { beehiivSubscribers } from '@/lib/connectors/beehiiv';
import { cachedStatus } from '@/lib/connectors';
import { warmCaches, warmEnabled, warmTasks } from '@/lib/warm';
import { listKeyStatuses } from '@/lib/keys';
import { resolveAttioKey, resolveManychatKey, runtimeEnv } from '@/lib/creds';
import { slackStatus } from '@/lib/connectors/slack';
import type { ConnectorStatus } from '@/lib/connectors/types';

/**
 * founderos-ui SPEC 4.1 a3: the live sources on the render path go through lib/swr.ts. A cached
 * value is always a real result of the source; a failed call is never stored. The cache is off
 * under vitest, so these tests switch it on (VITEST unset) for their own keys only.
 */
describe('live reads through the SWR cache', () => {
  beforeEach(() => {
    vi.stubEnv('VITEST', '');
    invalidateSwr();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    invalidateSwr();
  });

  const deal = { id: { record_id: 'r1' }, created_at: '2026-10-01T00:00:00Z', values: { name: [{ value: 'Harbor Dental retainer' }], stage: [{ status: { title: 'Won' } }] } };

  test('Attio clients: a second render inside the window makes no call', async () => {
    vi.stubEnv('ATTIO_API_KEY', 'att-test');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [deal] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const a = await attioClients();
    const b = await attioClients();
    expect(a.state).toBe('connected');
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('Attio clients: an error is not cached; the next render asks again', async () => {
    vi.stubEnv('ATTIO_API_KEY', 'att-test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    expect((await attioClients()).state).toBe('error');
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: [deal] }), { status: 200 }));
    vi.stubGlobal('fetch', ok);
    expect((await attioClients()).state).toBe('connected');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  test('Zernio: a failed refresh falls back to the last real answer, never an invented one', async () => {
    vi.stubEnv('ZERNIO_API_KEY', 'zk-test');
    const payload = { accounts: [{ platform: 'instagram', username: 'me', metadata: { profileData: { followersCount: 1234 } } }] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
    const first = await zernioLiveAccounts();
    expect(first.instagram?.followers).toBe(1234);
    invalidateSwr('zernio:'); // force the next read to call
    // lastSwr keeps nothing after an invalidation: the fallback is only ever a stored real answer.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
    expect(await zernioLiveAccounts()).toEqual({});
  });

  test('Beehiiv: cached per key; a new key is a new read', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { stats: { active_subscriptions: 42 } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = { BEEHIIV_API_KEY: 'k1', BEEHIIV_PUBLICATION_ID: 'p1' };
    expect(await beehiivSubscribers(env)).toBe(42);
    expect(await beehiivSubscribers(env)).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await beehiivSubscribers({ ...env, BEEHIIV_API_KEY: 'k2' })).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('cachedStatus: one real check per window per connector; invalidation by the connector prefix', async () => {
    let calls = 0;
    const check = async (): Promise<ConnectorStatus> => ({ id: 'x', name: 'X', kind: 'crm', state: 'connected', detail: `check ${++calls}` });
    expect((await cachedStatus('x', check)).detail).toBe('check 1');
    expect((await cachedStatus('x', check)).detail).toBe('check 1');
    invalidateSwr('connectors:');
    expect((await cachedStatus('x', check)).detail).toBe('check 2');
  });

  test('lastSwr returns the last stored real value, and nothing for an unknown key', async () => {
    await swr('lc:last', { freshMs: 0, maxStaleMs: 0 }, async () => 'real');
    expect(lastSwr('lc:last')).toBe('real');
    expect(lastSwr('lc:none')).toBeUndefined();
  });
});

describe('boot warm-up (lib/warm.ts)', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('every task runs at once; one failure does not stop the rest', async () => {
    const order: string[] = [];
    const results = await warmCaches([
      { name: 'a', run: async () => order.push('a') },
      { name: 'b', run: async () => { throw new Error('down'); } },
      { name: 'c', run: async () => order.push('c') },
    ]);
    expect(results.map((r) => [r.name, r.ok])).toEqual([['a', true], ['b', false], ['c', true]]);
    expect(order.sort()).toEqual(['a', 'c']);
  });

  test('covers the live pages and only reads (no snapshot syncs, no sends)', () => {
    const names = warmTasks().map((t) => t.name);
    for (const n of ['connectors', 'gbrain', 'attio-funnel', 'ghl-funnel', 'attio-clients', 'compute', 'comms-feed', 'zernio-accounts', 'beehiiv']) {
      expect(names).toContain(n);
    }
    expect(names.some((n) => /sync|send|post$/.test(n))).toBe(false);
  });

  test('off with GLADOS_WARM=0, under vitest and during next build', () => {
    expect(warmEnabled({})).toBe(true);
    expect(warmEnabled({ GLADOS_WARM: '0' })).toBe(false);
    expect(warmEnabled({ VITEST: 'true' })).toBe(false);
    expect(warmEnabled({ NEXT_PHASE: 'phase-production-build' })).toBe(false);
  });
});

/**
 * founderos-ui SPEC O12 (glados-ui BUILD-REPORT 4): an audit masks keys by pointing GLADOS_ENV_LOCAL
 * at a copy with every key blank, while Next has already loaded the real .env.local into
 * process.env. A blank in the masked file must win everywhere a key is read.
 */
describe('a masked .env.local beats the keys already in process.env', () => {
  let tmp: string;
  const prevOverride = process.env.GLADOS_ENV_LOCAL;

  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `glados-mask-${process.pid}-${Math.random().toString(36).slice(2)}.env.local`);
    fs.writeFileSync(tmp, ['ATTIO_API_KEY=', 'MANYCHAT_API_KEY=', 'SLACK_BOT_TOKEN=', 'BEEHIIV_API_KEY=', 'BEEHIIV_PUBLICATION_ID=', 'STRIPE_SECRET_KEY=', 'MIOSA_API_KEY='].join('\n') + '\n');
    process.env.GLADOS_ENV_LOCAL = tmp;
    for (const k of ['ATTIO_API_KEY', 'MANYCHAT_API_KEY', 'SLACK_BOT_TOKEN', 'BEEHIIV_API_KEY', 'BEEHIIV_PUBLICATION_ID', 'STRIPE_SECRET_KEY', 'MIOSA_API_KEY']) {
      vi.stubEnv(k, `real-${k.toLowerCase()}`);
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (prevOverride === undefined) delete process.env.GLADOS_ENV_LOCAL;
    else process.env.GLADOS_ENV_LOCAL = prevOverride;
    try { fs.unlinkSync(tmp); } catch {}
  });

  test('Attio and ManyChat keys (which also read ~/.config/mcp.json) resolve to unset', () => {
    expect(resolveAttioKey()).toBeUndefined();
    expect(resolveManychatKey()).toBeUndefined();
  });

  test('runtimeEnv carries the blanks, so env-record connectors see no key', async () => {
    const env = runtimeEnv();
    expect(env.SLACK_BOT_TOKEN).toBe('');
    expect(env.STRIPE_SECRET_KEY).toBe('');
    expect((await slackStatus()).state).toBe('not_configured');
  });

  test('a default-env read makes no outbound call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await beehiivSubscribers()).toBeNull();
    expect((await attioClients()).state).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('the key board shows the masked keys as absent', () => {
    const byVar = new Map(listKeyStatuses().map((k) => [k.envVar, k]));
    expect(byVar.get('MIOSA_API_KEY')?.present).toBe(false);
  });

  test('unmasked (the key absent from .env.local) still resolves from process.env', () => {
    fs.writeFileSync(tmp, '');
    expect(resolveAttioKey()).toBe('real-attio_api_key');
    expect(runtimeEnv().SLACK_BOT_TOKEN).toBe('real-slack_bot_token');
  });
});
