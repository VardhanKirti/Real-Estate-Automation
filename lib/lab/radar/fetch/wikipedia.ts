/**
 * Wikipedia pageviews, the class meter (05 3.6, 9.1). Not a detection source. Free; one
 * request per second, at most 40 per tick (the caller throttles).
 */
import type { FetchLike } from '@/lib/lab/apify-client';
import { canonicalKey, keyTokens } from '@/lib/lab/radar/names';
import { getJson, isRecord, num, radarFetch, str } from '@/lib/lab/radar/util';

export const WIKI_MAX_PER_TICK = 40;
export const WIKI_DELAY_MS = 1000;

export const opensearchUrl = (q: string): string => `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=3&format=json`;

const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
export const pageviewsUrl = (article: string, from: string, to: string): string =>
  `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article.replace(/ /g, '_'))}/daily/${ymd(from)}/${ymd(to)}`;

/** Opensearch reply `[q, titles[], descs[], urls[]]`: the first title whose key holds every non-version token of the event key. */
export function pickArticle(json: unknown, eventKey: string): string | null {
  const titles = Array.isArray(json) && Array.isArray(json[1]) ? (json[1] as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const need = keyTokens(eventKey);
  if (!need.length) return null;
  for (const t of titles) {
    const k = canonicalKey(t.replace(/[()]/g, ' '));
    const toks = k.split('-');
    if (need.every((n) => toks.includes(n))) return t;
  }
  return null;
}

export async function resolveArticle(name: string, opts: { fetch?: FetchLike } = {}): Promise<string | null> {
  return pickArticle(await getJson(opts.fetch ?? radarFetch, opensearchUrl(name)), canonicalKey(name));
}

/** `{ items: [{ timestamp: 'YYYYMMDD00', views }] }` to `[{ day: 'YYYY-MM-DD', v }]`. */
export function parsePageviews(json: unknown): { day: string; v: number }[] {
  const items = isRecord(json) && Array.isArray(json.items) ? json.items : [];
  const out: { day: string; v: number }[] = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const ts = str(it.timestamp);
    const v = num(it.views);
    if (!ts || ts.length < 8 || v === null) continue;
    out.push({ day: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`, v });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

export async function fetchPageviews(article: string, from: string, to: string, opts: { fetch?: FetchLike } = {}): Promise<{ day: string; v: number }[]> {
  return parsePageviews(await getJson(opts.fetch ?? radarFetch, pageviewsUrl(article, from, to)));
}
