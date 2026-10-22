import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { invalidateModeCache } from '@/lib/paths';
import { getDb } from '@/lib/data';

/**
 * FounderOS merge, fo/comms-workforce: the checks for F3 (morning digest),
 * F4 (recordings), F5 (Slack client board, week calendar), F9 (deliverables
 * review and failover) in pages/feature-additions.md,
 * plus AC-13 (every send or spend behind a confirm) and the house rules
 * (honest states, no raw hex, no hard-coded brand) on the files this lane added.
 */

let dir = '';
beforeAll(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'glados-focw-'));
  process.env.GLADOS_DB = path.join(root, 'test.db');
});
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'glados-focw-env-'));
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

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
const envLocal = (lines: string) => writeFileSync(path.join(dir, '.env.local'), lines);
const NOW = new Date('2026-10-12T15:00:00');

// ── F3 morning digest ─────────────────────────────────────────────────────

describe('F3 morning digest', () => {
  test('states: ready only for today; pending when the runner is on; off otherwise (spec copy verbatim)', async () => {
    const { digestState, DIGEST_COPY } = await import('@/lib/comms-extras');
    expect(digestState({ cronEnabled: false, latestDate: null, today: '2026-10-12' })).toBe('off');
    expect(digestState({ cronEnabled: true, latestDate: null, today: '2026-10-12' })).toBe('pending');
    expect(digestState({ cronEnabled: true, latestDate: '2026-10-11', today: '2026-10-12' })).toBe('pending');
    expect(digestState({ cronEnabled: false, latestDate: '2026-10-12', today: '2026-10-12' })).toBe('ready');
    expect(DIGEST_COPY.off).toBe('Morning digest is off on this instance.');
    expect(DIGEST_COPY.pending).toBe("Today's digest arrives at 7:00.");
    expect(DIGEST_COPY.offHint).toContain('GLADOS_CRON');
  });

  test('lanes: email, Slack, WhatsApp, calendar; cleared entries drop out; needs-reply counts people above group chatter', async () => {
    const { digestLanes } = await import('@/lib/comms-extras');
    const e = (source: string, sender: string, tier: string, ts: string) => ({ source, sender, tier, rank: 0, reason: '', title: '', preview: 'hi', ts }) as never;
    const body = {
      entries: [e('email', 'Ann', 'client', '2026-10-12T06:00:00Z'), e('email', 'News', 'noise', '2026-10-12T05:00:00Z'), e('slack', 'Bo', 'group', '2026-10-12T04:00:00Z'), e('whatsapp', 'Cy', 'people', '2026-10-12T03:00:00Z')],
    } as never;
    const today = [{ id: 'ev', title: 'Sync', start: '2026-10-12T10:00:00Z', end: null, allDay: false }];
    const lanes = digestLanes(body, today, ['whatsapp|Cy|2026-10-12T03:00:00Z']);
    expect(lanes.map((l) => l.id)).toEqual(['email', 'slack', 'whatsapp', 'calendar']);
    expect(lanes[0]).toMatchObject({ needsReply: 1 });
    expect(lanes[0].entries).toHaveLength(2);
    expect(lanes[1]).toMatchObject({ needsReply: 0 });
    expect(lanes[2].entries).toHaveLength(0);
    expect(lanes[3].events).toEqual(today);
    expect(digestLanes(null, [])).toHaveLength(4);
  });

  test('the page fetch: blank install is "off" with no digest; a stored digest for today is ready and unread until marked', async () => {
    const { buildCommsExtras } = await import('@/lib/comms-extras-server');
    const blank = await buildCommsExtras({ url: '/inbox', events: [], slackConnected: false, calendarConnected: false, now: NOW });
    expect(blank.digest).toMatchObject({ state: 'off', digest: null, read: false, sample: false, cronEnabled: false });
    getDb().commsDigests.insert({ id: 'dg-today', date: '2026-10-12', body: { entries: [] }, createdAt: NOW.toISOString() });
    const ready = await buildCommsExtras({ url: '/inbox', events: [], slackConnected: false, calendarConnected: false, now: NOW });
    expect(ready.digest).toMatchObject({ state: 'ready', read: false });
    getDb().commsDigests.reads.mark('dg-today');
    expect((await buildCommsExtras({ url: '/inbox', events: [], slackConnected: false, calendarConnected: false, now: NOW })).digest.read).toBe(true);
    // with the runner on and no digest for a later day: pending
    envLocal('GLADOS_CRON=1\n');
    const later = await buildCommsExtras({ url: '/inbox', events: [], slackConnected: false, calendarConnected: false, now: new Date('2026-10-13T06:00:00') });
    expect(later.digest.state).toBe('pending');
  });

  test('unread dot on the Comms tab: the sidebar reads the digest and clears on the read event', () => {
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain('useDigestUnread()');
    expect(sidebar).toMatch(/href === '\/inbox' && digestUnread/);
    const hook = read('components/comms-fo/useDigestUnread.ts');
    expect(hook).toContain("fetch('/api/comms/digest')");
    expect(hook).toContain('DIGEST_READ_EVENT');
    // opening the digest (GladOS sheet, Classic view) marks it read
    expect(read('components/comms-fo/CommsFoG.tsx')).toContain('reads.markRead()');
    expect(read('components/comms-fo/CommsFoClassic.tsx')).toContain('markRead()');
  });
});

// ── F4 recordings ─────────────────────────────────────────────────────────

describe('F4 recordings', () => {
  test('not configured per source, empty copy, rows from call_recordings, no network on render', async () => {
    const { buildCommsExtras } = await import('@/lib/comms-extras-server');
    const { RECORDINGS_EMPTY, formatDuration } = await import('@/lib/comms-extras');
    expect(RECORDINGS_EMPTY).toBe('No recordings yet.');
    expect(formatDuration(null)).toBe('unknown length');
    expect(formatDuration(840)).toBe('14 min');
    expect(formatDuration(3_900)).toBe('1 h 5 min');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const x = await buildCommsExtras({ url: '/inbox', events: [], slackConnected: false, calendarConnected: false, now: NOW });
    expect(x.recordings.sources).toMatchObject({ plaud: { configured: false, setupHref: '/integrations#plaud' }, fathom: { configured: false, setupHref: '/integrations#fathom' } });
    getDb().callRecordings.upsert({ source: 'plaud', externalId: 'r1', title: 'Site walk', startedAt: NOW.toISOString(), durationS: 600, participants: [], summary: 'notes', transcriptUrl: null });
    const y = await buildCommsExtras({ url: '/inbox', events: [], slackConnected: false, calendarConnected: false, now: NOW });
    expect(y.recordings.rows.map((r) => r.title)).toContain('Site walk');
    expect(y.recordings.sample).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('both trees: a table or lane with Set up per source; the GladOS row opens a drawer', () => {
    const g = read('components/comms-fo/CommsFoG.tsx');
    expect(g).toMatch(/<GTable<CallRecording>/);
    expect(g).toContain('<GDrawer');
    expect(g).toContain('s.setupHref');
    const c = read('components/comms-fo/CommsFoClassic.tsx');
    expect(c).toContain('<SetupLink href={s.setupHref} />');
    expect(read('components/inbox/InboxG.tsx')).toContain("{ value: 'recordings', label: 'Recordings' }");
    expect(read('components/inbox/InboxWorkspace.tsx')).toContain("{ id: 'recordings', label: 'Recordings' }");
  });
});

// ── F5 Slack client board and week calendar ──────────────────────────────

describe('F5 client board and week', () => {
  test('one lane per confirmed client with a channel, newest first, open in Slack', async () => {
    const { clientLanes, slackChannelUrl } = await import('@/lib/comms-extras');
    const lanes = clientLanes(
      [
        { clientId: 'a', name: 'Acme', slackChannel: '#Client-Acme' },
        { clientId: 'b', name: 'NoChan', slackChannel: null },
      ],
      [
        { channel: 'client-acme', user: 'u1', text: 'old', ts: '100.0' },
        { channel: 'client-acme', user: 'u2', text: 'new', ts: '200.0' },
        { channel: 'general', user: 'u3', text: 'x', ts: '300.0' },
      ],
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ channel: 'client-acme', openUrl: slackChannelUrl('client-acme') });
    expect(lanes[0].messages.map((m) => m.text)).toEqual(['new', 'old']);
    expect(slackChannelUrl('#Client-Acme')).toBe('https://slack.com/app_redirect?channel=client-acme');
  });

  test('Not configured when Slack has no key; a calendar with no account is Not configured, never an empty week', async () => {
    const { buildCommsExtras } = await import('@/lib/comms-extras-server');
    const x = await buildCommsExtras({ url: '/inbox', events: [], slackConnected: false, calendarConnected: false, now: NOW });
    expect(x.clients).toMatchObject({ state: 'unconfigured', setupHref: '/integrations#slack' });
    expect(x.week).toMatchObject({ configured: false, setupHref: '/integrations#googlecalendar', sample: false });
    const s = await buildCommsExtras({ url: '/inbox?sample=1', events: [], slackConnected: false, calendarConnected: false, now: NOW });
    expect(s.clients).toMatchObject({ state: 'ready', sample: true });
    expect(s.week).toMatchObject({ configured: true, sample: true });
  });

  test('week: seven local days from today, overlapping events share lanes, all-day events sit apart', async () => {
    const { weekDays } = await import('@/lib/comms-extras');
    const at = (d: number, h: number, m = 0) => new Date(2026, 9, 12 + d, h, m).toISOString();
    const { days, loHour, hiHour } = weekDays(
      [
        { id: 'a', title: 'A', start: at(0, 10), end: at(0, 11), allDay: false },
        { id: 'b', title: 'B', start: at(0, 10, 30), end: at(0, 11, 30), allDay: false },
        { id: 'c', title: 'C', start: at(3, 9), end: null, allDay: true },
        { id: 'z', title: 'Too late', start: at(9, 9), end: null, allDay: false },
      ],
      NOW,
    );
    expect(days).toHaveLength(7);
    expect(days[0].isToday).toBe(true);
    expect(days[0].timed.map((e) => [e.lane, e.lanes])).toEqual([[0, 2], [1, 2]]);
    expect(days[3].allDay.map((e) => e.id)).toEqual(['c']);
    expect(days.flatMap((d) => d.timed).some((e) => e.id === 'z')).toBe(false);
    expect(hiHour - loHour).toBeGreaterThanOrEqual(10);
    expect(days[0].timed[0].topPct).toBeGreaterThanOrEqual(0);
  });

  test('GladOS: Clients and Week tabs with lanes in a card scroller; Classic: extra lanes', () => {
    const g = read('components/inbox/InboxG.tsx');
    expect(g).toContain("{ value: 'clients', label: 'Clients' }");
    expect(g).toContain("{ value: 'week', label: 'Week' }");
    expect(read('app/globals.css')).toMatch(/\.wg-cf-lanes \{[^}]*overflow-x: auto/);
    const c = read('components/inbox/InboxWorkspace.tsx');
    expect(c).toContain('<ClientLanesClassic');
    expect(c).toContain('<WeekClassic');
  });
});

// ── F9 deliverables review and failover ──────────────────────────────────

describe('F9 review and failover', () => {
  test('deliverables: ok runs with output, not failover log lines, not already decided (A-1)', async () => {
    const { isDeliverable, reviewView, outputTitle } = await import('@/lib/agent-review');
    expect(isDeliverable({ ok: true, summary: 'Drafted a reply' })).toBe(true);
    expect(isDeliverable({ ok: false, summary: 'Drafted a reply' })).toBe(false);
    expect(isDeliverable({ ok: true, summary: '  ' })).toBe(false);
    expect(isDeliverable({ ok: true, summary: 'Failover: model a → b (by the operator)' })).toBe(false);
    const db = getDb();
    const t = new Date().toISOString();
    db.agentRuns.insert({ id: 'rv-1', agentId: 'daily-briefing', startedAt: t, finishedAt: t, ok: true, summary: 'Brief one\nmore' });
    db.agentRuns.insert({ id: 'rv-2', agentId: 'daily-briefing', startedAt: t, finishedAt: t, ok: true, summary: 'Brief two' });
    db.deliverableDecisions.record({ runId: 'rv-2', decision: 'rejected', reason: 'late' });
    const v = reviewView(db);
    expect(v.pending.map((d) => d.runId)).toContain('rv-1');
    expect(v.pending.map((d) => d.runId)).not.toContain('rv-2');
    expect(v.decided.find((d) => d.runId === 'rv-2')).toMatchObject({ decision: 'rejected', reason: 'late' });
    expect(outputTitle('Brief one\nmore')).toBe('Brief one');
  });

  test('failover options are ids this install already runs; chat calls the stored model (the runtime reads it)', async () => {
    const { failoverModelOptions, chatModelFor } = await import('@/lib/agent-review');
    expect(failoverModelOptions([{ model: 'builtin' }, { model: 'anthropic/x' }, { model: 'anthropic/x' }], 'builtin', 'anthropic/default')).toEqual(['builtin', 'anthropic/default', 'anthropic/x']);
    expect(chatModelFor('builtin')).toBeUndefined();
    expect(chatModelFor('')).toBeUndefined();
    expect(chatModelFor('anthropic/claude-opus-5')).toBe('anthropic/claude-opus-5');

    const llm = await import('@/lib/connectors/llm');
    const spy = vi.spyOn(llm, 'chat').mockResolvedValue({ text: 'ok', toolCalls: [] });
    const { chatWithAgent } = await import('@/lib/agents/chat');
    const db = getDb();
    db.agents.insert({ id: 'fo-seat', departmentId: db.departments.all()[0].id, name: 'Seat', role: '', status: 'active', tier: 'worker', description: '', model: 'anthropic/claude-opus-5', tools: [], parentId: null, instance: 'builtin' });
    const agent = { id: 'fo-seat', name: 'Seat', description: '', departmentId: 'x', run: async () => ({ ok: true, summary: '' }) };
    await chatWithAgent(db, [agent], 'fo-seat', 'hello');
    expect(spy.mock.calls[0][0]).toMatchObject({ model: 'anthropic/claude-opus-5' });
    db.agents.setModel('fo-seat', 'builtin');
    await chatWithAgent(db, [agent], 'fo-seat', 'again');
    expect(spy.mock.calls[1][0].model).toBeUndefined();
  });

  test('A-2 in the UI: both trees confirm before the PATCH, which always carries confirm: true', () => {
    const hooks = read('components/agents-fo/hooks.ts');
    expect(hooks).toMatch(/method: 'PATCH'[\s\S]{0,200}confirm: true/);
    const g = read('components/agents-fo/AgentsFoG.tsx');
    expect(g).toMatch(/<GDialog[\s\S]{0,300}fo\.switchTo\(choice\)/);
    const c = read('components/agents-fo/AgentsFoClassic.tsx');
    expect(c).toMatch(/role="alertdialog" aria-label="Confirm failover"[\s\S]{0,600}fo\.switchTo\(choice\)/);
    // GladOS: a Review tab and the failover select in the sheet; Classic: Review tab and the select in the work panel
    expect(read('components/agents/AgentsG.tsx')).toContain("value: 'review'");
    expect(read('components/agents/AgentSheet.tsx')).toContain('<FailoverG');
    expect(read('components/AgentWorkPanel.tsx')).toContain('<FailoverClassic');
    // a rejection needs a reason in both trees
    expect(g).toContain("confirmDisabledReason={reason.trim() ? undefined");
    expect(c).toContain('disabled={!reason.trim()');
  });
});

// ── House rules on this lane's files ─────────────────────────────────────

describe('house rules', () => {
  const FILES = [
    'components/comms-fo/CommsFoG.tsx',
    'components/comms-fo/CommsFoClassic.tsx',
    'components/comms-fo/hooks.ts',
    'components/agents-fo/AgentsFoG.tsx',
    'components/agents-fo/AgentsFoClassic.tsx',
    'lib/comms-extras.ts',
    'lib/agent-review.ts',
  ];
  test('no raw hex, no emojis, no em dashes in copy, no hard-coded brand name in UI', () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
      expect(src, f).not.toMatch(/\p{Extended_Pictographic}/u);
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, f).not.toContain('—');
      if (f.endsWith('.tsx')) expect(code, f).not.toMatch(/GladOS|FOUNDER OS/);
    }
  });

  test('every new GladOS piece uses kit primitives; Classic pieces use os tokens (Legacy remaps them)', () => {
    const g = read('components/comms-fo/CommsFoG.tsx') + read('components/agents-fo/AgentsFoG.tsx');
    expect(g).not.toMatch(/className="[^"]*\b(bg|text|border)-os-/);
    const c = read('components/comms-fo/CommsFoClassic.tsx') + read('components/agents-fo/AgentsFoClassic.tsx');
    expect(c).not.toMatch(/from '@\/components\/g'/);
  });
});
