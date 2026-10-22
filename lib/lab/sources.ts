import type { LabFeed, LabPlatform } from '@/lib/schemas';

const HOSTS: [RegExp, LabPlatform][] = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)youtube\.com$/, 'youtube'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(x|twitter)\.com$/, 'twitter'],
];

/** "@who", "who" or a profile URL → { platform, handle } (handle lower-cased, no @). */
export function parseHandle(raw: string, platform?: LabPlatform): { platform: LabPlatform; handle: string; url: string | null } | null {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      const p = HOSTS.find(([re]) => re.test(u.hostname.toLowerCase()))?.[1];
      if (!p) return null;
      const seg = u.pathname.split('/').filter(Boolean);
      const h = p === 'linkedin' ? seg[seg.indexOf('in') + 1] : seg[0];
      if (!h) return null;
      return { platform: p, handle: h.replace(/^@/, '').toLowerCase(), url: u.toString() };
    } catch {
      return null;
    }
  }
  if (!platform) return null;
  const h = v.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._-]{1,100}$/.test(h) ? { platform, handle: h, url: null } : null;
}


/**
 * A trend feed's key (SPEC §4.1): a subreddit for reddit ("r/LocalLLaMA" or "LocalLLaMA"),
 * a search phrase for keyword_search and google_trends, a changelog URL for changelog,
 * and a free label for hn and producthunt (one front page each). Keys keep their case
 * where it matters (subreddits are case-insensitive, so they are lower-cased).
 */
export function parseFeed(feed: LabFeed, raw: string): { platform: LabFeed; handle: string; url: string | null } | null {
  const v = raw.trim();
  if (!v) return null;
  switch (feed) {
    case 'reddit': {
      const m = v.match(/^(?:https?:\/\/(?:www\.|old\.)?reddit\.com)?\/?(?:r\/)?([A-Za-z0-9_]{2,21})\/?$/);
      return m ? { platform: feed, handle: m[1].toLowerCase(), url: `https://www.reddit.com/r/${m[1]}/` } : null;
    }
    case 'changelog': {
      try {
        const u = new URL(v);
        return /^https?:$/.test(u.protocol) ? { platform: feed, handle: `${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase(), url: u.toString() } : null;
      } catch {
        return null;
      }
    }
    default: {
      const phrase = v.replace(/\s+/g, ' ').toLowerCase();
      return /^[\p{L}\p{N} ._#+-]{1,80}$/u.test(phrase) ? { platform: feed, handle: phrase, url: null } : null;
    }
  }
}
