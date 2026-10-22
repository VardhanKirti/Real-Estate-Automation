/**
 * HN via Algolia (05 3.2): one request per poll, every story over 20 points in the last 36 h.
 * Free, no key. Keeps AI_LEXICON titles that are not `Ask HN:` or `Tell HN:`.
 */
import type { FetchLike } from '@/lib/lab/apify-client';
import { AI_LEXICON } from '@/lib/lab/radar/config';
import { emptyRaw, type RawPing } from '@/lib/lab/radar/types';
import { getJson, isRecord, isoOrNull, num, radarFetch, str } from '@/lib/lab/radar/util';
import { nameFromTitle } from '@/lib/lab/radar/names';

export const HN_WINDOW_S = 129_600;
export const HN_MAX_PAGES = 3;

export function hnUrl(now: Date, page = 0): string {
  const since = Math.floor(now.getTime() / 1000) - HN_WINDOW_S;
  return `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=created_at_i>${since},points>20&hitsPerPage=1000${page ? `&page=${page}` : ''}`;
}

export function parseHnRadar(json: unknown): { pings: RawPing[]; nbPages: number } {
  const hits = isRecord(json) && Array.isArray(json.hits) ? json.hits : [];
  const nbPages = isRecord(json) ? (num(json.nbPages) ?? 1) : 1;
  const pings: RawPing[] = [];
  for (const h of hits) {
    if (!isRecord(h)) continue;
    const id = str(h.objectID);
    const title = str(h.title) ?? '';
    if (!id || !title) continue;
    if (/^(ask|tell) hn:/i.test(title.trim())) continue;
    if (!AI_LEXICON.test(title)) continue;
    const stripped = title.replace(/^(show|launch) hn:\s*/i, '');
    pings.push({
      ...emptyRaw('hn', id),
      title,
      url: str(h.url) ?? `https://news.ycombinator.com/item?id=${id}`,
      author: str(h.author),
      sourceTime: isoOrNull(h.created_at),
      metric: num(h.points),
      name: nameFromTitle(stripped),
    });
  }
  return { pings, nbPages };
}

export async function fetchHnRadar(opts: { now?: Date; fetch?: FetchLike } = {}): Promise<RawPing[]> {
  const f = opts.fetch ?? radarFetch;
  const now = opts.now ?? new Date();
  const first = parseHnRadar(await getJson(f, hnUrl(now)));
  const out = [...first.pings];
  for (let p = 1; p < Math.min(first.nbPages, HN_MAX_PAGES); p++) out.push(...parseHnRadar(await getJson(f, hnUrl(now, p))).pings);
  return out;
}

/** 05 9.1 fallback attention series: summed HN points per day for a name since t0 - 30 d. */
export function hnAttentionUrl(name: string, t0: string): string {
  const since = Math.floor(Date.parse(t0) / 1000) - 30 * 86_400;
  return `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(name)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=1000`;
}

export function parseHnAttention(json: unknown): { day: string; v: number }[] {
  const hits = isRecord(json) && Array.isArray(json.hits) ? json.hits : [];
  const byDay = new Map<string, number>();
  for (const h of hits) {
    if (!isRecord(h)) continue;
    const at = isoOrNull(h.created_at);
    if (!at) continue;
    const day = at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (num(h.points) ?? 0));
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, v }));
}
