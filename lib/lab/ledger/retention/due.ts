/**
 * retentionDue (06 9.2): fetch the retention reads that are due for owned YouTube and Instagram
 * posts. Section 08 owns every OAuth route, key and refresh (C4); this file only reads its env
 * names through resolveCred and its googleAccessToken(). Under Dry or Filming it writes fixture
 * rows (dry 1) and makes no call at all: no labFetch, no googleAccessToken (AC-06-35).
 */
import type { LabPost, LabRetention, LabRun } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { resolveCred } from '@/lib/creds';
import { googleAccessToken } from '@/lib/lab/setup/oauth-google';
import { ledgerRun } from '@/lib/lab/ledger/outcome';
import { fixtureRetention } from '@/lib/lab/ledger/fixtures';
import { fetchRetentionCurve, fetchVideoSummary, listOwnVideos, RetentionHttpError } from '@/lib/lab/ledger/retention/youtube';
import { fetchReelInsights, listOwnMedia } from '@/lib/lab/ledger/retention/instagram';

const HOUR = 3_600_000;
export const YT_DUE_AGES_H = [72, 168, 672] as const;
export const IG_DUE_AGES_H = [24, 72, 168] as const;
export const DUE_TOL_H = 12;
export const MAX_POSTS_PER_PROVIDER = 30;
const LIST_EVERY_H = 24;

type Provider = 'youtube' | 'instagram';
export type ProviderOutcome = { state: 'ok' | 'skipped' | 'error'; written: number; reason: string | null };

/** Owned posts due for a read: posted_at + age <= now and no row at age - 12 h or later (a later read covers earlier ages). */
export function dueReads(store: LabStore, platform: Provider, now: Date): { post: LabPost; ageH: number }[] {
  const ages = platform === 'youtube' ? YT_DUE_AGES_H : IG_DUE_AGES_H;
  const out: { post: LabPost; ageH: number }[] = [];
  const posts = store.posts.all().filter((p) => p.isOwned && p.platform === platform && p.postedAt).sort((a, b) => (a.postedAt! < b.postedAt! ? 1 : -1));
  for (const post of posts) {
    const have = store.retention.forPost(post.id);
    const ageNow = (now.getTime() - Date.parse(post.postedAt!)) / HOUR;
    const due = ages.filter((a) => a <= ageNow && !have.some((r) => r.ageH >= a - DUE_TOL_H));
    if (due.length) out.push({ post, ageH: ageNow });
    if (out.length >= MAX_POSTS_PER_PROVIDER) break;
  }
  return out;
}

const cred = (name: string) => resolveCred(name, []);

/** 9.1: the connected channel must be one of the owned YouTube sources, or nothing will match. */
export function channelIsOwned(store: LabStore, channelId: string): boolean {
  return store.sources.all('owned').some((s) => s.platform === 'youtube' && (s.handle === channelId || (s.url ?? '').includes(channelId)));
}

function cachedList(store: LabStore, key: string, now: Date): string[] | null {
  const v = store.priors.get(key)?.value as { at?: string; ids?: string[] } | null | undefined;
  return v?.at && v.ids && now.getTime() - Date.parse(v.at) < LIST_EVERY_H * HOUR ? v.ids : null;
}
function cacheList(store: LabStore, key: string, ids: string[], now: Date) {
  store.priors.set({ key, value: { at: now.toISOString(), ids }, n: ids.length, supersedesDefault: false, updatedAt: now.toISOString() });
}

const day = (iso: string) => iso.slice(0, 10);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

async function youtube(store: LabStore, now: Date): Promise<ProviderOutcome> {
  const channelId = cred('LAB_YT_CHANNEL_ID');
  if (!cred('LAB_YT_REFRESH_TOKEN') || !channelId) return { state: 'skipped', written: 0, reason: 'not connected' };
  if (!channelIsOwned(store, channelId)) return { state: 'skipped', written: 0, reason: 'Connected channel is not one of your owned YouTube sources. Retention will not match any post.' };
  const due = dueReads(store, 'youtube', now);
  if (!due.length) return { state: 'ok', written: 0, reason: null };
  let token: string | null;
  try {
    token = await googleAccessToken({ now });
  } catch (err) {
    return { state: 'error', written: 0, reason: message(err) };
  }
  if (!token) return { state: 'skipped', written: 0, reason: 'not connected' };
  let written = 0;
  try {
    let ids = cachedList(store, 'ledger:retention:yt_uploads', now);
    if (!ids) {
      ids = await listOwnVideos(token, channelId);
      cacheList(store, 'ledger:retention:yt_uploads', ids, now);
    }
    const own = new Set(ids);
    for (const { post, ageH } of due) {
      if (!own.has(post.externalId)) continue;
      const curve = await fetchRetentionCurve(token, post.externalId, day(post.postedAt!), day(now.toISOString()));
      const sum = await fetchVideoSummary(token, post.externalId, day(post.postedAt!), day(now.toISOString()));
      const row: LabRetention = {
        postId: post.id, platform: 'youtube', source: 'yt_analytics', capturedAt: now.toISOString(), ageH, partial: false, curve: curve.length ? curve : null,
        views: sum.views !== null ? Math.round(sum.views) : null, avgViewDurationS: sum.averageViewDuration, avgViewPct: sum.averageViewPercentage,
        reach: null, likes: null, comments: null, saved: null, shares: null, totalInteractions: null, avgWatchTimeMs: null, totalWatchTimeMs: null, skipRate: null,
        raw: { rows: curve.length }, dry: false,
      };
      store.retention.add(row);
      written++;
    }
  } catch (err) {
    // 401/403 stop the provider for this cycle; the message (trimmed) goes on the run row
    return { state: 'error', written, reason: err instanceof RetentionHttpError ? `${err.status}: ${err.message}` : message(err) };
  }
  return { state: 'ok', written, reason: null };
}

async function instagram(store: LabStore, now: Date): Promise<ProviderOutcome> {
  const token = cred('LAB_IG_ACCESS_TOKEN');
  if (!token || !cred('LAB_IG_USER_ID')) return { state: 'skipped', written: 0, reason: 'not connected' };
  const exp = cred('LAB_IG_TOKEN_EXPIRES_AT');
  if (exp && Date.parse(exp) <= now.getTime()) return { state: 'skipped', written: 0, reason: 'token expired' };
  const due = dueReads(store, 'instagram', now);
  if (!due.length) return { state: 'ok', written: 0, reason: null };
  let written = 0;
  try {
    let pairs = cachedList(store, 'ledger:retention:ig_media', now);
    if (!pairs) {
      const media = await listOwnMedia(token);
      pairs = media.filter((m) => m.shortcode && m.mediaProductType === 'REELS').map((m) => `${m.shortcode}|${m.id}`);
      cacheList(store, 'ledger:retention:ig_media', pairs, now);
    }
    const byShortcode = new Map(pairs.map((p) => p.split('|') as [string, string]));
    for (const { post, ageH } of due) {
      const mediaId = byShortcode.get(post.externalId);
      if (!mediaId) continue;
      const ins = await fetchReelInsights(token, mediaId);
      store.retention.add({ postId: post.id, platform: 'instagram', source: 'ig_graph', capturedAt: now.toISOString(), ageH, partial: ageH < 48, curve: null, avgViewDurationS: null, avgViewPct: null, ...ins, raw: { mediaId }, dry: false });
      written++;
    }
  } catch (err) {
    return { state: 'error', written, reason: err instanceof RetentionHttpError ? `${err.status}: ${err.message}` : message(err) };
  }
  return { state: 'ok', written, reason: null };
}

/** One `retention` run row per provider batch; dry writes fixture rows only. */
export async function retentionDue(store: LabStore, now: Date, opts: { dry: boolean }): Promise<{ youtube: ProviderOutcome; instagram: ProviderOutcome; runs: LabRun[] }> {
  const runs: LabRun[] = [];
  const out: Record<Provider, ProviderOutcome> = { youtube: { state: 'skipped', written: 0, reason: null }, instagram: { state: 'skipped', written: 0, reason: null } };
  for (const provider of ['youtube', 'instagram'] as const) {
    const started = new Date();
    if (opts.dry) {
      const due = dueReads(store, provider, now);
      for (const { post, ageH } of due) store.retention.add(fixtureRetention(post, ageH, now.toISOString()));
      out[provider] = { state: 'ok', written: due.length, reason: null };
    } else {
      out[provider] = provider === 'youtube' ? await youtube(store, now) : await instagram(store, now);
    }
    const o = out[provider];
    runs.push(ledgerRun(store, { kind: 'retention', started, items: o.written, dry: opts.dry, error: o.state === 'error' ? o.reason : null, input: { provider, state: o.state, ...(o.state === 'skipped' ? { skipped: o.reason } : {}) } }));
  }
  return { ...out, runs };
}
