/**
 * Pure maths behind /trading (pages/trading.md §2 `view`), ported from the
 * 2026-10-06 parts bin (lib/trading-view.ts, lib/trading-chart.ts,
 * lib/trading-guardrails.ts), which ported FounderOS `view.go`. No sqlite, no
 * DOM, no CSS: every tree (GladOS, Classic, Legacy) imports this file, and the
 * page lane picks colours.
 */
import type { ConnectorStatus } from '@/lib/connectors/types';
import type {
  TradeActivity,
  TradeAnalysis,
  TradingAccountSnapshot,
  TradingLimits,
  TradingLimitsRow,
  TradingOrder,
  TradingPosition,
} from '@/lib/schemas';

/** The account id the agent may trade; every other account is read-only to it. */
export const AGENTIC_ID = 'agentic';

/** The wallet as the board sees it: a public address read from a public RPC. */
export type PhantomView = { address: string; sol: number; usdPerSol: number | null; usdValue: number | null; fetchedAt: string };

const MIN = 60_000;
const round = (n: number) => Math.round(n * 100) / 100;

/** A feed older than this is stale (connector state error, warn pill). */
export const TRADING_STALE_MS = 24 * 60 * MIN;

export type Freshness = { state: 'none' | 'live' | 'stale'; label: string; ageMs: number | null };

/** "updated just now" / "updated 12 min ago" / "Feed 2 days old". Decided by the freshest push. */
export function freshness(accounts: TradingAccountSnapshot[], now: number = Date.now()): Freshness {
  if (accounts.length === 0) return { state: 'none', label: 'No feed yet', ageMs: null };
  const freshest = accounts.reduce((a, b) => (a.capturedAt >= b.capturedAt ? a : b));
  const ageMs = Math.max(0, now - Date.parse(freshest.capturedAt));
  const m = Math.floor(ageMs / MIN);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (ageMs >= TRADING_STALE_MS) return { state: 'stale', label: d >= 2 ? `Feed ${d} days old` : `Feed ${h} hours old`, ageMs };
  const label = m < 1 ? 'updated just now' : m < 60 ? `updated ${m} min ago` : `updated ${h} h ago`;
  return { state: 'live', label, ageMs };
}

const SIZE_BUCKETS: Array<{ label: string; max: number }> = [
  { label: '<$50', max: 50 },
  { label: '$50-250', max: 250 },
  { label: '$250-1k', max: 1000 },
  { label: '$1k+', max: Infinity },
];

/** The book by market value; every bucket present so the chart keeps its columns. */
export function positionSizes(positions: TradingPosition[]): Array<{ label: string; count: number }> {
  return SIZE_BUCKETS.map((b, i) => {
    const min = i === 0 ? -Infinity : SIZE_BUCKETS[i - 1].max;
    return { label: b.label, count: positions.filter((p) => p.marketValueUsd >= min && p.marketValueUsd < b.max).length };
  });
}

export type ActivityFilter = 'all' | 'agent' | 'you' | 'rejected';

/** A row a human placed: the feed tags these manual / override / operator. */
export const isHumanTrade = (a: Pick<TradeActivity, 'agent'>) => /\b(manual|override|operator|you|human)\b/i.test(a.agent);

export function filterActivity(rows: TradeActivity[], filter: ActivityFilter): TradeActivity[] {
  switch (filter) {
    case 'agent':
      return rows.filter((a) => !isHumanTrade(a));
    case 'you':
      return rows.filter(isHumanTrade);
    case 'rejected':
      return rows.filter((a) => a.status === 'rejected');
    default:
      return rows;
  }
}

export function activityCounts(rows: TradeActivity[]): Record<ActivityFilter, number> {
  return {
    all: rows.length,
    agent: filterActivity(rows, 'agent').length,
    you: filterActivity(rows, 'you').length,
    rejected: filterActivity(rows, 'rejected').length,
  };
}

export type AgentSummary = {
  hasActed: boolean;
  tradeCount: number;
  lastTrade: TradeActivity | null;
  deployedUsd: number;
  idleCashUsd: number | null;
  unrealizedPnlUsd: number;
};

/** What the agent has actually done in its sleeve, from the fed rows only. */
export function agentSummary(snapshot: TradingAccountSnapshot | null, positions: TradingPosition[], trades: TradeActivity[]): AgentSummary {
  const filled = trades.filter((t) => t.status === 'filled').sort((a, b) => b.at.localeCompare(a.at));
  return {
    hasActed: filled.length > 0,
    tradeCount: filled.length,
    lastTrade: filled[0] ?? null,
    deployedUsd: round(positions.reduce((t, p) => t + p.marketValueUsd, 0)),
    idleCashUsd: snapshot ? snapshot.cashUsd : null,
    unrealizedPnlUsd: round(positions.reduce((t, p) => t + p.unrealizedPnlUsd, 0)),
  };
}

export type TradingVolume = {
  /** Brokerage total across every fed account (the wallet rides separately). */
  headlineUsd: number;
  dayPnlUsd: number;
  investedUsd: number;
  positionCount: number;
  /** headline plus the wallet, null when the wallet has no price */
  totalWithWalletUsd: number | null;
  meters: Array<{ key: string; label: string; frac: number; valueUsd: number | null; agentMayTrade: boolean }>;
};

/** The Accounts card: one meter per account plus the wallet, each its honest share. */
export function tradingVolume(x: { accounts: TradingAccountSnapshot[]; positions: TradingPosition[]; phantom: PhantomView | null }): TradingVolume {
  const brokerage = x.accounts.reduce((s, a) => s + a.accountValueUsd, 0);
  const walletUsd = x.phantom?.usdValue ?? 0;
  const total = brokerage + walletUsd;
  const share = (n: number) => (total > 0 ? Math.max(0, Math.min(1, n / total)) : 0);
  const meters: TradingVolume['meters'] = x.accounts.map((a) => ({
    key: a.accountId,
    label: a.accountLabel,
    frac: share(a.accountValueUsd),
    valueUsd: a.accountValueUsd,
    agentMayTrade: a.accountId === AGENTIC_ID,
  }));
  if (x.phantom) {
    meters.push({
      key: 'phantom',
      label: `Phantom · ${x.phantom.sol} SOL`,
      frac: x.phantom.usdValue === null ? 0 : share(x.phantom.usdValue),
      valueUsd: x.phantom.usdValue,
      agentMayTrade: false,
    });
  }
  return {
    headlineUsd: round(brokerage),
    dayPnlUsd: round(x.accounts.reduce((s, a) => s + a.dayPnlUsd, 0)),
    investedUsd: round(x.positions.reduce((s, p) => s + p.marketValueUsd, 0)),
    positionCount: x.positions.length,
    totalWithWalletUsd: x.phantom && x.phantom.usdValue === null ? null : round(total),
    meters,
  };
}

// ── limits: the clamp (pages/trading.md T-5) ───────────────────────────────

/** The 7 numeric fields an operator may set, in display order. */
export const LIMIT_FIELDS = [
  'maxDeployedCapitalUsd',
  'maxNotionalPerTradeUsd',
  'maxPositionPctOfSleeve',
  'maxRiskPctPerTrade',
  'maxConcurrentPositions',
  'maxTradesPerDay',
  'minSleeveValueUsd',
] as const satisfies ReadonlyArray<Exclude<keyof TradingLimits, 'autopilot'>>;

/** Labels and hints from FounderOS TradingLimits.svelte. */
export const LIMIT_LABELS: Record<(typeof LIMIT_FIELDS)[number], { label: string; hint: string }> = {
  maxDeployedCapitalUsd: { label: 'Autonomy budget', hint: 'Most capital deployed at once without a human' },
  maxNotionalPerTradeUsd: { label: 'Max per trade', hint: 'Largest single order' },
  maxPositionPctOfSleeve: { label: 'Max position', hint: '% of the sleeve in one name' },
  maxRiskPctPerTrade: { label: 'Risk per trade', hint: '% of the sleeve at risk on one trade' },
  maxConcurrentPositions: { label: 'Max positions', hint: 'Names held at once' },
  maxTradesPerDay: { label: 'Trades per day', hint: 'Orders per day' },
  minSleeveValueUsd: { label: 'Kill-switch floor', hint: 'Buys stop if the sleeve falls through this' },
};

/**
 * The schema ranges a stored value is clamped into. These are input RANGES,
 * not defaults: nothing here is ever shown as if it were saved (SPEC O4). The
 * 2026-10-06 build's $5,000 / $25,000 ceilings are deliberately not ported.
 */
export const LIMIT_RANGES: Record<(typeof LIMIT_FIELDS)[number], { min: number; max: number; integer?: true }> = {
  maxDeployedCapitalUsd: { min: 1, max: 10_000_000 },
  maxNotionalPerTradeUsd: { min: 1, max: 10_000_000 },
  maxPositionPctOfSleeve: { min: 0.1, max: 100 },
  maxRiskPctPerTrade: { min: 0.1, max: 100 },
  maxConcurrentPositions: { min: 1, max: 500, integer: true },
  maxTradesPerDay: { min: 1, max: 500, integer: true },
  minSleeveValueUsd: { min: 0, max: 10_000_000 },
};

/** Hold each value inside its range, reporting which fields moved so the UI
 *  can say a value did not take rather than lying about it. */
export function clampLimits(input: Record<string, unknown>): { limits: Omit<TradingLimits, 'autopilot'>; clamped: string[]; invalid: string[] } {
  const limits = {} as Record<string, number>;
  const clamped: string[] = [];
  const invalid: string[] = [];
  for (const field of LIMIT_FIELDS) {
    const raw = input[field];
    const r = LIMIT_RANGES[field];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      invalid.push(field);
      continue;
    }
    let v = r.integer ? Math.round(raw) : raw;
    if (v < r.min) v = r.min;
    if (v > r.max) v = r.max;
    if (v !== raw) clamped.push(field);
    limits[field] = v;
  }
  return { limits: limits as Omit<TradingLimits, 'autopilot'>, clamped, invalid };
}

/** Everything /trading draws. One builder (lib/trading-payload.ts) for page and API. */
export type TradingPayload = {
  accounts: TradingAccountSnapshot[];
  history: Record<string, TradingAccountSnapshot[]>;
  positions: TradingPosition[];
  activity: TradeActivity[];
  analysis: TradeAnalysis | null;
  openOrders: TradingOrder[];
  limits: TradingLimitsRow | null;
  status: ConnectorStatus;
  phantomStatus: ConnectorStatus;
  phantom: PhantomView | null;
  view: {
    freshness: Freshness;
    volume: TradingVolume;
    sizes: Array<{ label: string; count: number }>;
    agent: AgentSummary;
    activityCounts: Record<ActivityFilter, number>;
  };
  /** 'sample' (?sample=1 on a blank install) and 'filming' carry the Sample badge. */
  mode: 'live' | 'sample' | 'filming';
  sample: boolean;
  at: string;
};

export function buildView(x: {
  accounts: TradingAccountSnapshot[];
  positions: TradingPosition[];
  activity: TradeActivity[];
  phantom: PhantomView | null;
  now: number;
}): TradingPayload['view'] {
  const sleeve = x.accounts.find((a) => a.accountId === AGENTIC_ID) ?? null;
  return {
    freshness: freshness(x.accounts, x.now),
    volume: tradingVolume(x),
    sizes: positionSizes(x.positions),
    agent: agentSummary(sleeve, x.positions.filter((p) => p.accountId === AGENTIC_ID), x.activity.filter((a) => a.accountId === AGENTIC_ID)),
    activityCounts: activityCounts(x.activity),
  };
}
