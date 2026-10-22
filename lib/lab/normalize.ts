import type { LabPlatform } from '@/lib/schemas';

/**
 * Apify dataset items → one post shape (SPEC §4.3). Field maps ported from CINTEL's
 * `supabase/functions/_shared/postNormalizer.ts` with two deliberate differences:
 *
 * 1. Honest-or-absent counters. CINTEL writes `saves: 0` and `shares: 0` where a
 *    platform returns nothing (IG, YouTube, LinkedIn). Here a counter the item does not
 *    carry is `null`, and a real 0 stays 0 (CINTEL's `a || b || 0` chains turned a real
 *    0 into "fall through"; `firstNumber` does not).
 * 2. No views, no rate. An IG image has no view count: `views` is null and nothing
 *    downstream divides by a fallback.
 *
 * Pure: no store, no clock. lib/lab/apify-client.ts fetches the items; the sync lane
 * upserts what this returns.
 */

/** `quotes` is X only (04 2.2); every counter is non-negative or null (Instagram reports a hidden like count as -1). */
export type NormalizedMetrics = { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; quotes?: number | null };

export type NormalizedPost = {
  platform: LabPlatform;
  externalId: string;
  url: string;
  caption: string;
  /** video | reel | short | carousel | image | text */
  contentType: string;
  postedAt: string | null;
  durationS: number | null;
  thumbnailUrl: string | null;
  /** The playable media (short-form transcription source) or the image. */
  mediaUrl: string | null;
  hashtags: string[];
  mentions: string[];
  /** Subtitles the actor returned (YouTube), or null. */
  transcript: string | null;
  /** The author handle the item names, lower-cased, without @. */
  authorHandle: string | null;
  metrics: NormalizedMetrics;
};

export type NormalizedProfile = { platform: LabPlatform; handle: string; displayName: string | null; followers: number | null; following: number | null; postCount: number | null; avatarUrl: string | null };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Item = Record<string, any>;

/** The first argument that is a finite number (a real 0 counts). Numeric strings parse. */
export function firstNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** A counter below 0 (Instagram's -1 for hidden likes) is unknown, not a count (04 2.2). */
export const nonNegative = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) || v < 0 ? null : v);
const clean = (m: NormalizedMetrics): NormalizedMetrics => {
  const out: NormalizedMetrics = { views: nonNegative(m.views), likes: nonNegative(m.likes), comments: nonNegative(m.comments), shares: nonNegative(m.shares), saves: nonNegative(m.saves) };
  if (m.quotes !== undefined) out.quotes = nonNegative(m.quotes);
  return out;
};

/** ISO 8601 (PT1M5S), MM:SS, HH:MM:SS or seconds → seconds; null when unknown or 0. */
export function parseDuration(d: unknown): number | null {
  if (typeof d === 'number') return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
  if (typeof d !== 'string' || !d.trim()) return null;
  const iso = d.match(/^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (iso && (iso[1] || iso[2] || iso[3])) {
    const s = Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0);
    return s > 0 ? Math.round(s) : null;
  }
  const parts = d.split(':').map(Number);
  if (parts.length >= 2 && parts.every((p) => Number.isFinite(p))) {
    const s = parts.reduce((acc, v) => acc * 60 + v, 0);
    return s > 0 ? s : null;
  }
  const num = Number(d);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
}

/** Seconds or milliseconds epoch, or a date string → ISO; null when unparseable. */
export function parseTimestamp(ts: unknown): string | null {
  if (ts === null || ts === undefined || ts === '') return null;
  if (typeof ts === 'number') {
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return new Date(ts > 1e10 ? ts : ts * 1000).toISOString();
  }
  if (typeof ts === 'string') {
    if (/^\d+$/.test(ts)) return parseTimestamp(Number(ts));
    const t = Date.parse(ts);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

export function extractHashtags(text: string | null | undefined): string[] {
  return text ? (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.slice(1)) : [];
}
export function extractMentions(text: string | null | undefined): string[] {
  return text ? (text.match(/@[\w.]+/g) ?? []).map((m) => m.slice(1).replace(/\.$/, '')) : [];
}

const str = (...vals: unknown[]): string | null => {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v;
  return null;
};
const strList = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : typeof x?.name === 'string' ? x.name : typeof x?.text === 'string' ? x.text : '')).filter(Boolean) : null;
const handle = (h: string | null): string | null => (h ? h.replace(/^@/, '').toLowerCase() : null);

function normalizeInstagram(item: Item): NormalizedPost | null {
  const caption = str(item.caption, item.text) ?? '';
  const id = str(item.shortCode, item.id, item.shortcode);
  const url = str(item.url) ?? (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null);
  if (!id || !url) return null;
  const isVideo = Boolean(item.videoUrl) || item.type === 'Video' || item.productType === 'clips';
  return {
    platform: 'instagram',
    externalId: String(id),
    url,
    caption,
    contentType: item.type === 'Sidecar' ? 'carousel' : isVideo ? (item.productType === 'clips' || item.type === 'Video' ? 'reel' : 'video') : 'image',
    postedAt: parseTimestamp(item.timestamp ?? item.takenAtTimestamp),
    durationS: parseDuration(item.videoDuration ?? item.duration),
    thumbnailUrl: str(item.displayUrl, item.thumbnailUrl),
    mediaUrl: str(item.videoUrl, item.displayUrl),
    hashtags: strList(item.hashtags) ?? extractHashtags(caption),
    mentions: strList(item.mentions) ?? extractMentions(caption),
    transcript: null,
    authorHandle: handle(str(item.ownerUsername, item.owner?.username)),
    metrics: {
      views: isVideo ? firstNumber(item.videoViewCount, item.videoPlayCount, item.playCount) : null,
      likes: firstNumber(item.likesCount, item.likeCount),
      comments: firstNumber(item.commentsCount, item.commentCount),
      shares: firstNumber(item.sharesCount, item.reshareCount),
      // the post scraper does not return saves: absent, not 0
      saves: firstNumber(item.savesCount, item.saveCount),
    },
  };
}

function normalizeYoutube(item: Item): NormalizedPost | null {
  const id = str(item.id, item.videoId);
  if (!id) return null;
  const caption = str(item.title, item.text) ?? '';
  const subs = Array.isArray(item.subtitles)
    ? item.subtitles.map((s: Item) => str(s?.plaintext, s?.srt, s?.text) ?? '').filter(Boolean).join('\n') || null
    : str(item.subtitles, item.transcript);
  // a Short: the flag, a /shorts/ url, or the item came from a /shorts start URL ([LIVE-CHECK] key: input or fromUrl)
  const origin = String((typeof item.input === 'string' ? item.input : item.input?.url) ?? item.fromUrl ?? '');
  const isShort = Boolean(item.isShort) || /\/shorts\//.test(String(item.url ?? '')) || /\/shorts\/?(\?|$)/.test(origin);
  return {
    platform: 'youtube',
    externalId: id,
    url: str(item.url) ?? `https://www.youtube.com/watch?v=${id}`,
    caption,
    contentType: isShort ? 'short' : 'video',
    postedAt: parseTimestamp(item.date ?? item.uploadDate ?? item.publishedAt),
    durationS: parseDuration(item.duration),
    thumbnailUrl: str(item.thumbnailUrl, item.thumbnail),
    mediaUrl: str(item.url),
    hashtags: strList(item.hashtags) ?? strList(item.tags) ?? extractHashtags(caption),
    mentions: extractMentions(str(item.text, item.description) ?? ''),
    transcript: subs,
    authorHandle: handle(str(item.channelUsername, item.channelHandle, item.channelName)),
    metrics: {
      views: firstNumber(item.viewCount, item.views),
      likes: firstNumber(item.likes, item.likeCount),
      comments: firstNumber(item.commentsCount, item.commentCount),
      shares: null,
      saves: null,
    },
  };
}

function normalizeTiktok(item: Item): NormalizedPost | null {
  const id = str(item.id, item.videoId);
  const author = str(item.authorMeta?.name, item.author?.uniqueId);
  const url = str(item.webVideoUrl, item.url) ?? (id && author ? `https://www.tiktok.com/@${author}/video/${id}` : null);
  if (!id || !url) return null;
  const caption = str(item.text, item.desc) ?? '';
  return {
    platform: 'tiktok',
    externalId: id,
    url,
    caption,
    contentType: item.isSlideshow || Array.isArray(item.slideshowImageLinks) ? 'carousel' : 'video',
    postedAt: parseTimestamp(item.createTimeISO ?? item.createTime),
    durationS: parseDuration(item.videoMeta?.duration ?? item.duration),
    thumbnailUrl: str(item.videoMeta?.coverUrl, item.coverUrl, item.cover),
    // shouldDownloadVideos:true puts a downloadable file in mediaUrls; videoUrl on older shapes
    mediaUrl: str(Array.isArray(item.mediaUrls) ? item.mediaUrls[0] : null, item.videoMeta?.downloadAddr, item.videoUrl),
    hashtags: strList(item.hashtags) ?? extractHashtags(caption),
    mentions: strList(item.mentions) ?? extractMentions(caption),
    transcript: null,
    authorHandle: handle(author),
    metrics: {
      views: firstNumber(item.playCount, item.views),
      likes: firstNumber(item.diggCount, item.likes),
      comments: firstNumber(item.commentCount, item.comments),
      shares: firstNumber(item.shareCount),
      saves: firstNumber(item.collectCount),
    },
  };
}

function normalizeTwitter(item: Item): NormalizedPost | null {
  const id = str(item.id, item.id_str);
  if (!id) return null;
  const caption = str(item.fullText, item.full_text, item.text) ?? '';
  const media = item.extendedEntities?.media?.[0] ?? item.extended_entities?.media?.[0] ?? item.entities?.media?.[0];
  const variants: Item[] = media?.video_info?.variants ?? [];
  const videoUrl = variants.filter((v) => v.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url ?? null;
  return {
    platform: 'twitter',
    externalId: id,
    url: str(item.url, item.twitterUrl) ?? `https://x.com/i/status/${id}`,
    caption,
    contentType: videoUrl ? 'video' : media ? 'image' : 'text',
    postedAt: parseTimestamp(item.createdAt ?? item.created_at),
    durationS: parseDuration(media?.video_info?.duration_millis ? media.video_info.duration_millis / 1000 : null),
    thumbnailUrl: str(media?.media_url_https),
    mediaUrl: videoUrl ?? str(media?.media_url_https),
    hashtags: (item.entities?.hashtags ?? []).map((h: Item) => h.text).filter(Boolean),
    mentions: (item.entities?.user_mentions ?? []).map((m: Item) => m.screen_name).filter(Boolean),
    transcript: null,
    authorHandle: handle(str(item.author?.userName, item.user?.screen_name)),
    metrics: {
      views: firstNumber(item.viewCount, item.views, item.view_count),
      likes: firstNumber(item.likeCount, item.favorite_count),
      comments: firstNumber(item.replyCount, item.reply_count),
      shares: firstNumber(item.retweetCount, item.retweet_count),
      saves: firstNumber(item.bookmarkCount, item.bookmark_count),
      quotes: firstNumber(item.quoteCount, item.quote_count),
    },
  };
}

function normalizeLinkedin(item: Item): NormalizedPost | null {
  const id = str(item.shareUrn, item.entityId, item.urn, item.id);
  const url = str(item.linkedinUrl, item.url, item.postUrl);
  if (!id || !url) return null;
  const caption = str(item.content, item.text, item.commentary) ?? '';
  const images = Array.isArray(item.postImages) ? item.postImages : [];
  const postedRaw = item.postedAt?.date ?? item.postedAt?.timestamp ?? item.postedAt;
  return {
    platform: 'linkedin',
    externalId: id,
    url,
    caption,
    contentType: item.videoUrl || item.postVideo ? 'video' : images.length > 1 ? 'carousel' : item.image || images.length === 1 ? 'image' : 'text',
    postedAt: parseTimestamp(postedRaw),
    durationS: parseDuration(item.postVideo?.duration ?? null),
    thumbnailUrl: str(images[0]?.url, item.image),
    mediaUrl: str(item.videoUrl, item.postVideo?.videoUrl, images[0]?.url, item.image),
    hashtags: strList(item.hashtags) ?? extractHashtags(caption),
    mentions: extractMentions(caption),
    transcript: null,
    authorHandle: handle(str(item.author?.publicIdentifier, String(item.authorProfileUrl ?? '').match(/\/(?:in|company)\/([^/?#]+)/)?.[1] ?? null)),
    metrics: {
      // LinkedIn exposes impressions only to the author; competitors' posts have none: null unless a number is present
      views: firstNumber(item.engagement?.views, item.numImpressions, item.views),
      likes: firstNumber(item.engagement?.likes, item.numLikes, item.likes),
      comments: firstNumber(item.engagement?.comments, item.numComments, typeof item.comments === 'number' ? item.comments : null),
      shares: firstNumber(item.engagement?.shares, item.numShares),
      saves: null,
    },
  };
}

const NORMALIZERS: Record<LabPlatform, (item: Item) => NormalizedPost | null> = {
  instagram: normalizeInstagram,
  youtube: normalizeYoutube,
  tiktok: normalizeTiktok,
  twitter: normalizeTwitter,
  linkedin: normalizeLinkedin,
};

/** Normalize one actor's dataset items; items without an id or url are dropped, duplicates collapse to the first. */
export function normalizeItems(platform: LabPlatform, items: readonly unknown[]): NormalizedPost[] {
  const seen = new Set<string>();
  const out: NormalizedPost[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const p = NORMALIZERS[platform](raw as Item);
    if (!p || seen.has(p.externalId)) continue;
    seen.add(p.externalId);
    out.push({ ...p, metrics: clean(p.metrics) });
  }
  return out;
}

/**
 * Follower counts from profile-mode items (or from the author block post items carry:
 * TikTok `authorMeta.fans`, YouTube `numberOfSubscribers`). Field names for the profile
 * actors are taken from their Store docs and are UNVERIFIED until the first live run.
 */
export function normalizeProfile(platform: LabPlatform, item: unknown): NormalizedProfile | null {
  if (!item || typeof item !== 'object') return null;
  const i = item as Item;
  switch (platform) {
    case 'instagram': {
      const h = handle(str(i.username, i.ownerUsername));
      return h ? { platform, handle: h, displayName: str(i.fullName), followers: firstNumber(i.followersCount), following: firstNumber(i.followsCount), postCount: firstNumber(i.postsCount), avatarUrl: str(i.profilePicUrlHD, i.profilePicUrl) } : null;
    }
    case 'tiktok': {
      const a = i.authorMeta ?? i;
      const h = handle(str(a.name, a.uniqueId));
      return h ? { platform, handle: h, displayName: str(a.nickName, a.nickname), followers: firstNumber(a.fans, a.followerCount), following: firstNumber(a.following, a.followingCount), postCount: firstNumber(a.video, a.videoCount), avatarUrl: str(a.avatar) } : null;
    }
    case 'youtube': {
      const h = handle(str(i.channelUsername, i.channelHandle, i.channelName));
      return h ? { platform, handle: h, displayName: str(i.channelName), followers: firstNumber(i.numberOfSubscribers, i.subscriberCount), following: null, postCount: firstNumber(i.channelTotalVideos), avatarUrl: str(i.channelAvatarUrl) } : null;
    }
    case 'twitter': {
      const a = i.author ?? i.user ?? i;
      const h = handle(str(a.userName, a.screen_name));
      return h ? { platform, handle: h, displayName: str(a.name), followers: firstNumber(a.followers, a.followers_count), following: firstNumber(a.following, a.friends_count), postCount: firstNumber(a.statusesCount, a.statuses_count), avatarUrl: str(a.profilePicture, a.profile_image_url_https) } : null;
    }
    case 'linkedin': {
      const a = i.author ?? i;
      const h = handle(str(a.publicIdentifier));
      return h ? { platform, handle: h, displayName: str(a.name, [a.firstName, a.lastName].filter(Boolean).join(' ')), followers: firstNumber(a.followersCount, a.followers), following: null, postCount: null, avatarUrl: str(a.avatar?.url, a.profilePicture) } : null;
    }
  }
}
