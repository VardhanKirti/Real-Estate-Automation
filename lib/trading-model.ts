/**
 * The /trading view model (pages/trading.md §3, §5). Pure and client-safe: no
 * sqlite, no DOM, no CSS. The server builder (lib/trading-page.ts) calls
 * `tradingModel()` once per request and every tree (GladOS, Classic, and the
 * Bennett Legacy tree a later lane adds) renders from the result, so the
 * states, copy and numbers can never drift between styles.
 */
import { AGENTIC_ID, filterActivity, isHumanTrade, LIMIT_FIELDS, LIMIT_LABELS, LIMIT_RANGES, type ActivityFilter, type TradingPayload } from '@/lib/trading-view';
import type { TradeActivity, TradingAccountSnapshot, TradingLimitsRow } from '@/lib/schemas';

// ── formatting (shared by every tree) ──────────────────────────────────────

/** `$11,290` (whole dollars) or `$11,290.40` with cents. */
export function usd(n: number, cents = false): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

/** Axis labels: `$12.5k`, `$980`, `$1.2M`. */
export function usdCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `$${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(2)}k`;
  return usd(n);
}

/** `+$142` / `−$8.15`: a P&L figure with its sign (a true minus, never a dash). */
export function signedUsd(n: number, cents = true): string {
  const body = usd(Math.abs(n), cents);
  if (Math.abs(n) < 0.005) return usd(0, cents);
  return n > 0 ? `+${body}` : `−${body}`;
}

export type Tone = 'up' | 'down' | 'flat';
export const toneOf = (n: number | null | undefined): Tone => (n == null || Math.abs(n) < 0.005 ? 'flat' : n > 0 ? 'up' : 'down');

/** Quantities keep their decimals (fractional shares) but never trail zeros. */
export function qty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** "Oct 12, 2:04 PM" for chart tooltips and the trade sheet. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Oct 12" for chart axes. */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── the model ──────────────────────────────────────────────────────────────

export type FeedState = 'none' | 'live' | 'stale';
export type WalletState = 'unconfigured' | 'ok' | 'error';

export type AccountRow = {
  id: string;
  label: string;
  valueUsd: number | null;
  /** share of the total, 0..1 */
  frac: number;
  dayPnlUsd: number | null;
  cashUsd: number | null;
  buyingPowerUsd: number | null;
  /** "Agent may trade" / "Read-only to agents" / "3.25 SOL" */
  note: string;
  kind: 'brokerage' | 'wallet';
  agentMayTrade: boolean;
  /** the wallet row when the RPC failed: the error for `title` */
  error?: string;
};

export type ChartSeries = { accountId: string; label: string; points: Array<{ at: string; valueUsd: number }> };

export type LimitField = {
  key: (typeof LIMIT_FIELDS)[number];
  label: string;
  hint: string;
  unit: '$' | '%' | '';
  min: number;
  max: number;
  integer: boolean;
  /** the stored value, or null when nothing is saved */
  stored: number | null;
};

export type TradingModel = {
  payload: TradingPayload;
  now: number;
  /** Not configured: no feed ever and no wallet address (§3). */
  unconfigured: boolean;
  feed: FeedState;
  wallet: WalletState;
  /** "Feed live · 12 min" / "Feed 2 days old" / null without a feed */
  feedPill: { tone: 'ok' | 'warn'; text: string; title: string } | null;
  /** "$11,290 across 2 accounts · updated 12 min ago" (or null with nothing to total) */
  subtitle: string | null;
  totalUsd: number | null;
  dayPnlUsd: number | null;
  investedUsd: number;
  /** invested share of the brokerage total, 0..1, null with no brokerage value */
  investedFrac: number | null;
  /** brokerage + wallet total over time (carry forward per account), oldest first */
  totalHistory: number[];
  accounts: AccountRow[];
  series: ChartSeries[];
  /** the account the chart opens on: ?acct= if it exists, else the agentic sleeve, else the first */
  initialAcct: string | null;
  initialLog: ActivityFilter;
  hasAgentic: boolean;
  limits: { saved: TradingLimitsRow | null; fields: LimitField[]; savedLabel: string };
  /** the most recent agent-placed trade, for Classic's "next move" panel */
  lastAgentTrade: TradeActivity | null;
  readOnly: boolean;
  readOnlyReason: string | null;
  /** Sample badge fixture name, or null when the data is real */
  fixture: string | null;
  /** Copy that names the product (BRAND.name, never a literal; SPEC AC-15). */
  copy: { subtitleEmpty: string; autopilotBody: string };
};

const LOG_FILTERS: ActivityFilter[] = ['all', 'agent', 'you', 'rejected'];

export const UNITS: Record<(typeof LIMIT_FIELDS)[number], '$' | '%' | ''> = {
  maxDeployedCapitalUsd: '$',
  maxNotionalPerTradeUsd: '$',
  maxPositionPctOfSleeve: '%',
  maxRiskPctPerTrade: '%',
  maxConcurrentPositions: '',
  maxTradesPerDay: '',
  minSleeveValueUsd: '$',
};

/** Every account's value at each capture time, carried forward, summed: the hero sparkline. */
export function totalHistory(history: Record<string, TradingAccountSnapshot[]>, cap = 60): number[] {
  const rows = Object.values(history).flat().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  if (rows.length === 0) return [];
  const ids = new Set(rows.map((r) => r.accountId));
  const last = new Map<string, number>();
  const out: number[] = [];
  for (const r of rows) {
    last.set(r.accountId, r.accountValueUsd);
    // a partial sum (before every account has reported once) would draw a false jump
    if (last.size < ids.size) continue;
    let sum = 0;
    for (const v of last.values()) sum += v;
    out.push(Math.round(sum * 100) / 100);
  }
  if (out.length <= cap) return out;
  // even sampling, always keeping the newest point
  const step = (out.length - 1) / (cap - 1);
  return Array.from({ length: cap }, (_, i) => out[Math.round(i * step)]);
}

export function parseLog(v: string | null | undefined): ActivityFilter {
  return LOG_FILTERS.includes(v as ActivityFilter) ? (v as ActivityFilter) : 'all';
}

export function tradingModel(payload: TradingPayload, opts: { now?: number; acct?: string | null; log?: string | null; brandName?: string } = {}): TradingModel {
  const brand = opts.brandName ?? 'This app';
  const now = opts.now ?? Date.parse(payload.at);
  const { accounts, view, phantom, phantomStatus } = payload;
  const feed: FeedState = view.freshness.state;
  const wallet: WalletState = phantomStatus.state === 'not_configured' ? 'unconfigured' : phantom ? 'ok' : 'error';

  const brokerage = view.volume.headlineUsd;
  const walletUsd = phantom?.usdValue ?? null;
  const totalUsd = accounts.length === 0 && walletUsd === null ? null : Math.round((brokerage + (walletUsd ?? 0)) * 100) / 100;
  const countAccounts = accounts.length + (phantom ? 1 : 0);

  const freshest = accounts.length ? accounts.reduce((a, b) => (a.capturedAt >= b.capturedAt ? a : b)) : null;
  const feedPill: TradingModel['feedPill'] =
    feed === 'none'
      ? null
      : feed === 'stale'
        ? { tone: 'warn', text: view.freshness.label, title: `Newest capture ${freshest ? stamp(freshest.capturedAt) : ''}. The Markets agent has stopped pushing.` }
        : { tone: 'ok', text: `Feed live · ${freshest ? ago(freshest.capturedAt, now).replace(' ago', '') : ''}`, title: `Newest capture ${freshest ? stamp(freshest.capturedAt) : ''}` };

  const updated = freshest ? (feed === 'stale' ? view.freshness.label.toLowerCase() : `updated ${ago(freshest.capturedAt, now)}`) : null;
  const subtitle =
    totalUsd === null ? null : `${usd(totalUsd)} across ${countAccounts} ${countAccounts === 1 ? 'account' : 'accounts'}${updated ? ` · ${updated}` : ''}`;

  const total = totalUsd ?? 0;
  const share = (n: number) => (total > 0 ? Math.max(0, Math.min(1, n / total)) : 0);
  const rows: AccountRow[] = accounts.map((a) => ({
    id: a.accountId,
    label: a.accountLabel,
    valueUsd: a.accountValueUsd,
    frac: share(a.accountValueUsd),
    dayPnlUsd: a.dayPnlUsd,
    cashUsd: a.cashUsd,
    buyingPowerUsd: a.buyingPowerUsd,
    note: a.accountId === AGENTIC_ID ? 'Agent may trade' : 'Read-only to agents',
    kind: 'brokerage',
    agentMayTrade: a.accountId === AGENTIC_ID,
  }));
  if (wallet !== 'unconfigured') {
    rows.push({
      id: 'phantom',
      label: 'Phantom',
      valueUsd: walletUsd,
      frac: walletUsd === null ? 0 : share(walletUsd),
      dayPnlUsd: null,
      cashUsd: null,
      buyingPowerUsd: null,
      note: phantom ? `${phantom.sol.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL` : 'Wallet not reachable',
      kind: 'wallet',
      agentMayTrade: false,
      error: phantom ? undefined : phantomStatus.detail,
    });
  }

  const series: ChartSeries[] = accounts.map((a) => ({
    accountId: a.accountId,
    label: a.accountLabel,
    points: (payload.history[a.accountId] ?? []).map((s) => ({ at: s.capturedAt, valueUsd: s.accountValueUsd })),
  }));
  const hasAgentic = accounts.some((a) => a.accountId === AGENTIC_ID);
  const initialAcct =
    opts.acct && accounts.some((a) => a.accountId === opts.acct) ? opts.acct : hasAgentic ? AGENTIC_ID : (accounts[0]?.accountId ?? null);

  const saved = payload.limits;
  const fields: LimitField[] = LIMIT_FIELDS.map((key) => ({
    key,
    label: LIMIT_LABELS[key].label,
    hint: LIMIT_LABELS[key].hint,
    unit: UNITS[key],
    min: LIMIT_RANGES[key].min,
    max: LIMIT_RANGES[key].max,
    integer: Boolean(LIMIT_RANGES[key].integer),
    stored: saved ? saved[key] : null,
  }));

  const agentTrades = payload.activity.filter((a) => !isHumanTrade(a) && a.accountId === AGENTIC_ID);
  const sample = payload.sample;
  const brokerageTotal = brokerage;

  return {
    payload,
    now,
    unconfigured: feed === 'none' && wallet === 'unconfigured',
    feed,
    wallet,
    feedPill,
    subtitle,
    totalUsd,
    dayPnlUsd: accounts.length ? view.volume.dayPnlUsd : null,
    investedUsd: view.volume.investedUsd,
    investedFrac: brokerageTotal > 0 ? Math.max(0, Math.min(1, view.volume.investedUsd / brokerageTotal)) : null,
    totalHistory: totalHistory(payload.history),
    accounts: rows,
    series,
    initialAcct,
    initialLog: parseLog(opts.log),
    hasAgentic,
    limits: { saved, fields, savedLabel: saved ? `Saved ${ago(saved.updatedAt, now)}` : 'No limits saved' },
    lastAgentTrade: agentTrades[0] ?? null,
    readOnly: sample,
    readOnlyReason: sample ? 'Sample data: limits are read only here' : null,
    fixture: sample ? (payload.mode === 'filming' ? 'Filming fixture, trading' : 'trading sample (?sample=1)') : null,
    copy: {
      subtitleEmpty: `Brokerage and wallet monitor. ${brand} never places an order.`,
      autopilotBody: `The Markets agent will place real orders inside these limits. ${brand} does not place orders itself.`,
    },
  };
}

/** Trade log rows for a filter (re-exported so trees import one module). */
export const logRows = (m: TradingModel, f: ActivityFilter) => filterActivity(m.payload.activity, f);
export { isHumanTrade, AGENTIC_ID, type ActivityFilter };

/** "Markets agent" / "You" for the trade log's who column. */
export const whoOf = (a: Pick<TradeActivity, 'agent'>) => (isHumanTrade(a) ? 'You' : a.agent);

/** One-line order summary: "Buy SPY 1 @ $601.40". */
export function tradeLine(a: Pick<TradeActivity, 'action' | 'symbol' | 'quantity' | 'priceUsd'>): string {
  return `${a.symbol} ${qty(a.quantity)} @ ${usd(a.priceUsd, true)}`;
}

/** Validate one limit input; returns the number or an error sentence. */
export function checkLimit(f: Pick<LimitField, 'label' | 'min' | 'max' | 'integer'>, raw: string): { value: number | null; error: string | null } {
  const t = raw.trim().replace(/[$,%\s]/g, '');
  if (t === '') return { value: null, error: 'Required' };
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, error: 'Enter a number' };
  if (f.integer && !Number.isInteger(n)) return { value: null, error: 'Whole number only' };
  if (n < f.min) return { value: null, error: `At least ${f.min.toLocaleString('en-US')}` };
  if (n > f.max) return { value: null, error: `At most ${f.max.toLocaleString('en-US')}` };
  return { value: n, error: null };
}
