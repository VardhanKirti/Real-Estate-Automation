/**
 * Product Hunt (05 3.8). With PRODUCTHUNT_TOKEN: v1's GraphQL query (free). Else the Apify
 * actor `s-r/producthunt-launches` on line `apify.radar_producthunt` (run.ts gates it).
 */
import type { FetchLike } from '@/lib/lab/apify-client';
import { AI_LEXICON, PRODUCTHUNT_ACTOR } from '@/lib/lab/radar/config';
import { emptyRaw, type RawPing } from '@/lib/lab/radar/types';
import { HOUR, isRecord, isoOrNull, num, radarFetch, str } from '@/lib/lab/radar/util';
import { fetchProductHunt } from '@/lib/lab/feeds';

export const PH_ACTOR_INPUT = { period: 'daily', date: 'yesterday', limit: 30 } as const;

/** Token path: v1 fetchProductHunt (36 h window) to pings. */
export async function fetchPhRadar(opts: { token: string; now?: Date; fetch?: FetchLike }): Promise<RawPing[]> {
  const now = opts.now ?? new Date();
  // v1 reads 7 days; the Radar keeps the last 36 h (05 3.8)
  const items = await fetchProductHunt({ token: opts.token, now, fetch: opts.fetch ?? radarFetch });
  const after = now.getTime() - 36 * HOUR;
  return items
    .filter((i) => Date.parse(i.at) >= after)
    .map((i) => ({ ...emptyRaw('producthunt', i.externalId), title: i.title, url: i.url, sourceTime: i.at, metric: i.score, name: i.title.split(':')[0].trim() || null }));
}

/** Actor rows `name, tagline, votes, comments, url, topics, date`: keep AI topics or AI_LEXICON matches. */
export function parsePhActor(items: readonly unknown[]): RawPing[] {
  const out: RawPing[] = [];
  for (const r of items) {
    if (!isRecord(r)) continue;
    const name = str(r.name);
    if (!name) continue;
    const tagline = str(r.tagline) ?? '';
    const topics = Array.isArray(r.topics) ? r.topics.map((t) => (typeof t === 'string' ? t : isRecord(t) ? (str(t.name) ?? '') : '')).filter(Boolean) : [];
    if (!topics.includes('Artificial Intelligence') && !AI_LEXICON.test(`${name} ${tagline}`)) continue;
    const url = str(r.url) ?? '';
    out.push({ ...emptyRaw('producthunt', url || name), title: tagline ? `${name}: ${tagline}` : name, url, sourceTime: isoOrNull(r.date), metric: num(r.votes), name, extra: { topics } });
  }
  return out;
}

