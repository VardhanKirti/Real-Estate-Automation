/**
 * TikTok Creative Center hashtags through Apify `rastriq/tiktok-trends-scraper` (05 3.9),
 * line `apify.radar_tiktok`. Keeps AI_LEXICON hashtags. Metric = rank (lower is better).
 */
import { AI_LEXICON, TIKTOK_CC_ACTOR } from '@/lib/lab/radar/config';
import { emptyRaw, type RawPing } from '@/lib/lab/radar/types';
import { isRecord, isoOrNull, num, str } from '@/lib/lab/radar/util';

export const TIKTOK_CC_INPUT = { countries: ['US'], period: '7', maxItemsPerType: 50, trendTypes: ['hashtags'], includeDetails: false } as const;

/** Hashtags run words together (`veo3`, `soraai`): split digits and a trailing `ai` before the lexicon test. */
export const isAiHashtag = (tag: string): boolean => AI_LEXICON.test(tag) || AI_LEXICON.test(tag.replace(/(\d+)/g, ' $1 ').replace(/([a-z])(ai)$/i, '$1 $2'));

export function parseTiktokCc(items: readonly unknown[]): RawPing[] {
  const out: RawPing[] = [];
  for (const r of items) {
    if (!isRecord(r)) continue;
    if (str(r.type) && str(r.type) !== 'hashtag' && str(r.type) !== 'hashtags') continue;
    const tag = str(r.hashtag_name);
    if (!tag || !isAiHashtag(tag)) continue;
    const rank = num(r.rank);
    out.push({
      ...emptyRaw('tiktok_cc', str(r.hashtag_id) ?? tag),
      title: `#${tag}`,
      url: str(r.detail_url) ?? `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`,
      sourceTime: isoOrNull(r.scraped_at),
      metric: rank,
      rank: rank === null ? null : Math.round(rank),
      name: tag,
    });
  }
  return out;
}

