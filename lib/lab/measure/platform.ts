/**
 * Platform corrections (04 3.8): the YouTube Shorts epoch split, the metric basis per platform
 * (X action score where X shows no views, LinkedIn reactions), and TikTok shares and saves per view.
 * Pure.
 */
import type { LabEpoch, LabMetricBasis, LabPlatform, LabPost } from '@/lib/schemas';

export const SHORTS_EPOCH = '2025-03-31T00:00:00Z';
export type Epoch = LabEpoch;
export type MetricBasis = LabMetricBasis;

type Counters = { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves?: number | null; quotes?: number | null };

/** `yt_shorts_pre_2025_03_31` for a YouTube Short posted before the 2025-03-31 view rule change. */
export function epochOf(post: Pick<LabPost, 'platform' | 'contentType' | 'postedAt'>): Epoch {
  if (post.platform === 'youtube' && post.contentType === 'short' && post.postedAt && Date.parse(post.postedAt) < Date.parse(SHORTS_EPOCH)) return 'yt_shorts_pre_2025_03_31';
  return 'current';
}

/** 0.5 likes + 1 reposts + 5 replies + 5 quotes (xai-org/x-algorithm defaults); null when nothing is known. */
export function xActionScore(m: { likes: number | null; shares: number | null; comments: number | null; quotes: number | null }): number | null {
  if (m.likes === null && m.shares === null && m.comments === null && m.quotes === null) return null;
  return 0.5 * (m.likes ?? 0) + (m.shares ?? 0) + 5 * (m.comments ?? 0) + 5 * (m.quotes ?? 0);
}

/** The basis a platform's ratio is computed on, and its value for one read. */
export function metricBasis(platform: LabPlatform, m: Counters): { basis: MetricBasis; value: number | null } {
  if (platform === 'twitter') {
    if (m.views !== null && m.views !== undefined) return { basis: 'views', value: m.views };
    return { basis: 'x_action', value: xActionScore({ likes: m.likes, shares: m.shares, comments: m.comments, quotes: m.quotes ?? null }) };
  }
  if (platform === 'linkedin') {
    if (m.likes === null && m.comments === null && m.shares === null) return { basis: 'li_reactions', value: null };
    return { basis: 'li_reactions', value: (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) };
  }
  return { basis: 'views', value: m.views };
}

/** The value of one read on a fixed basis (a post keeps one basis across its reads). */
export function basisValue(basis: MetricBasis, m: Counters): number | null {
  if (basis === 'views') return m.views;
  if (basis === 'x_action') return xActionScore({ likes: m.likes, shares: m.shares, comments: m.comments, quotes: m.quotes ?? null });
  if (m.likes === null && m.comments === null && m.shares === null) return null;
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);
}

/** TikTok shares and saves per view; null without views. */
export function perView(m: { views: number | null; shares: number | null; saves: number | null }): { sharesPerView: number | null; savesPerView: number | null } {
  if (m.views === null || !(m.views > 0)) return { sharesPerView: null, savesPerView: null };
  return { sharesPerView: m.shares === null ? null : m.shares / m.views, savesPerView: m.saves === null ? null : m.saves / m.views };
}

/** TikTok bands (3.8), re-cut after 200 tracked TikTok posts ([LIVE-CHECK]). */
export function sharesBand(x: number | null): string | null {
  if (x === null) return null;
  if (x < 0.005) return 'under 0.5%';
  if (x < 0.015) return '0.5-1.5%';
  if (x <= 0.03) return '1.5-3%';
  return 'over 3%';
}
export function savesBand(x: number | null): string | null {
  if (x === null) return null;
  if (x < 0.005) return 'under 0.5%';
  if (x < 0.02) return '0.5-2%';
  if (x <= 0.04) return '2-4%';
  return 'over 4%';
}
