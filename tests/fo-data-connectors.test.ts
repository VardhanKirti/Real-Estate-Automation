import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { robinhoodStatus } from '@/lib/connectors/robinhood';
import { phantomStatus, readPhantom, resetPhantomCache, solFromLamports } from '@/lib/connectors/phantom';
import { plaudStatus } from '@/lib/connectors/plaud';
import { fathomStatus, parseFathomMeetings, pullFathomMeetings, resetFathomCache } from '@/lib/connectors/fathom';
import { branchFor, draftPromptFor, launchSupersetDraft, supersetStatus } from '@/lib/connectors/superset';
import { createTrakyoLink, trakyoLinkWorkspace, validateTrakyoContent, validateTrakyoLink } from '@/lib/connectors/trakyo';
import { INTEGRATIONS, connectKeysFor, setupHrefFor } from '@/lib/integrations-catalog';
import type { TradingAccountSnapshot } from '@/lib/schemas';

/** SPEC §2.4: the six FounderOS-merge connectors, honest states, Set up links (AC-11, I-1). */

beforeEach(() => {
  vi.stubEnv('GLADOS_ENV_LOCAL', path.join(mkdtempSync(path.join(tmpdir(), 'glados-conn-')), '.env.local'));
  resetPhantomCache();
  resetFathomCache();
});
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date('2026-10-13T12:00:00.000Z');
const snap = (capturedAt: string): TradingAccountSnapshot => ({
  capturedAt, accountId: 'agentic', accountLabel: 'Agentic', accountValueUsd: 1000, buyingPowerUsd: 400, cashUsd: 400, dayPnlUsd: 0, totalPnlUsd: 0, source: 'x',
});
const fetchOf = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => vi.fn(fn) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('catalogue and setup links (I-1, AC-11)', () => {
  test('each new connector has a catalogue entry, a setupHrefFor deep link, and its env key', () => {
    const want: Record<string, { slug: string; keys: string[] }> = {
      robinhood: { slug: 'robinhood', keys: ['TRADING_PUSH_TOKEN'] },
      phantom: { slug: 'phantom', keys: ['PHANTOM_WALLET_ADDRESS'] },
      plaud: { slug: 'plaud', keys: ['PLAUD_INGEST_TOKEN'] },
      fathom: { slug: 'fathom', keys: ['FATHOM_API_KEY'] },
      superset: { slug: 'superset', keys: ['SUPERSET_API_KEY'] },
      trakyo: { slug: 'trakyo', keys: ['TRAKYO_API_KEY'] },
    };
    for (const [id, w] of Object.entries(want)) {
      const entry = INTEGRATIONS.find((i) => i.connectorId === id);
      expect(entry, id).toBeTruthy();
      expect(setupHrefFor(id)).toBe(`/integrations#${w.slug}`);
      expect(connectKeysFor(entry!)).toEqual(w.keys);
    }
  });

  test('every new env key is documented in .env.example', () => {
    const example = readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
    for (const k of ['PHANTOM_WALLET_ADDRESS', 'SOLANA_RPC_URL', 'TRADING_PUSH_TOKEN', 'USAGE_PUSH_TOKEN', 'PLAUD_INGEST_TOKEN', 'FATHOM_API_KEY', 'SUPERSET_API_KEY', 'GLADOS_WRITES', 'GLADOS_CRON']) {
      expect(example, k).toMatch(new RegExp(`^#?\\s*${k}=`, 'm'));
    }
    expect(example).not.toMatch(/status-only until Trakyo ships an API/);
  });

  test('the connections board checks all six', () => {
    const index = readFileSync(path.join(process.cwd(), 'lib/connectors/index.ts'), 'utf8');
    for (const id of ['robinhood', 'phantom', 'plaud', 'fathom', 'superset', 'trakyo']) expect(index).toContain(`['${id}'`);
  });
});

describe('robinhood: feed freshness, no key', () => {
  test('not_configured with no snapshot; connected under 24 h; error naming the age after', () => {
    expect(robinhoodStatus([], NOW).state).toBe('not_configured');
    expect(robinhoodStatus([snap('2026-10-13T11:30:00.000Z')], NOW).state).toBe('connected');
    const stale = robinhoodStatus([snap('2026-10-12T11:00:00.000Z')], NOW); // 25 h (T-3)
    expect(stale.state).toBe('error');
    expect(stale.detail).toMatch(/^Feed 25 hours old/);
    expect(robinhoodStatus([snap('2026-10-11T08:00:00.000Z')], NOW).detail).toMatch(/^Feed 2 days old/);
  });

  test('T-6: nothing in lib/ calls a broker write endpoint', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = path.join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), 'lib'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/robinhood\.com\/[^'"`\s]*orders|api\.robinhood\.com/i);
    }
  });
});

describe('phantom: a public address, a free cached read', () => {
  const ADDRESS = 'So11111111111111111111111111111111111111112';

  test('no address: not_configured and no request', async () => {
    const f = fetchOf(() => new Response('{}'));
    expect(await readPhantom(null, { fetchFn: f })).toEqual({ balance: null, error: null });
    expect(phantomStatus({ balance: null, error: null }, null).state).toBe('not_configured');
    expect(f).not.toHaveBeenCalled();
  });

  test('balance plus price; cached for 60 s; a price outage nulls only the USD value', async () => {
    const f = fetchOf((url) =>
      String(url).includes('coingecko') ? new Response('nope', { status: 503 }) : new Response(JSON.stringify({ result: { value: 1_500_000_000 } })),
    );
    const r = await readPhantom(ADDRESS, { fetchFn: f, now: 1_000 });
    expect(r.balance).toMatchObject({ sol: 1.5, usdValue: null });
    await readPhantom(ADDRESS, { fetchFn: f, now: 30_000 });
    expect(f).toHaveBeenCalledTimes(2); // RPC + price once, then the cache
    expect(phantomStatus(r, ADDRESS).state).toBe('connected');
    expect(solFromLamports(2_000_000_000)).toBe(2);
  });

  test('a dead RPC is an error, not connected; a non-address is an error', async () => {
    const r = await readPhantom(ADDRESS, { fetchFn: fetchOf(() => new Response('', { status: 500 })), now: 5 });
    expect(phantomStatus(r, ADDRESS)).toMatchObject({ state: 'error' });
    expect(phantomStatus({ balance: null, error: null }, 'not-an-address').state).toBe('error');
  });
});

describe('plaud: ingest token', () => {
  test('no token is not_configured; a token is ready with an honest count', () => {
    expect(plaudStatus(false, []).state).toBe('not_configured');
    expect(plaudStatus(true, [])).toMatchObject({ state: 'connected', detail: expect.stringMatching(/no recordings received yet/) });
    expect(plaudStatus(true, [{ startedAt: '2026-10-12T10:00:00Z' }]).detail).toMatch(/1 recording received/);
  });
});

describe('fathom: free read, 10 minute cache', () => {
  const body = {
    items: [
      { recording_id: 42, meeting_title: 'Weekly sync', recording_start_time: '2026-10-13T09:00:00Z', recording_end_time: '2026-10-13T09:30:00Z', calendar_invitees: [{ name: 'A' }, { email: 'b@example.com' }], share_url: 'https://fathom.video/share/x', default_summary: { markdown_formatted: 'Summary' } },
      { meeting_title: 'No id and no time' },
    ],
  };

  test('parse maps meetings and skips rows without an id or a time', () => {
    expect(parseFathomMeetings(body)).toEqual([
      { externalId: '42', title: 'Weekly sync', startedAt: '2026-10-13T09:00:00Z', durationS: 1800, participants: ['A', 'b@example.com'], summary: 'Summary', transcriptUrl: 'https://fathom.video/share/x' },
    ]);
    expect(parseFathomMeetings({ nope: true })).toEqual([]);
  });

  test('no key: not_configured, no request; key: one request per 10 minutes', async () => {
    const f = fetchOf(() => new Response(JSON.stringify(body)));
    expect((await fathomStatus(f)).state).toBe('not_configured');
    expect(f).not.toHaveBeenCalled();
    vi.stubEnv('FATHOM_API_KEY', 'fk');
    await pullFathomMeetings({ fetchFn: f, now: 0 });
    await pullFathomMeetings({ fetchFn: f, now: 9 * 60_000 });
    expect(f).toHaveBeenCalledTimes(1);
    await pullFathomMeetings({ fetchFn: f, now: 11 * 60_000 });
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[0][1] as RequestInit).headers).toEqual({ 'X-Api-Key': 'fk' });
  });

  test('a rejected key is an error', async () => {
    vi.stubEnv('FATHOM_API_KEY', 'bad');
    expect((await fathomStatus(fetchOf(() => new Response('', { status: 401 })))).state).toBe('error');
  });
});

describe('superset: CLI launch, never run by the status check', () => {
  test('status: no key, key without CLI, key with CLI', () => {
    expect(supersetStatus({ key: undefined }).state).toBe('not_configured');
    expect(supersetStatus({ key: 'k', cliFound: false }).state).toBe('error');
    expect(supersetStatus({ key: 'k', cliFound: true }).state).toBe('connected');
  });

  test('launch passes the key to the CLI env and the draft-only rules in the prompt', async () => {
    vi.stubEnv('SUPERSET_API_KEY', 'sk');
    const exec = vi.fn(async () => ({ stdout: JSON.stringify({ workspace: { id: 'ws_1' } }), stderr: '', code: 0 }));
    const out = await launchSupersetDraft({ clientName: 'Northwind Studio', brief: 'Three hooks', projectId: 'p1' }, { exec, now: NOW });
    expect(out).toEqual({ workspaceId: 'ws_1', branch: 'client/northwind-studio-202610131200' });
    const [, args, env] = exec.mock.calls[0] as unknown as [string, string[], Record<string, string>];
    expect(args.slice(0, 5)).toEqual(['workspaces', 'create', '--local', '--project', 'p1']);
    expect(env.SUPERSET_API_KEY).toBe('sk');
    expect(draftPromptFor({ clientName: 'X', brief: 'b' }, 'br')).toMatch(/Draft only\. Do not publish, send/);
    expect(branchFor('***')).toMatch(/^client\/client-/);
  });

  test('a CLI failure surfaces its own message, never a fake success', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: 'not logged in', code: 1 }));
    await expect(launchSupersetDraft({ clientName: 'X', brief: 'b', projectId: 'p' }, { exec })).rejects.toThrow(/not logged in/);
    await expect(launchSupersetDraft({ clientName: 'X', brief: ' ', projectId: 'p' }, { exec })).rejects.toThrow(/empty/);
  });
});

describe('trakyo: link studio', () => {
  test('validation runs before anything is sent', () => {
    expect(() => validateTrakyoLink({ url: 'ftp://x', contentItemId: 'ci_1' })).toThrow(/url/);
    expect(() => validateTrakyoLink({ url: 'https://example.com', contentItemId: 'nope' })).toThrow(/contentItemId/);
    expect(() => validateTrakyoLink({ url: 'https://example.com', contentItemId: 'ci_1', slug: 'bad slug' })).toThrow(/slug/);
    expect(validateTrakyoLink({ url: 'https://example.com', contentItemId: 'ci_1' }).appendTrackingParam).toBe(true);
    expect(() => validateTrakyoContent({ source: 'youtube', name: 'x' })).toThrow(/custom source/);
    expect(() => validateTrakyoContent({ source: 'Instagram', name: 'x', url: 'https://user:pw@example.com' })).toThrow(/url/);
  });

  test('no key: workspace not_configured with no request', async () => {
    vi.stubEnv('TRAKYO_API_KEY', '');
    const f = fetchOf(() => new Response('{}'));
    expect((await trakyoLinkWorkspace(f)).state).toBe('not_configured');
    expect(f).not.toHaveBeenCalled();
  });

  test('a key without links:read is partial and says which scope', async () => {
    vi.stubEnv('TRAKYO_API_KEY', 'tky_x');
    const ws = await trakyoLinkWorkspace(fetchOf(() => new Response(JSON.stringify({ scopes: ['metrics:read'] }))));
    expect(ws).toMatchObject({ state: 'partial', messages: [expect.stringMatching(/links:read/)] });
  });

  test('create link posts the documented body; a 403 names the missing scope; a 5xx is uncertain', async () => {
    vi.stubEnv('TRAKYO_API_KEY', 'tky_x');
    let sent: unknown = null;
    const ok = fetchOf((_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ key: 'k', url: 'https://example.com', short_link: 'https://trk.example/k', domain_id: '00000000-0000-4000-8000-000000000000', content_item_id: 'ci_1', clicks: 0 }));
    });
    const link = await createTrakyoLink({ url: 'https://example.com', contentItemId: 'ci_1', slug: 'spring' }, ok);
    expect(link.shortLink).toBe('https://trk.example/k');
    expect(sent).toEqual({ url: 'https://example.com', content_item_id: 'ci_1', slug: 'spring', append_tracking_param: true });
    await expect(createTrakyoLink({ url: 'https://example.com', contentItemId: 'ci_1' }, fetchOf(() => new Response('', { status: 403 })))).rejects.toThrow(/links:write/);
    await expect(createTrakyoLink({ url: 'https://example.com', contentItemId: 'ci_1' }, fetchOf(() => new Response('', { status: 503 })))).rejects.toMatchObject({ uncertain: true });
  });
});
