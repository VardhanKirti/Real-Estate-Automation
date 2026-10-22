import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import fs, { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderWithRouter } from './helpers/render-client';

/**
 * FounderOS merge, fo/fixups: follow-ups reported by the earlier lanes.
 * Task deep links (?task=), the Agents department filter (?dept=), the comms
 * feed and Phantom reads behind the SWR cache, and the GladOS audit leftovers.
 */

let appearance = 'glados.ice.dark';
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: () => {
    const all = [{ name: 'glados-appearance', value: appearance }];
    return { get: (n: string) => all.find((c) => c.name === n), getAll: () => all, has: (n: string) => all.some((c) => c.name === n) };
  },
  headers: () => new Headers({ host: 'localhost:4561' }),
}));

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

beforeAll(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'glados-fo-fixups-'));
  process.env.GLADOS_DB = path.join(root, 'test.db');
  process.env.FUNNEL_PROVIDER = 'seed';
  process.env.BRAIN_PROVIDER = 'stub';
  process.env.GBRAIN_BIN = path.join(root, 'no-gbrain-cli');
  process.env.GBRAIN_STORE = path.join(root, 'brain-store');
  fs.mkdirSync(process.env.GBRAIN_STORE, { recursive: true });
});
beforeEach(() => {
  appearance = 'glados.ice.dark';
});
afterEach(() => {
  vi.restoreAllMocks();
});

const TREES = [
  ['GladOS', 'glados.ice.dark'],
  ['Classic', 'classic.ice.dark'],
] as const;

async function seedTasks() {
  const { getDb } = await import('@/lib/data');
  const db = getDb();
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const base = { dueAt: null, horizon: null, runId: null, priority: 'normal' as const };
  for (const t of [
    { ...base, id: 'fx-blocked', agentId: null, ownerKind: 'me' as const, title: 'Approve the wire batch', detail: 'Two wires wait on your sign-off.', status: 'blocked' as const },
    { ...base, id: 'fx-open', agentId: null, ownerKind: 'me' as const, title: 'Another open task', detail: '', status: 'open' as const },
  ]) {
    if (!db.agentTasks.get(t.id)) db.agentTasks.insert({ ...t, createdAt: iso(7_200_000), updatedAt: iso(3_600_000) });
  }
}

async function renderTasks(cookie: string, searchParams: Record<string, string>): Promise<string> {
  appearance = cookie;
  const { default: TasksPage } = await import('@/app/tasks/page');
  return renderWithRouter(TasksPage({ searchParams }) as ReactElement);
}

// ── 1 + 8: /tasks?task=<id> opens the board on that task ─────────────────

describe('/tasks?task=<id> (Home Needs you, the composer)', () => {
  test('linkedTask: none, found, gone', async () => {
    const { linkedTask } = await import('@/lib/tasks-metrics');
    const tasks = [{ id: 'a' }, { id: 'b' }] as never[];
    expect(linkedTask(tasks, undefined)).toBeNull();
    expect(linkedTask(tasks, '  ')).toBeNull();
    expect(linkedTask(tasks, 'b')).toMatchObject({ id: 'b', task: { id: 'b' } });
    expect(linkedTask(tasks, ['a', 'b'])).toMatchObject({ id: 'a', task: { id: 'a' } });
    expect(linkedTask(tasks, 'zz')).toEqual({ id: 'zz', task: null });
  });

  test.each(TREES)('%s: the board opens with the linked task selected', async (_n, cookie) => {
    await seedTasks();
    const html = await renderTasks(cookie, { task: 'fx-blocked' });
    const at = html.indexOf('data-task-focus="fx-blocked"');
    expect(at).toBeGreaterThan(-1);
    const focus = html.slice(at, at + 2500);
    expect(focus).toContain('Approve the wire batch');
    expect(focus).toContain('Blocked');
    // the filter shows the one task, not the rest of the list
    if (cookie.startsWith('glados')) {
      expect(focus).toContain('data-selected="true"');
      expect(focus.slice(0, focus.indexOf('</ul>'))).not.toContain('Another open task');
    }
  }, 30_000);

  test.each(TREES)('%s: a link to a task that is gone says so', async (_n, cookie) => {
    const html = await renderTasks(cookie, { task: 'no-such-task' });
    expect(html).toContain('That task is no longer on the board.');
  }, 30_000);

  test.each(TREES)('%s: no ?task, no focus', async (_n, cookie) => {
    const html = await renderTasks(cookie, {});
    expect(html).not.toContain('data-task-focus');
  }, 30_000);

  test('every task link (Needs you, Done today, the composer API and its toast) uses taskHref', () => {
    expect(read('app/api/interject/route.ts')).toContain('href: taskHref(id)');
    expect(read('app/api/interject/route.ts')).not.toContain('`/tasks?task=');
    const i = read('components/home/Interject.tsx');
    expect(i).toMatch(/link: \{ label: 'Open', href: body\.href \?\? taskHref\(id\) \}/);
    expect(read('components/ui/Toast.tsx')).toContain('t.link.href');
  });
});

// ── 3: the WhatsApp chat list behind the SWR cache ──────────────────────

function fakeChatStorage(file: string, chats: Array<{ name: string; text: string; date: number; unread?: number }>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const db = new Database(file);
  db.exec('CREATE TABLE IF NOT EXISTS ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZPARTNERNAME TEXT, ZCONTACTJID TEXT, ZLASTMESSAGEDATE REAL, ZUNREADCOUNT INTEGER, ZARCHIVED INTEGER)');
  db.exec('CREATE TABLE IF NOT EXISTS ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZTEXT TEXT, ZMESSAGEDATE REAL)');
  for (const c of chats) {
    const { lastInsertRowid } = db.prepare('INSERT INTO ZWACHATSESSION (ZPARTNERNAME, ZCONTACTJID, ZLASTMESSAGEDATE, ZUNREADCOUNT, ZARCHIVED) VALUES (?, ?, ?, ?, 0)').run(c.name, `${c.name}@s.whatsapp.net`, c.date, c.unread ?? 0);
    db.prepare('INSERT INTO ZWAMESSAGE (ZCHATSESSION, ZTEXT, ZMESSAGEDATE) VALUES (?, ?, ?)').run(lastInsertRowid, c.text, c.date);
  }
  db.close();
}

describe('WhatsApp chat list: cached, warmed, honest', () => {
  test('a real read is cached (TTL.comms) and shared; invalidation reads again', async () => {
    vi.stubEnv('VITEST', 'false'); // lib/swr.ts is off under vitest unless asked
    try {
      const { recentChats, whatsappRecentKey } = await import('@/lib/connectors/whatsapp');
      const { invalidateSwr, lastSwr } = await import('@/lib/swr');
      const dir = mkdtempSync(path.join(tmpdir(), 'glados-wa-'));
      const file = path.join(dir, 'ChatStorage.sqlite');
      fakeChatStorage(file, [{ name: 'Ann', text: 'first', date: 800_000_000, unread: 2 }]);
      invalidateSwr('whatsapp:');
      const first = await recentChats(15, [file]);
      expect(first.map((c) => c.sender)).toEqual(['Ann']);
      expect(first[0]).toMatchObject({ source: 'whatsapp', preview: 'first', unread: 2 });
      expect(lastSwr(whatsappRecentKey(file))).toHaveLength(1);

      // a new chat lands in the database; within the fresh window the cached read answers
      fakeChatStorage(file, [{ name: 'Bo', text: 'second', date: 800_000_100 }]);
      expect((await recentChats(15, [file])).map((c) => c.sender)).toEqual(['Ann']);
      // each caller slices its own limit from the one read
      expect(await recentChats(0, [file])).toEqual([]);

      invalidateSwr('whatsapp:');
      expect((await recentChats(15, [file])).map((c) => c.sender)).toEqual(['Bo', 'Ann']);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);

  test('a failed read is never cached; no database stores nothing', async () => {
    vi.stubEnv('VITEST', 'false');
    try {
      const { recentChats, whatsappRecentKey } = await import('@/lib/connectors/whatsapp');
      const { lastSwr } = await import('@/lib/swr');
      const dir = mkdtempSync(path.join(tmpdir(), 'glados-wa-bad-'));
      const bad = path.join(dir, 'ChatStorage.sqlite');
      fs.writeFileSync(bad, 'not a database');
      expect(await recentChats(15, [bad])).toEqual([]);
      expect(lastSwr(whatsappRecentKey(bad))).toBeUndefined();
      expect(await recentChats(15, [path.join(dir, 'missing.sqlite')])).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);

  test('the feed reads WhatsApp through recentChats, and boot warms it (not on filming)', async () => {
    expect(read('lib/comms-feed.ts')).toContain('recentChats(per)');
    expect(read('lib/connectors/whatsapp.ts')).toMatch(/swr\(whatsappRecentKey\(dbPath\), TTL\.comms/);
    const { warmTasks } = await import('@/lib/warm');
    vi.stubEnv('DEMO_MODE', '0');
    expect(warmTasks().map((t) => t.name)).toContain('whatsapp-chats');
    vi.unstubAllEnvs();
  });
});

// ── 4: the Phantom balance behind the SWR cache ───────────────────────────

describe('Phantom balance: SWR cache, budget, warm-up', () => {
  const ADDRESS = 'So11111111111111111111111111111111111111112';
  const ok = (lamports: number) =>
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('coingecko') ? new Response(JSON.stringify({ solana: { usd: 100 } })) : new Response(JSON.stringify({ result: { value: lamports } })),
    ) as unknown as typeof fetch;
  const age = (key: string, ms: number) => {
    const e = (globalThis as unknown as { __gladosSwr: Map<string, { at: number }> }).__gladosSwr.get(key)!;
    e.at -= ms;
  };

  test('fresh (60 s): served with no call; stale: served at once while one refresh runs', async () => {
    const { readPhantom, resetPhantomCache, phantomKey } = await import('@/lib/connectors/phantom');
    const { TTL } = await import('@/lib/swr');
    expect(TTL.wallet.freshMs).toBe(60_000);
    resetPhantomCache();
    const f1 = ok(1_000_000_000);
    expect((await readPhantom(ADDRESS, { fetchFn: f1 })).balance).toMatchObject({ sol: 1, usdValue: 100 });
    expect(await readPhantom(ADDRESS, { fetchFn: f1 })).toMatchObject({ balance: { sol: 1 } });
    expect(f1).toHaveBeenCalledTimes(2); // RPC + price, once

    age(phantomKey(ADDRESS), 2 * 60_000);
    const f2 = ok(3_000_000_000);
    const t0 = Date.now();
    expect((await readPhantom(ADDRESS, { fetchFn: f2 })).balance?.sol).toBe(1); // the last real reading, now
    expect(Date.now() - t0).toBeLessThan(200);
    await new Promise((r) => setTimeout(r, 20));
    expect((await readPhantom(ADDRESS, { fetchFn: f2 })).balance?.sol).toBe(3); // the refresh landed
  });

  test('an expired reading waits at most the budget for a hung RPC, then shows the last real one', async () => {
    const { readPhantom, resetPhantomCache, phantomKey, PHANTOM_BUDGET_MS } = await import('@/lib/connectors/phantom');
    resetPhantomCache();
    await readPhantom(ADDRESS, { fetchFn: ok(2_000_000_000) });
    age(phantomKey(ADDRESS), 60 * 60_000);
    const hung = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await readPhantom(ADDRESS, { fetchFn: hung });
    const waited = Date.now() - t0;
    expect(r.balance?.sol).toBe(2);
    expect(waited).toBeGreaterThanOrEqual(PHANTOM_BUDGET_MS - 50);
    expect(waited).toBeLessThan(PHANTOM_BUDGET_MS + 1000);
  });

  test('no address: no call, nothing cached; boot warms a configured wallet only', async () => {
    const { readPhantom } = await import('@/lib/connectors/phantom');
    const f = ok(1);
    expect(await readPhantom(null, { fetchFn: f })).toEqual({ balance: null, error: null });
    expect(f).not.toHaveBeenCalled();
    const { warmTasks } = await import('@/lib/warm');
    vi.stubEnv('DEMO_MODE', '0');
    vi.stubEnv('PHANTOM_WALLET_ADDRESS', '');
    expect(warmTasks().map((t) => t.name)).not.toContain('phantom');
    vi.stubEnv('PHANTOM_WALLET_ADDRESS', ADDRESS);
    expect(warmTasks().map((t) => t.name)).toContain('phantom');
    vi.unstubAllEnvs();
  });
});

// ── 5: hero text stays out of the gradient's light foot ───────────────────

describe('GladOS hero contrast without a strip', () => {
  test('a hero with a status and no strip keeps the strip clearance (g-audit hero-contrast on / and /social)', () => {
    const css = read('app/globals.css');
    const strip = css.match(/\.g-hero:has\(\.g-hero-strip\) \{ padding-bottom: (\d+)px; \}/);
    const bare = css.match(/\.g-hero:not\(:has\(\.g-hero-strip\)\):has\(\.g-hero-status\) \{ padding-bottom: (\d+)px; \}/);
    expect(strip?.[1]).toBeDefined();
    expect(bare?.[1]).toBe(strip?.[1]);
    // the radial glow sits at 108% with a 36% radius: the foot of every hero gradient is light
    expect(css).toMatch(/--g-hero-a: radial-gradient\(85% 36% at \d+% 108%/);
  });
});

// ── 6 + 7: no sideways scroll at 390 (/funnel, /inbox under mobile emulation) ─

describe('390 overflow', () => {
  test('/funnel: the source tag wraps inside its column instead of running 1px past the page', () => {
    expect(read('app/globals.css')).toContain('.fn-g-sources > .g-tag { max-width: 100%; white-space: normal; }');
  });

  test('viewportWidth: a mobile layout viewport widened by overflow reads as the device width', async () => {
    const { viewportWidth, VIEWPORT_INFLATION_PX } = await import('@/lib/sidebar');
    const win = (innerWidth: number, clientWidth: number) => ({ innerWidth, document: { documentElement: { clientWidth } } });
    expect(viewportWidth(win(941, 390))).toBe(390); // /inbox at 390, isMobile: a 600px pre-measure chart SVG
    expect(viewportWidth(win(1440, 1425))).toBe(1440); // desktop scrollbar: unchanged
    expect(viewportWidth(win(390, 390))).toBe(390);
    expect(viewportWidth(win(800, 0))).toBe(800);
    expect(VIEWPORT_INFLATION_PX).toBeGreaterThan(20);
  });

  test('the head script sizes against the same width: an inflated phone stays on the rail', async () => {
    const { SIDEBAR_INIT_SCRIPT, SIDEBAR_STORAGE_KEY, SIDEBAR_RAIL_W } = await import('@/lib/sidebar');
    const run = (innerWidth: number, clientWidth: number) => {
      const attrs: Record<string, string> = {};
      const vars: Record<string, string> = {};
      const root = { clientWidth, style: { setProperty: (k: string, v: string) => void (vars[k] = v) }, setAttribute: (k: string, v: string) => void (attrs[k] = v), removeAttribute: (k: string) => void delete attrs[k] };
      const storage = { getItem: (k: string) => (k === SIDEBAR_STORAGE_KEY ? JSON.stringify({ v: 2, w: 232 }) : null) };
      new Function('document', 'localStorage', 'location', 'innerWidth', SIDEBAR_INIT_SCRIPT)({ documentElement: root }, storage, { pathname: '/inbox' }, innerWidth);
      return { attrs, vars };
    };
    expect(run(941, 390).vars['--sidebar-w']).toBe(`${SIDEBAR_RAIL_W}px`);
    expect(run(941, 390).attrs['data-sidebar']).toBe('rail');
    expect(run(1440, 1425).attrs['data-sidebar']).toBe('full');
  });

  test('Sidebar.tsx reads the window width through viewportWidth; chart SVGs never exceed their box', () => {
    const s = read('components/Sidebar.tsx');
    expect(s).not.toMatch(/window\.innerWidth/);
    expect(s).toContain('viewportWidth()');
    expect(read('app/globals.css')).toContain('.g-bars > svg, .g-xy-svg { max-width: 100%; }');
  });
});

// ── 9: Lab audit leftovers ────────────────────────────────────────────────

describe('Lab audit leftovers (Creatorverse lane)', () => {
  test('Today graph cards: the graphs, caption link and action carry a kit identity (g-audit --controls /lab)', () => {
    const g = read('components/lab/v2/shared/HeroGraphs.tsx');
    expect(g).toMatch(/className="lab2-graph lab2-graph-net"\s+tabIndex=\{0\}\s+role="application"\s+\{\.\.\.kit\('LabGraph'\)\}/);
    expect(g).toMatch(/className="lab2-graph lab2-graph-chart"\s+tabIndex=\{0\}\s+role="application"\s+\{\.\.\.kit\('LabGraph'\)\}/);
    expect(g).toContain("import { useKitMark } from './kitMark';");
    const n = read('components/lab/v2/shared/NarrativeCard.tsx');
    expect(n).toContain('<Link data-g="LabLink" href={p.href as string} scroll={false} className="lab2-narr-caplink"');
    expect(n).toContain('<Link data-g="LabLink" href={p.action.href} scroll={false} className="lab2-narr-action"');
    expect(n).toContain('<button data-g="LabButton" type="button" className="lab2-narr-action"');
  });

  test('reduced transparency: base and strong glass go solid whatever style tokens are in force (/lab/ledger)', () => {
    expect(read('app/globals.css')).toContain(
      "@media (prefers-reduced-transparency: reduce) { .lab .lab2-glass[data-tone='base'], .lab .lab2-glass[data-tone='strong'] { background: var(--lab-glass-solid); } }",
    );
  });

  test('lab-contrast judges rendered text only; the radar step opens Watching so its rows are judged', () => {
    expect(read('scripts/g-audit/_lab.mjs')).toMatch(/const unrendered = \(el\) => typeof el\.checkVisibility === 'function' && !el\.checkVisibility\(\);/);
    expect(read('scripts/g-audit/_lab.mjs')).toContain('clipped(el) || unrendered(el)');
    expect(read('scripts/g-audit/lab.mjs')).toContain("step('watching open'");
    // a corner under the fixed Wizard launcher is covered, judged on another scroll step
    expect(read('scripts/g-audit/_lab.mjs')).toContain('const xs = [r.left + 2, r.left + r.width / 2, r.right - 2]');
  });
});

// ── 2: /agents?dept=<id|slug|name> ───────────────────────────────────────
// /agents?dept= filtered GladOS's roster page. FounderOS keeps its own /agents and /social (founderos/, tests/founderos-screens.test.ts).
