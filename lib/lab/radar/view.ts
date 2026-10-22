/**
 * Radar domain views (05 17.1; 01 D13). Lane R owns this file. Pure reads over the store plus
 * env and file checks: a render makes no network call (AC-08-9).
 */
import fs from 'node:fs';
import { LabJobStateSchema } from '@/lib/schemas';
import type { JobState } from '@/lib/lab/setup/jobs';
import { labTz } from '@/lib/lab/setup/tz';
import { isDry } from '@/lib/lab/dry';
import { automationDirs, pausedBy } from '@/lib/lab/schedule';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { productHuntToken } from '@/lib/lab/feeds';
import { RADAR_SOURCES, SOURCE_LABEL, SOURCE_LINE } from '@/lib/lab/radar/config';
import { githubToken } from '@/lib/lab/radar/fetch/github';
import { angleMap, angleOwnStats, recommendAngle, takenAngles, type AngleOwnStats } from '@/lib/lab/radar/angles';
import { activeTrackedCount, coverageShare, stateAt, waveSeries } from '@/lib/lab/radar/coverage';
import { familyFirsts } from '@/lib/lab/radar/events';
import { CLASS_LABEL } from '@/lib/lab/radar/classify';
import { NOVELTY_LABEL, NOVELTY_PRIORS, noveltyPriorLine } from '@/lib/lab/radar/novelty';
import { orderKey } from '@/lib/lab/radar/window';
import { leadTimeTable, storedLeadTime } from '@/lib/lab/radar/leadtime';
import { briefHeader, liveAlerts } from '@/lib/lab/radar/morning-brief';
import { telegramOn } from '@/lib/lab/radar/wizard';
import { backtestSeed } from '@/lib/lab/radar/seed';
import { namingState } from '@/lib/lab/radar/namer';
import { disabledSources, watchHandles } from '@/lib/lab/radar/run';
import { RADAR_CADENCE, cadenceDue, xPollMinutes } from '@/lib/lab/radar/jobs';
import { ageLabel, clock, localParts, median } from '@/lib/lab/radar/util';
import type {
  LabEvent,
  LabEventClass,
  LabEventStatus,
  LabMorningBriefItem,
  LabNovelty,
  LabPlatform,
  LabRadarFamily,
  LabRadarSource,
  LabWavePosition,
  LabWindowState,
  LaunchAngle,
} from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { AngleCell } from '@/lib/lab/radar/angles';

export type { LabEventClass, LabWindowState, LabNovelty, LabRadarSource, LabRadarFamily, LaunchAngle } from '@/lib/schemas';
export type { AngleId, AngleCell } from '@/lib/lab/radar/angles';

export type RadarSourceHealth = {
  source: LabRadarSource;
  label: string;
  status: 'ok' | 'failing' | 'not_configured' | 'paused' | 'never_run';
  lastRunAt: string | null;
  lastError: string | null;
  nextDueAt: string | null;
  /** setupHrefFor(...) or '/lab?setup=sources' / '?setup=keys' */
  setupHref: string | null;
  /** 'apify.radar_x' | 'apify.radar_tiktok' | 'apify.radar_producthunt' | null (free) */
  costLine: string | null;
  /** e.g. 'Fake-star filter off' */
  note: string | null;
};

export type EventRow = {
  id: string;
  name: string;
  vendor: string | null;
  status: LabEventStatus;
  novelty: LabNovelty | null;
  /** 'New category' | ... | 'Not tagged yet' */
  noveltyLabel: string;
  class: LabEventClass;
  /** 'Spike (days)' | 'Adopted tool (weeks, comes back)' | 'Class decided at 96h' */
  classLabel: string;
  t0: string | null;
  /** '9h', '2d' */
  ageLabel: string;
  window: { state: LabWindowState; progress: number; reason: string | null; closesAt: string } | null;
  /** '3 of 14 creators' */
  coverage: { creators: number; active: number; label: string };
  waveN: number;
  waveSeries: { h: number; creators: number }[];
  sources: { family: LabRadarFamily; firstSeenAt: string; reason: string }[];
  coveredByMe: { postId: string; ratio: number | null } | null;
  ideaId: string | null;
};

export type MorningBriefView = { day: string; header: string; items: LabMorningBriefItem[]; sent: { at: string; via: 'wizard' } | null; sendError: string | null; telegramOn: boolean };
/** 01 5.1 lists 05's brief view as `BriefView`; it is MorningBriefView. */
export type BriefView = MorningBriefView;

export type RadarView = {
  state: 'never_run' | 'ok' | 'dry' | 'sample';
  lastTickAt: string | null;
  nextTickAt: string | null;
  sources: RadarSourceHealth[];
  liveAlerts: number;
  /** confirmed, open/closing first, then closed in the last 14 days */
  events: EventRow[];
  /** 'watching' list, collapsed */
  candidates: EventRow[];
  timeline: { from: string; to: string; lanes: { eventId: string; name: string; pings: { family: LabRadarFamily; at: string }[]; ribbon: { at: string; creators: number; state: LabWindowState }[] }[] };
  morningBrief: MorningBriefView | null;
  leadTime: { rows: { class: LabEventClass; family: LabRadarFamily; medianLeadH: number | null; n: number; shareLeading: number | null; label: string }[]; firedBeforePct: number | null; firedBeforeN: number; classRecord: string };
  waveLift: { firstMedian: number | null; firstN: number; followMedian: number | null; followN: number; label: string; prior: string };
};

export type EventSheetView = EventRow & {
  aliases: string[];
  t0Rule: string;
  t0RevisedAt: string | null;
  pings: { family: LabRadarFamily; source: LabRadarSource; title: string; url: string; at: string; reason: string; qualifies: boolean }[];
  attention: { day: string; v: number }[];
  classInfo: LabEvent['classInfo'];
  classBasis: 'wikipedia' | 'hn' | null;
  /** 'Prior from big AI channels: 2.8x their normal (n 8, YouTube long-form).' */
  noveltyPrior: string;
  angles: AngleCell[];
  /** both from recommendAngle (12.4) */
  recommendedAngle: Exclude<LaunchAngle, 'other'>;
  recommendCopy: string;
  posts: { postId: string; creator: string; platform: LabPlatform; hook: string; hoursSinceT0: number; wavePosition: LabWavePosition; rank: number | null; angle: LaunchAngle; ratio: number | null; ratioLabel: string; confidence: 'high' | 'low'; isOwned: boolean; confirmed: boolean | null }[];
  windowLog: LabEvent['windowLog'];
  actions: { make: boolean; dismiss: boolean; merge: boolean };
};

export type WindowCardView =
  | { kind: 'open' | 'closing'; eventId: string; sentence: string; progress: number; action: { label: 'Make this'; href: string } }
  /** 'No open windows. Next check 14:30.' */
  | { kind: 'none'; sentence: string }
  | { kind: 'never_run'; sentence: string; setupHref: string };

export type RadarTile = { eventId: string; name: string; ageLabel: string; coverageLabel: string; waveLabel: string; stateLabel: string; series: { h: number; creators: number }[]; href: string };

/* ── builders (05 17.1, 17.2) ─────────────────────────────────────────── */

export const NEVER_RUN_SENTENCE = 'Radar has not run yet.';
export const RADAR_COPY = {
  neverRun: 'Radar has not run yet. It needs no keys for HN, Hugging Face, GitHub, vendor posts and Wikipedia.',
  noEvents: 'No launches detected in the last 14 days.',
  watching: (n: number) => `Watching ${n}: seen in one source so far.`,
  xNotConfigured: 'X watch list: Not configured',
  apifyNotConfigured: 'Apify: Not configured',
  githubNoToken: 'GitHub token: Not configured. The fake-star filter is off; only established owners count.',
  phNotConfigured: 'Product Hunt token or Apify: Not configured',
  namingPaused: 'Naming paused: claude CLI not found',
  paused: 'Paused by PAUSED-radar',
  notEnough: 'not enough yet',
  waveLiftPrior: 'Prior: 1.94x vs 0.99x (n 19 vs 9, one launch, YouTube long-form)',
} as const;

export type RadarViewOpts = {
  sample?: boolean;
  dry?: boolean;
  /** the PAUSED-radar (or PAUSED, PAUSED-lab) file, or null */
  paused?: string | null;
  tz?: string;
  apifyConfigured?: boolean;
  githubToken?: boolean;
  phToken?: boolean;
  env?: Record<string, string | undefined>;
};

type Resolved = Required<Omit<RadarViewOpts, 'env'>> & { env: Record<string, string | undefined> };

function resolveOpts(o: RadarViewOpts = {}): Resolved {
  const env = o.env ?? process.env;
  return {
    sample: o.sample ?? false,
    dry: o.dry ?? isDry(),
    paused: o.paused !== undefined ? o.paused : pausedBy(automationDirs(), fs.existsSync, 'radar'),
    tz: o.tz ?? labTz(env),
    apifyConfigured: o.apifyConfigured ?? Boolean(resolveApifyToken()),
    githubToken: o.githubToken ?? Boolean(githubToken()),
    phToken: o.phToken ?? Boolean(productHuntToken()),
    env,
  };
}

const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NO_STATE: JobState = { lastAt: null, lastOkAt: null, lastDetail: '', fails: 0, skippedReason: null };

function jobState(store: LabStore, id: string): JobState | null {
  const p = LabJobStateSchema.safeParse(store.priors.get(`job:${id}`)?.value);
  return p.success ? p.data : null;
}

/** Radar has run when any radar job state, ping or event exists. */
function hasRun(store: LabStore): boolean {
  return RADAR_SOURCES.some((s) => jobState(store, `radar.${s}`)?.lastAt) || store.events.all().length > 0 || store.eventPings.all().length > 0;
}

function nextDue(source: LabRadarSource, st: JobState | null, now: Date, tz: string, env: Record<string, string | undefined>): string {
  const c = RADAR_CADENCE[source];
  const nextTick = () => new Date(Math.ceil((now.getTime() + 1) / (15 * 60_000)) * 15 * 60_000);
  if ('everyMin' in c) {
    const mins = source === 'x' ? xPollMinutes(null, env) : c.everyMin;
    if (!st?.lastAt) return nextTick().toISOString();
    const t = Date.parse(st.lastAt) + mins * 60_000;
    return new Date(Math.max(t, nextTick().getTime())).toISOString();
  }
  // daily: the first 15-minute tick at or after HH:MM local, today or tomorrow
  for (let k = 1; k <= 4 * 48; k++) {
    const t = new Date(Math.ceil(now.getTime() / (15 * 60_000)) * 15 * 60_000 + (k - 1) * 15 * 60_000);
    if (t.getTime() <= now.getTime()) continue;
    if (cadenceDue(source, st ?? NO_STATE, t, { tz, env })) return t.toISOString();
  }
  return nextTick().toISOString();
}

function sourceHealth(store: LabStore, now: Date, o: Resolved): RadarSourceHealth[] {
  const disabled = new Set(disabledSources(store));
  const watch = watchHandles(store).length;
  return RADAR_SOURCES.map((source) => {
    const st = jobState(store, `radar.${source}`);
    const costLine = SOURCE_LINE[source] && !(source === 'producthunt' && o.phToken) ? SOURCE_LINE[source]! : null;
    let status: RadarSourceHealth['status'] = !st?.lastAt ? 'never_run' : st.fails > 0 ? 'failing' : 'ok';
    let setupHref: string | null = null;
    let note: string | null = null;
    if (source === 'x' && !o.apifyConfigured) [status, setupHref, note] = ['not_configured', setupHrefFor('apify'), RADAR_COPY.apifyNotConfigured];
    else if (source === 'x' && !watch) [status, setupHref, note] = ['not_configured', '/lab?setup=sources', RADAR_COPY.xNotConfigured];
    else if (source === 'tiktok_cc' && !o.apifyConfigured) [status, setupHref, note] = ['not_configured', setupHrefFor('apify'), RADAR_COPY.apifyNotConfigured];
    else if (source === 'producthunt' && !o.phToken && !o.apifyConfigured) [status, setupHref, note] = ['not_configured', '/lab?setup=keys', RADAR_COPY.phNotConfigured];
    else if (source === 'github' && !o.githubToken) [setupHref, note] = ['/lab?setup=keys', RADAR_COPY.githubNoToken];
    if (disabled.has(source)) [status, note] = ['paused', 'Turned off in Setup'];
    if (o.paused) [status, note] = ['paused', RADAR_COPY.paused];
    return {
      source,
      label: SOURCE_LABEL[source],
      status,
      lastRunAt: st?.lastAt ?? null,
      lastError: st && st.fails > 0 ? st.lastDetail : null,
      nextDueAt: status === 'not_configured' || status === 'paused' ? null : nextDue(source, st, now, o.tz, o.env),
      setupHref,
      costLine,
      note,
    };
  });
}

type Ctx = { store: LabStore; now: Date; active: number; own: AngleOwnStats; ideasByEvent: Map<string, string>; dry: boolean; sample: boolean };

const liftOf = (e: Pick<LabEvent, 'novelty'>) => (e.novelty ? (NOVELTY_PRIORS[e.novelty].medianLift ?? 1) : 1);

function progressOf(e: LabEvent, now: Date): number {
  if (!e.windowOpensAt || !e.windowClosesAt) return 0;
  const o = Date.parse(e.windowOpensAt);
  const c = Date.parse(e.windowClosesAt);
  return c > o ? Math.min(1, Math.max(0, (now.getTime() - o) / (c - o))) : 1;
}

/** 10.4 order: open, closing, closed; within a state by prior lift x (1 - progress), then newer t0. */
export function orderEvents(events: readonly LabEvent[], now: Date): LabEvent[] {
  return [...events].sort((a, b) => {
    const ka = orderKey(a, progressOf(a, now), liftOf);
    const kb = orderKey(b, progressOf(b, now), liftOf);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.id.localeCompare(b.id);
  });
}

function eventRow(c: Ctx, e: LabEvent): EventRow {
  const cov = c.store.eventCoverage.forEvent(e.id);
  const share = coverageShare(cov, c.active);
  const firsts = familyFirsts(c.store.eventPings.forEvent(e.id));
  const mine = cov.find((x) => x.isOwned && x.confirmed !== false);
  return {
    id: e.id,
    name: e.name,
    vendor: e.vendor,
    status: e.status,
    novelty: e.novelty,
    noveltyLabel: e.novelty ? NOVELTY_LABEL[e.novelty] : 'Not tagged yet',
    class: e.class,
    classLabel: CLASS_LABEL[e.class],
    t0: e.t0,
    ageLabel: ageLabel(e.t0 ?? e.firstSeenAt, c.now),
    window: e.windowState && e.windowClosesAt ? { state: e.windowState, progress: Math.round(progressOf(e, c.now) * 1000) / 1000, reason: e.windowReason, closesAt: e.windowClosesAt } : null,
    coverage: { creators: share.creators, active: share.active, label: share.label },
    waveN: e.waveN,
    waveSeries: waveSeries(e, cov, c.now),
    sources: [...firsts.entries()].sort(([, a], [, b]) => a.firstSeenAt.localeCompare(b.firstSeenAt)).map(([family, p]) => ({ family, firstSeenAt: p.firstSeenAt, reason: p.qualifyReason ?? '' })),
    coveredByMe: mine ? { postId: mine.postId, ratio: mine.ratio } : null,
    ideaId: c.ideasByEvent.get(e.id) ?? null,
  };
}

/** Fixture events never show outside dry, Filming or sample (05 18, AC-05-35): all their pings are dry. */
function visible(c: Ctx, e: LabEvent): boolean {
  if (c.dry || c.sample) return true;
  const pings = c.store.eventPings.forEvent(e.id);
  return !(pings.length > 0 && pings.every((p) => p.dry));
}

function baseCtx(store: LabStore, now: Date, o: Resolved): Ctx {
  const ideasByEvent = new Map<string, string>();
  for (const i of store.ideas.all('open')) if (i.eventId && !ideasByEvent.has(i.eventId)) ideasByEvent.set(i.eventId, i.id);
  return { store, now, active: activeTrackedCount(store, now), own: angleOwnStats(store, now), ideasByEvent, dry: o.dry, sample: o.sample };
}

function shownEvents(c: Ctx): LabEvent[] {
  const since = c.now.getTime() - 14 * DAY_MS;
  return orderEvents(
    c.store.events.all({ status: ['confirmed'] }).filter((e) => visible(c, e) && (e.windowState !== 'closed' || Date.parse(e.windowClosesAt ?? e.t0 ?? e.firstSeenAt) >= since)),
    c.now,
  );
}

function morningBriefView(store: LabStore, now: Date, o: Resolved): MorningBriefView | null {
  const day = localParts(now, o.tz).day;
  const b = store.morningBrief.get(day);
  if (!b) return null;
  return { day: b.day, header: briefHeader(new Date(b.composedAt), o.tz, b.items.length), items: b.items, sent: b.sentAt ? { at: b.sentAt, via: 'wizard' } : null, sendError: b.sendError, telegramOn: telegramOn(o.env) };
}

/** `GET /api/lab/morning-brief?day=`: the day's brief, or an empty one when none was composed. */
export function morningBriefFor(store: LabStore, day: string | null, now: Date, opts: RadarViewOpts = {}): MorningBriefView {
  const o = resolveOpts(opts);
  const d = day ?? localParts(now, o.tz).day;
  const b = store.morningBrief.get(d);
  if (!b) return { day: d, header: `Morning brief, ${d}. 0 items.`, items: [], sent: null, sendError: null, telegramOn: telegramOn(o.env) };
  return { day: b.day, header: briefHeader(new Date(b.composedAt), o.tz, b.items.length), items: b.items, sent: b.sentAt ? { at: b.sentAt, via: 'wizard' } : null, sendError: b.sendError, telegramOn: telegramOn(o.env) };
}

function waveLift(store: LabStore): RadarView['waveLift'] {
  const rows = store.eventCoverage.all().filter((c) => !c.isOwned && c.ratio !== null && c.confirmed !== false && (c.confidence === 'high' || c.confirmed === true));
  const first = [...new Map(rows.filter((c) => c.wavePosition === 'first').map((c) => [c.postId, c.ratio!])).values()];
  const follow = [...new Map(rows.filter((c) => c.wavePosition === 'follow').map((c) => [c.postId, c.ratio!])).values()];
  const fm = first.length >= 5 ? median(first) : null;
  const lm = follow.length >= 5 ? median(follow) : null;
  return {
    firstMedian: fm === null ? null : Math.round(fm * 10) / 10,
    firstN: first.length,
    followMedian: lm === null ? null : Math.round(lm * 10) / 10,
    followN: follow.length,
    label: fm !== null && lm !== null ? `First wave ${r1(fm)}x (n ${first.length}) vs later ${r1(lm)}x (n ${follow.length})` : RADAR_COPY.notEnough,
    prior: RADAR_COPY.waveLiftPrior,
  };
}

function classRecord(store: LabStore): string {
  const seed = backtestSeed();
  const own = store.events.all({ status: ['confirmed'] }).filter((e) => e.classInfo.classCorrect !== null);
  const k = own.filter((e) => e.classInfo.classCorrect).length;
  return `Class rule: ${seed.correct} of ${seed.n} on seed events, ${own.length >= 5 ? `${k} of ${own.length}` : RADAR_COPY.notEnough} on your events`;
}

export function radarView(store: LabStore, now: Date, opts: RadarViewOpts = {}): RadarView {
  const o = resolveOpts(opts);
  const c = baseCtx(store, now, o);
  const events = shownEvents(c);
  const rows = events.map((e) => eventRow(c, e));
  const candidates = store.events.all({ status: ['candidate'] }).filter((e) => visible(c, e)).map((e) => eventRow(c, e));
  const sources = sourceHealth(store, now, o);
  const lastTickAt = sources.map((s) => s.lastRunAt).filter((x): x is string => Boolean(x)).sort().pop() ?? null;
  const nextTickAt = sources.map((s) => s.nextDueAt).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const from = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const lanes = events.map((e) => {
    const cov = store.eventCoverage.forEvent(e.id);
    const ribbon: { at: string; creators: number; state: LabWindowState }[] = [];
    if (e.t0) {
      for (let t = Math.max(Date.parse(e.t0), Date.parse(from)); t <= now.getTime(); t += DAY_MS) {
        const at = new Date(t).toISOString();
        const st = stateAt(e, at);
        if (!st) continue;
        ribbon.push({ at, creators: new Set(cov.filter((x) => !x.isOwned && x.postedAt <= at && x.confirmed !== false && (x.confidence === 'high' || x.confirmed === true)).map((x) => x.sourceId)).size, state: st });
      }
    }
    return { eventId: e.id, name: e.name, pings: store.eventPings.forEvent(e.id).filter((p) => p.qualifies).map((p) => ({ family: p.family, at: p.firstSeenAt })), ribbon };
  });
  const lt = storedLeadTime(store) ?? leadTimeTable(store, now);
  return {
    state: o.sample ? 'sample' : o.dry ? 'dry' : hasRun(store) ? 'ok' : 'never_run',
    lastTickAt,
    nextTickAt,
    sources,
    liveAlerts: liveAlerts(store, now).length,
    events: rows,
    candidates,
    timeline: { from, to: now.toISOString(), lanes },
    morningBrief: morningBriefView(store, now, o),
    leadTime: { rows: lt.rows.map((r) => (r.n < 5 ? { ...r, medianLeadH: null, shareLeading: null, label: RADAR_COPY.notEnough } : r)), firedBeforePct: lt.firedBeforeN >= 5 ? lt.firedBeforePct : null, firedBeforeN: lt.firedBeforeN, classRecord: classRecord(store) },
    waveLift: waveLift(store),
  };
}

/** Own median for a novelty tag: tracked, first wave, rated covering posts (05 8). */
function ownNovelty(store: LabStore, novelty: LabNovelty | null): { median: number; n: number } | null {
  if (!novelty) return null;
  const ids = new Set(store.events.all({ status: ['confirmed'] }).filter((e) => e.novelty === novelty).map((e) => e.id));
  const xs = [...new Map(store.eventCoverage.all().filter((c) => ids.has(c.eventId) && !c.isOwned && c.wavePosition === 'first' && c.ratio !== null && c.confirmed !== false).map((c) => [c.postId, c.ratio!])).values()];
  const m = median(xs);
  return m === null ? null : { median: Math.round(m * 10) / 10, n: xs.length };
}

export function ratioLabel(ratio: number | null, ageH: number | null, postAgeH: number): string {
  if (postAgeH < 6) return 'too new';
  if (ratio === null) return 'not rated yet';
  return `${r1(ratio)}x at ${Math.round(ageH ?? postAgeH)}h`;
}

export function eventSheetView(store: LabStore, id: string, now: Date, opts: RadarViewOpts = {}): EventSheetView | null {
  const o = resolveOpts(opts);
  const e = store.events.get(id);
  if (!e || e.status === 'merged') return null;
  const c = baseCtx(store, now, o);
  if (!visible(c, e)) return null;
  const row = eventRow(c, e);
  const cov = store.eventCoverage.forEvent(e.id);
  const rec = recommendAngle({ taken: takenAngles(cov), windowState: e.windowState, own: c.own });
  const sources = new Map(store.sources.all().map((s) => [s.id, s]));
  const toGo = e.t0 ? Math.max(0, Math.ceil(96 - (now.getTime() - Date.parse(e.t0)) / HOUR_MS)) : 96;
  return {
    ...row,
    classLabel: e.class === 'unknown' ? `Class decided at 96h (${toGo}h to go).` : row.classLabel,
    aliases: e.aliases,
    t0Rule: e.t0Rule ?? 'not confirmed',
    t0RevisedAt: e.t0RevisedAt,
    pings: store.eventPings.forEvent(e.id).map((p) => ({ family: p.family, source: p.source, title: p.title, url: p.url, at: p.sourceTime ?? p.firstSeenAt, reason: p.qualifyReason ?? '', qualifies: p.qualifies })),
    attention: e.attention,
    classInfo: e.classInfo,
    classBasis: e.classBasis,
    noveltyPrior: noveltyPriorLine(e.novelty, ownNovelty(store, e.novelty)),
    angles: angleMap(e, cov, c.own).map((a) => (a.n < 5 ? { ...a, medianRatio: null } : a)),
    recommendedAngle: rec.angle,
    recommendCopy: rec.copy,
    posts: cov
      .filter((x) => x.confirmed !== false)
      .map((x) => {
        const p = store.posts.get(x.postId);
        const s = sources.get(x.sourceId);
        const hook = (store.dissections.get(x.postId)?.hookText || p?.caption || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const postAgeH = (now.getTime() - Date.parse(x.postedAt)) / HOUR_MS;
        return {
          postId: x.postId, creator: x.isOwned ? 'You' : (s?.displayName || s?.handle || 'A tracked creator'), platform: x.platform, hook, hoursSinceT0: x.hoursSinceT0, wavePosition: x.wavePosition,
          rank: x.creatorRank, angle: x.angle, ratio: x.ratio, ratioLabel: ratioLabel(x.ratio, x.ratioAgeH, postAgeH), confidence: x.confidence, isOwned: x.isOwned, confirmed: x.confirmed,
        };
      }),
    windowLog: e.windowLog,
    actions: { make: e.status === 'confirmed' && e.windowState !== 'closed', dismiss: e.status !== 'dismissed', merge: e.status !== 'dismissed' },
  };
}

/** The earliest next run among the free radar jobs (17.2 `Next check`). */
function nextCheck(store: LabStore, now: Date, o: Resolved): Date {
  const free: LabRadarSource[] = ['vendor', 'hn', 'hf_models', 'hf_spaces', 'github'];
  const ts = free.map((s) => Date.parse(nextDue(s, jobState(store, `radar.${s}`), now, o.tz, o.env)));
  return new Date(Math.min(...ts));
}

export function windowCardView(store: LabStore, now: Date, opts: RadarViewOpts = {}): WindowCardView {
  const o = resolveOpts(opts);
  if (!o.sample && !o.dry && !hasRun(store)) return { kind: 'never_run', sentence: NEVER_RUN_SENTENCE, setupHref: '/lab?setup=sources' };
  const c = baseCtx(store, now, o);
  const e = shownEvents(c).find((x) => x.windowState === 'open' || x.windowState === 'closing');
  if (!e) return { kind: 'none', sentence: `No open windows. Next check ${clock(nextCheck(store, now, o), o.tz)}.` };
  const share = coverageShare(store.eventCoverage.forEvent(e.id), c.active);
  const age = ageLabel(e.t0, now);
  const sentence =
    e.windowState === 'open'
      ? `${e.name} shipped ${age} ago. ${share.creators} of ${share.active} creators have covered it. Window open.`
      : `${e.name} is ${age} old. ${share.creators} of ${share.active} creators are in. Window closing.`;
  return { kind: e.windowState as 'open' | 'closing', eventId: e.id, sentence, progress: Math.round(progressOf(e, now) * 1000) / 1000, action: { label: 'Make this', href: `/lab/radar?event=${e.id}` } };
}

export function radarTiles(store: LabStore, now: Date, opts: RadarViewOpts = {}): RadarTile[] {
  const o = resolveOpts(opts);
  const c = baseCtx(store, now, o);
  return shownEvents(c)
    .filter((e) => e.windowState === 'open' || e.windowState === 'closing')
    .slice(0, 8)
    .map((e) => {
      const cov = store.eventCoverage.forEvent(e.id);
      const share = coverageShare(cov, c.active);
      return {
        eventId: e.id,
        name: e.name,
        ageLabel: ageLabel(e.t0, now),
        coverageLabel: share.label,
        waveLabel: `wave ${e.waveN}`,
        stateLabel: e.windowState as string,
        series: waveSeries(e, cov, now),
        href: `/lab/radar?event=${e.id}`,
      };
    });
}

/** The Radar header's naming line, when the claude CLI was missing on the last try. */
export function namingLine(store: LabStore): string | null {
  return namingState(store)?.paused ? RADAR_COPY.namingPaused : null;
}
