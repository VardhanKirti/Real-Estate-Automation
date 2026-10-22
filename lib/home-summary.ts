/**
 * Pure data for Home (SPEC S01 §7, X4). Both styles read it: the Classic
 * console today, the GladOS heroes in Phase 3. Nothing here renders, fetches
 * or reads the clock implicitly, so every number on Home is unit-testable.
 */
import type { CommsItem } from '@/lib/comms';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Inbound arrivals in the trailing 24 hours, as 24 one-hour buckets, oldest
 * first; bucket 23 is the hour ending `now`. Same window as `inboundLast24h`
 * (cutoff inclusive, future timestamps dropped), so the buckets always sum to
 * that number. An item exactly 24h old falls in bucket 0.
 */
export function hourlyBuckets(items: { ts?: string }[], now: Date = new Date()): number[] {
  const end = now.getTime();
  const counts = new Array<number>(24).fill(0);
  for (const item of items) {
    if (!item.ts) continue;
    const t = Date.parse(item.ts);
    if (!Number.isFinite(t) || t > end || t < end - DAY_MS) continue;
    const back = Math.min(23, Math.floor((end - t) / HOUR_MS));
    counts[23 - back] += 1;
  }
  return counts;
}

/** ISO start of each `hourlyBuckets` bucket, for tick titles. */
export function hourlyBucketStarts(now: Date = new Date()): string[] {
  const end = now.getTime();
  return Array.from({ length: 24 }, (_, i) => new Date(end - (24 - i) * HOUR_MS).toISOString());
}

export type InboundSummary = {
  /** Arrivals in the trailing 24h (equals `inboundLast24h`). */
  count: number;
  /** True when the feed hit its cap while still inside 24h: show `{count}+`, not an exact number (S01 edge 1). */
  capped: boolean;
  /** Of those, how many carry contact priority 1. */
  priority: number;
  /** Distinct sources that delivered in the window. */
  channels: number;
  hourly: number[];
  /** Any comms connector (email, WhatsApp, Slack) connected. False means "Comms not connected", not 0. */
  configured: boolean;
};

const COMMS_CONNECTORS = new Set(['email', 'whatsapp', 'slack']);

/**
 * Everything the Inbound · 24h figure needs. `feedCap` is the limit the feed
 * was gathered with (`gatherCommsFeed(200)`); when the feed is full and its
 * oldest item is still inside 24h, the true count may be higher.
 */
export function inboundSummary(
  feed: CommsItem[],
  connections: { id: string; state: string }[],
  now: Date = new Date(),
  feedCap?: number,
): InboundSummary {
  const end = now.getTime();
  const inWindow = feed.filter((i) => {
    const t = Date.parse(i.ts);
    return Number.isFinite(t) && t >= end - DAY_MS && t <= end;
  });
  const capped = feedCap != null && feed.length >= feedCap && feed.length > 0 && feed.every((i) => {
    const t = Date.parse(i.ts);
    return Number.isFinite(t) && t >= end - DAY_MS;
  });
  return {
    count: inWindow.length,
    capped,
    priority: inWindow.filter((i) => i.priority === 1).length,
    channels: new Set(inWindow.map((i) => i.source)).size,
    hourly: hourlyBuckets(inWindow, now),
    configured: connections.some((c) => COMMS_CONNECTORS.has(c.id) && c.state === 'connected'),
  };
}

export type RevenueSegment = { key: string; label: string; usd: number; share: number };
export type RevenueSummary = {
  total: number;
  /** The largest category; ties keep input order. */
  top: RevenueSegment;
  /** Categories with money in, input order, shares are whole percents summing to exactly 100. */
  segments: RevenueSegment[];
};

/**
 * Total, leader and shares from the same income categories the finance strip
 * and /finances use. Null when there is no money in (the hero then shows its
 * honest empty state, not "$0 · NaN%"). Shares use largest-remainder rounding
 * so they add to 100.
 */
export function revenueSummary(categories: { key: string; label: string; usd: number }[]): RevenueSummary | null {
  const paid = categories.filter((c) => Number.isFinite(c.usd) && c.usd > 0);
  const total = paid.reduce((s, c) => s + c.usd, 0);
  if (total <= 0) return null;

  const raw = paid.map((c) => (c.usd / total) * 100);
  const shares = raw.map(Math.floor);
  let left = 100 - shares.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, rem: v - Math.floor(v) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }

  const segments = paid.map((c, i) => ({ key: c.key, label: c.label, usd: c.usd, share: shares[i] }));
  const top = segments.reduce((best, s) => (s.usd > best.usd ? s : best), segments[0]);
  return { total, top, segments };
}

/** Compact age: "now", "12m", "5h", "46d". Future timestamps read "now". */
export function relAge(iso: string, now: Date = new Date()): string {
  const m = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(m) || m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/**
 * The caption that explains a zero run count (H4): "last run 46d ago", or
 * null when nothing has ever run (the card then shows its empty state).
 */
export function lastRunCaption(lastRunAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!lastRunAt || !Number.isFinite(Date.parse(lastRunAt))) return null;
  const age = relAge(lastRunAt, now);
  return age === 'now' ? 'last run just now' : `last run ${age} ago`;
}
