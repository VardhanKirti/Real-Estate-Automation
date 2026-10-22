import { RUN_TIMEOUT_MS, RUN_TYPICAL_MS, type Brief, type Campaign, type RunKind, type RunStatus } from '@/lib/creative-engine/schemas';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import { eventMs, placeEvents, type PlaceOptions as PlaceEventOptions } from '@/lib/timeline-place';

/**
 * The Creative Engine run timeline (SPEC S07 F8 to F22, §5 C20). Pure, no
 * React and no node imports, so the dashboard and the tests share it.
 *
 * - the strip under the stat row plots runs on a time axis, three lanes by
 *   kind group, with a range of 24 h, 7 d or 30 d;
 * - the floating pill is a thumb that selects one run; clicking it opens that
 *   run's result (`routeForRun`);
 * - the rendering card's track reports elapsed time against the kind's
 *   typical and timeout (`progressFor`);
 * - `?engine=<sheet>&brief=&run=&angle=&asset=` deep links parse and print
 *   here (`parseEngineLink`, `engineSearch`).
 */

/* ── ranges ── */

export const TIMELINE_RANGES = [
  { key: '24h', label: '24 h', ago: '24 h ago', ms: 24 * 3600_000 },
  { key: '7d', label: '7 d', ago: '7 d ago', ms: 7 * 24 * 3600_000 },
  { key: '30d', label: '30 d', ago: '30 d ago', ms: 30 * 24 * 3600_000 },
] as const;
export type RangeKey = (typeof TIMELINE_RANGES)[number]['key'];
export const RANGE_STORAGE_KEY = 'ae-timeline-range';

export function rangeSpec(key: RangeKey) {
  return TIMELINE_RANGES.find((r) => r.key === key) ?? TIMELINE_RANGES[0];
}

export function parseRange(v: string | null | undefined): RangeKey | null {
  return TIMELINE_RANGES.some((r) => r.key === v) ? (v as RangeKey) : null;
}

/** One step wider, or null at 30 d. */
export function widerRange(key: RangeKey): RangeKey | null {
  const i = TIMELINE_RANGES.findIndex((r) => r.key === key);
  return TIMELINE_RANGES[i + 1]?.key ?? null;
}

/** One step narrower, or null at 24 h. */
export function narrowerRange(key: RangeKey): RangeKey | null {
  const i = TIMELINE_RANGES.findIndex((r) => r.key === key);
  return i > 0 ? TIMELINE_RANGES[i - 1].key : null;
}

function startMs(run: Pick<ResolvedRun, 'startedAt'>, now: number): number {
  return eventMs(run.startedAt, now);
}

/**
 * Default range (S07 F8, Q-ENG-13): the smallest range that holds a run. The
 * anchor is the newest finished run when there is one, so a campaign whose
 * history is a week old does not open on a 24 h strip that shows only the
 * render in flight (the in-flight run is inside every range anyway). With no
 * runs, 24 h. Older than 30 d: 30 d, and the strip offers "+N earlier".
 */
export function rangeFor(runs: Pick<ResolvedRun, 'startedAt' | 'status'>[], now = Date.now()): RangeKey {
  if (runs.length === 0) return '24h';
  const finished = runs.filter((r) => r.status !== 'running' && r.status !== 'queued');
  const pool = finished.length ? finished : runs;
  const newest = Math.max(...pool.map((r) => startMs(r, now)));
  const age = now - newest;
  return TIMELINE_RANGES.find((r) => age <= r.ms)?.key ?? '30d';
}

/* ── placement ── */

/** Three lanes by kind group (F9): research/angles, script/brief, renders. */
export function laneFor(kind: RunKind): 0 | 1 | 2 {
  if (kind === 'research' || kind === 'angles' || kind === 'health') return 0;
  if (kind === 'script' || kind === 'brief') return 1;
  return 2;
}
/** Lane centres as a fraction of the strip height (§5.2). */
export const LANE_Y = [0.3, 0.52, 0.74] as const;

export type PlacedDot = { kind: 'dot'; id: string; runIds: [string]; x: number; lane: 0 | 1 | 2; status: RunStatus; t: number };
export type PlacedCluster = { kind: 'cluster'; id: string; runIds: string[]; x: number; lane: 0 | 1 | 2; t: number };
export type Placed = PlacedDot | PlacedCluster;

export type Placement = {
  dots: PlacedDot[];
  clusters: PlacedCluster[];
  /** dots and clusters together, in time order */
  items: Placed[];
  /** runs older than the range, not drawn */
  earlier: number;
  /** each in-range run's own x (px), for snapping and the thumb */
  xOf: Record<string, number>;
  /** the drawable track, px from the strip's left edge */
  track: { left: number; right: number };
};

export type PlaceOptions = PlaceEventOptions;

/**
 * Dots on the strip (F9, F10). The placement maths lives in
 * `lib/timeline-place.ts` (SPEC X4, moved there so the kit's GTimelineStrip
 * shares it); runs map to events with their kind group as the lane.
 */
export function placeRuns(runs: ResolvedRun[], range: RangeKey, widthPx: number, now = Date.now(), opts: PlaceOptions = {}): Placement {
  const events = runs.map((r) => ({ id: r.id, at: r.startedAt, lane: laneFor(r.kind), status: r.status }));
  return placeEvents<RunStatus>(events, rangeSpec(range).ms, widthPx, now, opts) as Placement;
}

/** In-range runs oldest first: the slider's value order (F14). */
export function orderedRuns(runs: ResolvedRun[], range: RangeKey, now = Date.now()): ResolvedRun[] {
  const from = now - rangeSpec(range).ms;
  return runs.filter((r) => startMs(r, now) >= from).sort((a, b) => startMs(a, now) - startMs(b, now) || a.id.localeCompare(b.id));
}

/** The run whose dot is nearest to x (px); ties go to the newer run. */
export function nearestRunId(xOf: Record<string, number>, x: number, order: ResolvedRun[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const r of order) {
    const rx = xOf[r.id];
    if (rx === undefined) continue;
    const d = Math.abs(rx - x);
    if (d <= bestD) { best = r.id; bestD = d; }
  }
  return best;
}

/** F13: newest running run, else newest delivered, else the newest run at all, else none. */
export function defaultRunId(runs: ResolvedRun[], now = Date.now()): string | null {
  const newest = (xs: ResolvedRun[]) => xs.slice().sort((a, b) => startMs(b, now) - startMs(a, now))[0]?.id ?? null;
  return newest(runs.filter((r) => r.status === 'running')) ?? newest(runs.filter((r) => r.status === 'delivered')) ?? newest(runs);
}

/* ── words ── */

const KIND_NOUN: Record<RunKind, string> = {
  research: 'Research',
  angles: 'Angles',
  script: 'Script',
  brief: 'Brief',
  ugc: 'UGC video',
  motion: 'Motion video',
  image: 'Image',
  health: 'Health check',
  workflow: 'Workflow',
};
const DELIVERED: Record<RunKind, string> = {
  research: 'Research done',
  angles: 'Angles proposed',
  script: 'Script written',
  brief: 'Brief ready',
  ugc: 'UGC video delivered',
  motion: 'Motion video delivered',
  image: 'Image delivered',
  health: 'Health probed',
  workflow: 'Workflow delivered',
};

export function kindNoun(kind: RunKind): string {
  return KIND_NOUN[kind] ?? kind;
}

/** Pill line 1 (F12): "Brief ready" for a delivered brief; the status otherwise. */
export function runHeadline(run: Pick<ResolvedRun, 'kind' | 'status'>): string {
  const noun = kindNoun(run.kind);
  switch (run.status) {
    case 'delivered': return DELIVERED[run.kind] ?? `${noun} delivered`;
    case 'running': return `${noun} generating`;
    case 'queued': return `${noun} queued`;
    case 'failed': return `${noun} failed`;
    case 'stale': return `${noun} stalled`;
    case 'abandoned': return `${noun} abandoned`;
  }
}

/** Wall clock a run has used; a running run ticks from its start (F17). */
export function elapsedAt(run: Pick<ResolvedRun, 'status' | 'startedAt' | 'elapsedMs'>, now = Date.now()): number {
  if (run.status !== 'running') return run.elapsedMs;
  const t = Date.parse(run.startedAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : run.elapsedMs;
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function agoText(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (!Number.isFinite(mins)) return 'never';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

/** Pill line 2 (F12): elapsed while running, age otherwise. */
export function runSubline(run: ResolvedRun, now = Date.now()): string {
  if (run.status === 'running') return `${fmtElapsed(elapsedAt(run, now))} elapsed`;
  return agoText(run.finishedAt ?? run.startedAt, now);
}

/** "Brief · A lamp with a bedtime · delivered 9 d ago" (F11). */
export function runAriaLabel(run: ResolvedRun, now = Date.now()): string {
  // "Brief · A lamp with a bedtime" already names its kind; drop the repeat.
  const head = run.title.split('·')[0].trim().toLowerCase();
  const repeat = head !== '' && kindNoun(run.kind).toLowerCase().startsWith(head.split(' ')[0]);
  const title = (repeat ? run.title.slice(run.title.indexOf('·') + 1).trim() : run.title) || run.title;
  const when = run.status === 'running' ? `running, ${fmtElapsed(elapsedAt(run, now))} elapsed` : `${run.status} ${agoText(run.finishedAt ?? run.startedAt, now)}`;
  return `${kindNoun(run.kind)} · ${title} · ${when}`;
}

/* ── routing (F15) ── */

export type EngineSheet = 'generator' | 'scripter' | 'briefings' | 'ugc' | 'runs' | 'proof' | 'credits' | 'connect' | 'console';
export const ENGINE_SHEETS: readonly EngineSheet[] = ['generator', 'scripter', 'briefings', 'ugc', 'runs', 'proof', 'credits', 'connect', 'console'];

export type SheetTarget = {
  sheet: EngineSheet;
  /** the campaign the target lives in, when it is not the open one */
  campaignId?: string | null;
  runId?: string;
  /** a cluster opened in the Runs drawer */
  runIds?: string[];
  briefId?: string;
  scriptId?: string;
  angleId?: string;
  assetId?: string;
  /** where the Creative generator scrolls to */
  focus?: 'concept' | 'research' | 'angles';
  /** the generator's "Proven only" filter */
  proofOnly?: boolean;
};

function refPart(ref: string | null, key: 'brief' | 'script'): string | undefined {
  const m = ref?.match(new RegExp(`#${key}:(.+)$`));
  return m ? m[1] : undefined;
}

/** The asset a delivered render made: through its generation, else its outputRef file name. */
export function assetIdForRun(run: Pick<ResolvedRun, 'id' | 'outputRef'>, campaign: Pick<Campaign, 'generations' | 'assets'> | null): string | undefined {
  if (!campaign) return undefined;
  const gen = campaign.generations.find((g) => g.runIds.includes(run.id));
  const own = gen ? campaign.assets.filter((a) => a.generationId === gen.id) : [];
  const file = run.outputRef?.startsWith('asset:') ? run.outputRef.split('/').pop() : undefined;
  const byFile = file ? campaign.assets.find((a) => a.path?.endsWith(`/${file}`) || a.path === file) : undefined;
  return (byFile ?? own.at(-1))?.id;
}

/**
 * Where the pill sends a run (F15). Status first: anything not delivered
 * lives in the Runs drawer (Check now and Abandon are there); health goes
 * to Credits & health; a run with no campaign goes to the Runs drawer.
 */
export function routeForRun(run: ResolvedRun, campaign: Pick<Campaign, 'id' | 'generations' | 'assets' | 'briefs' | 'scripts'> | null = null): SheetTarget {
  if (run.kind === 'health') return { sheet: 'credits' };
  if (run.status !== 'delivered' || run.campaignId === null) return { sheet: 'runs', runId: run.id };
  const base = { campaignId: run.campaignId };
  switch (run.kind) {
    case 'research': return { ...base, sheet: 'generator', focus: 'research' };
    case 'angles': return { ...base, sheet: 'generator', focus: 'angles' };
    case 'script': {
      const scriptId = refPart(run.outputRef, 'script');
      const angleId = campaign?.scripts.find((s) => s.id === scriptId)?.angleId;
      return { ...base, sheet: 'scripter', ...(scriptId ? { scriptId } : {}), ...(angleId ? { angleId } : {}) };
    }
    case 'brief': {
      const briefId = refPart(run.outputRef, 'brief') ?? (campaign && campaign.id === run.campaignId ? latestBriefId(campaign.briefs) : undefined);
      return { ...base, sheet: 'briefings', ...(briefId ? { briefId } : {}) };
    }
    case 'ugc': {
      const assetId = assetIdForRun(run, campaign && campaign.id === run.campaignId ? campaign : null);
      return { ...base, sheet: 'ugc', ...(assetId ? { assetId } : {}) };
    }
    case 'motion':
    case 'image':
    case 'workflow': {
      const assetId = assetIdForRun(run, campaign && campaign.id === run.campaignId ? campaign : null);
      return { ...base, sheet: 'console', ...(assetId ? { assetId } : {}) };
    }
  }
}

function latestBriefId(briefs: Pick<Brief, 'id' | 'at'>[]): string | undefined {
  return briefs.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.id;
}

/* ── deep links (§5 C20) ── */

const LINK_KEYS = ['engine', 'brief', 'run', 'angle', 'asset', 'proven'] as const;

/** `?engine=briefings&brief=brf-1` → a target; anything unknown → null. `proven=1` is the generator's "Proven only" filter. */
export function parseEngineLink(search: string | URLSearchParams): SheetTarget | null {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const sheet = q.get('engine');
  if (!sheet || !ENGINE_SHEETS.includes(sheet as EngineSheet)) return null;
  const t: SheetTarget = { sheet: sheet as EngineSheet };
  const id = (k: string) => {
    const v = q.get(k);
    return v && /^[\w.-]{1,80}$/.test(v) ? v : undefined;
  };
  const brief = id('brief');
  const run = id('run');
  const angle = id('angle');
  const asset = id('asset');
  if (brief) t.briefId = brief;
  if (run) t.runId = run;
  if (angle) t.angleId = angle;
  if (asset) t.assetId = asset;
  if (t.sheet === 'generator' && q.get('proven') === '1') { t.proofOnly = true; t.focus = 'angles'; }
  return t;
}

export type LinkIdKind = 'brief' | 'run' | 'angle' | 'asset';
const LINK_ID_FIELD: Record<LinkIdKind, 'briefId' | 'runId' | 'angleId' | 'assetId'> = { brief: 'briefId', run: 'runId', angle: 'angleId', asset: 'assetId' };

/**
 * Drop the ids a deep link names that the loaded campaign does not have (C20: an unknown
 * id falls back to the sheet without a target). Returns the cleaned target and what was
 * dropped, so the page can say so in a toast and the address bar stops carrying it.
 */
export function resolveLinkIds(
  t: SheetTarget,
  campaign: Pick<Campaign, 'briefs' | 'angles' | 'assets'> | null,
  runs: Pick<ResolvedRun, 'id'>[],
): { target: SheetTarget; dropped: LinkIdKind[] } {
  const has: Record<LinkIdKind, (id: string) => boolean> = {
    brief: (id) => !!campaign?.briefs.some((b) => b.id === id),
    angle: (id) => !!campaign?.angles.some((a) => a.id === id),
    asset: (id) => !!campaign?.assets.some((a) => a.id === id),
    run: (id) => runs.some((r) => r.id === id),
  };
  const target = { ...t };
  const dropped: LinkIdKind[] = [];
  for (const k of Object.keys(LINK_ID_FIELD) as LinkIdKind[]) {
    const f = LINK_ID_FIELD[k];
    const id = target[f];
    if (id && !has[k](id)) { delete target[f]; dropped.push(k); }
  }
  return { target, dropped };
}

/** The toast for ids a link named that are not here. */
export function droppedLinkText(dropped: LinkIdKind[]): string {
  const noun = dropped.length === 1 ? `That ${dropped[0]} is` : `Those ${dropped.join(' and ')} links are`;
  return `${noun} not in this campaign. Opened the sheet without it.`;
}

/** The query string for a target, keeping every other param (sample, mode). Null target clears the link. */
export function engineSearch(current: string, target: SheetTarget | null): string {
  const q = new URLSearchParams(current);
  for (const k of LINK_KEYS) q.delete(k);
  if (target) {
    q.set('engine', target.sheet);
    if (target.briefId) q.set('brief', target.briefId);
    if (target.runId) q.set('run', target.runId);
    if (target.angleId) q.set('angle', target.angleId);
    if (target.assetId) q.set('asset', target.assetId);
    if (target.sheet === 'generator' && target.proofOnly) q.set('proven', '1');
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/* ── rendering track (F19 to F22) ── */

/** Where the typical-time tick sits on the track; past it is the slow band up to the timeout ring. */
export const TYPICAL_AT = 0.75;

export type Progress = { pct: number; tick: number; phase: 'normal' | 'slow' | 'stale'; typicalMs: number; timeoutMs: number; elapsedMs: number };

export function progressFor(run: Pick<ResolvedRun, 'kind' | 'status' | 'startedAt' | 'elapsedMs'>, now = Date.now()): Progress {
  const typicalMs = RUN_TYPICAL_MS[run.kind];
  const timeoutMs = RUN_TIMEOUT_MS[run.kind];
  const elapsedMs = elapsedAt(run, now);
  if (run.status === 'stale' || elapsedMs >= timeoutMs) return { pct: 1, tick: TYPICAL_AT, phase: 'stale', typicalMs, timeoutMs, elapsedMs };
  if (elapsedMs <= typicalMs) return { pct: TYPICAL_AT * (elapsedMs / typicalMs), tick: TYPICAL_AT, phase: 'normal', typicalMs, timeoutMs, elapsedMs };
  const band = Math.max(1, timeoutMs - typicalMs);
  return { pct: TYPICAL_AT + (1 - TYPICAL_AT) * Math.min(1, (elapsedMs - typicalMs) / band), tick: TYPICAL_AT, phase: 'slow', typicalMs, timeoutMs, elapsedMs };
}

export function fmtMinutes(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** "Typical for seedance-2.0: about 3 min. Marked stale after 25 min." (F20) */
export function progressTitle(run: Pick<ResolvedRun, 'kind' | 'arcads'>): string {
  const what = run.arcads?.model ?? kindNoun(run.kind).toLowerCase();
  return `Typical for ${what}: about ${fmtMinutes(RUN_TYPICAL_MS[run.kind])}. Marked stale after ${fmtMinutes(RUN_TIMEOUT_MS[run.kind])}.`;
}

/* ── brief status (F23 to F26) ── */

export const BRIEF_STATUSES = ['draft', 'ready', 'sent'] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];
const BRIEF_LABEL: Record<BriefStatus, string> = { draft: 'Draft', ready: 'Brief ready', sent: 'Sent' };
const BRIEF_STOP: Record<BriefStatus, string> = { draft: 'Draft', ready: 'Ready', sent: 'Sent' };

export function briefStatusLabel(s: BriefStatus): string {
  return BRIEF_LABEL[s];
}
export function briefStopLabel(s: BriefStatus): string {
  return BRIEF_STOP[s];
}

/** Ready-for-you order: unsent first (as stored), sent briefs after. */
export function readyOrder<S extends { id: string }>(scripts: S[], briefs: Pick<Brief, 'scriptId' | 'status'>[]): S[] {
  const sent = new Set(briefs.filter((b) => b.status === 'sent').map((b) => b.scriptId));
  return [...scripts.filter((s) => !sent.has(s.id)), ...scripts.filter((s) => sent.has(s.id))];
}
