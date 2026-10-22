/**
 * Pure view helpers for /brand-deals (SPEC S02 §7, X4). The page's charts
 * and the tests share these, so the chart can never draw a figure the
 * snapshot does not hold. Client-safe: no node imports.
 */

import type { BrandDealsSnapshot, Deal } from '@/lib/brand-deals';

/** Stage filter keys the board understands (chips, chart columns, slash tokens). */
export type DealFilter = 'all' | 'approval' | 'sent' | 'unique' | 'won' | 'lost' | 'closed';

export type StageBarSegment = { key: 'won' | 'lost'; label: string; usd: number; count: number };

export type StageBarColumn = {
  /** The stage filter a click on this column sets. */
  key: Extract<DealFilter, 'all' | 'sent' | 'approval' | 'closed'>;
  label: string;
  /** Bar height measure (Q-REV-1: the Pipeline chart is drawn in dollars). */
  usd: number;
  /** Secondary figure: how many deals sit in the column. */
  count: number;
  /** Closed only: won over lost, summing to `usd` and `count`. */
  segments?: StageBarSegment[];
};

/**
 * The four Pipeline columns, in order: Announced (every tracked thread),
 * Awaiting brand (sent), Needs approval, Closed (won over lost). The open
 * columns read `volume` directly so they always match the Deal Volume card.
 */
export function stageBars(snap: Pick<BrandDealsSnapshot, 'deals' | 'counts' | 'volume'>): StageBarColumn[] {
  const { deals, counts, volume } = snap;
  const quotedAll = deals.reduce((n, d) => n + (d.quotedUsd ?? 0), 0);
  return [
    { key: 'all', label: 'Announced', usd: quotedAll, count: deals.length },
    { key: 'sent', label: 'Awaiting brand', usd: volume.awaitingUsd, count: counts.sent },
    { key: 'approval', label: 'Needs approval', usd: volume.approvalUsd, count: counts.approval },
    {
      key: 'closed',
      label: 'Closed',
      usd: volume.wonUsd + volume.lostUsd,
      count: counts.won + counts.lost,
      segments: [
        { key: 'won', label: 'Won', usd: volume.wonUsd, count: counts.won },
        { key: 'lost', label: 'Lost', usd: volume.lostUsd, count: counts.lost },
      ],
    },
  ];
}

/* ---------------------------------------------------------- chain depth */

export type ChainDepthBucket = '1' | '2-3' | '4-5' | '6-9' | '10+';

/** The Chains card's columns, shortest thread first. */
export const CHAIN_DEPTH_BUCKETS: readonly ChainDepthBucket[] = ['1', '2-3', '4-5', '6-9', '10+'];

/** Which depth column a thread of `n` cached messages falls in; null when it has none. */
export function chainDepthBucket(n: number): ChainDepthBucket | null {
  if (!Number.isFinite(n) || n < 1) return null;
  if (n === 1) return '1';
  if (n <= 3) return '2-3';
  if (n <= 5) return '4-5';
  if (n <= 9) return '6-9';
  return '10+';
}

/** Deal count per depth column, in `CHAIN_DEPTH_BUCKETS` order. */
export function chainDepthColumns(deals: Pick<Deal, 'chainLen'>[]): { label: ChainDepthBucket; count: number }[] {
  const counts = new Map<ChainDepthBucket, number>(CHAIN_DEPTH_BUCKETS.map((b) => [b, 0]));
  for (const d of deals) {
    const b = chainDepthBucket(d.chainLen);
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return CHAIN_DEPTH_BUCKETS.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

/* ---------------------------------------------------------- poll status */

export type PollStatus = { text: string; tone: 'ok' | 'warn'; title: string };

/**
 * The header's freshness pill (H6): "Updated 12 s ago" from the last
 * successful poll, or a warn line while the latest poll failed. Before the
 * first client tick (`lastOkAt` null) it says nothing it cannot back up.
 */
export function pollStatus(lastOkAt: number | null, now: number, lastError: boolean): PollStatus {
  const exact = lastOkAt != null ? new Date(lastOkAt).toLocaleString('en-US') : null;
  if (lastError) {
    return {
      text: 'Last update failed · retrying',
      tone: 'warn',
      title: exact ? `Last successful update ${exact}. Retrying every 30 s.` : 'No successful update yet. Retrying every 30 s.',
    };
  }
  if (lastOkAt == null) return { text: 'Updating…', tone: 'ok', title: 'Waiting for the first update' };
  const s = Math.max(0, Math.round((now - lastOkAt) / 1000));
  const age = s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`;
  return { text: `Updated ${age} ago`, tone: 'ok', title: `Last update ${exact}. Refreshes every 30 s.` };
}

/* ---------------------------------------------------------- send activity */

export type SendRange = '24h' | '7d' | '30d' | 'all';

/**
 * The Send activity strip's ranges (S02 FR-B4). `all` spans back to the
 * oldest recorded event, so a quiet month still shows its history instead
 * of an empty track (spanMs null = computed from the events).
 */
export const SEND_RANGES: Record<SendRange, { label: string; long: string; ago: string; spanMs: number | null }> = {
  '24h': { label: '24 h', long: 'last 24 hours', ago: '24 h ago', spanMs: 24 * 3600_000 },
  '7d': { label: '7 d', long: 'last 7 days', ago: '7 d ago', spanMs: 7 * 24 * 3600_000 },
  '30d': { label: '30 d', long: 'last 30 days', ago: '30 d ago', spanMs: 30 * 24 * 3600_000 },
  all: { label: 'All', long: 'everything recorded', ago: '', spanMs: null },
};

/** The smallest range that holds at least one event (CE rangeFor rule); `all` when none of the fixed ones do. */
export function sendRangeFor(events: readonly { at: string }[], now: number): SendRange {
  const ages = events.map((e) => now - Date.parse(e.at)).filter((a) => Number.isFinite(a));
  if (ages.length === 0) return '24h';
  for (const k of ['24h', '7d', '30d'] as const) {
    if (ages.some((a) => a <= (SEND_RANGES[k].spanMs as number))) return k;
  }
  return 'all';
}

/** The span (ms) the strip draws for a range: fixed, or back to the oldest event (+4% so it clears the gutter). */
export function sendSpanMs(range: SendRange, events: readonly { at: string }[], now: number): number {
  const fixed = SEND_RANGES[range].spanMs;
  if (fixed !== null) return fixed;
  const oldest = Math.min(now, ...events.map((e) => Date.parse(e.at)).filter((t) => Number.isFinite(t)));
  return Math.max(SEND_RANGES['24h'].spanMs as number, (now - oldest) * 1.04);
}
