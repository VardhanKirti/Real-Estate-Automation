import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderWithRouter } from './helpers/render-client';
import { invalidateModeCache } from '@/lib/paths';
import { getDb } from '@/lib/data';

/**
 * /chats (founderos-ui pages/chats.md): the server view model both trees read,
 * the page checks C-1 to C-5 that can be held without a browser, the README
 * states (blank, sample, filming, not configured) and the style rules (tokens
 * only, no emojis, G_READY with its files).
 */

let dir = '';
beforeAll(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'glados-chats-'));
  process.env.GLADOS_DB = path.join(root, 'test.db');
});
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'glados-chats-env-'));
  vi.stubEnv('GLADOS_ENV_LOCAL', path.join(dir, '.env.local'));
  vi.stubEnv('GLADOS_MODE_FILE', path.join(dir, '.glados-mode'));
  vi.stubEnv('WIZARD_DATA_DIR', path.join(dir, 'wizard'));
  vi.stubEnv('DEMO_MODE', '0');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  vi.stubEnv('LLM_PROVIDER', '');
  invalidateModeCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  invalidateModeCache();
});

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const URL_BLANK = 'http://localhost/chats';
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

describe('view model (lib/chats-view.ts)', () => {
  test('blank install: Wizard pinned alone, roster offered, no key so the composer is off with a Set up link (C-1)', async () => {
    const { buildChatsView } = await import('@/lib/chats-view');
    const v = await buildChatsView(getDb(), URL_BLANK);
    expect(v.mode).toBe('live');
    expect(v.sample).toBe(false);
    expect(v.threads.map((t) => t.agentId)).toEqual(['conductor']);
    expect(v.threads[0]).toMatchObject({ name: 'Wizard', role: 'Your conductor', pinned: true, lastMessage: null });
    expect(v.roster.length).toBeGreaterThan(0);
    expect(v.roster.some((r) => r.id === 'conductor')).toBe(false);
    expect(v.model.state).toBe('not_configured');
    expect(v.model.setupHref).toMatch(/^\/integrations/);
    expect(v.composer).toEqual({ enabled: false, reason: 'not_configured' });
    expect(v.selected).toBe('conductor');
    expect(v.open).toMatchObject({ agentId: 'conductor', source: 'wizard', messages: [] });
  });

  test('sample on a blank install: badged fixture threads, composer off as a preview', async () => {
    const { buildChatsView } = await import('@/lib/chats-view');
    const v = await buildChatsView(getDb(), `${URL_BLANK}?sample=1`);
    expect(v.mode).toBe('sample');
    expect(v.sample).toBe(true);
    expect(v.composer).toEqual({ enabled: false, reason: 'sample' });
    expect(v.threads[0].agentId).toBe('conductor');
    expect(v.threads.length).toBeGreaterThan(1);
    expect(v.open?.messages.length).toBeGreaterThan(0);
  });

  test('Filming: Sample badge on, composer off, no request leaves the box', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    vi.stubEnv('LLM_PROVIDER', 'stub'); // even with a working model the preview never sends
    invalidateModeCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { buildChatsView } = await import('@/lib/chats-view');
    const v = await buildChatsView(getDb(), URL_BLANK);
    expect(v.mode).toBe('filming');
    expect(v.sample).toBe(true);
    expect(v.composer.enabled).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('C-2: the Wizard row is always first, then threads newest message first; ?agent= opens that thread', async () => {
    const db = getDb();
    db.agentMessages.insert({ id: 'c2-a', agentId: 'comms-agent', role: 'user', content: 'older', toolCalls: [], createdAt: ago(90) });
    db.agentMessages.insert({ id: 'c2-b', agentId: 'daily-briefing', role: 'user', content: 'newer', toolCalls: [], createdAt: ago(5) });
    const { buildChatsView } = await import('@/lib/chats-view');
    const v = await buildChatsView(db, URL_BLANK, { agent: 'comms-agent' });
    expect(v.threads.slice(0, 3).map((t) => t.agentId)).toEqual(['conductor', 'daily-briefing', 'comms-agent']);
    expect(v.roster.some((r) => r.id === 'comms-agent')).toBe(false);
    expect(v.selected).toBe('comms-agent');
    expect(v.open?.messages.map((m) => m.id)).toEqual(['c2-a']);
    // an unknown ?agent= falls back to the Wizard rather than a broken thread
    expect((await buildChatsView(db, URL_BLANK, { agent: 'nope' })).selected).toBe('conductor');
  });

  test('the Wizard row reads the latest Wizard project', async () => {
    const { createProject, appendMessages } = await import('@/lib/wizard/store');
    const p = createProject({ name: 'Launch plan' });
    appendMessages(p.id, [
      { role: 'user', text: 'Plan the launch', at: ago(3) },
      { role: 'wizard', text: 'Three steps, two owners.', at: ago(2) },
    ]);
    const { buildChatsView, buildThread } = await import('@/lib/chats-view');
    const v = await buildChatsView(getDb(), URL_BLANK);
    expect(v.threads[0]).toMatchObject({ agentId: 'conductor', lastMessage: 'Three steps, two owners.', messageCount: 2 });
    const t = buildThread(getDb(), 'conductor', URL_BLANK);
    expect(t?.projectName).toBe('Launch plan');
    expect(t?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  test('C-3: a send through the shared route writes one agent_messages row per turn and lands in the rail', async () => {
    vi.stubEnv('LLM_PROVIDER', 'stub');
    const db = getDb();
    const before = db.agentMessages.byAgent('crm-pulse').length;
    const { POST } = await import('@/app/api/agents/[id]/chat/route');
    const res = await POST(new Request('http://localhost/api/agents/crm-pulse/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Pipeline today?' }) }), { params: { id: 'crm-pulse' } });
    expect(res.status).toBe(200);
    const rows = db.agentMessages.byAgent('crm-pulse');
    expect(rows.length - before).toBe(2); // the operator's turn and the agent's turn
    expect(rows.map((r) => r.role).slice(-2)).toEqual(['user', 'assistant']);
    const { buildChatsView } = await import('@/lib/chats-view');
    const v = await buildChatsView(db, URL_BLANK);
    expect(v.threads[1].agentId).toBe('crm-pulse');
    expect(v.composer).toEqual({ enabled: true, reason: null });
  });

  test('GET /api/chats and /api/chats/[agentId] answer from the same builders', async () => {
    const rail = await (await (await import('@/app/api/chats/route')).GET(new Request(URL_BLANK))).json();
    expect(rail.threads[0]).toMatchObject({ agentId: 'conductor', pinned: true });
    expect(rail.composer).toMatchObject({ enabled: false });
    const { GET } = await import('@/app/api/chats/[agentId]/route');
    const body = await (await GET(new Request('http://localhost/api/chats/conductor'), { params: { agentId: 'conductor' } })).json();
    expect(body.agent).toMatchObject({ id: 'conductor', name: 'Wizard', source: 'wizard' });
    expect((await GET(new Request('http://localhost/api/chats/nope'), { params: { agentId: 'nope' } })).status).toBe(404);
  });
});

describe('trees render every state', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterEach(() => quiet.mockClear());

  test('GladOS tree: header copy, kit only, Not configured with Set up, Sample badge only in a preview', async () => {
    const { buildChatsView } = await import('@/lib/chats-view');
    const { ChatsG } = await import('@/components/chats/ChatsG');
    const blank = renderWithRouter(createElement(ChatsG, { view: await buildChatsView(getDb(), URL_BLANK), initialView: 'rail' }));
    expect(blank).toContain('Chats');
    expect(blank).toContain('Every conversation with your agents');
    expect(blank).toContain('Conversations');
    expect(blank).toContain('Not configured');
    expect(blank).toContain('Agent chat needs a model key.');
    expect(blank).toMatch(/href="\/integrations[^"]*"><span[^>]*>Set up/);
    expect(blank).not.toContain('data-sample-badge');
    expect(blank).toContain('Message Wizard…');
    // this file's database has threads by now, so the preview here is Filming (Sample needs a blank install)
    vi.stubEnv('DEMO_MODE', '1');
    invalidateModeCache();
    const sample = renderWithRouter(createElement(ChatsG, { view: await buildChatsView(getDb(), URL_BLANK), initialView: 'rail' }));
    expect(sample).toContain('data-sample-badge');
    expect(sample).toContain('Sending is off in this preview');
  });

  test('Classic tree: PageHeader, bordered shell, Enter and Shift+Enter hint only when sending is possible', async () => {
    const { buildChatsView } = await import('@/lib/chats-view');
    const { ChatsClassic } = await import('@/components/chats/ChatsClassic');
    const blank = renderWithRouter(createElement(ChatsClassic, { view: await buildChatsView(getDb(), URL_BLANK), initialView: 'rail' }));
    expect(blank).toContain('Every conversation with your agents');
    expect(blank).toContain('border-os-border');
    expect(blank).toContain('Not configured');
    expect(blank).not.toContain('Shift+Enter');
    vi.stubEnv('LLM_PROVIDER', 'stub');
    const live = renderWithRouter(createElement(ChatsClassic, { view: await buildChatsView(getDb(), URL_BLANK, { agent: 'daily-briefing' }), initialView: 'thread' }));
    expect(live).toContain('Enter sends · Shift+Enter for a new line');
    expect(live).toContain('Direct line: Daily Briefing can read your data here, not change it.');
  });

  test('the page forks on the appearance and renders', async () => {
    const Page = (await import('@/app/chats/page')).default;
    await expect(Page({ searchParams: {} })).resolves.toBeTruthy();
    await expect(Page({ searchParams: { sample: '1', agent: 'daily-briefing' } })).resolves.toBeTruthy();
  });
});

describe('contract', () => {
  test('nav: Chats sits in Workforce right after Agents', async () => {
    const { NAV_ORDER, groupOf, NAV_ITEMS } = await import('@/lib/nav');
    expect(NAV_ORDER.indexOf('/chats')).toBe(NAV_ORDER.indexOf('/agents') + 1);
    expect(groupOf('/chats')?.id).toBe('workforce');
    expect(NAV_ITEMS.find((i) => i.href === '/chats')?.label).toBe('Chats');
  });

  test('G_READY lists /chats with files that exist', async () => {
    const { G_READY, G_TREE_FILES } = await import('@/lib/g-ready');
    expect(G_READY).toContain('/chats');
    for (const f of G_TREE_FILES['/chats']) expect(existsSync(path.join(process.cwd(), f)), f).toBe(true);
  });

  test('C-4: the rail collapse is the page’s own key and never the app sidebar', async () => {
    const { RAIL_KEY } = await import('@/components/chats/useChats');
    expect(RAIL_KEY).toBe('glados-chats-rail');
    for (const f of ['components/chats/useChats.ts', 'components/chats/ChatsG.tsx', 'components/chats/ChatsClassic.tsx', 'app/chats/page.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/sidebar-w|lib\/sidebar|glados-sidebar/);
    }
    const css = read('app/globals.css');
    const block = css.slice(css.indexOf('/* ── fo/chats'));
    expect(block).not.toMatch(/--sidebar-w\s*:/);
  });

  test('tokens only and no emojis in the /chats trees and their CSS block', () => {
    const css = read('app/globals.css');
    const block = css.slice(css.indexOf('/* ── fo/chats'));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(\s*\d/);
    for (const f of ['components/chats/ChatsG.tsx', 'components/chats/ChatsClassic.tsx', 'components/chats/useChats.ts', 'lib/chats-view.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(src, f).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
