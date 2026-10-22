import type { LabPlatform } from '@/lib/schemas';

/**
 * Apify over plain REST (SPEC §4.2). No SDK, no in-request polling loop: `startRun`
 * returns as soon as Apify accepts the run, the caller stores the run id, and a later
 * read advances it with `getRun` → `datasetItems` (the GladOS advance-on-read pattern,
 * lib/creative-engine/generate.ts). `fetch` is injectable so every path is unit-tested
 * against a fake; nothing in this module is ever called in dry or Filming mode (the
 * spend gate in lib/lab/spend.ts short-circuits before a client exists).
 *
 * Endpoints (docs.apify.com/api/v2):
 *   POST /v2/acts/{owner~name}/runs          start; query maxItems, maxTotalChargeUsd, timeout, memory
 *   GET  /v2/actor-runs/{runId}              status, defaultDatasetId, usageTotalUsd, chargedEventCounts,
 *                                            statusMessage, stats.runTimeSecs, options.maxTotalChargeUsd
 *                                            (there is no stats.itemCount: 09.1.1)
 *   GET  /v2/datasets/{datasetId}            itemCount (items so far, up to 5 s behind; 09.4.1)
 *   GET  /v2/datasets/{datasetId}/items      the results (clean=true, format=json)
 *   POST /v2/actor-runs/{runId}/abort        Stop (09.4.5); the run ends ABORTED and its items stay readable
 *   GET  /v2/users/me                        account (free; used only by an explicit "test key")
 * Auth: `Authorization: Bearer <token>`. Responses wrap the object in `{ data }`.
 */

export const APIFY_BASE = 'https://api.apify.com/v2';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type ApifyRunStatus = 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMING-OUT' | 'TIMED-OUT' | 'ABORTING' | 'ABORTED';

export type ApifyRun = {
  id: string;
  actId: string | null;
  status: ApifyRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  defaultDatasetId: string | null;
  /** The run's total charge in USD (platform usage + pay-per-event/result). Null while unknown. */
  usageTotalUsd: number | null;
  /** Pay-per-event counts so far, e.g. { post: 40, 'post-details': 40 } (09.4.1). Null when absent. */
  chargedEventCounts: Record<string, number> | null;
  /** The actor's own status line, shown verbatim and never parsed. */
  statusMessage: string | null;
  runTimeSecs: number | null;
  /** The ceiling the run was started with (options.maxTotalChargeUsd). */
  maxTotalChargeUsd: number | null;
};

/**
 * The smallest maxTotalChargeUsd each actor accepts (published `minimalMaxTotalChargeUsd`, 09.1.2,
 * read 2026-10-11). Section 09's price book is the live source; this is the recorded floor the
 * verify and snapshot runs never go under.
 */
export const ACTOR_MIN_MAX_USD: Record<string, number> = {
  'apify/instagram-post-scraper': 0.005,
  'apify/instagram-profile-scraper': 0.0026,
  'clockworks/tiktok-scraper': 0.5,
  'harvestapi/linkedin-profile-posts': 0.002,
  'apify/instagram-hashtag-scraper': 0.0026,
};

/** The event that counts one result, per actor (09.4.1 items so far). */
export const PRIMARY_EVENT: Record<string, string> = {
  'apify/instagram-post-scraper': 'post',
  'apify/instagram-profile-scraper': 'profile',
  'clockworks/tiktok-scraper': 'result',
  'streamers/youtube-scraper': 'result',
  'harvestapi/linkedin-profile-posts': 'post',
  'apidojo/tweet-scraper': 'apify-default-dataset-item',
  'apify/instagram-hashtag-scraper': 'result',
};

/** Actors that allow one concurrent run per Apify account (09.1.3 item 5, 09.5.3). */
export const SINGLE_RUN_ACTORS: readonly string[] = ['apidojo/tweet-scraper'];

export class ApifyError extends Error {
  constructor(message: string, public status: number, public body = '') {
    super(message);
    this.name = 'ApifyError';
  }
}

export const TERMINAL_STATUSES: readonly ApifyRunStatus[] = ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'];
export const isTerminal = (s: ApifyRunStatus): boolean => TERMINAL_STATUSES.includes(s);

/** Apify's run status → lab_runs.status. */
export function labRunStatus(s: ApifyRunStatus): 'queued' | 'running' | 'succeeded' | 'failed' | 'aborted' | 'timed_out' {
  switch (s) {
    case 'READY':
      return 'queued';
    case 'RUNNING':
    case 'TIMING-OUT':
    case 'ABORTING':
      return 'running';
    case 'SUCCEEDED':
      return 'succeeded';
    case 'FAILED':
      return 'failed';
    case 'TIMED-OUT':
      return 'timed_out';
    case 'ABORTED':
      return 'aborted';
  }
}

/** "apify/instagram-post-scraper" → "apify~instagram-post-scraper" (the path form). */
export const actorPath = (actorId: string): string => encodeURIComponent(actorId.replace('/', '~'));

function toRun(raw: unknown): ApifyRun {
  const d = ((raw as { data?: unknown })?.data ?? raw) as Record<string, unknown>;
  if (!d || typeof d.id !== 'string') throw new ApifyError('Apify returned no run id', 502, JSON.stringify(raw).slice(0, 300));
  const usage = typeof d.usageTotalUsd === 'number' ? d.usageTotalUsd : null;
  const stats = d.stats as Record<string, unknown> | undefined;
  const options = d.options as Record<string, unknown> | undefined;
  const ce = d.chargedEventCounts;
  const events = ce && typeof ce === 'object' && !Array.isArray(ce) ? Object.fromEntries(Object.entries(ce as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)) as [string, number][]) : null;
  return {
    id: d.id,
    actId: typeof d.actId === 'string' ? d.actId : null,
    status: (typeof d.status === 'string' ? d.status : 'READY') as ApifyRunStatus,
    startedAt: typeof d.startedAt === 'string' ? d.startedAt : null,
    finishedAt: typeof d.finishedAt === 'string' ? d.finishedAt : null,
    defaultDatasetId: typeof d.defaultDatasetId === 'string' ? d.defaultDatasetId : null,
    usageTotalUsd: usage,
    chargedEventCounts: events,
    statusMessage: typeof d.statusMessage === 'string' ? d.statusMessage : null,
    runTimeSecs: typeof stats?.runTimeSecs === 'number' ? (stats.runTimeSecs as number) : null,
    maxTotalChargeUsd: typeof options?.maxTotalChargeUsd === 'number' ? (options.maxTotalChargeUsd as number) : null,
  };
}

export type StartOpts = {
  /** Hard ceiling on items the actor may push (pay-per-result actors bill per item). */
  maxItems?: number;
  /** Hard ceiling on the run's charge, for pay-per-event actors (unverified per actor). */
  maxTotalChargeUsd?: number;
  /** Seconds. */
  timeoutSecs?: number;
  memoryMbytes?: number;
};

export function createApifyClient(opts: { token: string; fetch?: FetchLike; base?: string }) {
  // server code passes labFetch through lib/lab/apify-live.ts (the dry guard); this module stays node-free for client imports
  const f: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const base = (opts.base ?? APIFY_BASE).replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' };

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await f(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = `Apify ${method} ${path.split('?')[0]} answered ${res.status}`;
      try {
        const err = (JSON.parse(text) as { error?: { message?: string } }).error?.message;
        if (err) message = `${message}: ${err}`;
      } catch {
        /* not JSON */
      }
      throw new ApifyError(message, res.status, text.slice(0, 500));
    }
    return res.json();
  }

  return {
    /** Start an actor run. Returns once Apify accepted it; the run id is the handle. */
    async startRun(actorId: string, input: unknown, o: StartOpts = {}): Promise<ApifyRun> {
      const q = new URLSearchParams();
      if (o.maxItems !== undefined) q.set('maxItems', String(o.maxItems));
      if (o.maxTotalChargeUsd !== undefined) q.set('maxTotalChargeUsd', String(o.maxTotalChargeUsd));
      if (o.timeoutSecs !== undefined) q.set('timeout', String(o.timeoutSecs));
      if (o.memoryMbytes !== undefined) q.set('memory', String(o.memoryMbytes));
      const qs = q.toString();
      return toRun(await call('POST', `/acts/${actorPath(actorId)}/runs${qs ? `?${qs}` : ''}`, input ?? {}));
    },
    async getRun(runId: string): Promise<ApifyRun> {
      return toRun(await call('GET', `/actor-runs/${encodeURIComponent(runId)}`));
    },
    /** A dataset's item count (09.4.3: the items-so-far fallback when chargedEventCounts has no primary event yet). */
    async datasetInfo(datasetId: string): Promise<{ itemCount: number | null }> {
      const d = ((await call('GET', `/datasets/${encodeURIComponent(datasetId)}`)) as { data?: Record<string, unknown> }).data ?? {};
      return { itemCount: typeof d.itemCount === 'number' ? d.itemCount : null };
    },
    /** Stop a run at once (09.4.5: no `gracefully`); it ends ABORTED and its dataset stays readable. */
    async abortRun(runId: string): Promise<ApifyRun> {
      return toRun(await call('POST', `/actor-runs/${encodeURIComponent(runId)}/abort`));
    },
    /** One page of a dataset's items (clean=true drops Apify's hidden fields and empty items). */
    async datasetItems(datasetId: string, o: { offset?: number; limit?: number } = {}): Promise<unknown[]> {
      const q = new URLSearchParams({ clean: 'true', format: 'json' });
      if (o.offset) q.set('offset', String(o.offset));
      if (o.limit) q.set('limit', String(o.limit));
      const out = await call('GET', `/datasets/${encodeURIComponent(datasetId)}/items?${q.toString()}`);
      if (!Array.isArray(out)) throw new ApifyError('Apify dataset items were not a list', 502);
      return out;
    },
    /** The account behind the token. Free; never called by status checks (they read key presence only). */
    async me(): Promise<{ id: string; username: string | null; plan: string | null; tier: string | null }> {
      const d = ((await call('GET', '/users/me')) as { data?: Record<string, unknown> }).data ?? {};
      const plan = d.plan as Record<string, unknown> | undefined;
      return { id: String(d.id ?? ''), username: typeof d.username === 'string' ? d.username : null, plan: typeof plan?.id === 'string' ? String(plan.id) : null, tier: typeof plan?.tier === 'string' ? String(plan.tier) : null };
    },
  };
}

export type ApifyClient = ReturnType<typeof createApifyClient>;

/* ── Actors (SPEC §2, §4.2; v2 04 2.2) ─────────────────────────────────────
   Inputs follow each actor's public input schema as read on 2026-10-11 (04 2.2). Whether an
   actor's OUTPUT matches what the normalizer expects is not a constant: `verify-actors` records it
   in lab_priors `actor_fields`, read through lib/lab/measure/actors.ts `isVerified`. */

export type ActorSpec<A extends unknown[] = [string[], number]> = {
  actorId: string;
  /** The input body for POST /acts/{id}/runs. */
  buildInput: (...args: A) => Record<string, unknown>;
};

export type PostActorOpts = { downloadVideos?: boolean };

/**
 * The YouTube scraper's `transcriptionAndSubtitle` enum value for "download subtitles only".
 * [LIVE-CHECK] (04 2.2): read the raw value from the actor's input JSON in the console; until then
 * the field is omitted (subtitles treated as absent). Never send "always transcribe" (paid).
 */
export const YT_SUBTITLES_ONLY: string | null = null;

const bare = (h: string) => h.replace(/^@/, '');

export const POST_ACTORS: Record<LabPlatform, ActorSpec<[string[], number, PostActorOpts?]>> = {
  instagram: {
    actorId: 'apify/instagram-post-scraper',
    // detailedData carries the video play count and bills post + post-details (C19)
    buildInput: (handles, limit) => ({ username: handles, resultsLimit: limit, skipPinnedPosts: false, scrapeComments: false, dataDetailLevel: 'detailedData' }),
  },
  youtube: {
    actorId: 'streamers/youtube-scraper',
    buildInput: (handles, limit) => ({
      startUrls: handles.flatMap((h) => [{ url: `https://www.youtube.com/@${bare(h)}/videos` }, { url: `https://www.youtube.com/@${bare(h)}/shorts` }]),
      maxResults: limit,
      maxResultsShorts: limit,
      ...(YT_SUBTITLES_ONLY ? { transcriptionAndSubtitle: YT_SUBTITLES_ONLY } : {}),
      subtitlesLanguage: 'en',
    }),
  },
  tiktok: {
    actorId: 'clockworks/tiktok-scraper',
    // covers are not used by the Lab and are an extra event; downloads only when LAB_TIKTOK_DOWNLOADS=1 (04 2.2)
    buildInput: (handles, limit, o = {}) => ({ profiles: handles, resultsPerPage: limit, shouldDownloadVideos: Boolean(o.downloadVideos), shouldDownloadCovers: false }),
  },
  twitter: {
    actorId: 'apidojo/tweet-scraper',
    // each query bills at least 50 tweets; single tweets are not allowed (04 2.2)
    buildInput: (handles, limit) => ({ searchTerms: handles.map((h) => `from:${bare(h)} -filter:replies`), maxItems: Math.max(50, limit) * Math.max(1, handles.length), sort: 'Latest' }),
  },
  linkedin: {
    actorId: 'harvestapi/linkedin-profile-posts',
    // reactions and comments are billed as extra posts: off
    buildInput: (handles, limit) => ({ targetUrls: handles.map((h) => `https://www.linkedin.com/in/${bare(h)}/`), maxPosts: limit, includeReposts: false, scrapeReactions: false, scrapeComments: false }),
  },
};

/**
 * Single-post reads for the fixed-age snapshot scheduler (04 4.1): one run per platform holding
 * every due post. X has no single-tweet read: the owned `from:` query stands in.
 */
export const SINGLE_POST_INPUT: Record<LabPlatform, (urls: string[], handles: string[]) => Record<string, unknown>> = {
  instagram: (urls) => ({ username: urls, skipPinnedPosts: false, scrapeComments: false, dataDetailLevel: 'detailedData' }),
  tiktok: (urls) => ({ postURLs: urls, resultsPerPage: 1, shouldDownloadVideos: false, shouldDownloadCovers: false }),
  youtube: (urls) => ({ startUrls: urls.map((url) => ({ url })), maxResults: urls.length, subtitlesLanguage: 'en' }),
  linkedin: (urls) => ({ targetUrls: urls, maxPosts: 1, includeReposts: false, scrapeReactions: false, scrapeComments: false }),
  twitter: (_urls, handles) => POST_ACTORS.twitter.buildInput(handles, 50),
};

/** One profile read per cycle writes follower counts to lab_creator_snapshots (§4.2). */
export const PROFILE_ACTORS: Partial<Record<LabPlatform, ActorSpec<[string[]]>>> = {
  instagram: { actorId: 'apify/instagram-profile-scraper', buildInput: (handles) => ({ usernames: handles }) },
  // TikTok and YouTube post items carry the author block (fans / numberOfSubscribers): no extra run needed.
};

/** Content-first discovery (§4.8): keyword and hashtag search, capped per run. */
export const SEARCH_ACTORS: Partial<Record<LabPlatform, ActorSpec<[string[], number]>>> = {
  tiktok: { actorId: 'clockworks/tiktok-scraper', buildInput: (terms, limit) => ({ searchQueries: terms, resultsPerPage: limit, shouldDownloadVideos: false, shouldDownloadCovers: false }) },
  youtube: { actorId: 'streamers/youtube-scraper', buildInput: (terms, limit) => ({ searchQueries: terms, maxResults: limit, subtitlesLanguage: 'en' }) },
  instagram: { actorId: 'apify/instagram-hashtag-scraper', buildInput: (tags, limit) => ({ hashtags: tags.map((t) => t.replace(/^#/, '')), resultsLimit: limit }) },
};

/** Default depth (§4.2): a creator's first scrape reads 50 posts, then 15 newest per cycle; a suggestion is sampled once at 10. */
export const SCRAPE_DEPTH = { first: 50, cycle: 15, suggestion: 10 } as const;
