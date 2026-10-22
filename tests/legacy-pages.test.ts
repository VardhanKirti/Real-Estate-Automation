import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderWithRouter } from './helpers/render-client';
import { L_NO_SLAB, L_READY } from '@/lib/l-ready';
import { treeFor } from '@/lib/appearance';
import { invalidateModeCache } from '@/lib/paths';
import { getDb } from '@/lib/data';
import { sampleClients, sampleLeadMagnets, sampleTrading } from '@/lib/fo-sample';
import { buildView, type TradingPayload } from '@/lib/trading-view';
import { tradingModel } from '@/lib/trading-model';
import { buildClientsView } from '@/lib/clients-view';
import type { ClientsPayload } from '@/lib/clients-data';
import { buildLeadMagnetsPage } from '@/lib/lead-magnets';
import { resetUsageCache } from '@/lib/usage';
import { buildUsagePayload } from '@/lib/usage-payload';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { TradingLegacy, TradingLegacyError } from '@/components/trading/TradingLegacy';
import { UsageLegacy } from '@/components/usage/UsageLegacy';
import { ClientsLegacy } from '@/components/clients/ClientsLegacy';
import { LeadMagnetsLegacy } from '@/components/lead-magnets/LeadMagnetsLegacy';
import { ChatsLegacy } from '@/components/chats/ChatsLegacy';

/**
 * Bennett Legacy trees for the five FounderOS pages (founderos-ui pages/*.md
 * §8, SPEC §2.5 O1, AC-6; lane fo/l-new). Every state of every tree renders
 * from the shared view model, carries data-l, has no GladOS kit class (g-*)
 * or data-g, and shows Not configured + Set up or the SAMPLE chip honestly.
 */

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const render = (el: ReactElement) => renderWithRouter(el);
const NOW = new Date('2026-10-12T15:00:00Z');

/** Every class token in the markup that belongs to the GladOS kit. */
function gClasses(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (/^g-[a-z0-9]/.test(c)) out.push(c);
  return out;
}

/** The Legacy house rules every rendered state meets. */
function legacyClean(html: string, root: string) {
  expect(html).toContain(`data-l="${root}"`);
  expect(gClasses(html)).toEqual([]);
  expect(html).not.toMatch(/data-g=/);
  expect(html).not.toMatch(/style="[^"]*#[0-9a-fA-F]{3,8}\b/);
}

beforeAll(() => {
  process.env.GLADOS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'glados-legacy-pages-')), 'test.db');
});

// ── /trading ─────────────────────────────────────────────────────────────
const status = (id: string, state: ConnectorStatus['state'], detail = ''): ConnectorStatus => ({ id, name: id, kind: 'payments', state, detail });
const setup = { robinhood: '/integrations#robinhood', phantom: '/integrations#phantom' };
const PUSH = '/api/trading/snapshot';

function blankTrading(): TradingPayload {
  return {
    accounts: [], history: {}, positions: [], activity: [], analysis: null, openOrders: [], limits: null,
    status: status('robinhood', 'not_configured'), phantomStatus: status('phantom', 'not_configured'), phantom: null,
    view: buildView({ accounts: [], positions: [], activity: [], phantom: null, now: NOW.getTime() }),
    mode: 'live', sample: false, at: NOW.toISOString(),
  };
}
function liveTrading(opts: { limits?: boolean } = {}): TradingPayload {
  const s = sampleTrading(NOW);
  return {
    ...s,
    limits: opts.limits === false ? null : s.limits,
    status: status('robinhood', 'connected'),
    phantomStatus: status('phantom', 'connected'),
    view: buildView({ accounts: s.accounts, positions: s.positions, activity: s.activity, phantom: s.phantom, now: NOW.getTime() }),
    mode: 'live', sample: false, at: NOW.toISOString(),
  };
}
const trading = (p: TradingPayload) => render(createElement(TradingLegacy, { model: tradingModel(p, { brandName: 'GladOS', now: NOW.getTime() }), pushPath: PUSH, setup }));

describe('/trading Legacy tree', () => {
  test('blank install: Not configured with both Set up links, the push URL, no numbers, no Sample chip', () => {
    const html = trading(blankTrading());
    legacyClean(html, 'TradingLegacy');
    expect(html).toContain('Not configured');
    expect(html).toContain('href="/integrations#robinhood"');
    expect(html).toContain('href="/integrations#phantom"');
    expect(html).toContain('Connect the Markets agent feed. Its first push fills this page.');
    expect(html).toContain(PUSH);
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain('data-sample-badge');
  });

  test('live: FO cards in FO order, the slab title, no Sample chip', () => {
    const html = trading(liveTrading());
    legacyClean(html, 'TradingLegacy');
    expect(html).toContain('// Markets · Robinhood + Phantom · agent-fed');
    const order = ['Agent · the sleeve', 'Accounts', 'Agent · reasoning', 'Positions', 'Agent · next move', 'Open orders', 'Trade log', 'Agent limits'].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const part of ['SlabTitle', 'SlabCard', 'BigStat', 'MeterStack', 'DotMatrix', 'InsightCard', 'ValueLine', 'Switch']) expect(html).toContain(`data-l="${part}"`);
    expect(html).toContain('SOFI');
    expect(html).not.toContain('data-sample-badge');
  });

  test('sample and filming: the SAMPLE chip and read-only limits', () => {
    const p = liveTrading();
    p.sample = true;
    p.mode = 'filming';
    const html = trading(p);
    legacyClean(html, 'TradingLegacy');
    expect(html).toContain('data-sample-badge');
    expect(html).toContain('Sample data: limits are read only here');
  });

  test('empty feed says so plainly in every card', () => {
    const p = liveTrading();
    Object.assign(p, { positions: [], activity: [], analysis: null, openOrders: [] });
    p.view = buildView({ accounts: p.accounts, positions: [], activity: [], phantom: p.phantom, now: NOW.getTime() });
    const html = trading(p);
    for (const t of ['No open positions.', 'No trades yet.', 'No analysis pushed yet.', 'No live orders at the broker.']) expect(html).toContain(t);
  });

  test('no limits saved keeps autopilot locked behind a reason', () => {
    const html = trading(liveTrading({ limits: false }));
    expect(html).toContain('No limits saved');
    expect(html).toContain('Save limits first');
  });

  test('store error: the page says so, with Retry', () => {
    const html = render(createElement(TradingLegacyError, { message: 'SQLITE_CANTOPEN' }));
    legacyClean(html, 'TradingLegacy');
    expect(html).toContain('The trading store is not reachable.');
    expect(html).toContain('Retry');
  });
});

// ── /usage ───────────────────────────────────────────────────────────────
describe('/usage Legacy tree', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetUsageCache();
  });
  const empty = () => {
    const root = mkdtempSync(path.join(tmpdir(), 'glados-legacy-usage-'));
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(root, 'none-claude'));
    vi.stubEnv('CODEX_SESSIONS_DIR', path.join(root, 'none-codex'));
    vi.stubEnv('OLLAMA_HOST', 'http://127.0.0.1:9');
    vi.stubEnv('DEMO_MODE', '0');
  };
  const usage = async (url: string, sample: boolean) => {
    const p = await buildUsagePayload({ url, now: NOW });
    return render(createElement(UsageLegacy, { initial: p, initialNow: NOW.getTime(), sample }));
  };

  test('blank install: Not configured with the Set up link and what was checked, never a zero', async () => {
    empty();
    const html = await usage('http://localhost/usage', false);
    legacyClean(html, 'UsageLegacy');
    expect(html).toContain('Not configured');
    expect(html).toMatch(/href="\/integrations[^"]*"/);
    expect(html).toContain('Sources checked');
    expect(html).toContain('/api/usage/push');
    expect(html).not.toContain('data-sample-badge');
  });

  test('sample: FO cards, the SAMPLE chip, an unreported plan says Not reported, no gauge without a provider', async () => {
    empty();
    const html = await usage('http://localhost/usage?sample=1', true);
    legacyClean(html, 'UsageLegacy');
    expect(html).toContain('// Token burn · one plan per provider');
    for (const t of ['Token Burn', 'Burn Volume', 'Burn by Model', 'Plan Limits', 'Top burner', 'Raw reading']) expect(html).toContain(t);
    for (const part of ['StepLine', 'MeterStack', 'InsightCard']) expect(html).toContain(`data-l="${part}"`);
    expect(html).toContain('data-sample-badge');
    expect(html).toContain('Not reported');
    expect(html).toContain('No provider reported an official gauge.');
  });

  test('demo mode: Usage is the sample, with the SAMPLE chip', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    const html = await usage('http://localhost/usage', false);
    legacyClean(html, 'UsageLegacy');
    expect(html).not.toContain('Usage is not available on this instance.');
    expect(html).toContain('data-sample-badge');
  });
});

// ── /clients ─────────────────────────────────────────────────────────────
const SETUP_CL = { attio: '/integrations#attio', superset: '/integrations#superset' };
function clientsPayload(over: Partial<ClientsPayload> = {}): ClientsPayload {
  return {
    roster: [], work: [], candidates: [], attio: { state: 'not_configured' },
    superset: { id: 'superset', name: 'Superset', kind: 'orchestration', state: 'not_configured', detail: 'Set SUPERSET_API_KEY' },
    writes: false, counts: { draft: 0, queued: 0, running: 0, done: 0, failed: 0 }, mode: 'live', sample: false, ...over,
  };
}
const clients = (p: ClientsPayload) => render(createElement(ClientsLegacy, { view: buildClientsView(p, { now: NOW }), setup: SETUP_CL }));

describe('/clients Legacy tree', () => {
  test('blank install: Attio and Superset Not configured with Set up links, New request blocked, no zero roster', () => {
    const html = clients(clientsPayload());
    legacyClean(html, 'ClientsLegacy');
    expect(html).toContain('Not configured');
    expect(html).toContain('Attio is not connected yet.');
    expect(html).toContain('href="/integrations#attio"');
    expect(html).toContain('href="/integrations#superset"');
    expect(html).toContain('Confirm or add a client first');
    expect(html).toContain('No work requests yet.');
    expect(html).not.toContain('data-sample-badge');
  });

  test('keyed, none confirmed: the empty line names Attio deals', () => {
    expect(clients(clientsPayload({ attio: { state: 'connected' } }))).toContain('Confirm a client from your Attio deals.');
  });

  test('sample: the SAMPLE chip, fixture rows, requests read only', () => {
    const s = sampleClients(NOW);
    const html = clients(clientsPayload({ ...s, mode: 'sample', sample: true, attio: { state: 'connected' } }));
    legacyClean(html, 'ClientsLegacy');
    expect(html).toContain('data-sample-badge');
    expect(html).toContain('Northwind Studio');
    expect(html).toContain('Sample data: add a client to write a real request');
  });

  test('populated: FO cards in FO order and no fee, term or revenue (CL-4)', () => {
    const s = sampleClients(NOW);
    const html = clients(clientsPayload({ ...s, attio: { state: 'connected' } }));
    legacyClean(html, 'ClientsLegacy');
    const order = ['Request Activity', 'Request Volume', 'Request Rhythm', 'Roster', 'Busiest day', 'New request', 'Work requests'].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const part of ['StepLine', 'MeterStack', 'DotMatrix', 'InsightCard']) expect(html).toContain(`data-l="${part}"`);
    expect(html).not.toMatch(/\$\d|retainer fee|contract term/i);
  });
});

// ── /lead-magnets ────────────────────────────────────────────────────────
describe('/lead-magnets Legacy tree', () => {
  const opts = { trakyoConfigured: false, trakyoSetupHref: '/integrations#trakyo', now: NOW };
  const liveRows = sampleLeadMagnets(NOW).map((m) => ({ ...m, id: m.id.replace('sample-', 'lm-') }));
  const lm = (rows: Parameters<typeof buildLeadMagnetsPage>[0], over: Partial<Parameters<typeof buildLeadMagnetsPage>[1]> = {}) =>
    render(createElement(LeadMagnetsLegacy, { page: buildLeadMagnetsPage(rows, { filter: null, mode: 'live', ...opts, ...over }) }));

  test('fresh install: the empty line, Register, Trakyo Set up, no Sample chip', () => {
    const html = lm([]);
    legacyClean(html, 'LeadMagnetsLegacy');
    expect(html).toContain('No lead magnets yet.');
    expect(html).toContain('Register the first page you send people to.');
    expect(html).toContain('0 pages · 0 live');
    expect(html).toContain('href="/integrations#trakyo"');
    expect(html).not.toContain('data-sample-badge');
  });

  test('sample: the SAMPLE chip and read-only rows', () => {
    const html = lm(sampleLeadMagnets(NOW), { mode: 'sample' });
    legacyClean(html, 'LeadMagnetsLegacy');
    expect(html).toContain('data-sample-badge');
    expect(html).toContain('Automation starter kit');
    expect(html).toContain('Sample data: register a real page to edit');
  });

  test('populated: FO cards, captures Not tracked never 0 (LM-3), the status select', () => {
    const html = lm(liveRows);
    legacyClean(html, 'LeadMagnetsLegacy');
    for (const t of ['// Content engine', 'Lead Magnets', 'Pages Shipped', 'Magnet Volume', 'Captures', 'Where Leads Land', 'All pages']) expect(html).toContain(t);
    expect(html).toContain('Not tracked');
    expect(html).not.toMatch(/>0 captures?</i);
    expect(html).toContain('aria-label="Status of Automation starter kit"');
    expect(html).not.toContain('← Content');
  });

  test('filtered empty offers Clear filter', () => {
    const html = lm(liveRows, { filter: 'archived' });
    expect(html).toContain('No archived pages.');
    expect(html).toContain('Clear filter');
  });
});

// ── /chats ───────────────────────────────────────────────────────────────
describe('/chats Legacy tree', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'glados-legacy-chats-'));
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
    invalidateModeCache();
  });
  const chats = async (url: string, agent: string | null = null) => {
    const { buildChatsView } = await import('@/lib/chats-view');
    return render(createElement(ChatsLegacy, { view: await buildChatsView(getDb(), url, { agent }), initialView: agent ? 'thread' : 'rail' }));
  };

  test('blank install: FO title outside a slab, the Wizard pinned, composer off with Not configured + Set up', async () => {
    const html = await chats('http://localhost/chats');
    legacyClean(html, 'ChatsLegacy');
    expect(html).toContain('// Every conversation');
    expect(html).toContain('data-l="ChatShell"');
    expect(html).toContain('Conversations');
    expect(html).toContain('pinned');
    expect(html).toContain('Not configured');
    expect(html).toMatch(/href="\/integrations[^"]*"/);
    expect(html).toContain('No direct chats yet.');
    expect(html).not.toContain('data-sample-badge');
    expect(html).not.toContain('Shift+Enter');
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });

  test('sample: the SAMPLE chip, fixture threads, sending off', async () => {
    const html = await chats('http://localhost/chats?sample=1');
    legacyClean(html, 'ChatsLegacy');
    expect(html).toContain('data-sample-badge');
    expect(html).toContain('Sending is off in this preview');
  });

  test('with a model: the Enter hint shows on a direct line', async () => {
    vi.stubEnv('LLM_PROVIDER', 'stub');
    const html = await chats('http://localhost/chats', 'daily-briefing');
    legacyClean(html, 'ChatsLegacy');
    expect(html).toContain('Shift+Enter');
    expect(html).toContain('direct line');
  });
});

// ── wiring and house rules ───────────────────────────────────────────────
const PAGES = [
  { route: '/trading', page: 'app/trading/page.tsx', tree: 'components/trading/TradingLegacy.tsx' },
  { route: '/usage', page: 'app/usage/page.tsx', tree: 'components/usage/UsageLegacy.tsx' },
  { route: '/clients', page: 'app/clients/page.tsx', tree: 'components/clients/ClientsLegacy.tsx' },
  { route: '/lead-magnets', page: 'app/lead-magnets/page.tsx', tree: 'components/lead-magnets/LeadMagnetsLegacy.tsx' },
  { route: '/chats', page: 'app/chats/page.tsx', tree: 'components/chats/ChatsLegacy.tsx' },
] as const;

describe('Legacy page trees: wiring and house rules', () => {
  test.each(PAGES)('$route is in L_READY and its page forks to the Legacy tree', ({ route, page, tree }) => {
    expect(L_READY).toContain(route);
    expect(treeFor({ ui: 'legacy' }, route)).toBe('legacy');
    const src = read(page);
    expect(src).toMatch(new RegExp(`treeFor\\(getAppearance\\(\\), '${route}'\\)`));
    expect(src).toMatch(/=== 'legacy'/);
    expect(src).toContain(path.basename(tree, '.tsx'));
  });

  test.each(PAGES)('$route Legacy tree: kit and tokens only, no data code, no colour literal, no emoji', ({ tree }) => {
    const src = read(tree);
    expect(src).toContain("from '@/components/legacy'");
    expect(src).not.toMatch(/@\/components\/g\b|@\/components\/g'|@\/components\/terminal|@\/components\/fo-classic|PageHeader/);
    expect(src).not.toMatch(/getDb|@\/lib\/data'/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/);
    expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(src).not.toMatch(/\bos-(text|muted|dim|border|surface|accent)/);
  });

  test('only /chats renders without the slab (FO draws Chats without one)', () => {
    expect(L_NO_SLAB).toContain('/chats');
    for (const r of ['/trading', '/usage', '/clients', '/lead-magnets']) expect(L_NO_SLAB).not.toContain(r);
  });

  test('the L1 CSS block is tokens only, l- prefixed and has a reduced-motion rule', () => {
    const css = read('app/globals.css');
    const block = css.slice(css.indexOf('/* ── L1 Legacy page trees'), css.indexOf('/* ── end L1 Legacy page trees ── */'));
    expect(block.length).toBeGreaterThan(1000);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/);
    expect(block).toMatch(/prefers-reduced-motion: reduce/);
    const selectors = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|[\s,{}(])\.([a-zA-Z][\w-]*)/g)].map((m) => m[2]);
    expect(selectors.filter((c) => !c.startsWith('l-') && !/^(px|pt|mx|mb|block|w-full)/.test(c))).toEqual([]);
  });
});
