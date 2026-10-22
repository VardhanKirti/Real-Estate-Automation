/**
 * Vendor posts (05 3.5): RSS, Atom, and link diff for the pages with no feed. A vendor ping is
 * a launch ping when its title matches LAUNCH_RE. The first poll of a link-diff page stores every
 * slug as a baseline ping (never a candidate, AC-05-14).
 */
import type { FetchLike } from '@/lib/lab/apify-client';
import { AI_LEXICON, VENDOR_FEEDS, isLaunchText, type VendorFeed } from '@/lib/lab/radar/config';
import { emptyRaw, type RawPing } from '@/lib/lab/radar/types';
import { getText, isoOrNull, radarFetch } from '@/lib/lab/radar/util';
import { nameFromTitle } from '@/lib/lab/radar/names';

export type FeedEntry = { title: string; link: string; id: string; at: string | null };

const decode = (s: string): string =>
  s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .trim();

const tag = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : null;
};

/** RSS 2.0: `<item>` with title, link, guid, pubDate (CDATA and single-line feeds included). */
export function parseRss(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const title = tag(b, 'title') ?? '';
    const link = tag(b, 'link') ?? '';
    const id = tag(b, 'guid') ?? link;
    if (!title && !link) continue;
    out.push({ title, link, id: id || title, at: isoOrNull(tag(b, 'pubDate') ?? tag(b, 'dc:date')) });
  }
  return out;
}

/** Atom: `<entry>` with title, link href, id, updated. */
export function parseAtom(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) {
    const b = m[1];
    const title = tag(b, 'title') ?? '';
    const link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '';
    const id = tag(b, 'id') ?? link;
    out.push({ title, link, id: id || title, at: isoOrNull(tag(b, 'updated') ?? tag(b, 'published')) });
  }
  return out;
}

/** Link diff: the slug set of a page. */
export function parseLinkDiff(html: string, slugRe: RegExp): string[] {
  const re = new RegExp(slugRe.source, slugRe.flags.includes('g') ? slugRe.flags : `${slugRe.flags}g`);
  return [...new Set([...html.matchAll(re)].map((m) => m[1]).filter(Boolean))];
}

export const slugTitle = (slug: string): string => slug.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const isLaunchTitle = (title: string): boolean => isLaunchText(title);

function entryPing(feed: VendorFeed, e: FeedEntry): RawPing | null {
  if (feed.lexiconFilter && !AI_LEXICON.test(e.title)) return null;
  return {
    ...emptyRaw('vendor', `${feed.vendor}:${e.id}`.slice(0, 300)),
    title: e.title,
    url: e.link,
    author: feed.vendor,
    vendor: feed.vendor,
    sourceTime: e.at,
    name: nameFromTitle(e.title),
    isLaunch: isLaunchTitle(e.title),
  };
}

/** Pings for one feed's body. `knownSlugs` = slugs already stored for a link-diff page (empty = first poll). */
export function vendorPings(feed: VendorFeed, body: string, knownSlugs: ReadonlySet<string>): RawPing[] {
  if (feed.kind === 'link_diff') {
    const slugs = parseLinkDiff(body, feed.slugRe!);
    const first = knownSlugs.size === 0;
    return slugs
      .filter((s) => first || !knownSlugs.has(s))
      .map((slug) => {
        const title = slugTitle(slug);
        return {
          ...emptyRaw('vendor', `${feed.vendor}:${slug}`),
          title,
          url: `${feed.base}${slug}`,
          author: feed.vendor,
          vendor: feed.vendor,
          sourceTime: null,
          name: first ? null : nameFromTitle(title),
          isLaunch: first ? false : isLaunchTitle(title),
          isBaseline: first,
        };
      });
  }
  const entries = /<entry[\s>]/i.test(body) && !/<item[\s>]/i.test(body) ? parseAtom(body) : parseRss(body);
  return entries.map((e) => entryPing(feed, e)).filter((p): p is RawPing => p !== null);
}

/**
 * Poll every vendor feed. One failing feed is reported and the rest continue.
 * `knownSlugs(feed)` gives the stored slugs of a link-diff page.
 */
export async function fetchVendor(opts: { fetch?: FetchLike; feeds?: readonly VendorFeed[]; knownSlugs?: (feed: VendorFeed) => ReadonlySet<string> } = {}): Promise<{ pings: RawPing[]; errors: { url: string; error: string }[] }> {
  const f = opts.fetch ?? radarFetch;
  const pings: RawPing[] = [];
  const errors: { url: string; error: string }[] = [];
  for (const feed of opts.feeds ?? VENDOR_FEEDS) {
    try {
      const body = await getText(f, feed.url);
      pings.push(...vendorPings(feed, body, opts.knownSlugs?.(feed) ?? new Set()));
    } catch (err) {
      errors.push({ url: feed.url, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { pings, errors };
}
