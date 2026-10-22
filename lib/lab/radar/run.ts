/**
 * Radar job bodies and `runRadarNow` (05 sections 4, 18, 19). Scheduling is section 08's: the
 * `radar.*` and `brief` rows of LAB_JOBS call `runSource`, `runRadarEvents` and `runBrief`.
 *
 * Dry (LAB_DRY=1) on a real install: no request leaves the process and nothing is written to the
 * lab_event* tables; runs are logged with dry = 1 and the fixture counts are returned.
 * Filming: the fixtures persist with dry = 1 (05 18). Paid sources go through `gatedCall`.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { LabEvent, LabRadarSource, LabRun } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { createApifyClient, type ApifyClient, type FetchLike } from '@/lib/lab/apify-client';
import { CapError, gatedCall, headroom, lineOffReason } from '@/lib/lab/spend';
import { dryReason as currentDryReason, isDry } from '@/lib/lab/dry';
import { labFetch } from '@/lib/lab/net';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { automationDirs, pausedBy } from '@/lib/lab/schedule';
import { claudeJson } from '@/lib/creative-engine/claude';
import { matchText as clusterMatch } from '@/lib/lab/clusters';
import { productHuntToken } from '@/lib/lab/feeds';
import { labTz } from '@/lib/lab/setup/tz';
import { PRODUCTHUNT_ACTOR, RADAR_DISABLED_KEY, RADAR_SOURCES, SOURCE_LINE, TIKTOK_CC_ACTOR, VENDOR_FEEDS, X_ACTOR, type VendorFeed } from '@/lib/lab/radar/config';
import { fetchHnRadar, hnAttentionUrl, parseHnAttention } from '@/lib/lab/radar/fetch/hn';
import { fetchHfModels, fetchHfSpaces } from '@/lib/lab/radar/fetch/hf';
import { fakeStarCheck, fetchGithubNew, fetchOwner, githubToken as readGithubToken, ownerEstablished } from '@/lib/lab/radar/fetch/github';
import { fetchVendor } from '@/lib/lab/radar/fetch/vendor';
import { fetchPageviews, resolveArticle, WIKI_DELAY_MS, WIKI_MAX_PER_TICK } from '@/lib/lab/radar/fetch/wikipedia';
import { xWatchInput } from '@/lib/lab/radar/fetch/x';
import { fetchPhRadar, PH_ACTOR_INPUT } from '@/lib/lab/radar/fetch/producthunt';
import { TIKTOK_CC_INPUT } from '@/lib/lab/radar/fetch/tiktok';
import { sourceBaseline, upsertPing } from '@/lib/lab/radar/pings';
import type { RawPing } from '@/lib/lab/radar/types';
import { attachOrCreate, confirmEvents, expireCandidates, manualEvent, xAttach } from '@/lib/lab/radar/events';
import { nameCandidates, NameReply, type NameAsk } from '@/lib/lab/radar/namer';
import { NoveltyReplySchema, tagNovelty, type NoveltyAsk } from '@/lib/lab/radar/novelty';
import { classifyEvent } from '@/lib/lab/radar/classify';
import { applyWindow, windowCoverage, windowFor } from '@/lib/lab/radar/window';
import { activeTrackedCount, matchCoverage } from '@/lib/lab/radar/coverage';
import { AngleReplySchema, assignAngles, type AngleAsk } from '@/lib/lab/radar/angles';
import { persistLeadTime } from '@/lib/lab/radar/leadtime';
import { composeMorningBrief } from '@/lib/lab/radar/morning-brief';
import { sendMorningBriefToWizard, telegramOn } from '@/lib/lab/radar/wizard';
import { persistRadarFixtures, radarFixtures } from '@/lib/lab/radar/fixtures';
import { getJson, DAY, radarFetch } from '@/lib/lab/radar/util';

export type RadarAsk = { name?: NameAsk | null; novelty?: NoveltyAsk | null; angle?: AngleAsk | null };

export type RadarCtx = {
  store: LabStore;
  now: Date;
  dry: boolean;
  dryReason: 'env' | 'filming' | null;
  scheduled: boolean;
  override?: boolean;
  job?: string | null;
  fetch?: FetchLike;
  client?: ApifyClient | null;
  apifyToken?: string | null;
  githubToken?: string | null;
  phToken?: string | null;
  ask?: RadarAsk;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
  tz?: string;
  home?: string;
  brainRoot?: string | null;
};

export type SourceStatus = 'ran' | 'skipped' | 'deferred' | 'blocked' | 'error';
export type SourceOutcome = { source: LabRadarSource; status: SourceStatus; detail: string; items: number; runId: string | null; cap?: { line: string; spent: number; cap: number | null } };


/** Fill a context from the environment (the API, the CLI and LAB_JOBS all start here). */
export function radarCtx(store: LabStore, partial: Partial<RadarCtx> = {}): RadarCtx {
  const reason = partial.dryReason !== undefined ? partial.dryReason : currentDryReason();
  return {
    store,
    now: partial.now ?? new Date(),
    dry: partial.dry ?? (reason !== null || isDry()),
    dryReason: reason,
    scheduled: partial.scheduled ?? false,
    ...partial,
  };
}

const apifyTokenOf = (ctx: RadarCtx): string | null => (ctx.apifyToken !== undefined ? ctx.apifyToken : (resolveApifyToken() ?? null));
const githubTokenOf = (ctx: RadarCtx): string | null => (ctx.githubToken !== undefined ? ctx.githubToken : (readGithubToken() ?? null));
const phTokenOf = (ctx: RadarCtx): string | null => (ctx.phToken !== undefined ? ctx.phToken : (productHuntToken() ?? null));
const fetchOf = (ctx: RadarCtx): FetchLike => ctx.fetch ?? radarFetch;
const clientOf = (ctx: RadarCtx): ApifyClient | null => {
  if (ctx.client !== undefined) return ctx.client;
  const token = apifyTokenOf(ctx);
  return token ? createApifyClient({ token, fetch: ctx.fetch ?? ((url, init) => labFetch(url, init)) }) : null;
};

/** lab_priors `radar:disabled` (05 19, toggled from Setup > Sources). */
export function disabledSources(store: LabStore): LabRadarSource[] {
  const v = store.priors.get(RADAR_DISABLED_KEY)?.value;
  return Array.isArray(v) ? v.filter((s): s is LabRadarSource => (RADAR_SOURCES as readonly string[]).includes(s as string)) : [];
}

export function setSourceEnabled(store: LabStore, source: LabRadarSource, enabled: boolean, now: Date): LabRadarSource[] {
  const cur = new Set(disabledSources(store));
  if (enabled) cur.delete(source);
  else cur.add(source);
  const value = RADAR_SOURCES.filter((s) => cur.has(s));
  store.priors.set({ key: RADAR_DISABLED_KEY, value, n: value.length, supersedesDefault: false, updatedAt: now.toISOString() });
  return value;
}

export const watchHandles = (store: LabStore): string[] => store.sources.all('watch').filter((s) => s.status === 'active' && s.platform === 'x').map((s) => s.handle);

/**
 * Why a source cannot run now, or null (05 19 "Each source is off until its prerequisite exists").
 * `kind: 'defer'` = the X single-run guard (09.5.3): no run row, no spend, retried next tick.
 */
export function sourceNeeds(ctx: RadarCtx, source: LabRadarSource): { kind: 'skip' | 'defer'; reason: string } | null {
  const { store } = ctx;
  if (disabledSources(store).includes(source)) return { kind: 'skip', reason: 'Turned off in Setup' };
  const apify = Boolean(apifyTokenOf(ctx));
  if (source === 'x') {
    if (!apify) return { kind: 'skip', reason: 'Apify: Not configured' };
    if (!watchHandles(store).length) return { kind: 'skip', reason: 'X watch list: Not configured' };
    const off = lineOffReason('apify.radar_x', { store, env: ctx.env });
    if (off) return { kind: 'skip', reason: off };
    if (store.runs.openForActor(X_ACTOR).length) return { kind: 'defer', reason: 'Waiting for the other X run to finish' };
  }
  if (source === 'tiktok_cc') {
    if (!apify) return { kind: 'skip', reason: 'Apify: Not configured' };
    const off = lineOffReason('apify.radar_tiktok', { store, env: ctx.env });
    if (off) return { kind: 'skip', reason: off };
  }
  if (source === 'producthunt' && !phTokenOf(ctx)) {
    if (!apify) return { kind: 'skip', reason: 'Product Hunt token or Apify: Not configured' };
    const off = lineOffReason('apify.radar_producthunt', { store, env: ctx.env });
    if (off) return { kind: 'skip', reason: off };
  }
  return null;
}

/** A free source's 0-cost lab_runs row (08.5.2): kind radar, line null. */
function freeRun(ctx: RadarCtx, source: LabRadarSource): LabRun {
  const at = ctx.now.toISOString();
  const run: LabRun = {
    id: `lrun-${randomUUID().slice(0, 12)}`, kind: 'radar', apifyRunId: null, datasetId: null, actor: `radar:${source}`, input: { source }, status: 'running', items: null, costUsd: 0,
    dry: ctx.dry, startedAt: at, finishedAt: null, error: null, line: null, job: ctx.job ?? `radar.${source}`, scheduled: ctx.scheduled, batchId: null, progress: null,
  };
  ctx.store.runs.insert(run);
  return run;
}

const finish = (ctx: RadarCtx, run: LabRun, items: number, error: string | null = null) =>
  ctx.store.runs.update(run.id, { status: error ? 'failed' : 'succeeded', items, finishedAt: new Date().toISOString(), error: error ? error.slice(0, 500) : null });

/** Upsert raw pings with the source's baseline computed once. */
export function storePings(ctx: RadarCtx, raws: readonly RawPing[], extra: (r: RawPing) => Parameters<typeof upsertPing>[2]['ctx'] = () => ({})): number {
  if (!raws.length) return 0;
  const bySource = new Map<string, number[]>();
  ctx.store.transaction(() => {
    for (const r of raws) {
      if (!bySource.has(r.source)) bySource.set(r.source, sourceBaseline(ctx.store, r.source, ctx.now));
      upsertPing(ctx.store, r, { now: ctx.now, dry: ctx.dry, baseline: bySource.get(r.source), ctx: extra(r) });
    }
  });
  return raws.length;
}

/** Slugs already stored for a link-diff page. */
function knownSlugs(store: LabStore, feed: VendorFeed): Set<string> {
  const prefix = `${feed.vendor}:`;
  return new Set(
    store.eventPings
      .forSource('vendor', '1970-01-01T00:00:00.000Z')
      .filter((p) => p.externalId.startsWith(prefix) && p.url.startsWith(feed.base ?? '\u0000'))
      .map((p) => p.externalId.slice(prefix.length)),
  );
}

async function runGithub(ctx: RadarCtx): Promise<number> {
  const token = githubTokenOf(ctx);
  const raws = await fetchGithubNew({ now: ctx.now, fetch: fetchOf(ctx), token });
  let checks = 0;
  const owners = new Map<string, { type: string | null; createdAt: string | null }>();
  const extras = new Map<string, NonNullable<Parameters<typeof upsertPing>[2]['ctx']>>();
  for (const r of raws) {
    const prev = ctx.store.eventPings.get(`github:${r.externalId}`);
    const stars = r.metric ?? 0;
    const young = r.extra.createdAt ? ctx.now.getTime() - Date.parse(r.extra.createdAt) <= 7 * DAY : false;
    const prevVel = prev?.velocityPerH ?? 0;
    if (!(stars >= 500 && young) && prevVel < 50) continue;
    if (token) {
      const info = prev?.fakeStarInfo as { checkedAt?: string } | null | undefined;
      const fresh = info?.checkedAt && ctx.now.getTime() - Date.parse(info.checkedAt) < DAY;
      if (!fresh && checks < 3) {
        checks++;
        const res = await fakeStarCheck(r.externalId, stars, { token, fetch: fetchOf(ctx) });
        const checked = { ...res, checkedAt: ctx.now.toISOString() };
        extras.set(r.externalId, { githubToken: true, fakeStar: checked });
      } else extras.set(r.externalId, { githubToken: true });
    } else {
      const login = r.extra.ownerLogin ?? '';
      if (r.extra.ownerType === 'Organization') extras.set(r.externalId, { ownerEstablished: true });
      else if (login) {
        if (!owners.has(login)) owners.set(login, await fetchOwner(login, { fetch: fetchOf(ctx) }));
        extras.set(r.externalId, { ownerEstablished: ownerEstablished(owners.get(login)!, ctx.now) });
      }
    }
  }
  return storePings(ctx, raws, (r) => extras.get(r.externalId) ?? { githubToken: Boolean(token) });
}

/** The daily Wikipedia meter: articles, attention series, ping retention, lead-time table. */
async function runWikipedia(ctx: RadarCtx): Promise<number> {
  const { store, now } = ctx;
  const sleep = ctx.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const f = fetchOf(ctx);
  let requests = 0;
  const call = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    if (requests >= WIKI_MAX_PER_TICK) return null;
    if (requests > 0) await sleep(WIKI_DELAY_MS);
    requests++;
    return fn();
  };
  const today = now.toISOString().slice(0, 10);
  let updated = 0;
  for (const e of store.events.all({ status: ['confirmed'] })) {
    if (!e.t0 || now.getTime() - Date.parse(e.t0) > 60 * DAY) continue;
    let next: LabEvent = e;
    if (e.wikiArticle === null) {
      const art = await call(() => resolveArticle(e.name, { fetch: f }));
      if (art) next = { ...next, wikiArticle: art };
      else if (now.getTime() - Date.parse(e.t0) >= 7 * DAY) next = { ...next, wikiArticle: '' };
    }
    const from = new Date(Date.parse(e.t0) - 14 * DAY).toISOString();
    const to = new Date(Math.min(now.getTime(), Date.parse(from) + 60 * DAY)).toISOString();
    let series: { day: string; v: number }[] | null = null;
    if (next.wikiArticle) {
      series = await call(() => fetchPageviews(next.wikiArticle!, from, to, { fetch: f }));
      if (series) next = { ...next, classBasis: 'wikipedia' };
    } else {
      const hn = await call(async () => parseHnAttention(await getJson(f, hnAttentionUrl(e.name, e.t0!))));
      if (hn && hn.length) {
        series = hn;
        next = { ...next, classBasis: 'hn' };
      }
    }
    if (series) next = { ...next, attention: series.filter((x) => x.day <= today) };
    if (next !== e) {
      store.events.upsert({ ...next, updatedAt: now.toISOString() });
      updated++;
    }
  }
  store.eventPings.deleteOlderUnattached(new Date(now.getTime() - 30 * DAY).toISOString());
  persistLeadTime(store, now);
  return updated;
}

/** Start one paid Apify source through the gate (line, kind 'radar'). */
async function runPaid(ctx: RadarCtx, source: 'x' | 'tiktok_cc' | 'producthunt'): Promise<SourceOutcome> {
  const line = SOURCE_LINE[source]!;
  const actor = source === 'x' ? X_ACTOR : source === 'tiktok_cc' ? TIKTOK_CC_ACTOR : PRODUCTHUNT_ACTOR;
  const lastOk = (ctx.store.priors.get(`job:radar.${source}`)?.value as { lastOkAt?: string | null } | null | undefined)?.lastOkAt ?? null;
  const input = source === 'x' ? xWatchInput(watchHandles(ctx.store), lastOk) : source === 'tiktok_cc' ? TIKTOK_CC_INPUT : PH_ACTOR_INPUT;
  const fixtureItems = radarFixtures(ctx.now).pings.filter((p) => p.source === source).length;
  try {
    const res = await gatedCall<null>(
      ctx.store,
      { provider: 'apify', line, kind: 'radar', actor, input: { source, actorInput: input }, override: ctx.override, scheduled: ctx.scheduled, job: ctx.job ?? `radar.${source}`, now: ctx.now },
      {
        dry: () => {
          if (ctx.dryReason === 'filming') persistRadarFixtures(ctx.store, ctx.now);
          return { result: null, units: 0, items: fixtureItems };
        },
        live: async (_run, lc) => {
          const client = clientOf(ctx);
          if (!client) throw new Error('Apify: Not configured');
          // the start sits lexically inside the live branch (AC-08-14: one door for spending)
          const maxItems = source === 'x' ? (input as ReturnType<typeof xWatchInput>).maxItems : source === 'tiktok_cc' ? TIKTOK_CC_INPUT.maxItemsPerType : PH_ACTOR_INPUT.limit;
          const started = await client.startRun(actor, input, { maxItems, ...(lc.maxTotalChargeUsd != null ? { maxTotalChargeUsd: lc.maxTotalChargeUsd } : {}) });
          return { result: null, units: 0, actualUsd: null, apifyRunId: started.id, datasetId: started.defaultDatasetId, pending: true, items: null };
        },
      },
    );
    return { source, status: 'ran', detail: res.dry ? 'Dry run: fixtures, no charges' : 'Started on Apify; results land on the next tick', items: res.run.items ?? 0, runId: res.run.id };
  } catch (err) {
    if (err instanceof CapError) {
      const h = headroom(ctx.store, line, ctx.now, ctx.env);
      return { source, status: 'blocked', detail: err.reason === 'off' ? err.message : 'cap reached', items: 0, runId: null, cap: { line, spent: Math.round(h.lineSpent * 100) / 100, cap: h.lineCap } };
    }
    return { source, status: 'error', detail: err instanceof Error ? err.message : String(err), items: 0, runId: null };
  }
}

/** One radar source now (a `radar.<source>` job body). */
export async function runSource(ctx: RadarCtx, source: LabRadarSource): Promise<SourceOutcome> {
  const need = sourceNeeds(ctx, source);
  if (need) return { source, status: need.kind === 'defer' ? 'deferred' : 'skipped', detail: need.reason, items: 0, runId: null };
  if (source === 'x' || source === 'tiktok_cc' || (source === 'producthunt' && !phTokenOf(ctx))) return runPaid(ctx, source);
  const run = freeRun(ctx, source);
  if (ctx.dry) {
    const items = ctx.dryReason === 'filming' ? persistRadarFixtures(ctx.store, ctx.now).pings : radarFixtures(ctx.now).pings.filter((p) => p.source === source).length;
    finish(ctx, run, items);
    return { source, status: 'ran', detail: 'Dry run: fixtures, no network', items, runId: run.id };
  }
  try {
    let items = 0;
    const f = fetchOf(ctx);
    if (source === 'hn') items = storePings(ctx, await fetchHnRadar({ now: ctx.now, fetch: f }));
    else if (source === 'hf_models') items = storePings(ctx, await fetchHfModels({ fetch: f }));
    else if (source === 'hf_spaces') items = storePings(ctx, await fetchHfSpaces({ fetch: f }));
    else if (source === 'github') items = await runGithub(ctx);
    else if (source === 'vendor') {
      const res = await fetchVendor({ fetch: f, knownSlugs: (feed) => knownSlugs(ctx.store, feed) });
      items = storePings(ctx, res.pings);
      if (res.errors.length === VENDOR_FEEDS.length) throw new Error(res.errors[0].error);
    } else if (source === 'producthunt') items = storePings(ctx, await fetchPhRadar({ token: phTokenOf(ctx)!, now: ctx.now, fetch: f }));
    else if (source === 'wikipedia') items = await runWikipedia(ctx);
    finish(ctx, run, items);
    return { source, status: 'ran', detail: `${items} items`, items, runId: run.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finish(ctx, run, 0, msg);
    return { source, status: 'error', detail: msg, items: 0, runId: run.id };
  }
}

/* ── the LLM asks, gated on line llm ($0, uncapped), only when something needs one ── */

function gatedAsk<T>(ctx: RadarCtx, label: string, ask: (p: string) => Promise<{ ok: true; data: T } | { ok: false; unavailable: boolean; error: string }>) {
  return async (prompt: string) => {
    const res = await gatedCall(ctx.store, { provider: 'llm', line: 'llm', kind: 'radar', actor: `claude:${label}`, input: { label }, scheduled: ctx.scheduled, job: ctx.job ?? 'radar.events', now: ctx.now }, {
      dry: () => ({ result: { ok: false as const, unavailable: false, error: 'dry' } }),
      live: async () => ({ result: await ask(prompt), units: 0, actualUsd: 0 }),
    });
    return res.result;
  };
}

export function defaultAsks(ctx: RadarCtx): RadarAsk {
  return {
    name: gatedAsk(ctx, 'radar-name', (p) => claudeJson(p, NameReply, { timeoutMs: 120_000 })),
    novelty: gatedAsk(ctx, 'radar-novelty', (p) => claudeJson(p, NoveltyReplySchema, { timeoutMs: 120_000 })),
    angle: gatedAsk(ctx, 'radar-angle', (p) => claudeJson(p, AngleReplySchema, { timeoutMs: 120_000 })),
  };
}

export type EventsResult = { dry: boolean; named: number; attached: number; created: number; confirmed: number; expired: number; tagged: number; windows: number; coverage: number; angles: number };

/** The `radar.events` job body: the event pipeline in 08.5.1's order. */
export async function runRadarEvents(ctx: RadarCtx): Promise<EventsResult> {
  const res: EventsResult = { dry: ctx.dry, named: 0, attached: 0, created: 0, confirmed: 0, expired: 0, tagged: 0, windows: 0, coverage: 0, angles: 0 };
  if (ctx.dry) {
    if (ctx.dryReason === 'filming') persistRadarFixtures(ctx.store, ctx.now);
    const f = radarFixtures(ctx.now);
    return { ...res, created: f.events.length, confirmed: f.events.filter((e) => e.status === 'confirmed').length };
  }
  const { store, now } = ctx;
  const ask = ctx.ask ?? defaultAsks(ctx);
  res.named = (await nameCandidates(store, now, { ask: ask.name, dry: false })).named;
  const a = attachOrCreate(store, now);
  res.attached = a.attached;
  res.created = a.created;
  res.attached += xAttach(store, now).attached;
  res.confirmed = confirmEvents(store, now).confirmed;
  res.expired = expireCandidates(store, now);
  const t = await tagNovelty(store, now, { ask: ask.novelty, dry: false });
  res.tagged = t.byRule + t.byLlm;
  const active = activeTrackedCount(store, now);
  store.transaction(() => {
    for (const e of store.events.all({ status: ['confirmed'] })) {
      if (!e.t0 || now.getTime() - Date.parse(e.t0) > 60 * DAY) continue;
      let next: LabEvent = e;
      if (!e.clusterId) {
        const m = clusterMatch(store, e.name);
        if (m) next = { ...next, clusterId: m.id };
      }
      const c = classifyEvent(next, now);
      next = { ...next, class: c.class, classInfo: c.classInfo };
      if (c.wave) next = { ...next, waveN: c.wave.n, waveStartedAt: c.wave.startedAt };
      next = applyWindow(next, windowFor(next, windowCoverage(store, next, active, now), now), now);
      if (JSON.stringify(next) !== JSON.stringify(e)) {
        store.events.upsert({ ...next, updatedAt: now.toISOString() });
        res.windows++;
      }
    }
  });
  res.coverage = matchCoverage(store, now).rows;
  res.angles = (await assignAngles(store, { ask: ask.angle, dry: false })).assigned;
  return res;
}

/** The `brief` job body: compose (always, written to the brain), then send only when the switch is on. */
export async function runBrief(ctx: RadarCtx): Promise<{ items: number; sent: boolean; reason: string }> {
  const tz = ctx.tz ?? labTz(ctx.env);
  const brief = composeMorningBrief(ctx.store, { now: ctx.now, tz, dry: ctx.dry, brainRoot: ctx.brainRoot });
  if (!telegramOn(ctx.env ?? process.env)) return { items: brief.items.length, sent: false, reason: 'off' };
  if (ctx.dry) {
    // 08.9: in dry or Filming the send is logged as a `brief` run with dry = 1 and nothing is sent
    const at = ctx.now.toISOString();
    ctx.store.runs.insert({ id: `lrun-${randomUUID().slice(0, 12)}`, kind: 'brief', apifyRunId: null, datasetId: null, actor: 'wizard', input: { day: brief.day }, status: 'succeeded', items: brief.items.length, costUsd: 0, dry: true, startedAt: at, finishedAt: at, error: null, line: null, job: 'brief', scheduled: ctx.scheduled, batchId: null, progress: null });
    return { items: brief.items.length, sent: false, reason: 'dry' };
  }
  const s = sendMorningBriefToWizard(ctx.store, brief, { now: ctx.now, home: ctx.home, env: ctx.env, dry: ctx.dry, tz });
  return { items: brief.items.length, ...s };
}

/** Record `job:<id>` state for a manual run (the tick records its own). */
export function recordJobState(store: LabStore, job: string, ok: boolean, detail: string, now: Date, skipped: string | null = null): void {
  const prev = store.priors.get(`job:${job}`)?.value as { lastOkAt?: string | null; fails?: number } | null | undefined;
  const at = now.toISOString();
  store.priors.set({
    key: `job:${job}`,
    value: { lastAt: at, lastOkAt: ok && !skipped ? at : (prev?.lastOkAt ?? null), lastDetail: detail.slice(0, 300), fails: ok ? 0 : (prev?.fails ?? 0) + 1, skippedReason: skipped },
    n: 0, supersedesDefault: false, updatedAt: at,
  });
}

export type RadarNowResult = {
  ran: LabRadarSource[];
  skipped: { source: LabRadarSource; reason: string }[];
  errors: { source: LabRadarSource; error: string }[];
  events: { created: number; confirmed: number };
  blocked: SourceOutcome[];
  paused: string | null;
  dry: boolean;
};

/**
 * Every enabled source now, regardless of due-ness, then the event pipeline (05 4: the API's
 * `run` action and `lab-sync -- radar`). Paid lines stay gated; `override` only from the UI confirm.
 */
export async function runRadarNow(store: LabStore, opts: Partial<RadarCtx> & { paused?: string | null } = {}): Promise<RadarNowResult> {
  const ctx = radarCtx(store, { ...opts, scheduled: false });
  const paused = opts.paused !== undefined ? opts.paused : pausedBy(automationDirs(), fs.existsSync, 'radar');
  const out: RadarNowResult = { ran: [], skipped: [], errors: [], events: { created: 0, confirmed: 0 }, blocked: [], paused, dry: ctx.dry };
  if (paused) {
    out.skipped = RADAR_SOURCES.map((source) => ({ source, reason: `Paused by ${paused.split('/').pop()}` }));
    return out;
  }
  for (const source of RADAR_SOURCES) {
    const r = await runSource({ ...ctx, job: `radar.${source}` }, source);
    if (r.status === 'ran') out.ran.push(source);
    else if (r.status === 'skipped' || r.status === 'deferred') out.skipped.push({ source, reason: r.detail });
    else if (r.status === 'blocked') {
      out.blocked.push(r);
      out.skipped.push({ source, reason: r.detail });
    } else out.errors.push({ source, error: r.detail });
    if (!ctx.dry || ctx.dryReason === 'filming') recordJobState(store, `radar.${source}`, r.status !== 'error', r.detail, ctx.now, r.status === 'ran' ? null : r.status === 'error' ? null : r.detail);
  }
  const ev = await runRadarEvents({ ...ctx, job: 'radar.events' });
  out.events = { created: ev.created, confirmed: ev.confirmed };
  if (!ctx.dry) recordJobState(store, 'radar.events', true, `${ev.created} created, ${ev.confirmed} confirmed`, ctx.now);
  return out;
}

/** T3 helper for the API (`add`). */
export const addManualEvent = (store: LabStore, name: string, t0: string | null, now: Date) => manualEvent(store, name, t0, now);

