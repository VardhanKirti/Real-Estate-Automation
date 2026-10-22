/**
 * Actor field verification (04 2.3, L1). Field names drift per actor, so the first live step is
 * one tiny run per actor on Brody's own handles, compared key by key with what the normalizer
 * needs. The result lives in lab_priors `actor_fields` (Record<actorId, ActorFieldReport>); a post
 * actor reported `missing` or `failed` refuses live scrapes until a fix is verified (or override).
 * Values are never kept: only key paths (no personal data).
 */
import type { LabPlatform, LabRun, LabSource } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { ACTOR_MIN_MAX_USD, POST_ACTORS, PROFILE_ACTORS, SEARCH_ACTORS, type ApifyClient } from '@/lib/lab/apify-client';
import { GOOGLE_TRENDS_ACTOR } from '@/lib/lab/feeds';
import { CapError, gatedCall } from '@/lib/lab/spend';
import { dryPostItems, dryProfileItems, drySearchItems } from '@/lib/lab/dry-items';

export type ActorFieldSpec = {
  actorId: string;
  platform: LabPlatform;
  kind: 'post' | 'profile' | 'search' | 'single' | 'trends';
  /** Keys the normalizer needs; dotted paths allowed ("engagement.likes"). */
  required: string[];
  /** Keys that unlock a feature when present (e.g. X viewCount). */
  optional: string[];
};

/** [LIVE-CHECK] every `required` path is a best reading of the Store examples on 2026-10-11; the first verify run is the authority. */
export const ACTOR_FIELD_EXPECTATIONS: ActorFieldSpec[] = [
  { actorId: 'apify/instagram-post-scraper', platform: 'instagram', kind: 'post', required: ['shortCode', 'url', 'timestamp', 'likesCount', 'commentsCount', 'ownerUsername'], optional: ['videoViewCount', 'videoPlayCount', 'videoDuration', 'videoUrl', 'productType'] },
  { actorId: 'apify/instagram-profile-scraper', platform: 'instagram', kind: 'profile', required: ['username', 'followersCount'], optional: ['postsCount', 'followsCount'] },
  { actorId: 'clockworks/tiktok-scraper', platform: 'tiktok', kind: 'post', required: ['id', 'webVideoUrl', 'createTimeISO', 'playCount', 'diggCount', 'commentCount', 'shareCount', 'collectCount', 'authorMeta.name', 'authorMeta.fans'], optional: ['videoMeta.duration', 'isSponsored', 'isPinned'] },
  { actorId: 'streamers/youtube-scraper', platform: 'youtube', kind: 'post', required: ['id', 'url', 'date', 'viewCount', 'likes', 'commentsCount', 'numberOfSubscribers'], optional: ['duration', 'subtitles', 'isShort'] },
  { actorId: 'apidojo/tweet-scraper', platform: 'twitter', kind: 'post', required: ['id', 'url', 'createdAt', 'likeCount', 'retweetCount', 'replyCount', 'quoteCount', 'author.userName'], optional: ['viewCount', 'bookmarkCount', 'author.followers'] },
  { actorId: 'harvestapi/linkedin-profile-posts', platform: 'linkedin', kind: 'post', required: ['id', 'linkedinUrl', 'postedAt', 'engagement.likes', 'engagement.comments', 'engagement.shares'], optional: ['engagement.reactions', 'author.followersCount'] },
  { actorId: 'apify/google-trends-scraper', platform: 'youtube' /* unused */, kind: 'trends', required: ['interestOverTime_timelineData'], optional: [] },
];

export type ActorFieldReport = {
  actorId: string;
  at: string;
  items: number;
  /** Every key path seen in the first 3 items (keys only, never values). */
  keysSeen: string[];
  missingRequired: string[];
  presentOptional: string[];
  status: 'ok' | 'fixed' | 'missing' | 'failed';
  chargeCeiling: 'honoured' | 'ignored' | 'unknown';
  usageTotalUsd: number | null;
};

export const ACTOR_FIELDS_KEY = 'actor_fields';
/** Per-run ceiling for a verify run (04 2.3), except the LC-3 ceiling probe. */
export const VERIFY_MAX_USD = 0.1;
export const VERIFY_ITEMS = 3;
/**
 * LC-3: one run with maxItems 50 and a $0.01 ceiling; honoured when it ends at or under $0.012.
 * 04 2.3 names a TikTok run, but the TikTok scraper refuses a ceiling under $0.50 (its published
 * minimalMaxTotalChargeUsd, 09.1.3 item 4), so the probe uses the Instagram post scraper ($0.005).
 */
export const CEILING_PROBE = { actorId: 'apify/instagram-post-scraper', platform: 'instagram' as LabPlatform, maxItems: 50, maxTotalChargeUsd: 0.01, slackUsd: 0.012 } as const;

/** Every key path in an item, objects descended, arrays as `[]` (never a value). */
function keyPaths(v: unknown, prefix = '', out = new Set<string>(), depth = 0): Set<string> {
  if (!v || typeof v !== 'object' || depth > 4) return out;
  if (Array.isArray(v)) {
    if (v.length) keyPaths(v[0], prefix, out, depth + 1);
    return out;
  }
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    keyPaths(child, path, out, depth + 1);
  }
  return out;
}

/** Pure: compare one dataset page with the spec. Values are never kept (no personal data). */
export function verifyActorFields(spec: ActorFieldSpec, items: readonly unknown[], at: string): ActorFieldReport {
  const seen = new Set<string>();
  for (const item of items.slice(0, 3)) keyPaths(item, '', seen);
  const keysSeen = [...seen].sort();
  const missingRequired = items.length === 0 ? [...spec.required] : spec.required.filter((k) => !seen.has(k));
  const presentOptional = spec.optional.filter((k) => seen.has(k));
  return { actorId: spec.actorId, at, items: items.length, keysSeen, missingRequired, presentOptional, status: items.length === 0 ? 'failed' : missingRequired.length ? 'missing' : 'ok', chargeCeiling: 'unknown', usageTotalUsd: null };
}

export function actorReports(store: LabStore): Record<string, ActorFieldReport> {
  const v = store.priors.get(ACTOR_FIELDS_KEY)?.value;
  return v && typeof v === 'object' ? (v as Record<string, ActorFieldReport>) : {};
}

export function recordActorReport(store: LabStore, report: ActorFieldReport, now: Date): void {
  const all = { ...actorReports(store), [report.actorId]: report };
  store.priors.set({ key: ACTOR_FIELDS_KEY, value: all, n: Object.keys(all).length, supersedesDefault: true, updatedAt: now.toISOString() });
}

/** A verify run's report: `ok` or `fixed` (a human edit after a `missing` report, confirmed by the next run). */
export function isVerified(store: LabStore, actorId: string): boolean {
  const r = actorReports(store)[actorId];
  return r?.status === 'ok' || r?.status === 'fixed';
}

/** A post actor whose report says the normalizer would miss fields: live scrapes refuse it (409 actor_unverified) unless override. */
export function isBlocked(store: LabStore, actorId: string): boolean {
  const r = actorReports(store)[actorId];
  return r?.status === 'missing' || r?.status === 'failed';
}

/** The checklist's verify_actors tick (04 2.1): a report exists and every post actor is ok or fixed. */
export function allPostActorsVerified(store: LabStore, platforms: readonly LabPlatform[] = Object.keys(POST_ACTORS) as LabPlatform[]): boolean {
  const reports = actorReports(store);
  if (Object.keys(reports).length === 0) return false;
  return platforms.every((p) => {
    const r = reports[POST_ACTORS[p].actorId];
    return r?.status === 'ok' || r?.status === 'fixed';
  });
}

export type VerifyTarget = { spec: ActorFieldSpec; input: Record<string, unknown>; maxItems: number; maxTotalChargeUsd: number; probe: boolean; platform: LabPlatform; sourceIds: string[] };

/** One tiny run per actor on owned handles only (never a tracked creator). Pure over the sources. */
export function planVerification(owned: readonly LabSource[]): VerifyTarget[] {
  const first = new Map<LabPlatform, LabSource>();
  for (const s of owned) if (s.kind === 'owned' && s.status === 'active' && !first.has(s.platform as LabPlatform) && (s.platform as string) in POST_ACTORS) first.set(s.platform as LabPlatform, s);
  const out: VerifyTarget[] = [];
  for (const spec of ACTOR_FIELD_EXPECTATIONS) {
    const src = first.get(spec.platform);
    if (spec.kind === 'post' && src) {
      const items = spec.platform === 'twitter' ? 50 : VERIFY_ITEMS;
      out.push({ spec, platform: spec.platform, sourceIds: [src.id], input: POST_ACTORS[spec.platform].buildInput([src.handle], items), maxItems: items, maxTotalChargeUsd: VERIFY_MAX_USD, probe: false });
    } else if (spec.kind === 'profile' && src && PROFILE_ACTORS[spec.platform]) {
      out.push({ spec, platform: spec.platform, sourceIds: [src.id], input: PROFILE_ACTORS[spec.platform]!.buildInput([src.handle]), maxItems: 1, maxTotalChargeUsd: VERIFY_MAX_USD, probe: false });
    } else if (spec.kind === 'trends' && first.size > 0) {
      out.push({ spec, platform: spec.platform, sourceIds: [], input: { searchTerms: ['ai agents'], timeRange: 'now 7-d', isMultiple: false }, maxItems: 1, maxTotalChargeUsd: VERIFY_MAX_USD, probe: false });
    }
  }
  // LC-2: the search actors with 1 term and limit 5
  for (const [platform, actor] of Object.entries(SEARCH_ACTORS) as [LabPlatform, NonNullable<(typeof SEARCH_ACTORS)[LabPlatform]>][]) {
    if (!first.has(platform)) continue;
    out.push({ spec: { actorId: actor.actorId, platform, kind: 'search', required: [], optional: [] }, platform, sourceIds: [], input: actor.buildInput(['ai agents'], 5), maxItems: 5, maxTotalChargeUsd: VERIFY_MAX_USD, probe: false });
  }
  // LC-3: the ceiling probe
  const pr = first.get(CEILING_PROBE.platform);
  if (pr) out.push({ spec: { ...ACTOR_FIELD_EXPECTATIONS.find((s) => s.actorId === CEILING_PROBE.actorId)! }, platform: CEILING_PROBE.platform, sourceIds: [pr.id], input: POST_ACTORS[CEILING_PROBE.platform].buildInput([pr.handle], CEILING_PROBE.maxItems), maxItems: CEILING_PROBE.maxItems, maxTotalChargeUsd: CEILING_PROBE.maxTotalChargeUsd, probe: true });
  return out;
}

/** The verify run's lab_runs.input: what advance needs to file the report. */
export type VerifyRunInput = { platform: LabPlatform; actorId: string; kind: ActorFieldSpec['kind']; probe: boolean; sourceIds: string[]; actorInput: Record<string, unknown> };

/** File a finished verify run (advance-on-read, or the dry branch): the report, plus LC-3 for the probe. */
export function fileVerifyRun(store: LabStore, input: VerifyRunInput, items: readonly unknown[], usageTotalUsd: number | null, now: Date): ActorFieldReport {
  const spec = ACTOR_FIELD_EXPECTATIONS.find((s) => s.actorId === input.actorId && s.kind === (input.kind === 'search' ? 'search' : s.kind)) ?? { actorId: input.actorId, platform: input.platform, kind: input.kind, required: [], optional: [] };
  const prev = actorReports(store)[input.actorId];
  const report = verifyActorFields(input.kind === 'search' ? { ...spec, kind: 'search', required: [], optional: [] } : spec, items, now.toISOString());
  if (input.probe) {
    report.chargeCeiling = usageTotalUsd === null ? 'unknown' : usageTotalUsd <= CEILING_PROBE.slackUsd ? 'honoured' : 'ignored';
    report.usageTotalUsd = usageTotalUsd;
    // the probe answers LC-3 only: keep the field report from the normal run when there is one
    if (prev) return (recordActorReport(store, { ...prev, chargeCeiling: report.chargeCeiling }, now), { ...prev, chargeCeiling: report.chargeCeiling });
  } else {
    report.usageTotalUsd = usageTotalUsd;
    if (prev?.chargeCeiling && prev.chargeCeiling !== 'unknown') report.chargeCeiling = prev.chargeCeiling;
    // a report that was missing and is now complete after a human fix reads `fixed`
    if (report.status === 'ok' && prev?.status === 'missing') report.status = 'fixed';
  }
  recordActorReport(store, report, now);
  return report;
}

/**
 * Gated: one tiny run per actor through gatedCall (provider apify, kind 'verify', line 'apify.verify').
 * Dry and Filming file fixture items at once (no network). Stops quietly at the line cap.
 */
export async function startActorVerification(store: LabStore, client: ApifyClient | null, opts: { override?: boolean; now?: Date; scheduled?: boolean } = {}): Promise<LabRun[]> {
  const now = opts.now ?? new Date();
  const targets = planVerification(store.sources.all('owned'));
  const runs: LabRun[] = [];
  for (const t of targets) {
    const input: VerifyRunInput = { platform: t.platform, actorId: t.spec.actorId, kind: t.spec.kind, probe: t.probe, sourceIds: t.sourceIds, actorInput: t.input };
    try {
      const min = ACTOR_MIN_MAX_USD[t.spec.actorId] ?? null;
      const res = await gatedCall<null>(store, { provider: 'apify', line: 'apify.verify', kind: 'verify', actor: t.spec.actorId, input, override: opts.override, scheduled: opts.scheduled, maxRunUsd: Math.max(t.maxTotalChargeUsd, min ?? 0), estimate: { point: t.maxTotalChargeUsd / 2, high: t.maxTotalChargeUsd, minMaxTotalChargeUsd: min }, now }, {
        dry: () => {
          const sources = t.sourceIds.map((id) => store.sources.get(id)).filter((s): s is LabSource => s !== null);
          const items = t.spec.actorId === GOOGLE_TRENDS_ACTOR
            ? [{ interestOverTime_timelineData: [] }]
            : t.spec.kind === 'profile'
              ? dryProfileItems(sources.map((s) => s.handle))
              : t.spec.kind === 'search'
                ? drySearchItems(t.platform, ['ai agents'], 5, now)
                : dryPostItems(t.platform, sources.map((s) => ({ handle: s.handle, displayName: s.displayName, existing: [] })), VERIFY_ITEMS, now);
          fileVerifyRun(store, input, items, null, now);
          return { result: null, units: items.length, items: items.length };
        },
        live: async (_run, ctx) => {
          if (!client) throw new Error('no Apify client');
          // never under the actor's published minimum (09.1.2): Apify refuses a lower ceiling
          const ceiling = Math.max(Math.min(t.maxTotalChargeUsd, ctx.maxTotalChargeUsd ?? t.maxTotalChargeUsd), ACTOR_MIN_MAX_USD[t.spec.actorId] ?? 0);
          const started = await client.startRun(t.spec.actorId, t.input, { maxItems: t.maxItems, maxTotalChargeUsd: ceiling });
          return { result: null, units: 0, actualUsd: null, apifyRunId: started.id, datasetId: started.defaultDatasetId, pending: true, items: null };
        },
      });
      runs.push(res.run);
    } catch (err) {
      // an actor whose published minimum does not fit the line skips; a cap or an off line stops the pass
      if (err instanceof CapError && err.reason === 'needs_headroom') continue;
      // a manual check that could start nothing hands the cap to the SpendGate (402, override once)
      if (err instanceof CapError && !opts.scheduled && err.reason === 'cap' && runs.length === 0) throw err;
      if (err instanceof CapError) break;
      throw err;
    }
  }
  return runs;
}
