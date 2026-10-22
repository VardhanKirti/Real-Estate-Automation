/**
 * YouTube retention reads (06 9.2). Free within quota, so no gatedCall. Every request goes through
 * section 08's labFetch (which refuses non-local hosts in dry). The bearer token comes from 08's
 * googleAccessToken() and is never logged, stored or returned.
 */
import { labFetch } from '@/lib/lab/net';

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
export const MAX_PAGES = 4;

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

async function getJson(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await labFetch(url, auth(token));
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = ((body.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`).slice(0, 200);
    throw new RetentionHttpError(res.status, msg);
  }
  return body;
}

export class RetentionHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RetentionHttpError';
  }
}

/** 06 9.2 step 3, exactly (one video per query). */
export function curveQuery(videoId: string, startDate: string, endDate: string): string {
  return `${ANALYTICS}?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=audienceWatchRatio,relativeRetentionPerformance&dimensions=elapsedVideoTimeRatio&filters=video==${encodeURIComponent(videoId)}`;
}

/** 06 9.2 step 4. */
export function summaryQuery(videoId: string, startDate: string, endDate: string): string {
  return `${ANALYTICS}?ids=channel==MINE&startDate=${startDate}&endDate=${endDate}&metrics=views,averageViewDuration,averageViewPercentage&filters=video==${encodeURIComponent(videoId)}`;
}

/** The channel's uploads (video ids), following nextPageToken up to 4 pages. */
export async function listOwnVideos(token: string, channelId: string): Promise<string[]> {
  const ch = await getJson(`${DATA_API}/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`, token);
  const uploads = ((ch.items as { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] | undefined)?.[0]?.contentDetails?.relatedPlaylists?.uploads) ?? null;
  if (!uploads) return [];
  const ids: string[] = [];
  let page: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const body = await getJson(`${DATA_API}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploads)}&maxResults=50${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, token);
    for (const it of (body.items as { contentDetails?: { videoId?: string } }[] | undefined) ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    page = (body.nextPageToken as string | undefined) ?? null;
    if (!page) break;
  }
  return ids;
}

/** Rows [elapsedVideoTimeRatio, audienceWatchRatio, relativeRetentionPerformance] as curve points. */
export async function fetchRetentionCurve(token: string, videoId: string, startDate: string, endDate: string): Promise<{ x: number; awr: number; rrp: number | null }[]> {
  const body = await getJson(curveQuery(videoId, startDate, endDate), token);
  return ((body.rows as unknown[][] | undefined) ?? [])
    .map((r) => ({ x: Number(r[0]), awr: Number(r[1]), rrp: r[2] === null || r[2] === undefined ? null : Number(r[2]) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.awr));
}

export async function fetchVideoSummary(token: string, videoId: string, startDate: string, endDate: string): Promise<{ views: number | null; averageViewDuration: number | null; averageViewPercentage: number | null }> {
  const body = await getJson(summaryQuery(videoId, startDate, endDate), token);
  const row = ((body.rows as unknown[][] | undefined) ?? [])[0];
  const n = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  return { views: row ? n(row[0]) : null, averageViewDuration: row ? n(row[1]) : null, averageViewPercentage: row ? n(row[2]) : null };
}
