/**
 * X watch list through Apify `apidojo/tweet-scraper` (05 3.7). One actor run per poll, one
 * OR-combined `from:` search term per 20 handles (per-handle queries would each pay the
 * 50-tweet minimum). Starting the run goes through the gate on line `apify.radar_x` (run.ts).
 */
import { VENDOR_X_HANDLES, X_ACTOR, isLaunchText } from '@/lib/lab/radar/config';
import { emptyRaw, type RawPing } from '@/lib/lab/radar/types';
import { DAY, isRecord, isoOrNull, num, str } from '@/lib/lab/radar/util';

export const X_WATCH_MAX_HANDLES = 20;
export const X_WATCH_MAX_ITEMS = 100;

/** 05 3.7: handles sorted, lowercased, deduped, chunked; one term per chunk. */
export function xWatchInput(handles: string[], lastOkAt: string | null): { searchTerms: string[]; maxItems: number; sort: 'Latest'; start?: string } {
  const clean = [...new Set(handles.map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < clean.length; i += X_WATCH_MAX_HANDLES) chunks.push(clean.slice(i, i + X_WATCH_MAX_HANDLES));
  const searchTerms = chunks.map((c) => `(${c.map((h) => `from:${h}`).join(' OR ')}) -filter:replies`);
  const out: { searchTerms: string[]; maxItems: number; sort: 'Latest'; start?: string } = { searchTerms, maxItems: X_WATCH_MAX_ITEMS * chunks.length, sort: 'Latest' };
  if (lastOkAt) out.start = new Date(Date.parse(lastOkAt) - DAY).toISOString().slice(0, 10);
  return out;
}

const VENDOR_SET = new Set(VENDOR_X_HANDLES.map((h) => h.toLowerCase()));

/** Tweets to pings. A vendor-handle tweet matching LAUNCH_RE is a launch ping (its name comes from the LLM namer). */
export function parseTweets(items: readonly unknown[]): RawPing[] {
  const seen = new Set<string>();
  const out: RawPing[] = [];
  for (const t of items) {
    if (!isRecord(t)) continue;
    const id = str(t.id) ?? (num(t.id) !== null ? String(t.id) : null);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const author = isRecord(t.author) ? str(t.author.userName) : null;
    const text = str(t.text) ?? '';
    const vendorAuthor = author ? VENDOR_SET.has(author.toLowerCase()) : false;
    out.push({
      ...emptyRaw('x', id),
      title: text.slice(0, 280),
      url: str(t.url) ?? (author ? `https://x.com/${author}/status/${id}` : ''),
      author,
      vendor: vendorAuthor ? author : null,
      sourceTime: isoOrNull(t.createdAt),
      metric: num(t.likeCount),
      isLaunch: vendorAuthor && isLaunchText(text),
      extra: { text, vendorAuthor },
    });
  }
  return out;
}

