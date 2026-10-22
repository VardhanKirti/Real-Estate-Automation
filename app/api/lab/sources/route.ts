import { z } from 'zod';
import { LabFeedSchema, LabPlatformSchema, type LabSource } from '@/lib/schemas';
import { parseFeed, parseHandle } from '@/lib/lab/sources';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AddSchema = z.object({
  action: z.literal('add').optional(),
  kind: z.enum(['owned', 'tracked', 'feed', 'watch']),
  /** A handle (with or without @) or a profile URL; for a feed, its key (subreddit, keyword, changelog URL). */
  handle: z.string().trim().min(1).max(200),
  /** Required with a bare handle; inferred from a URL. For a feed: the feed id (hn, reddit, producthunt, google_trends, changelog, keyword_search). */
  platform: z.union([LabPlatformSchema, LabFeedSchema, z.literal('x')]).optional(),
  displayName: z.string().trim().max(120).optional(),
});

/** v2 (08.2.1, 05 3.7): an X watch-list account is a userName without @ (letters, digits, underscore, 1 to 15). */
function parseWatch(raw: string): { platform: 'x'; handle: string; url: string } | null {
  let v = raw.trim();
  const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i.exec(v);
  if (m) v = m[1];
  v = v.replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(v) ? { platform: 'x', handle: v, url: `https://x.com/${v}` } : null;
}

const ManageSchema = z.object({
  action: z.enum(['pause', 'resume', 'remove', 'rename', 'set_kind']),
  id: z.string().min(1),
  displayName: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['owned', 'tracked']).optional(),
});

/**
 * POST /api/lab/sources — the Sources list (SPEC §4.1).
 *
 * Add (default action): `{ kind: owned | tracked | feed | watch, handle, platform?, displayName? }`.
 * v2: `watch` adds an X watch-list account (platform 'x'; 08.2.1, 05 3.7).
 * Re-adding a suggestion, or a removed or paused source, brings it back as the kind asked for.
 * Suggestions are not added here: discovery makes them and /api/lab/suggestions accepts or
 * dismisses them.
 *
 * Manage: `{ action: pause | resume | remove | rename | set_kind, id, displayName?, kind? }`.
 * `remove` sets status `dismissed` (its posts and metrics stay as history; it is never
 * scraped or suggested again until re-added). `set_kind` moves a creator between owned and
 * tracked (not a feed or a suggestion).
 */
export async function POST(request: Request) {
  const raw = await body(request);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;

  const manage = ManageSchema.safeParse(raw);
  if (manage.success) {
    const m = manage.data;
    const s = ctx.store.sources.get(m.id);
    if (!s) return json({ ok: false, error: 'no such source' }, 404);
    if (m.action === 'pause') ctx.store.sources.setStatus(s.id, 'paused');
    else if (m.action === 'resume') ctx.store.sources.setStatus(s.id, 'active');
    else if (m.action === 'remove') ctx.store.sources.setStatus(s.id, 'dismissed');
    else if (m.action === 'rename') {
      if (!m.displayName) return json({ ok: false, error: 'pass displayName' }, 400);
      ctx.store.sources.upsert({ ...s, displayName: m.displayName });
    } else {
      if (!m.kind) return json({ ok: false, error: 'pass kind (owned or tracked)' }, 400);
      if (s.kind !== 'owned' && s.kind !== 'tracked') return json({ ok: false, error: 'only owned and tracked sources change kind' }, 400);
      ctx.store.sources.setKind(s.id, m.kind);
    }
    return json({ ok: true, source: ctx.store.sources.get(s.id) });
  }

  const parsed = AddSchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: 'pass kind (owned, tracked, feed or watch) and a handle or profile URL, or an action with an id' }, 400);
  const d = parsed.data;

  let h: { platform: LabSource['platform']; handle: string; url: string | null } | null;
  if (d.kind === 'watch') {
    h = parseWatch(d.handle);
    if (!h) return json({ ok: false, error: 'an X watch account is a userName: letters, digits and underscores, up to 15' }, 400);
  } else if (d.kind === 'feed') {
    const feed = LabFeedSchema.safeParse(d.platform);
    if (!feed.success) return json({ ok: false, error: 'a feed needs platform: hn, reddit, producthunt, google_trends, changelog or keyword_search' }, 400);
    h = parseFeed(feed.data, d.handle);
    if (!h) return json({ ok: false, error: 'not a usable feed key' }, 400);
  } else {
    const platform = LabPlatformSchema.safeParse(d.platform === 'x' ? 'twitter' : d.platform);
    h = parseHandle(d.handle, platform.success ? platform.data : undefined);
    if (!h) return json({ ok: false, error: 'not a handle or a profile URL on Instagram, TikTok, YouTube, LinkedIn or X (a bare handle needs a platform)' }, 400);
  }

  const existing = ctx.store.sources.byHandle(h.platform, h.handle);
  if (existing) {
    if (existing.kind !== d.kind || existing.status !== 'active') {
      ctx.store.sources.upsert({ ...existing, kind: d.kind, status: 'active', displayName: d.displayName ?? existing.displayName });
    }
    return json({ ok: true, source: ctx.store.sources.get(existing.id), existed: true });
  }
  const source: LabSource = {
    id: `src-${h.platform}-${h.handle.replace(/[^a-z0-9]/g, '').slice(0, 40)}-${Date.now().toString(36)}`,
    kind: d.kind,
    platform: h.platform,
    handle: h.handle,
    url: h.url,
    displayName: d.displayName ?? h.handle,
    status: 'active',
    addedAt: new Date().toISOString(),
    reason: null,
    score: null,
  };
  ctx.store.sources.upsert(source);
  return json({ ok: true, source: ctx.store.sources.get(source.id), existed: false });
}
