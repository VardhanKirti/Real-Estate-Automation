import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { activityCounts, agentSummary, buildView, clampLimits, filterActivity, freshness, positionSizes, tradingVolume } from '@/lib/trading-view';
import { burnOf, parseClaudeLine, parseCodexLine, readLocalUsage, resetUsageCache, scanLocalUsage, summarizeUsage } from '@/lib/usage';
import { usageAvailability } from '@/lib/usage-guard';
import { chatThreads, threadPage } from '@/lib/chats';
import { routeInterject } from '@/lib/interject';
import { leadMagnetsView, shippedByWeek } from '@/lib/lead-magnets';
import { dueCrons, matchesCron } from '@/lib/cron-scheduler';
import { foMode, sampleClients, sampleLeadMagnets, sampleTrading } from '@/lib/fo-sample';
import type { LeadMagnet, TradeActivity, TradingAccountSnapshot, TradingPosition, UsageReading } from '@/lib/schemas';

/** The pure halves the page lanes render (pages/*.md §2), pinned here. */

afterEach(() => {
  vi.unstubAllEnvs();
  resetUsageCache();
});

const NOW = Date.parse('2026-10-13T15:00:00.000Z');
const snap = (over: Partial<TradingAccountSnapshot> = {}): TradingAccountSnapshot => ({
  capturedAt: '2026-10-13T14:30:00.000Z', accountId: 'agentic', accountLabel: 'Agentic', accountValueUsd: 1000,
  buyingPowerUsd: 400, cashUsd: 400, dayPnlUsd: -3, totalPnlUsd: 0, source: 'agent', ...over,
});
const pos = (mv: number, accountId = 'agentic'): TradingPosition => ({ capturedAt: 'x', accountId, symbol: `S${mv}`, quantity: 1, avgCostUsd: mv, marketValueUsd: mv, unrealizedPnlUsd: 1 });
const act = (agent: string, status: TradeActivity['status'] = 'filled', at = '2026-10-13T14:40:00.000Z'): TradeActivity => ({
  id: `${agent}-${status}-${at}`, at, accountId: 'agentic', agent, action: 'buy', symbol: 'SPY', quantity: 1, priceUsd: 600, rationale: '', status,
});

describe('trading view (T-7, ported from FO view_test.go via the parts bin)', () => {
  test('freshness: none, live under 24 h, stale with the age after (T-3)', () => {
    expect(freshness([], NOW).state).toBe('none');
    expect(freshness([snap()], NOW)).toMatchObject({ state: 'live', label: 'updated 30 min ago' });
    expect(freshness([snap({ capturedAt: '2026-10-12T14:00:00.000Z' })], NOW)).toMatchObject({ state: 'stale', label: 'Feed 25 hours old' });
    expect(freshness([snap({ capturedAt: '2026-10-11T09:00:00.000Z' })], NOW).label).toBe('Feed 2 days old');
  });

  test('position sizes keep every bucket', () => {
    expect(positionSizes([pos(10), pos(100), pos(5000)]).map((b) => b.count)).toEqual([1, 1, 0, 1]);
  });

  test('activity attribution: manual and override rows are the operator, the rest the agent', () => {
    const rows = [act('Markets agent'), act('manual'), act('Markets agent', 'rejected')];
    expect(activityCounts(rows)).toEqual({ all: 3, agent: 2, you: 1, rejected: 1 });
    expect(filterActivity(rows, 'you')[0].agent).toBe('manual');
  });

  test('agent summary counts filled trades only; an idle sleeve reads as idle', () => {
    expect(agentSummary(snap(), [], []).hasActed).toBe(false);
    const s = agentSummary(snap(), [pos(100), pos(50)], [act('Markets agent'), act('Markets agent', 'rejected')]);
    expect(s).toMatchObject({ hasActed: true, tradeCount: 1, deployedUsd: 150, idleCashUsd: 400, unrealizedPnlUsd: 2 });
    expect(agentSummary(null, [], []).idleCashUsd).toBeNull();
  });

  test('no wallet configured means no wallet meter, never a $0 fill', () => {
    const v = tradingVolume({ accounts: [snap()], positions: [], phantom: null });
    expect(v.meters).toHaveLength(1);
    expect(v.positionCount).toBe(0);
    const withWallet = tradingVolume({ accounts: [snap()], positions: [], phantom: { address: 'a', sol: 1, usdPerSol: null, usdValue: null, fetchedAt: '' } });
    expect(withWallet.totalWithWalletUsd).toBeNull();
    expect(withWallet.meters[1]).toMatchObject({ key: 'phantom', valueUsd: null, frac: 0 });
  });

  test('limits clamp into the schema ranges and report what moved (T-5); no money defaults exist', () => {
    const { limits, clamped, invalid } = clampLimits({
      maxDeployedCapitalUsd: 5000, maxNotionalPerTradeUsd: 0, maxPositionPctOfSleeve: 150, maxRiskPctPerTrade: 1,
      maxConcurrentPositions: 4.6, maxTradesPerDay: 3, minSleeveValueUsd: -5,
    });
    expect(invalid).toEqual([]);
    expect(limits).toEqual({ maxDeployedCapitalUsd: 5000, maxNotionalPerTradeUsd: 1, maxPositionPctOfSleeve: 100, maxRiskPctPerTrade: 1, maxConcurrentPositions: 5, maxTradesPerDay: 3, minSleeveValueUsd: 0 });
    expect(clamped.sort()).toEqual(['maxConcurrentPositions', 'maxNotionalPerTradeUsd', 'maxPositionPctOfSleeve', 'minSleeveValueUsd']);
    expect(clampLimits({}).invalid).toHaveLength(7);
  });

  test('the sample fixture builds a full view (two accounts, 5 positions, 5 trades)', () => {
    const s = sampleTrading(new Date(NOW));
    expect(s.accounts).toHaveLength(2);
    expect(s.positions).toHaveLength(5);
    expect(s.activity).toHaveLength(5);
    const v = buildView({ accounts: s.accounts, positions: s.positions, activity: s.activity, phantom: s.phantom, now: NOW });
    expect(v.freshness.state).toBe('live');
    expect(v.agent.hasActed).toBe(true);
  });
});

describe('usage', () => {
  const claudeLine = (ts: string, model: string, i: number, o: number, cw: number, cr = 999) =>
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { model, usage: { input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } } });

  test('parsers: burn counts input + output + cache writes, never cache reads', () => {
    const p = parseClaudeLine(claudeLine('2026-10-13T10:00:00.000Z', 'opus', 10, 5, 2))!;
    expect(burnOf(p)).toBe(17);
    expect(parseClaudeLine('{"type":"user","message":{"usage":{}}}')).toBeNull();
    expect(parseClaudeLine('not json "usage"')).toBeNull();
    const c = parseCodexLine(JSON.stringify({ type: 'event_msg', timestamp: '2026-10-13T10:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 20 } }, rate_limits: { primary: { used_percent: 41, window_minutes: 10080 } } } }))!;
    expect(c.cumulative).toEqual({ input: 100, output: 20 });
    expect(c.weekly?.usedPercent).toBe(41);
    expect(c.session).toBeNull();
  });

  test('the reader folds incrementally and reports which sources exist', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'glados-usage-'));
    const claude = path.join(root, 'claude', 'proj');
    mkdirSync(claude, { recursive: true });
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(root, 'claude'));
    vi.stubEnv('CODEX_SESSIONS_DIR', path.join(root, 'no-codex'));
    vi.stubEnv('GLADOS_USAGE_MACHINE', 'laptop');
    const file = path.join(claude, 's.jsonl');
    const ts = new Date().toISOString();
    writeFileSync(file, claudeLine(ts, 'opus', 10, 5, 2) + '\n');
    const first = scanLocalUsage();
    expect(first.sources).toEqual({ claude: true, codex: false });
    expect(first.readings).toEqual([expect.objectContaining({ machine: 'laptop', plan: 'claude', model: 'opus', input: 10, output: 5, cacheWrite: 2 })]);
    appendFileSync(file, claudeLine(ts, 'opus', 1, 1, 1) + '\n' + '{"partial');
    const second = scanLocalUsage();
    expect(second.readings[0]).toMatchObject({ input: 11, output: 6, cacheWrite: 3 });
  });

  test('the request path reads the cache: a fresh value is returned without a rescan (U-4)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'glados-usage-'));
    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    vi.stubEnv('CODEX_SESSIONS_DIR', root);
    const a = await readLocalUsage();
    const b = await readLocalUsage();
    expect(b).toBe(a);
  });

  test('summary: an unreported plan is "not reported" (null), never 0 (U-2); no gauge without a provider (U-3)', () => {
    const now = new Date('2026-10-13T12:00:00');
    const r = (machine: string, day: string, input: number, pushedAt = now.toISOString()): UsageReading => ({ machine, plan: 'claude', day, model: 'opus', input, output: 0, cacheWrite: 0, pushedAt });
    const s = summarizeUsage({ readings: [r('laptop', '2026-10-13', 100), r('mini', '2026-10-12', 50, '2026-10-12T00:00:00Z'), r('laptop', '2026-09-01', 999)], localMachine: 'laptop', official: { codex: null }, range: 7, now });
    const claude = s.plans.find((p) => p.plan === 'claude')!;
    expect(claude.burn).toBe(150);
    expect(claude.days).toHaveLength(7);
    expect(claude.machines).toEqual([
      expect.objectContaining({ machine: 'laptop', source: 'local', stale: false }),
      expect.objectContaining({ machine: 'mini', source: 'push', stale: true }),
    ]);
    const codex = s.plans.find((p) => p.plan === 'codex')!;
    expect(codex).toMatchObject({ reported: false, burn: null, days: null, official: null });
    expect(s.topBurner).toEqual({ machine: 'laptop', plan: 'claude', burn: 100 });
  });

  test('guard: off under DEMO_GATE, DEMO_MODE=1 and a filming/demo mode file (U-1)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'glados-guard-'));
    vi.stubEnv('GLADOS_MODE_FILE', path.join(dir, 'mode'));
    expect(usageAvailability({ DEMO_GATE: '1' }).available).toBe(false);
    expect(usageAvailability({ DEMO_MODE: '1' }).available).toBe(false);
    expect(usageAvailability({}).available).toBe(true);
    writeFileSync(path.join(dir, 'mode'), 'filming');
    expect(usageAvailability({})).toEqual({ available: false, reason: 'filming mode' });
    expect(usageAvailability({ DEMO_MODE: '0' }).available).toBe(true);
  });
});

describe('chats (C-2)', () => {
  const m = (agentId: string, createdAt: string, content = 'hi') => ({ agentId, role: 'user' as const, content, createdAt });
  const roster = [{ id: 'conductor', name: 'Wizard' }, { id: 'a', name: 'Alpha', description: 'does A' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }];

  test('Wizard pinned first even with no messages; others newest first; New chat lists the rest', () => {
    const recent = [m('b', '2026-10-13T10:00:00Z', 'x'.repeat(300)), m('a', '2026-10-13T09:00:00Z'), m('b', '2026-10-13T08:00:00Z')];
    const { threads, newChat } = chatThreads(recent, roster);
    expect(threads.map((t) => t.agentId)).toEqual(['conductor', 'b', 'a']);
    expect(threads[0]).toMatchObject({ pinned: true, name: 'Wizard', role: 'Your conductor', lastMessage: null });
    expect(threads[1].lastMessage!.length).toBe(120);
    expect(threads[1].messageCount).toBe(2);
    expect(newChat.map((a) => a.id)).toEqual(['c']);
  });

  test('threads page oldest first, 50 at a time', () => {
    const all = Array.from({ length: 120 }, (_, i) => ({ createdAt: `2026-10-13T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`, i }));
    const page = threadPage(all);
    expect(page.messages).toHaveLength(50);
    expect(page.messages[0].i).toBe(70);
    expect(page.hasMore).toBe(true);
    const back = threadPage(all, { before: page.messages[0].createdAt });
    expect(back.messages[back.messages.length - 1].i).toBe(69);
  });
});

describe('interject router (H-3)', () => {
  const agents = [{ id: 'daily-briefing', name: 'Daily Briefing' }, { id: 'comms-agent', name: 'Comms Agent' }];
  test('task, relay and note each land in the right kind', () => {
    expect(routeInterject('todo: send the invoice', agents)).toEqual({ kind: 'task', title: 'send the invoice', detail: '' });
    expect(routeInterject('Call the bank', agents)).toMatchObject({ kind: 'task', title: 'Call the bank' });
    expect(routeInterject('tell Daily Briefing to add the Q3 numbers', agents)).toMatchObject({ kind: 'relay', agentId: 'daily-briefing', title: 'add the Q3 numbers' });
    expect(routeInterject('@comms-agent check the inbox', agents)).toMatchObject({ kind: 'relay', agentId: 'comms-agent' });
    expect(routeInterject('note: the launch moves to May', agents)).toEqual({ kind: 'note', text: 'the launch moves to May' });
    expect(routeInterject('tell Nobody to do it', agents)).toMatchObject({ kind: 'task' });
    expect(routeInterject('   ', agents)).toBeNull();
  });
});

describe('lead magnets view (LM-3)', () => {
  test('captures are never 0: not tracked, with the Trakyo setup link when unkeyed', () => {
    const v = leadMagnetsView([], { trakyoConfigured: false, trakyoSetupHref: '/integrations#trakyo', now: new Date(NOW) });
    expect(v.captures).toEqual({ tracked: false, reason: 'trakyo_not_configured', setupHref: '/integrations#trakyo' });
    expect(v.destinations).toBeNull();
    expect(v.shippedByWeek).toHaveLength(12);
  });

  test('volume, destination share and weekly buckets from the sample', () => {
    const magnets: LeadMagnet[] = sampleLeadMagnets(new Date(NOW));
    const v = leadMagnetsView(magnets, { trakyoConfigured: true, trakyoSetupHref: '', now: new Date(NOW) });
    expect(v.volume).toEqual({ draft: 1, live: 2, paused: 1, archived: 0 });
    expect(v.destinations).toEqual({ email: 0.5, booking: 0.5 });
    expect(shippedByWeek(magnets, new Date(NOW)).reduce((a, w) => a + w.count, 0)).toBe(3);
  });
});

describe('cron scheduler (ported)', () => {
  test('matches fields and catches up after a restart, never twice in one window', () => {
    const at = new Date(2026, 9, 13, 7, 0);
    expect(matchesCron('0 7 * * *', at)).toBe(true);
    expect(matchesCron('*/15 * * * *', new Date(2026, 9, 13, 7, 30))).toBe(true);
    const job = { id: 'j', agentId: 'a', schedule: '0 7 * * *', description: '', enabled: true, lastRunAt: null as string | null };
    expect(dueCrons([job], new Date(2026, 9, 13, 7, 6)).map((j) => j.id)).toEqual(['j']); // restart at 07:06 still delivers
    expect(dueCrons([{ ...job, lastRunAt: new Date(2026, 9, 13, 7, 1).toISOString() }], new Date(2026, 9, 13, 7, 6))).toEqual([]);
    expect(dueCrons([{ ...job, enabled: false }], new Date(2026, 9, 13, 7, 6))).toEqual([]);
  });
});

describe('sample mode helper (AC-12)', () => {
  test('filming always wins; ?sample=1 only on a blank install', () => {
    expect(foMode('http://x/api/trading', true, true)).toBe('filming');
    expect(foMode('http://x/api/trading?sample=1', true, false)).toBe('sample');
    expect(foMode('http://x/api/trading?sample=1', false, false)).toBe('live');
    expect(foMode('http://x/api/trading', true, false)).toBe('live');
  });

  test('fixtures carry no money field on clients (CL-4)', () => {
    const s = sampleClients(new Date(NOW));
    expect(JSON.stringify(s)).not.toMatch(/usd|fee|revenue|amount/i);
  });
});
