import { z } from 'zod';

/**
 * AdPilot campaign layer — paid-media performance for the /adpilot deck.
 * Reads data/adpilot-campaigns.json. Until a real ad account is connected
 * (Foreplay Lens / Meta), the file carries staged numbers on the operator's real
 * offers; the read path, schemas, and every derived metric are the
 * production ones, so connecting the account later swaps the file's
 * producer, not the page.
 */

export const GeoPointSchema = z.object({
  city: z.string(),
  country: z.string(),
  lat: z.number(),
  lng: z.number(),
  leads: z.number().int().min(0),
  bookings: z.number().int().min(0),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

/** One day of delivery — Meta insights provide this natively; the staged
 *  file carries plausible dailies so widgets are identical either way. */
export const DailyPointSchema = z.object({
  date: z.string(),
  spend: z.number(),
  leads: z.number(),
  bookings: z.number(),
});
export type DailyPoint = z.infer<typeof DailyPointSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  objective: z.enum(['leads', 'bookings', 'purchases']),
  status: z.enum(['active', 'paused']),
  platform: z.string(),
  period: z.object({ from: z.string(), to: z.string() }),
  spend: z.number(),
  impressions: z.number(),
  clicks: z.number(),
  leads: z.number(),
  bookings: z.number(),
  purchases: z.number(),
  revenue: z.number(),
  audience: z.object({
    age: z.record(z.string(), z.number()),
    gender: z.record(z.string(), z.number()),
    placements: z.record(z.string(), z.number()),
  }),
  geo: z.array(GeoPointSchema),
  daily: z.array(DailyPointSchema).optional(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

/** Merge per-campaign dailies into one series (the "All campaigns" chart). */
export function aggregateDaily(campaigns: Campaign[]): DailyPoint[] {
  const merged = new Map<string, DailyPoint>();
  for (const c of campaigns) {
    for (const d of c.daily ?? []) {
      const hit = merged.get(d.date);
      if (hit) {
        hit.spend += d.spend;
        hit.leads += d.leads;
        hit.bookings += d.bookings;
      } else {
        merged.set(d.date, { ...d });
      }
    }
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type CampaignMetrics = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  bookings: number;
  purchases: number;
  revenue: number;
  ctr: number | null; // clicks / impressions
  cpl: number | null; // spend / leads
  costPerBooking: number | null;
  costPerResult: number | null; // per the objective's unit (aggregate: per booking)
  roas: number | null; // revenue / spend
};

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function campaignMetrics(c: Pick<Campaign, 'spend' | 'impressions' | 'clicks' | 'leads' | 'bookings' | 'purchases' | 'revenue'> & { objective?: Campaign['objective'] }): CampaignMetrics {
  const resultCount =
    c.objective === 'leads' ? c.leads : c.objective === 'purchases' ? c.purchases : c.bookings;
  return {
    spend: c.spend,
    impressions: c.impressions,
    clicks: c.clicks,
    leads: c.leads,
    bookings: c.bookings,
    purchases: c.purchases,
    revenue: c.revenue,
    ctr: ratio(c.clicks, c.impressions),
    cpl: ratio(c.spend, c.leads),
    costPerBooking: ratio(c.spend, c.bookings),
    costPerResult: ratio(c.spend, resultCount),
    roas: ratio(c.revenue, c.spend),
  };
}

/** Sum a set of campaigns into the "All campaigns" view. */
export function aggregateCampaigns(campaigns: Campaign[]): CampaignMetrics {
  const sum = campaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      leads: acc.leads + c.leads,
      bookings: acc.bookings + c.bookings,
      purchases: acc.purchases + c.purchases,
      revenue: acc.revenue + c.revenue,
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, bookings: 0, purchases: 0, revenue: 0 },
  );
  return campaignMetrics(sum);
}

/** Merge geo points across campaigns (same city+country rows sum). */
export function aggregateGeo(campaigns: Campaign[]): GeoPoint[] {
  const merged = new Map<string, GeoPoint>();
  for (const c of campaigns) {
    for (const g of c.geo) {
      const key = `${g.city}|${g.country}`;
      const hit = merged.get(key);
      if (hit) {
        hit.leads += g.leads;
        hit.bookings += g.bookings;
      } else {
        merged.set(key, { ...g });
      }
    }
  }
  return [...merged.values()].sort((a, b) => b.leads - a.leads);
}

/** Spend-weighted merge of audience breakdown shares. */
export function aggregateAudience(campaigns: Campaign[]): Campaign['audience'] {
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0) || 1;
  const merge = (pick: (c: Campaign) => Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const c of campaigns) {
      const w = c.spend / totalSpend;
      for (const [k, v] of Object.entries(pick(c))) out[k] = (out[k] ?? 0) + v * w;
    }
    for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 10) / 10;
    return out;
  };
  return {
    age: merge((c) => c.audience.age),
    gender: merge((c) => c.audience.gender),
    placements: merge((c) => c.audience.placements),
  };
}

/** Signal de-duplication (SPEC X5) lives with the signal engine; re-exported for AdPilot callers. */
export { dedupeSignals, type DedupedSignal, type DedupeOptions } from '@/lib/foreplay/signals';

/* ── Deck helpers (SPEC S01 F6, F7, F9, F11, F24) ── */

const DAY_MS = 86_400_000;

/**
 * The window the deck's numbers cover, in days (S01 F7, AC01.10). The
 * metrics are summed over the daily series when one exists, so its length
 * wins: the count of distinct dates across the selection. Without dailies,
 * the inclusive span of the union of `period` ranges. Null when there is
 * nothing to measure (no campaigns, or unparseable periods).
 */
export function periodDays(campaigns: Pick<Campaign, 'period' | 'daily'>[]): number | null {
  if (campaigns.length === 0) return null;
  const dates = new Set<string>();
  for (const c of campaigns) for (const d of c.daily ?? []) dates.add(d.date);
  if (dates.size > 0) return dates.size;
  let from = Infinity;
  let to = -Infinity;
  for (const c of campaigns) {
    const f = Date.parse(`${c.period.from}T00:00:00Z`);
    const t = Date.parse(`${c.period.to}T00:00:00Z`);
    if (!Number.isFinite(f) || !Number.isFinite(t)) continue;
    from = Math.min(from, f);
    to = Math.max(to, t);
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / DAY_MS) + 1;
}

export type AlignedRow<T> = { item: T; cells: (DailyPoint | null)[] };

/**
 * Line every campaign's dailies up on one date axis (S01 §8 edge 5): the
 * sorted union of dates, each row holding its point for that date or null.
 * Rows align by date key, never by index, so campaigns with different
 * ranges still read in the same column.
 */
export function alignDaily<T extends { daily?: DailyPoint[] }>(items: T[]): { dates: string[]; rows: AlignedRow<T>[] } {
  const all = new Set<string>();
  for (const it of items) for (const d of it.daily ?? []) all.add(d.date);
  const dates = [...all].sort();
  const rows = items.map((item) => {
    const byDate = new Map((item.daily ?? []).map((d) => [d.date, d]));
    return { item, cells: dates.map((d) => byDate.get(d) ?? null) };
  });
  return { dates, rows };
}

/** Short relative time against an explicit `now`, so server and client render the same text. */
export function relativeAgo(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'never';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** A sync older than this reads as stale on the status chip (S01 F6). */
export const SYNC_STALE_MS = 48 * 3_600_000;

export function isStale(iso: string | null, now: number, maxAgeMs = SYNC_STALE_MS): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t > maxAgeMs;
}

/**
 * Normalise what someone typed into the Track-brand box into a bare domain
 * (S01 F24): strips scheme, `www.`, path, query and port; lower-cases.
 * Null when the result is not domain-shaped, so nothing is POSTed.
 */
export function parseBrandDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (s.length < 4 || s.length > 120) return null;
  return /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(s) ? s : null;
}

/** Roving focus for a row of options (rail pills, tabs): the next index for a key, or null. */
export function rovingIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** Signal-strength alpha for a delivery dot / legend dot (0 = quiet day). */
export function deliveryAlpha(t: number): number {
  if (!(t > 0.02)) return 0;
  return Math.round((0.1 + Math.pow(Math.min(t, 1), 1.7) * 0.88) * 100) / 100;
}
