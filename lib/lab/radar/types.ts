import type { LabRadarSource } from '@/lib/schemas';

/**
 * One external item as a fetcher or parser returns it, before it becomes a lab_event_pings
 * row (05 5). `upsertPing` turns it into a row: velocity, lexicon, qualification.
 */
export type RawPing = {
  source: Exclude<LabRadarSource, 'wikipedia'>;
  externalId: string;
  title: string;
  url: string;
  author: string | null;
  vendor: string | null;
  /** the item's own time (HN created_at, vendor pubDate, tweet createdAt); null = first seen */
  sourceTime: string | null;
  /** points, trendingScore, stars, votes, rank (tiktok), author count (x synthetic) */
  metric: number | null;
  rank: number | null;
  /** the ping's name when the source names it (05 6.1); null = needs the LLM namer */
  name: string | null;
  isLaunch: boolean;
  isBaseline: boolean;
  /** source-specific facts the qualifying rules need */
  extra: {
    /** HF: repo createdAt; GitHub: repo created_at */
    createdAt?: string | null;
    hfId?: string;
    fullName?: string;
    ownerLogin?: string;
    ownerType?: string;
    topics?: string[];
    /** tiktok_cc: rank yesterday (null = new in list) */
    prevRank?: number | null;
    /** x: tweet text (attach rule) */
    text?: string;
    /** x: author is in VENDOR_X_HANDLES */
    vendorAuthor?: boolean;
  };
};

export const emptyRaw = (source: RawPing['source'], externalId: string): RawPing => ({
  source, externalId, title: '', url: '', author: null, vendor: null, sourceTime: null, metric: null, rank: null, name: null, isLaunch: false, isBaseline: false, extra: {},
});
