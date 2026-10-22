/**
 * Instagram insights reads (06 9.2), API with Instagram Login, v25.0. Free, no gatedCall, through
 * section 08's labFetch. The long-lived token (LAB_IG_ACCESS_TOKEN, written by 08) is sent as a
 * bearer header and never logged, stored or returned.
 */
import { labFetch } from '@/lib/lab/net';
import { MAX_PAGES, RetentionHttpError } from '@/lib/lab/ledger/retention/youtube';

const GRAPH = 'https://graph.instagram.com/v25.0';
/** [LIVE-CHECK] LC-06-5: ig_reels_avg_watch_time expected in milliseconds; set to 1000 if it is seconds. */
export const AVG_WATCH_UNIT_MS = 1;
/** [LIVE-CHECK] LC-06-5: reels_skip_rate expected 0 to 100; set to 100 if it comes back 0 to 1. */
export const SKIP_RATE_SCALE = 1;
export const REEL_METRICS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate'] as const;

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function getJson(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await labFetch(url, auth(token));
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new RetentionHttpError(res.status, ((body.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`).slice(0, 200));
  return body;
}

export type IgMedia = { id: string; mediaProductType: string | null; shortcode: string | null; timestamp: string | null };

export function mediaListUrl(): string {
  return `${GRAPH}/me/media?fields=id,media_product_type,media_type,permalink,shortcode,timestamp&limit=50`;
}
export function insightsUrl(mediaId: string): string {
  return `${GRAPH}/${encodeURIComponent(mediaId)}/insights?metric=${REEL_METRICS.join(',')}`;
}

/** Own media, following paging.next (same host only) up to 4 pages. */
export async function listOwnMedia(token: string): Promise<IgMedia[]> {
  const out: IgMedia[] = [];
  let url: string | null = mediaListUrl();
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const body = await getJson(url, token);
    for (const m of (body.data as Record<string, unknown>[] | undefined) ?? []) {
      out.push({ id: String(m.id), mediaProductType: (m.media_product_type as string) ?? null, shortcode: (m.shortcode as string) ?? null, timestamp: (m.timestamp as string) ?? null });
    }
    const next = (body.paging as { next?: string } | undefined)?.next ?? null;
    // the page link may carry the token as a query param; strip it, the header carries auth
    url = next && next.startsWith(GRAPH) ? next.replace(/([?&])access_token=[^&]*&?/, '$1').replace(/[?&]$/, '') : null;
  }
  return out;
}

export type ReelInsights = { reach: number | null; views: number | null; likes: number | null; comments: number | null; saved: number | null; shares: number | null; totalInteractions: number | null; avgWatchTimeMs: number | null; totalWatchTimeMs: number | null; skipRate: number | null };

/** Missing metrics come back absent (empty data, not 0, per Meta): stored as null. */
export function parseInsights(body: { data?: { name: string; values?: { value: unknown }[] }[] }): ReelInsights {
  const get = (name: string): number | null => {
    const v = body.data?.find((d) => d.name === name)?.values?.[0]?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const avg = get('ig_reels_avg_watch_time');
  const total = get('ig_reels_video_view_total_time');
  const skip = get('reels_skip_rate');
  return {
    reach: get('reach'), views: get('views'), likes: get('likes'), comments: get('comments'), saved: get('saved'), shares: get('shares'), totalInteractions: get('total_interactions'),
    avgWatchTimeMs: avg !== null ? avg * AVG_WATCH_UNIT_MS : null, totalWatchTimeMs: total !== null ? total * AVG_WATCH_UNIT_MS : null,
    skipRate: skip !== null ? Math.max(0, Math.min(100, skip * SKIP_RATE_SCALE)) : null,
  };
}

export async function fetchReelInsights(token: string, mediaId: string): Promise<ReelInsights> {
  return parseInsights((await getJson(insightsUrl(mediaId), token)) as { data?: { name: string; values?: { value: unknown }[] }[] });
}
