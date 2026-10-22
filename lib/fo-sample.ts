/**
 * Sample and Filming fixtures for the FounderOS-merge features (SPEC AC-12,
 * pages/README.md "Sample" and "Filming").
 *
 *   Sample   `?sample=1` on a blank install: a clearly badged preview.
 *   Filming  Filming mode (lib/paths.ts): the page shows the same fixture with
 *            the Sample badge and never calls a live source.
 *
 * Every builder here is pure and deterministic relative to `now`, so a page
 * stays populated whenever it is filmed. Nothing here is ever written to a
 * store: a fixture is a response, not a row (lib/seed.ts stays structural).
 * Names are invented; no real person, client or account appears.
 */
import { filmingMode } from '@/lib/paths';
import { slackChannelUrl, type ClientLane, type DigestEvent } from '@/lib/comms-extras';
import type {
  CallRecording,
  ClientConfirmation,
  ClientWork,
  LeadMagnet,
  TradeActivity,
  TradeAnalysis,
  TradingAccountSnapshot,
  TradingLimitsRow,
  TradingOrder,
  TradingPosition,
  UsageReading,
} from '@/lib/schemas';
import type { LaneReading } from '@/lib/usage';

export type FoMode = 'live' | 'sample' | 'filming';

/** Which data a GET answers with. `blank` = the feature has no real rows yet. */
export function foMode(url: string | URL, blank: boolean, filming: boolean = filmingMode()): FoMode {
  if (filming) return 'filming';
  const sample = new URL(String(url), 'http://localhost').searchParams.get('sample') === '1';
  return sample && blank ? 'sample' : 'live';
}

export const isSampleMode = (m: FoMode) => m !== 'live';

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const ymd = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ── Trading: two accounts, 5 positions, 5 trades (pages/trading.md §3) ────

export function sampleTrading(now: Date = new Date()) {
  const t = now.getTime();
  const at = iso(t - 12 * 60_000);
  const accounts: TradingAccountSnapshot[] = [
    { capturedAt: at, accountId: 'individual', accountLabel: 'Individual', accountValueUsd: 10_250, buyingPowerUsd: 1_840, cashUsd: 1_840, dayPnlUsd: 62.4, totalPnlUsd: 1_310.5, source: 'sample' },
    { capturedAt: at, accountId: 'agentic', accountLabel: 'Agentic', accountValueUsd: 2_480, buyingPowerUsd: 610, cashUsd: 610, dayPnlUsd: -8.15, totalPnlUsd: 94.2, source: 'sample' },
  ];
  const history: Record<string, TradingAccountSnapshot[]> = {};
  for (const a of accounts) {
    history[a.accountId] = Array.from({ length: 30 }, (_, i) => {
      const k = 29 - i;
      const wobble = Math.sin(i / 3) * 0.012 + i * 0.0015;
      return { ...a, capturedAt: iso(t - k * DAY - 12 * 60_000), accountValueUsd: Math.round(a.accountValueUsd * (0.955 + wobble) * 100) / 100 };
    });
    history[a.accountId][29] = a;
  }
  const pos = (accountId: string, symbol: string, quantity: number, avg: number, price: number): TradingPosition => ({
    capturedAt: at, accountId, symbol, quantity, avgCostUsd: avg,
    marketValueUsd: Math.round(quantity * price * 100) / 100, unrealizedPnlUsd: Math.round(quantity * (price - avg) * 100) / 100,
  });
  const positions: TradingPosition[] = [
    pos('individual', 'VTI', 22, 241.1, 268.4),
    pos('individual', 'AAPL', 9, 188.0, 231.6),
    pos('agentic', 'SPY', 2, 562.3, 571.9),
    pos('agentic', 'MSFT', 1, 418.2, 409.5),
    pos('agentic', 'SOFI', 6, 9.8, 11.2),
  ].sort((a, b) => b.marketValueUsd - a.marketValueUsd);
  const trade = (n: number, hoursAgo: number, agent: string, action: 'buy' | 'sell', symbol: string, quantity: number, priceUsd: number, status: TradeActivity['status'], rationale: string): TradeActivity => ({
    id: `sample-trade-${n}`, at: iso(t - hoursAgo * 3_600_000), accountId: 'agentic', agent, action, symbol, quantity, priceUsd, rationale, status,
  });
  const activity: TradeActivity[] = [
    trade(1, 3, 'Markets agent', 'buy', 'SOFI', 6, 9.8, 'filled', 'Breakout over the 50-day on rising volume; sized under the per-trade cap.'),
    trade(2, 27, 'Markets agent', 'buy', 'MSFT', 1, 418.2, 'filled', 'Pullback to support after earnings; one share keeps the position under 20% of the sleeve.'),
    trade(3, 50, 'Markets agent', 'buy', 'NVDA', 1, 131.0, 'rejected', 'Rejected: trades per day limit already reached.'),
    trade(4, 74, 'manual', 'sell', 'QQQ', 1, 488.0, 'filled', 'Operator override.'),
    trade(5, 98, 'Markets agent', 'buy', 'SPY', 2, 562.3, 'filled', 'Core position for the sleeve.'),
  ];
  const analysis: TradeAnalysis = {
    id: 'sample-analysis-1', at: iso(t - 3 * 3_600_000), accountId: 'agentic', agent: 'Markets agent', examined: 12, signals: 2,
    notes: 'Two signals; one taken (SOFI). Holding cash for the rest of the week.',
    rows: [
      { ticker: 'SOFI', score: 0.71, verdict: 'buy', reason: 'Breakout with volume confirmation.' },
      { ticker: 'AMD', score: 0.55, verdict: 'watch', reason: 'Setup forming; no trigger yet.' },
      { ticker: 'TSLA', score: 0.31, verdict: 'skip', reason: 'Too volatile for the risk-per-trade limit.' },
      { ticker: 'KO', score: null, verdict: 'skip', reason: 'Could not score: no fresh data.' },
    ],
  };
  const openOrders: TradingOrder[] = [
    { id: 'sample-order-1', accountId: 'agentic', symbol: 'AMD', side: 'buy', type: 'limit', state: 'queued', quantity: 2, filledQuantity: 0, dollarAmountUsd: null, limitPriceUsd: 148.5, placedAgent: 'Markets agent', createdAt: iso(t - 2 * 3_600_000) },
  ];
  const limits: TradingLimitsRow = {
    maxDeployedCapitalUsd: 2_000, maxNotionalPerTradeUsd: 500, maxPositionPctOfSleeve: 25, maxRiskPctPerTrade: 1,
    maxConcurrentPositions: 6, maxTradesPerDay: 2, minSleeveValueUsd: 1_500, autopilot: false, updatedAt: iso(t - 5 * DAY),
  };
  const phantom = { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', sol: 3.25, usdPerSol: 152.4, usdValue: 495.3, fetchedAt: iso(t - 60_000) };
  return { accounts, history, positions, activity, analysis, openOrders, limits, phantom };
}

// ── Clients: three confirmed clients, four requests ──────────────────────

export function sampleClients(now: Date = new Date()): { roster: ClientConfirmation[]; work: ClientWork[] } {
  const t = now.getTime();
  const roster: ClientConfirmation[] = [
    { clientId: 'sample-northwind', name: 'Northwind Studio', company: 'Northwind Studio', source: 'manual', retainer: true, slackChannel: 'client-northwind', supersetProject: null, confirmedAt: iso(t - 40 * DAY) },
    { clientId: 'sample-acme', name: 'Acme Labs', company: 'Acme Labs', source: 'manual', retainer: false, slackChannel: null, supersetProject: null, confirmedAt: iso(t - 21 * DAY) },
    { clientId: 'sample-harbor', name: 'Harbor & Pine', company: 'Harbor & Pine', source: 'manual', retainer: true, slackChannel: 'client-harbor', supersetProject: null, confirmedAt: iso(t - 9 * DAY) },
  ];
  const w = (n: number, clientId: string, daysAgo: number, status: ClientWork['status'], brief: string): ClientWork => ({
    id: `sample-work-${n}`, clientId, brief, status, supersetWorkspace: null, createdAt: iso(t - daysAgo * DAY),
    finishedAt: status === 'done' || status === 'failed' ? iso(t - (daysAgo - 1) * DAY) : null, detail: '',
  });
  return {
    roster,
    work: [
      w(1, 'sample-northwind', 1, 'draft', 'Audience: founders. Deliverable: three hooks for the spring launch reel. Deadline: Friday.'),
      w(2, 'sample-harbor', 3, 'running', 'Deliverable: landing page copy for the new consult offer.'),
      w(3, 'sample-northwind', 6, 'done', 'Deliverable: email sequence, five emails, for the webinar replay.'),
      w(4, 'sample-acme', 12, 'failed', 'Deliverable: case study draft from the Q3 call notes.'),
    ],
  };
}

// ── Lead magnets: four pages ─────────────────────────────────────────────

export function sampleLeadMagnets(now: Date = new Date()): LeadMagnet[] {
  const t = now.getTime();
  const m = (n: number, name: string, offer: string, path: string, destination: LeadMagnet['destination'], status: LeadMagnet['status'], liveDaysAgo: number | null, campaign: string): LeadMagnet => ({
    id: `sample-magnet-${n}`, name, offer, liveUrl: `https://example.com/${path}`, destination, campaign, status,
    wentLiveAt: liveDaysAgo === null ? null : ymd(t - liveDaysAgo * DAY), notes: '',
    createdAt: iso(t - ((liveDaysAgo ?? 2) + 3) * DAY), updatedAt: iso(t - (liveDaysAgo ?? 2) * DAY),
  });
  return [
    m(1, 'Automation starter kit', 'Ten workflows to copy', 'starter-kit', 'email', 'live', 4, 'Spring launch'),
    m(2, 'Free strategy call', 'A 30 minute audit', 'strategy-call', 'booking', 'live', 18, 'Always on'),
    m(3, 'Agent prompt pack', 'Prompts for five agents', 'prompt-pack', 'email', 'paused', 45, 'Webinar'),
    m(4, 'Pricing calculator', 'Price your offer in 2 minutes', 'pricing', 'email', 'draft', null, ''),
  ];
}

// ── Chats: three agent threads ───────────────────────────────────────────

export type SampleThreadMessage = { id: string; agentId: string; role: 'user' | 'assistant'; content: string; createdAt: string };

export function sampleChatMessages(now: Date = new Date()): SampleThreadMessage[] {
  const t = now.getTime();
  const msg = (n: number, agentId: string, minsAgo: number, role: 'user' | 'assistant', content: string): SampleThreadMessage => ({
    id: `sample-msg-${n}`, agentId, role, content, createdAt: iso(t - minsAgo * 60_000),
  });
  return [
    msg(1, 'conductor', 30, 'user', 'What needs me today?'),
    msg(2, 'conductor', 29, 'assistant', 'Two replies in Comms and one draft waiting on review in Agents.'),
    msg(3, 'daily-briefing', 300, 'user', 'Summarise yesterday.'),
    msg(4, 'daily-briefing', 299, 'assistant', 'Three calls, eleven emails needing replies, one deal moved to proposal.'),
    msg(5, 'comms-agent', 900, 'user', 'Anything urgent in the inbox?'),
    msg(6, 'comms-agent', 899, 'assistant', 'One client asked to move Thursday’s call. Everything else can wait.'),
  ];
}

// ── Recordings: two Plaud, two Fathom ────────────────────────────────────

export function sampleRecordings(now: Date = new Date()): CallRecording[] {
  const t = now.getTime();
  const r = (n: number, source: CallRecording['source'], hoursAgo: number, title: string, mins: number, participants: string[], summary: string): CallRecording => ({
    id: `${source}:sample-${n}`, source, externalId: `sample-${n}`, title, startedAt: iso(t - hoursAgo * 3_600_000), durationS: mins * 60,
    participants, summary, transcriptUrl: null,
  });
  return [
    r(1, 'fathom', 5, 'Weekly sync, Northwind Studio', 32, ['Dara Whitfield', 'Theo Bassett'], 'Agreed the launch date and the three hooks to test.'),
    r(2, 'plaud', 26, 'Site walk notes', 14, [], 'Measurements for the studio fit-out and the list of fixes.'),
    r(3, 'fathom', 50, 'Discovery call, Harbor & Pine', 41, ['Priya Raman'], 'Wants a consult offer; budget confirmed; proposal by Monday.'),
    r(4, 'plaud', 98, 'Voice memo: offer ideas', 6, [], 'Three angles for the spring offer.'),
  ];
}

// ── Morning digest ───────────────────────────────────────────────────────

export function sampleDigestBody(now: Date = new Date()) {
  const t = now.getTime();
  const e = (tier: string, rank: number, source: string, sender: string, title: string, preview: string, hoursAgo: number, reason: string) => ({
    tier, rank, source, sender, title, preview, ts: iso(t - hoursAgo * 3_600_000), reason,
  });
  const entries = [
    e('call', 0, 'email', 'Dara Whitfield', 'Re: Thursday call', 'Can we move to 3pm?', 2, 'You have a call with them'),
    e('client', 1, 'slack', 'Priya Raman', '#client-harbor', 'Draft looks good, two small notes.', 4, 'Client'),
    e('people', 2, 'whatsapp', 'Marcus Alder', 'Marcus Alder', 'Coffee next week?', 7, 'A person'),
    e('noise', 5, 'email', 'Weekly digest', 'Your weekly report', 'Here is what happened this week.', 9, 'Bulk sender'),
  ];
  return {
    generatedAt: iso(t - 60 * 60_000),
    windowHours: 24,
    entries,
    total: entries.length,
    needsReply: 3,
    counts: { call: 1, client: 1, people: 1, branddeal: 0, group: 0, noise: 1 },
    unsubscribes: [{ sender: 'Weekly digest', count: 3, reason: 'Bulk sender' }],
    sources: [
      { source: 'email', ok: true, configured: true, count: 2 },
      { source: 'slack', ok: true, configured: true, count: 1 },
      { source: 'whatsapp', ok: true, configured: true, count: 1 },
    ],
  };
}

// ── Usage (only with ?sample=1 off a filming instance; the guard is on in Filming) ──

export function sampleUsageReadings(now: Date = new Date()): UsageReading[] {
  const t = now.getTime();
  const out: UsageReading[] = [];
  for (let k = 6; k >= 0; k--) {
    const day = ymd(t - k * DAY);
    const f = 1 + Math.sin(k) * 0.3;
    out.push({ machine: 'sample-laptop', plan: 'claude', day, model: 'claude-sonnet', input: Math.round(420_000 * f), output: Math.round(95_000 * f), cacheWrite: Math.round(610_000 * f), pushedAt: iso(t) });
    out.push({ machine: 'sample-mini', plan: 'claude', day, model: 'claude-opus', input: Math.round(150_000 * f), output: Math.round(40_000 * f), cacheWrite: Math.round(220_000 * f), pushedAt: iso(t) });
    out.push({ machine: 'sample-laptop', plan: 'codex', day, model: 'codex', input: Math.round(90_000 * f), output: Math.round(18_000 * f), cacheWrite: 0, pushedAt: iso(t) });
  }
  return out;
}

/** Lane split for the sample laptop (the sample's local machine): pushes carry no lanes. */
export function sampleUsageLanes(now: Date = new Date()): LaneReading[] {
  const share = { board: 0.34, sessions: 0.41, terminal: 0.17, automation: 0.08 } as const;
  const out: LaneReading[] = [];
  for (const r of sampleUsageReadings(now)) {
    if (r.machine !== 'sample-laptop') continue;
    const burn = r.input + r.output + r.cacheWrite;
    for (const [lane, f] of Object.entries(share) as [keyof typeof share, number][]) out.push({ plan: r.plan, day: r.day, lane, burn: Math.round(burn * f) });
  }
  return out;
}

// ── Comms: Slack client board and week calendar (F5) ─────────────────────

export function sampleClientLanes(now: Date = new Date()): ClientLane[] {
  const t = now.getTime();
  const ts = (minsAgo: number) => String((t - minsAgo * 60_000) / 1000);
  const lane = (clientId: string, name: string, channel: string, lines: [string, string, number][]): ClientLane => ({
    clientId, name, channel, openUrl: slackChannelUrl(channel),
    messages: lines.map(([user, text, minsAgo]) => ({ channel, user, text, ts: ts(minsAgo) })),
  });
  return [
    lane('sample-northwind', 'Northwind Studio', 'client-northwind', [
      ['Dara Whitfield', 'Uploaded the three cuts to the shared folder.', 25],
      ['Theo Bassett', 'Hook two tested best on the first 500 views.', 190],
    ]),
    lane('sample-harbor', 'Harbor & Pine', 'client-harbor', [['Priya Raman', 'Draft looks good, two small notes on the pricing slide.', 240]]),
    lane('sample-lumen', 'Lumen Dental', 'client-lumen', []),
  ];
}

export function sampleWeekEvents(now: Date = new Date()): DigestEvent[] {
  const at = (dayOffset: number, h: number, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m).toISOString();
  const ev = (n: number, title: string, d: number, h: number, mins: number, m = 0): DigestEvent => ({
    id: `sample-ev-${n}`, title, start: at(d, h, m), end: new Date(Date.parse(at(d, h, m)) + mins * 60_000).toISOString(), allDay: false,
  });
  return [
    ev(1, 'Weekly sync, Northwind Studio', 0, 10, 45),
    ev(2, 'Discovery call, Harbor & Pine', 0, 14, 30),
    ev(3, 'Edit review', 1, 9, 60),
    ev(4, 'Podcast recording', 2, 13, 90),
    ev(5, 'Founder dinner', 3, 19, 120),
    ev(6, 'Proposal walkthrough', 4, 11, 30),
    ev(7, 'Office hours', 4, 11, 60, 15),
    { id: 'sample-ev-8', title: 'Studio closed', start: at(5, 0), end: null, allDay: true },
  ];
}
