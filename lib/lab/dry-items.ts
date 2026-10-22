import type { LabBeat, LabBeatType, LabCtaType, LabFormat, LabHookChannel, LabHookForm, LabPacing, LabPillar, LabPlatform, LabPost, LabStructure, LabTrigger } from '@/lib/schemas';

/**
 * Dry fixtures for the ingest lane (LAB_DRY=1 or Filming; SPEC §5.5, AC6). Every Apify,
 * speech-to-text and LLM answer the sync would get is generated here instead, in the
 * RAW shape the real provider returns, so the dry cycle runs the same normalize →
 * upsert → measure path as a live one. Nothing here touches the network.
 *
 * Deterministic: the same handle, post and clock give the same item. Every creator,
 * caption and number is invented; media URLs use the reserved `.invalid` TLD.
 *
 * Re-reads: when a source already has posts (the Filming fixture world, or an earlier
 * dry cycle), the dry scrape re-reads those posts by their external id and echoes their
 * stored caption and shape, with views at least the last read, so a dry "Run now" in
 * Filming appends metric snapshots instead of inventing a second set of posts.
 */

/* ── PRNG ──────────────────────────────────────────────────────────────── */

export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

/* ── fictional copy ────────────────────────────────────────────────────── */

export const DRY_TOPICS = ['agent memory', 'voice cloning', 'browser agents', 'prompt caching', 'local models', 'ai video editing', 'coding agents', 'workflow automation'] as const;
const OPENERS = ['I replaced three tools with one agent', 'Nobody tells you what this costs', 'Stop doing this by hand', 'This took me four minutes', 'Here is the setup I actually use', 'Most people get this wrong'];
const DAY = 86_400_000;

export type DryExisting = Pick<LabPost, 'externalId' | 'url' | 'caption' | 'contentType' | 'postedAt' | 'durationS' | 'thumbnailUrl' | 'mediaUrl'> & { latestViews: number | null };
export type DryTarget = { handle: string; displayName?: string | null; existing: DryExisting[] };

type Raw = Record<string, unknown>;

/** Views a post has `hours` after posting: a saturating curve on a per-post scale. */
export function dryViewsAt(scale: number, hours: number): number {
  return Math.max(0, Math.round(scale * (1 - Math.exp(-Math.max(0, hours) / 36))));
}

type Shape = { id: string; url: string; caption: string; contentType: string; postedAt: string; durationS: number | null; views: number; likes: number; comments: number; shares: number; saves: number; followers: number; media: string; thumb: string };

function shapesFor(platform: LabPlatform, t: DryTarget, limit: number, now: Date): Shape[] {
  const r0 = rng(`${platform}|${t.handle}`);
  const followers = Math.round(4_000 + r0() * 180_000);
  const out: Shape[] = [];
  const existing = [...t.existing].sort((a, b) => String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? ''))).slice(0, limit);
  if (existing.length > 0) {
    for (const e of existing) {
      const r = rng(`${platform}|${e.externalId}`);
      const posted = e.postedAt ?? new Date(now.getTime() - 3 * DAY).toISOString();
      const hours = (now.getTime() - Date.parse(posted)) / 3_600_000;
      const fresh = dryViewsAt(followers * (0.05 + r() * 0.6), hours);
      // a re-read never goes backwards; posts under 14 days still creep up
      const views = Math.max(fresh, Math.round((e.latestViews ?? 0) * (hours < 14 * 24 ? 1.01 : 1)));
      out.push({ id: e.externalId, url: e.url, caption: e.caption, contentType: e.contentType, postedAt: posted, durationS: e.durationS, ...counters(r, views), followers, media: e.mediaUrl ?? `https://fixtures.invalid/lab/${platform}/${e.externalId}.mp4`, thumb: e.thumbnailUrl ?? `https://fixtures.invalid/lab/${platform}/${e.externalId}.jpg` });
    }
    return out;
  }
  for (let i = 0; i < limit; i++) {
    const r = rng(`${platform}|${t.handle}|${i}`);
    const id = `dry${hashSeed(`${platform}|${t.handle}|${i}`).toString(36)}`;
    const posted = new Date(now.getTime() - (i * 1.7 + 0.3 + r() * 0.5) * DAY);
    const hours = (now.getTime() - posted.getTime()) / 3_600_000;
    // one post in eight breaks out well past the creator's normal
    const scale = followers * (r() < 0.125 ? 1.5 + r() * 3 : 0.05 + r() * 0.35);
    const topic = pick(r, DRY_TOPICS);
    const caption = `${pick(r, OPENERS)}: ${topic} #${topic.replace(/\s+/g, '')} #ai`;
    const long = platform === 'youtube' && r() < 0.3;
    const durationS = platform === 'linkedin' || platform === 'twitter' ? (r() < 0.5 ? null : Math.round(20 + r() * 70)) : long ? Math.round(420 + r() * 900) : Math.round(18 + r() * 70);
    const contentType = durationS === null ? 'text' : platform === 'instagram' ? 'reel' : platform === 'youtube' ? (long ? 'video' : 'short') : 'video';
    out.push({ id, url: postUrl(platform, t.handle, id), caption, contentType, postedAt: posted.toISOString(), durationS, ...counters(r, dryViewsAt(scale, hours)), followers, media: `https://fixtures.invalid/lab/${platform}/${id}.mp4`, thumb: `https://fixtures.invalid/lab/${platform}/${id}.jpg` });
  }
  return out;
}

function counters(r: () => number, views: number) {
  const likes = Math.round(views * (0.02 + r() * 0.07));
  return { views, likes, comments: Math.round(likes * (0.02 + r() * 0.08)), shares: Math.round(likes * (0.01 + r() * 0.1)), saves: Math.round(likes * (0.03 + r() * 0.15)) };
}

function postUrl(platform: LabPlatform, handle: string, id: string): string {
  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/p/${id}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}/video/${id}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${id}`;
    case 'twitter':
      return `https://x.com/${handle}/status/${id}`;
    case 'linkedin':
      return `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`;
  }
}

const mmss = (s: number | null) => (s === null ? null : `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);

/** Raw item in the actor's own output shape (the fields lib/lab/normalize.ts reads). */
function toRaw(platform: LabPlatform, handle: string, displayName: string, s: Shape, subtitles: boolean): Raw {
  switch (platform) {
    case 'instagram': {
      const video = s.contentType === 'reel' || s.contentType === 'video';
      return {
        shortCode: s.id, url: s.url, caption: s.caption, type: s.contentType === 'carousel' ? 'Sidecar' : video ? 'Video' : 'Image', productType: s.contentType === 'reel' ? 'clips' : 'feed',
        timestamp: s.postedAt, videoDuration: s.durationS, displayUrl: s.thumb, videoUrl: video ? s.media : undefined, ownerUsername: handle,
        videoViewCount: video ? s.views : undefined, likesCount: s.likes, commentsCount: s.comments,
      };
    }
    case 'tiktok':
      return {
        id: s.id, webVideoUrl: s.url, text: s.caption, createTimeISO: s.postedAt, videoMeta: { duration: s.durationS, coverUrl: s.thumb, downloadAddr: s.media },
        authorMeta: { name: handle, nickName: displayName, fans: s.followers, following: 200, video: 300 },
        playCount: s.views, diggCount: s.likes, commentCount: s.comments, shareCount: s.shares, collectCount: s.saves,
      };
    case 'youtube':
      return {
        id: s.id, url: s.contentType === 'short' ? `https://www.youtube.com/shorts/${s.id}` : s.url, title: s.caption, date: s.postedAt, duration: mmss(s.durationS), thumbnailUrl: s.thumb,
        channelUsername: handle, channelName: displayName, numberOfSubscribers: s.followers, viewCount: s.views, likes: s.likes, commentsCount: s.comments,
        subtitles: subtitles ? [{ language: 'en', plaintext: dryTranscriptText(s.id, s.caption, s.durationS ?? 60) }] : [],
      };
    case 'twitter':
      return { id: s.id, url: s.url, fullText: s.caption, createdAt: s.postedAt, author: { userName: handle, name: displayName, followers: s.followers, following: 400 }, viewCount: s.views, likeCount: s.likes, replyCount: s.comments, retweetCount: s.shares, bookmarkCount: s.saves };
    case 'linkedin':
      return { shareUrn: s.id, linkedinUrl: s.url, content: s.caption, postedAt: { date: s.postedAt }, author: { publicIdentifier: handle, name: displayName, followersCount: s.followers }, engagement: { likes: s.likes, comments: s.comments, shares: s.shares } };
  }
}

/** What a post actor would return for these handles (re-reads first, else `limit` new fictional posts each). */
export function dryPostItems(platform: LabPlatform, targets: readonly DryTarget[], limit: number, now: Date): Raw[] {
  return targets.flatMap((t) => shapesFor(platform, t, limit, now).map((s) => toRaw(platform, t.handle, t.displayName ?? t.handle, s, true)));
}

/** What apify/instagram-profile-scraper would return. */
export function dryProfileItems(handles: readonly string[]): Raw[] {
  return handles.map((h) => {
    const r = rng(`instagram|${h}`);
    return { username: h, fullName: h, followersCount: Math.round(4_000 + r() * 180_000), followsCount: 300, postsCount: 400 };
  });
}

/** What a search actor would return: posts by fictional creators the Lab has not seen, about the searched terms. */
export function drySearchItems(platform: LabPlatform, terms: readonly string[], limit: number, now: Date): Raw[] {
  const out: Raw[] = [];
  for (const term of terms) {
    const r = rng(`search|${platform}|${term}`);
    const creators = Array.from({ length: 4 }, (_, i) => `dry-creator-${hashSeed(`${platform}|${term}|${i}`).toString(36).slice(0, 6)}`);
    for (let i = 0; i < limit; i++) {
      const handle = pick(r, creators);
      const id = `drys${hashSeed(`${platform}|${term}|${i}`).toString(36)}`;
      const posted = new Date(now.getTime() - (1 + r() * 20) * DAY).toISOString();
      const caption = `${pick(r, OPENERS)}: ${term} #${term.replace(/\s+/g, '')}`;
      const s: Shape = { id, url: postUrl(platform, handle, id), caption, contentType: platform === 'instagram' ? 'reel' : platform === 'youtube' ? 'short' : 'video', postedAt: posted, durationS: Math.round(20 + r() * 60), ...counters(r, Math.round(2_000 + r() * 90_000)), followers: Math.round(3_000 + r() * 90_000), media: `https://fixtures.invalid/lab/${platform}/${id}.mp4`, thumb: `https://fixtures.invalid/lab/${platform}/${id}.jpg` };
      out.push(toRaw(platform, handle, handle, s, false));
    }
  }
  return out;
}

/** A fictional spoken transcript sized to the duration (about 160 wpm). */
export function dryTranscriptText(seed: string, caption: string, durationS: number): string {
  const r = rng(`transcript|${seed}`);
  const words = Math.max(12, Math.round((durationS * (140 + r() * 50)) / 60));
  const lead = caption.replace(/#\S+/g, '').trim();
  const filler = ['so', 'here', 'is', 'the', 'part', 'that', 'matters', 'you', 'open', 'it', 'run', 'the', 'test', 'and', 'watch', 'what', 'happens', 'next', 'it', 'works', 'every', 'time'];
  const out = lead.split(/\s+/).filter(Boolean);
  while (out.length < words) out.push(pick(r, filler));
  return out.slice(0, words).join(' ');
}

/* ── dry dissection reply (the LLM's answer shape, lib/lab/dissect.ts) ─── */

const FORMATS: LabFormat[] = ['talking_head', 'screen_recording', 'tutorial_walkthrough', 'b_roll_voiceover', 'green_screen'];
const HOOKS: LabHookForm[] = ['results_first', 'contrarian', 'open_loop', 'howto_promise', 'number_stat', 'direct_challenge'];
const TRIGGERS: LabTrigger[] = ['curiosity', 'fear_fomo', 'aspiration', 'surprise_shock', 'relatability'];
const CHANNELS: LabHookChannel[] = ['spoken', 'on_screen_text', 'mixed'];
const STRUCTURES: LabStructure[] = ['tutorial', 'demo_reveal', 'problem_solution', 'hot_take', 'listicle'];
const PACING: LabPacing[] = ['conversational', 'rapid_fire', 'punchy'];
const PILLARS: LabPillar[] = ['educational', 'entertainment', 'inspirational'];
const CTAS: LabCtaType[] = ['follow', 'comment_keyword', 'none', 'link'];
const TEMPLATES: LabBeatType[][] = [
  ['hook', 'reveal', 'demo', 'payoff', 'cta'],
  ['hook', 'context', 'demo', 'rehook', 'demo', 'cta'],
  ['hook', 'promise', 'evidence', 'payoff'],
  ['hook', 'contrast', 'claim', 'evidence', 'cta'],
];

export function dryDissectionReply(post: Pick<LabPost, 'externalId' | 'caption' | 'contentType'>, hasTranscript: boolean) {
  const r = rng(`dissect|${post.externalId}`);
  const tpl = pick(r, TEMPLATES);
  const cuts = [0, ...tpl.slice(1).map((_, i) => Math.round(((i + 1) / tpl.length) * 100 - 4 + r() * 8)), 100];
  const beats: LabBeat[] = hasTranscript ? tpl.map((type, i) => ({ type, startPct: cuts[i], endPct: cuts[i + 1], summary: `${type} beat` })) : [];
  const topic = DRY_TOPICS.find((t) => post.caption.toLowerCase().includes(t)) ?? pick(r, DRY_TOPICS);
  const conf = () => Math.round((0.55 + r() * 0.4) * 100) / 100;
  return {
    format: post.contentType === 'text' ? 'text_post' : post.contentType === 'carousel' ? 'carousel' : post.contentType === 'video' && r() < 0.2 ? 'long_form' : pick(r, FORMATS),
    format_confidence: conf(),
    hook_form: pick(r, HOOKS),
    hook_form_confidence: conf(),
    emotional_trigger: pick(r, TRIGGERS),
    emotional_trigger_confidence: conf(),
    hook_channel: pick(r, CHANNELS),
    hook_channel_confidence: conf(),
    hook_text: post.caption.split(':')[0].slice(0, 120),
    first_frame_text: '',
    structure_type: pick(r, STRUCTURES),
    structure_type_confidence: conf(),
    beats: beats.map((b) => ({ start_pct: b.startPct, end_pct: b.endPct, type: b.type, summary: b.summary })),
    pacing: pick(r, PACING),
    pacing_confidence: conf(),
    topics: [{ topic, angle: `${pick(r, ['the cost', 'the setup', 'the mistake', 'the shortcut'])} of ${topic}`, is_primary: true }],
    pillar: pick(r, PILLARS),
    pillar_confidence: conf(),
    cta_type: pick(r, CTAS),
    cta_type_confidence: conf(),
    tension: r() < 0.5 ? { false_belief: `${topic} is hard`, reframe: `${topic} takes one setup` } : null,
    quality_notes: 'dry fixture',
  };
}
