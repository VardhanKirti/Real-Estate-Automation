import type {
  LabBeat,
  LabBeatType,
  LabConfidence,
  LabDissection,
  LabGate,
  LabGateCheck,
  LabIdea,
  LabIdeaStatus,
  LabMeasure,
  LabPlatform,
  LabPost,
  LabPostMetrics,
  LabProfile,
  LabQuadrant,
  LabRun,
  LabRunKind,
  LabRunStatus,
  LabSource,
  LabSourceKind,
  LabTiming,
  LabTrajectory,
  LabTranscript,
} from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import {
  MIN_N,
  MIN_PROFILE_BREAKOUTS,
  enough,
  fmtRatio,
  hoursBetween,
  ladder,
  ladderIndex,
  median,
  normalizeBeats,
  strandMarks,
  beatTemplate,
  wordBudget,
  wordCount,
  type LadderRung,
} from '@/lib/lab/measures';
import { FEATURE_LABEL, FORMAT_LABEL, featureRows, featuresOf, profileSentences } from '@/lib/lab/distill';
import { computeDna } from '@/lib/lab/dna';
import { publishCandidates } from '@/lib/lab/outcomes';
import { angleStats, clusterAngleRows } from '@/lib/lab/trends';
import { sectionBudgets } from '@/lib/lab/gate';
import { spendMeter, type SpendMeter } from '@/lib/lab/spend';
import type { LabDryReason } from '@/lib/lab/dry';

/**
 * THE VIEW CONTRACT (docs/projects/content-lab/CONTRACT.md). Every Content Lab surface,
 * GladOS and Classic, renders from these serialisable shapes and nothing else: the UI
 * lanes never read the store, never compute a statistic and never decide whether a
 * number is "enough". Rules baked in here, so both trees inherit them:
 *
 * - Honest or absent: a number with n < 5 arrives as `enough: false` and the UI prints
 *   "not enough data" (AC2); a profile feature arrives only when it passed n >= 8 and an
 *   interval excluding 1.0 (`shown`, AC3); an idea whose evidence does not resolve to at
 *   least two real posts is dropped (AC4).
 * - Colour is never decided here: beats, ladder rungs and categories carry token NAMES
 *   (`--lab-beat-demo`, `--lab-ladder-3`, a 1-11 category index) for the CSS to resolve.
 * - Every list is already sorted the way the wireframes show it (SPEC §5.4).
 * - Plain JSON: no Dates, Maps or functions, so a server page can hand it to a client
 *   tree and an API route can return it as is.
 */

/* ── tabs, states ─────────────────────────────────────────────────────── */

export const LAB_TABS = [
  { id: 'today', label: 'Today' },
  { id: 'breakouts', label: 'Breakouts' },
  { id: 'profile', label: 'Viral profile' },
  { id: 'trends', label: 'Trends' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'sources', label: 'Sources' },
] as const;
export type LabTab = (typeof LAB_TABS)[number]['id'];
export const isLabTab = (v: unknown): v is LabTab => typeof v === 'string' && LAB_TABS.some((t) => t.id === v);

/**
 * not_configured: no Apify token (and not sample/Filming) → the frame and ONE empty card
 *   with Set up (setupHref); no tab payloads at all.
 * empty: configured, nothing added or scraped → Sources opens first ("Add your accounts").
 * thin: data exists but below the thresholds → numbers carry enough:false.
 * ready: everything renders.
 */
export type LabState = 'not_configured' | 'empty' | 'thin' | 'ready';

export type LabMode = {
  state: LabState;
  /** An Apify token resolves (lib/connectors/apify.ts). */
  configured: boolean;
  /** ?sample=1 fixture preview on a blank install: render GSampleBadge (fixture = fixtureName). */
  sample: boolean;
  /** Filming mode: fixtures in demo-data, nothing is charged. */
  filming: boolean;
  dry: boolean;
  dryReason: LabDryReason;
  /** "Filming · no charges" / "LAB_DRY=1 · fixtures, no charges", or null. */
  dryLabel: string | null;
  /** setupHrefFor('apify'). */
  setupHref: string;
  /** Title for the sample badge, null when the data is real. */
  fixtureName: string | null;
  /** The tab to open when the URL names none (sources when empty). */
  defaultTab: LabTab;
};

/** A number that may not be shown: when `enough` is false the UI prints "not enough data". */
export type Measured = { value: number | null; n: number; enough: boolean; text: string | null };

/* ── signature shapes: Strand, Ladder, Field, Specimen ────────────────── */

export type StrandBeatView = { type: LabBeatType; label: string; startPct: number; endPct: number; summary: string; /** CSS custom property name */ token: string };
export type StrandView = {
  beats: StrandBeatView[];
  /** The hook segment (underlined). */
  hook: { startPct: number; endPct: number } | null;
  /** Rehook tick positions, percent of runtime. */
  rehookTicks: number[];
  durationS: number | null;
  /** "hook → reveal → demo → payoff → cta" */
  template: string;
};

export type LadderView = {
  ratio: number | null;
  /** "7.2x" */
  text: string | null;
  rung: LadderRung | null;
  /** "7.2x · strong", or "not enough data" */
  label: string;
  /** 0 unknown, 1 none … 4 exceptional; token = `--lab-ladder-${index}` (0 → --lab-dim) */
  index: 0 | 1 | 2 | 3 | 4;
  token: string;
  /** 90% interval */
  lo: number | null;
  hi: number | null;
  /** baseline n */
  n: number;
  confidence: LabConfidence;
  enough: boolean;
};

export type CreatorRef = { sourceId: string; handle: string; displayName: string; platform: string; owned: boolean; kind: LabSourceKind | null };

export type MetricsView = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** null = the platform does not return saves (never 0-filled) */
  saves: number | null;
  depth: number | null;
  /** "6.2% deep" */
  depthText: string | null;
  capturedAt: string | null;
};

export type SpecimenCard = {
  postId: string;
  href: string;
  url: string;
  platform: LabPlatform;
  creator: CreatorRef;
  postedAt: string | null;
  thumbnailUrl: string | null;
  durationS: number | null;
  hookText: string;
  format: string | null;
  formatLabel: string | null;
  ladder: LadderView;
  strand: StrandView | null;
  metrics: MetricsView;
  quadrant: LabQuadrant | null;
  trajectory: LabTrajectory | null;
  /** Posted inside the "since" window (default 7 days) */
  isNew: boolean;
  isBreakout: boolean;
  transcriptStatus: 'done' | 'none' | 'pending' | 'failed';
};

export type TranscriptSegment = { type: LabBeatType; startPct: number; endPct: number; text: string; token: string };

export type WhyLift = { feature: string; featureLabel: string; value: string; valueLabel: string; lift: number; liftText: string; n: number; lo: number | null; hi: number | null };

export type SpecimenSheet = SpecimenCard & {
  caption: string;
  dissection: {
    hookForm: string; hookFormLabel: string; trigger: string; triggerLabel: string; channel: string; structure: string; structureLabel: string;
    pacing: string; pillar: string; cta: string; firstFrameText: string; tension: { falseBelief: string; reframe: string } | null;
    confidences: Record<string, number>; modelId: string; promptVersion: string;
  } | null;
  topics: { topic: string; angle: string; isPrimary: boolean; clusterId: string | null; clusterLabel: string | null }[];
  transcript: {
    status: LabTranscript['status']; text: string; wordCount: number; wpm: number | null; provider: string;
    /** The transcript cut by beat (proportional to word position), each with its strand token. */
    segments: TranscriptSegment[];
  } | null;
  snapshots: { capturedAt: string; hoursSincePost: number | null; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null }[];
  reach: Measured;
  velocity: Measured;
  baseline: { n: number; confidence: LabConfidence; median: number | null; ownWeight: number | null; enough: boolean };
  /** Viral Profile lifts (shown ones only) that this post carries, strongest first. */
  why: WhyLift[];
  profileId: string | null;
};

export type FieldPoint = {
  postId: string;
  /** breakout ratio (log axis) */
  x: number;
  /** depth (log axis) */
  y: number;
  views: number;
  /** 0-1 dot size, by log views across the field */
  r: number;
  owned: boolean;
  quadrant: LabQuadrant | null;
  isNew: boolean;
  isBreakout: boolean;
  platform: LabPlatform;
  format: string | null;
  label: string;
  handle: string;
};

export type FieldView = {
  points: FieldPoint[];
  /** Quadrant lines: the niche medians (competitor posts). Each point's own quadrant is authoritative (depth medians are per platform). */
  medians: { breakout: number | null; depth: number | null };
  /** Positive log-safe domains with a little padding. */
  domain: { x: [number, number]; y: [number, number] };
  counts: Record<LabQuadrant, number>;
  newBreakouts: number;
  /** new breakouts at strong or exceptional */
  strong: number;
  n: number;
  enough: boolean;
};

/* ── tab shapes ───────────────────────────────────────────────────────── */

export type ProfileFeatureView = { feature: string; label: string; values: { value: string; label: string; lift: number | null; liftText: string | null; n: number; total: number; lo: number | null; hi: number | null; shown: boolean }[] };

export type ProfileView = {
  id: string;
  family: string;
  label: string;
  version: number;
  windowDays: number;
  createdAt: string;
  postsN: number;
  breakoutsN: number;
  breakoutRate: Measured;
  strand: StrandView | null;
  /** Plain sentences, each quoting lift and n (only shown features). */
  sentences: string[];
  /** The hero line: "results first 2.9x · n 22", or null when nothing shows. */
  headline: string | null;
  stats: { wpm: [number, number] | null; durationS: [number, number] | null; wpmText: string | null; durationText: string | null };
  /** Every feature with its values; render only `shown` ones (the rest carry their n for tooltips). */
  features: ProfileFeatureView[];
  versions: { version: number; createdAt: string; breakoutsN: number }[];
  /** Niche lifts you rarely use: "results first: niche 2.9x, you use it in 9% of posts". */
  gaps: { feature: string; value: string; label: string; nicheLift: number; n: number; yourShare: number; yourN: number }[];
  /** "yours" vs "niche" with n (SPEC §4.13). */
  yoursVsNiche: { key: string; label: string; yours: Measured; niche: Measured; source: 'measured' | 'prior' }[];
  thin: boolean;
};

export type TrendRow = {
  clusterId: string;
  label: string;
  timing: LabTiming | null;
  momentum: number | null;
  /** "▲ 2.6x" style text is the UI's; this is the plain "2.6x" */
  momentumText: string | null;
  direction: 'up' | 'down' | 'flat';
  creators: number;
  platforms: number;
  posts: number;
  breakouts: number;
  /** 1-11, the categorical colour slot (kit --g-cat-N / Classic --lab-cat-N) */
  cat: number;
  coverage: { covered: boolean; postId: string | null; ladder: LadderView | null };
  /** Top angles in the last 28 days; exhausted = many posts, nothing broke out. */
  angles: { angle: string; posts: number; best: number | null; bestText: string | null; exhausted: boolean }[];
  ideaIds: string[];
};

export type TrendsView = {
  /** 12 week-ending days, oldest first */
  weeks: string[];
  /** Stacked-area input: one series per cluster, weighted weekly count (posts + 2 per breakout). */
  series: { clusterId: string; label: string; cat: number; values: number[] }[];
  rows: TrendRow[];
  feedItems: { id: string; feed: string; title: string; url: string; score: number | null; seenAt: string; clusterLabel: string | null }[];
};

export type IdeaCard = {
  id: string;
  title: string;
  topic: string | null;
  clusterId: string | null;
  angle: string;
  tension: { falseBelief: string; reframe: string } | null;
  family: string;
  familyLabel: string;
  strand: StrandView | null;
  hookRecs: { form: string; formLabel: string; trigger: string; triggerLabel: string; lift: number | null; liftText: string | null; n: number; enough: boolean }[];
  evidence: { postId: string; why: string; card: SpecimenCard }[];
  timing: LabTiming | null;
  fit: number;
  fitText: string;
  thin: boolean;
  status: LabIdeaStatus;
  dismissReason: string | null;
  createdAt: string;
  actedOnAt: string | null;
  scriptId: string | null;
  href: string;
};

export type ScriptRow = {
  id: string;
  href: string;
  title: string;
  status: 'draft' | 'published';
  version: number;
  updatedAt: string;
  ideaId: string | null;
  gatePassed: boolean;
  failing: number;
  words: number;
  budget: number;
  durationS: number;
  publishedPostId: string | null;
  outcome: LadderView | null;
};

export type ScriptSheet = {
  id: string;
  title: string;
  status: 'draft' | 'published';
  version: number;
  versions: { version: number; createdAt: string; gatePassed: boolean; edited: boolean }[];
  idea: IdeaCard | null;
  evidence: { tension: { falseBelief: string; reframe: string } | null; posts: SpecimenCard[]; hookRecs: IdeaCard['hookRecs']; budget: { durationS: number; words: number; wpm: number } };
  hooks: { form: string; formLabel: string; trigger: string; triggerLabel: string; spoken: string; onScreen: string; words: number; chosen: boolean }[];
  sections: { index: number; type: LabBeatType; label: string; token: string; startPct: number; endPct: number; spoken: string; onScreen: string; visualNote: string; words: number; budget: number; delta: number; deltaText: string; over: boolean; failing: LabGateCheck[] }[];
  cta: string;
  caption: string;
  titles: string[];
  strand: StrandView;
  profileStrand: StrandView | null;
  gate: LabGate;
  publishedPost: SpecimenCard | null;
  /** Mark published picker: your own posts since the draft (from a day before it), ranked by transcript similarity
   *  (caption until transcribed), then newest; at most 6, empty unless the script is a draft. */
  publishCandidates: (SpecimenCard & { similarity: number | null; similarityText: string | null })[];
  outcomes: { capturedAt: string; ladder: LadderView; depthText: string | null }[];
};

/** Your DNA (SPEC §4.9), every number with its n. */
export type DnaView = {
  windowDays: number;
  posts: number;
  mix: { family: string; label: string; posts: number; share: number; shareText: string; breakoutRate: Measured; baselineViews: Measured; medianDurationS: number | null }[];
  /** "Your screen recording posts break out 1.7x as often as your AI tool tutorials posts (n 18 and 47)." or null */
  contrast: string | null;
  voice: {
    wpm: Measured;
    sentenceMean: Measured;
    sentenceSpread: string | null;
    openers: { word: string; shareText: string; n: number }[];
    transitions: { phrase: string; per1kText: string; n: number }[];
    fillerRate: Measured;
    transcripts: number;
  };
  gaps: { family: string; familyLabel: string; feature: string; label: string; nicheLift: number; nicheLiftText: string; n: number; yourShare: number; yourShareText: string; yourN: number }[];
  families: string[];
};

export type SourceRow = {
  id: string; kind: LabSourceKind; platform: string; handle: string; displayName: string; url: string | null; status: LabSource['status'];
  addedAt: string; reason: string | null; score: number | null; posts: number; breakouts: number; followers: number | null; lastPostAt: string | null;
};

export type RunRow = {
  id: string; kind: LabRunKind; actor: string | null; actorLabel: string; lane: string; status: LabRunStatus; items: number | null;
  costUsd: number | null; costText: string | null; dry: boolean; startedAt: string; finishedAt: string | null; durationS: number | null; error: string | null;
};

export type RunStripView = {
  lanes: { id: string; label: string; status: 'ok' | 'failed' | 'running' | 'blocked' | 'idle'; detail: string | null; at: string | null }[];
  lastSyncAt: string | null;
  profileVersion: number | null;
  dry: boolean;
};

export type SourcesView = {
  owned: SourceRow[];
  tracked: SourceRow[];
  suggested: SourceRow[];
  feeds: SourceRow[];
  runs: RunRow[];
  spend: SpendMeter & { lines: { provider: string; label: string; text: string; pct: number | null }[] };
  schedule: { installed: boolean; label: string; nextAt: string | null; agent: string };
  dryNote: string | null;
  /** "Add your accounts" when nothing is owned yet. */
  emptyHint: string | null;
};

export type TodayView = {
  field: FieldView;
  heroProfile: ProfileView | null;
  newBreakouts: SpecimenCard[];
  openTrends: TrendRow[];
  nextIdeas: IdeaCard[];
  headline: { newBreakouts: number; strong: number; window: string };
};

export type BreakoutFilters = { format?: string | null; platform?: string | null; quadrant?: LabQuadrant | null; windowDays?: number | null };
export type BreakoutsView = {
  field: FieldView;
  filters: { formats: { id: string; label: string; n: number }[]; platforms: { id: string; label: string; n: number }[]; quadrants: { id: LabQuadrant; label: string; n: number }[]; windows: number[] };
  applied: { format: string | null; platform: string | null; quadrant: LabQuadrant | null; windowDays: number };
  specimens: SpecimenCard[];
  total: number;
};

export type LabView = {
  generatedAt: string;
  mode: LabMode;
  /** `agent`: the Lab agent's id and its display name from roster data (never hard-coded). */
  header: { title: string; subtitle: string; lastSyncAt: string | null; source: 'Apify'; agent: { id: 'content-lab'; name: string } };
  tabs: { id: LabTab; label: string; count: number | null }[];
  /** The tab the payload was built for ('all' builds every tab). */
  tab: LabTab | 'all';
  runStrip: RunStripView | null;
  today?: TodayView;
  breakouts?: BreakoutsView;
  profile?: { profiles: ProfileView[]; selected: string | null; dna: DnaView };
  trends?: TrendsView;
  ideas?: { open: IdeaCard[]; used: IdeaCard[]; dismissed: IdeaCard[]; openCap: number };
  scripts?: { rows: ScriptRow[] };
  sources?: SourcesView;
  /** Deep links (?post= ?idea= ?script=): resolved, or null when the id is unknown. */
  focus: { post: SpecimenSheet | null; idea: IdeaCard | null; script: ScriptSheet | null };
};

export type BuildOpts = {
  tab?: LabTab | 'all';
  now?: Date;
  /** isNew window start; default now − 7 days */
  since?: Date;
  configured: boolean;
  sample?: boolean;
  filming?: boolean;
  dry?: boolean;
  dryReason?: LabDryReason;
  dryLabel?: string | null;
  setupHref: string;
  fixtureName?: string | null;
  /** The Lab agent's display name from roster data (lib/agents/content-lab.ts labAgentName). */
  agentName?: string | null;
  filters?: BreakoutFilters;
  profileFamily?: string | null;
  post?: string | null;
  idea?: string | null;
  script?: string | null;
};

/* ── labels and tokens ─────────────────────────────────────────────────── */

export const humanize = (v: string): string => {
  const s = v.replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const beatToken = (t: LabBeatType): string => `--lab-beat-${t}`;
/** A beat's display label ("CTA" stays an acronym; the rest are sentence case). */
export const beatLabel = (t: LabBeatType): string => (t === 'cta' ? 'CTA' : humanize(t));
export const PLATFORM_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X', hn: 'Hacker News', reddit: 'Reddit', producthunt: 'Product Hunt', google_trends: 'Google Trends', changelog: 'Changelogs', keyword_search: 'Keyword search' };
export const QUADRANT_LABEL: Record<LabQuadrant, string> = { ideal: 'Ideal', loyal: 'Loyal', clickbait: 'Clickbait', dud: 'Dud' };
export const familyLabel = (f: string) => (FORMAT_LABEL as Record<string, string>)[f] ?? humanize(f);
const pct1 = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const money = (x: number | null) => (x === null ? null : `$${x.toFixed(2)}`);

export function measured(value: number | null, n: number, text: (v: number) => string, min = MIN_N): Measured {
  const ok = value !== null && enough(n, min);
  return { value: ok ? value : null, n, enough: ok, text: ok ? text(value!) : null };
}

export function strandView(beats: readonly LabBeat[] | null | undefined, durationS: number | null = null): StrandView | null {
  if (!beats || beats.length === 0) return null;
  const b = normalizeBeats(beats);
  const marks = strandMarks(b);
  return { beats: b.map((x) => ({ type: x.type, label: beatLabel(x.type), startPct: x.startPct, endPct: x.endPct, summary: x.summary ?? '', token: beatToken(x.type) })), hook: marks.hook, rehookTicks: marks.rehookTicks, durationS, template: beatTemplate(b) };
}

export function ladderView(m: Pick<LabMeasure, 'breakout' | 'breakoutLo' | 'breakoutHi' | 'baselineN' | 'baselineConfidence'> | null): LadderView {
  const n = m?.baselineN ?? 0;
  const ratio = m?.breakout ?? null;
  // Below n 5 the ratio is shrunk mostly onto the niche: it is not shown as a ladder value.
  const ok = ratio !== null && enough(n);
  const rung = ok ? ladder(ratio) : null;
  const index = ladderIndex(rung);
  return {
    ratio: ok ? ratio : null,
    text: ok ? fmtRatio(ratio) : null,
    rung,
    label: ok ? `${fmtRatio(ratio)} · ${rung}` : 'not enough yet',
    index,
    token: index ? `--lab-ladder-${index}` : '--lab-dim',
    lo: ok ? (m?.breakoutLo ?? null) : null,
    hi: ok ? (m?.breakoutHi ?? null) : null,
    n,
    confidence: m?.baselineConfidence ?? 'low',
    enough: ok,
  };
}

/* ── the builder ──────────────────────────────────────────────────────── */

const DAY = 86_400_000;

/** The v1 builder context; v2 page builders reuse it (01 5.1 legacy.ts). */
export type Ctx = {
  store: LabStore;
  now: Date;
  since: number;
  posts: LabPost[];
  postById: Map<string, LabPost>;
  sources: Map<string, LabSource>;
  measures: Map<string, LabMeasure>;
  dissections: Map<string, LabDissection>;
  transcripts: Map<string, LabTranscript>;
  latest: Map<string, LabPostMetrics>;
  clusters: Map<string, string>;
  primaryCluster: Map<string, string | null>;
};

export function context(store: LabStore, now: Date, since: Date): Ctx {
  const posts = store.posts.all();
  return {
    store,
    now,
    since: since.getTime(),
    posts,
    postById: new Map(posts.map((p) => [p.id, p])),
    sources: new Map(store.sources.all().map((s) => [s.id, s])),
    measures: new Map(store.measures.all().map((m) => [m.postId, m])),
    dissections: new Map(store.dissections.all().map((d) => [d.postId, d])),
    transcripts: new Map(store.transcripts.all().map((t) => [t.postId, t])),
    latest: store.metrics.latest(),
    clusters: new Map(store.clusters.all().map((c) => [c.id, c.label])),
    primaryCluster: new Map(store.topics.all().filter((t) => t.isPrimary).map((t) => [t.postId, t.clusterId])),
  };
}

function creatorRef(c: Ctx, p: LabPost): CreatorRef {
  const s = c.sources.get(p.sourceId);
  return { sourceId: p.sourceId, handle: s?.handle ?? '', displayName: s?.displayName || s?.handle || '', platform: p.platform, owned: p.isOwned, kind: s?.kind ?? null };
}

function metricsView(m: LabPostMetrics | undefined, depth: number | null): MetricsView {
  return { views: m?.views ?? null, likes: m?.likes ?? null, comments: m?.comments ?? null, shares: m?.shares ?? null, saves: m?.saves ?? null, depth, depthText: depth === null ? null : `${pct1(depth)} deep`, capturedAt: m?.capturedAt ?? null };
}

export function specimen(c: Ctx, p: LabPost): SpecimenCard {
  const m = c.measures.get(p.id) ?? null;
  const d = c.dissections.get(p.id) ?? null;
  const posted = p.postedAt ? Date.parse(p.postedAt) : NaN;
  return {
    postId: p.id,
    href: `/lab?post=${encodeURIComponent(p.id)}`,
    url: p.url,
    platform: p.platform,
    creator: creatorRef(c, p),
    postedAt: p.postedAt,
    thumbnailUrl: p.thumbnailUrl,
    durationS: p.durationS,
    hookText: d?.hookText || p.caption.split('\n')[0].slice(0, 140),
    format: d?.format ?? null,
    formatLabel: d ? familyLabel(d.format) : null,
    ladder: ladderView(m),
    strand: strandView(d?.beats, p.durationS),
    metrics: metricsView(c.latest.get(p.id), m?.depth ?? null),
    quadrant: m?.quadrant ?? null,
    trajectory: m?.trajectory ?? null,
    isNew: posted >= c.since,
    isBreakout: m?.isBreakout ?? false,
    transcriptStatus: c.transcripts.get(p.id)?.status ?? 'none',
  };
}

export function field(c: Ctx, posts: readonly LabPost[]): FieldView {
  const pts: Omit<FieldPoint, 'r'>[] = [];
  for (const p of posts) {
    const m = c.measures.get(p.id);
    const v = c.latest.get(p.id)?.views ?? null;
    if (!m || m.breakout === null || m.depth === null || v === null || !(m.depth > 0) || m.baselineN < MIN_N) continue;
    const d = c.dissections.get(p.id);
    pts.push({ postId: p.id, x: m.breakout, y: m.depth, views: v, owned: p.isOwned, quadrant: m.quadrant, isNew: (p.postedAt ? Date.parse(p.postedAt) : 0) >= c.since, isBreakout: m.isBreakout, platform: p.platform, format: d?.format ?? null, label: d?.hookText ?? p.caption.slice(0, 80), handle: c.sources.get(p.sourceId)?.handle ?? '' });
  }
  const lv = pts.map((p) => Math.log10(Math.max(1, p.views)));
  const lo = Math.min(...lv, Infinity);
  const hi = Math.max(...lv, -Infinity);
  const points: FieldPoint[] = pts.map((p, i) => ({ ...p, r: hi > lo ? Math.round(((lv[i] - lo) / (hi - lo)) * 1000) / 1000 : 0.5 }));
  const comp = points.filter((p) => !p.owned);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = (a: number, b: number): [number, number] => [a / 1.25, b * 1.25];
  const counts: Record<LabQuadrant, number> = { ideal: 0, loyal: 0, clickbait: 0, dud: 0 };
  for (const p of points) if (p.quadrant) counts[p.quadrant]++;
  const fresh = points.filter((p) => p.isNew && p.isBreakout);
  return {
    points,
    medians: { breakout: median(comp.map((p) => p.x)), depth: median(comp.map((p) => p.y)) },
    domain: { x: points.length ? pad(Math.min(...xs), Math.max(...xs)) : [0.1, 10], y: points.length ? pad(Math.min(...ys), Math.max(...ys)) : [0.005, 0.2] },
    counts,
    newBreakouts: fresh.length,
    strong: fresh.filter((p) => p.x >= 5).length,
    n: points.length,
    enough: enough(points.length),
  };
}

function lastSnapshotByCluster(store: LabStore) {
  const last = new Map<string, ReturnType<LabStore['trendSnapshots']['all']>[number]>();
  for (const s of store.trendSnapshots.all()) last.set(s.clusterId, s);
  return last;
}

export function profileView(c: Ctx, p: LabProfile, all: LabProfile[]): ProfileView {
  const shown = p.features.filter((f) => f.shown && f.lift !== null);
  const byFeature = new Map<string, ProfileFeatureView>();
  for (const f of p.features) {
    const fv = byFeature.get(f.feature) ?? { feature: f.feature, label: FEATURE_LABEL[f.feature] ?? humanize(f.feature), values: [] };
    fv.values.push({ value: f.value, label: valueLabel(c, f.feature, f.value), lift: f.lift, liftText: f.lift === null ? null : fmtRatio(f.lift), n: f.n, total: f.total, lo: f.lo, hi: f.hi, shown: f.shown });
    byFeature.set(f.feature, fv);
  }
  for (const fv of byFeature.values()) fv.values.sort((a, b) => Number(b.shown) - Number(a.shown) || (b.lift ?? 0) - (a.lift ?? 0));
  const ups = shown.filter((f) => f.lift! > 1).sort((a, b) => b.lift! - a.lift!);
  const sentences = profileSentences(p, (f, v) => valueLabel(c, f, v));
  const top = ups.find((f) => f.feature === 'hook_form') ?? ups[0];

  // you vs the niche, from your own posts in this family
  const ownRows = featureRows(c.store, { now: c.now, owned: true }).filter((r) => r.dissection.format === p.formatFamily);
  const gaps = ups
    .map((f) => {
      const carrying = ownRows.filter((r) => featuresOf(r)[f.feature] === f.value).length;
      return { feature: f.feature, value: f.value, label: `${FEATURE_LABEL[f.feature] ?? f.feature}: ${valueLabel(c, f.feature, f.value).toLowerCase()}`, nicheLift: f.lift!, n: f.n, yourShare: ownRows.length ? carrying / ownRows.length : 0, yourN: ownRows.length };
    })
    .filter((g) => g.yourN > 0 && g.yourShare < 0.25)
    .slice(0, 4);
  const ownBreakouts = ownRows.filter((r) => r.measure.isBreakout).length;
  const ownWpm = ownRows.map((r) => r.transcript?.wpm).filter((x): x is number => typeof x === 'number');
  const nicheWpm = p.stats.wpm ? (p.stats.wpm[0] + p.stats.wpm[1]) / 2 : null;
  const prior = c.store.priors.get('yours:wpm');
  const priorWpm = prior?.supersedesDefault ? ((prior.value as { value?: number } | null)?.value ?? null) : null;
  const ownDur = ownRows.map((r) => r.post.durationS).filter((x): x is number => typeof x === 'number');
  // a prior replaces the measured figure only once it passed its threshold (SPEC §4.13)
  const dp = c.store.priors.get(`yours:duration:${p.formatFamily}`);
  const dpv = (dp?.value as { value?: number } | null)?.value;
  const durPrior = dp?.supersedesDefault && typeof dpv === 'number' ? { value: dpv, n: dp.n } : null;
  const topHook = ups.find((f) => f.feature === 'hook_form') ?? null;
  const hp = topHook ? c.store.priors.get(`yours:hook_lift:${topHook.value}`) : null;
  const hpv = (hp?.value as { lift?: number | null } | null)?.lift;
  const hookPrior = hp?.supersedesDefault && typeof hpv === 'number' ? { lift: hpv, n: hp.n } : null;
  const yoursVsNiche: ProfileView['yoursVsNiche'] = [
    { key: 'breakout_rate', label: 'Breakout rate', yours: measured(ownRows.length ? ownBreakouts / ownRows.length : null, ownRows.length, pct1), niche: measured(p.postsN ? p.breakoutsN / p.postsN : null, p.postsN, pct1), source: 'measured' },
    { key: 'wpm', label: 'Pace', yours: priorWpm !== null ? measured(priorWpm, prior!.n, (v) => `${Math.round(v)} wpm`) : measured(median(ownWpm), ownWpm.length, (v) => `${Math.round(v)} wpm`), niche: measured(nicheWpm, p.breakoutsN, (v) => `${Math.round(v)} wpm`), source: priorWpm !== null ? 'prior' : 'measured' },
    { key: 'duration', label: 'Duration', yours: durPrior ? measured(durPrior.value, durPrior.n, (v) => `${Math.round(v)} s`) : measured(median(ownDur), ownDur.length, (v) => `${Math.round(v)} s`), niche: measured(p.stats.durationS ? (p.stats.durationS[0] + p.stats.durationS[1]) / 2 : null, p.breakoutsN, (v) => `${Math.round(v)} s`), source: durPrior ? 'prior' : 'measured' },
    ...(hookPrior && topHook ? [{ key: `hook_lift:${topHook.value}`, label: `${humanize(topHook.value)} hook lift`, yours: measured(hookPrior.lift, hookPrior.n, (v) => fmtRatio(v)!), niche: measured(topHook.lift, topHook.n, (v) => fmtRatio(v)!), source: 'prior' as const }] : []),
  ];
  return {
    id: p.id,
    family: p.formatFamily,
    label: p.label || familyLabel(p.formatFamily),
    version: p.version,
    windowDays: p.windowDays,
    createdAt: p.createdAt,
    postsN: p.postsN,
    breakoutsN: p.breakoutsN,
    breakoutRate: measured(p.postsN ? p.breakoutsN / p.postsN : null, p.postsN, pct1),
    strand: strandView(p.strand),
    sentences,
    headline: top ? `${valueLabel(c, top.feature, top.value).toLowerCase()} ${fmtRatio(top.lift)} · n ${top.n}` : null,
    stats: { wpm: p.stats.wpm, durationS: p.stats.durationS, wpmText: p.stats.wpm ? `${p.stats.wpm[0]}-${p.stats.wpm[1]} wpm` : null, durationText: p.stats.durationS ? `${p.stats.durationS[0]}-${p.stats.durationS[1]} s` : null },
    features: [...byFeature.values()].sort((a, b) => a.label.localeCompare(b.label)),
    versions: all.filter((x) => x.formatFamily === p.formatFamily).map((x) => ({ version: x.version, createdAt: x.createdAt, breakoutsN: x.breakoutsN })),
    gaps,
    yoursVsNiche,
    thin: p.breakoutsN < MIN_PROFILE_BREAKOUTS || shown.length === 0,
  };
}

export function valueLabel(c: Ctx, feature: string, value: string): string {
  if (feature === 'topic_cluster') return c.clusters.get(value) ?? value;
  if (feature === 'beat_template') return value;
  return humanize(value);
}

export function allProfiles(store: LabStore): LabProfile[] {
  // every version (for the history list), newest first
  return store.profiles.latest().flatMap((l) => store.profiles.history(l.formatFamily));
}

export function dnaView(c: Ctx): DnaView {
  const d = computeDna(c.store, { now: c.now });
  const v = d.voice;
  const pctText = (x: number) => `${Math.round(x * 100)}%`;
  return {
    windowDays: d.windowDays,
    posts: d.posts,
    mix: d.mix.map((m) => ({ family: m.family, label: m.label, posts: m.posts, share: m.share, shareText: pctText(m.share), breakoutRate: measured(m.breakoutRate, m.posts, pct1), baselineViews: measured(m.baselineViews, m.baselineN, (x) => `${Math.round(x).toLocaleString('en-US')} views`), medianDurationS: m.medianDurationS })),
    contrast: d.contrast ? `${d.contrast.text.charAt(0).toUpperCase()}${d.contrast.text.slice(1)}.` : null,
    voice: {
      wpm: measured(v.wpm.median, v.wpm.n, (x) => `${Math.round(x)} wpm`),
      sentenceMean: measured(v.sentence.mean, v.sentence.n, (x) => `${x} words a sentence`),
      sentenceSpread: enough(v.sentence.n) && v.sentence.p10 !== null && v.sentence.p90 !== null ? `${v.sentence.p10} to ${v.sentence.p90} words (p10 to p90)` : null,
      openers: enough(v.sentence.n) ? v.openers.map((o) => ({ word: o.word, shareText: pctText(o.share), n: o.n })) : [],
      transitions: enough(v.transcripts) ? v.transitions.map((t) => ({ phrase: t.phrase, per1kText: `${t.per1k} per 1,000 words`, n: t.n })) : [],
      fillerRate: measured(v.fillerRate, v.transcripts, (x) => `${x} per 100 words`),
      transcripts: v.transcripts,
    },
    gaps: d.gaps.slice(0, 8).map((g) => ({ family: g.family, familyLabel: familyLabel(g.family), feature: g.feature, label: `${FEATURE_LABEL[g.feature] ?? humanize(g.feature)}: ${valueLabel(c, g.feature, g.value).toLowerCase()}`, nicheLift: g.nicheLift, nicheLiftText: fmtRatio(g.nicheLift)!, n: g.n, yourShare: g.yourShare, yourShareText: pctText(g.yourShare), yourN: g.yourN })),
    families: d.families,
  };
}

export function trendsView(c: Ctx, ideas: LabIdea[]): TrendsView {
  const snaps = c.store.trendSnapshots.all();
  const days = [...new Set(snaps.map((s) => s.day))].sort();
  const lastDay = days[days.length - 1];
  const weeks: string[] = [];
  if (lastDay) for (let w = 11; w >= 0; w--) weeks.push(new Date(Date.parse(`${lastDay}T00:00:00Z`) - w * 7 * DAY).toISOString().slice(0, 10));
  const by = new Map<string, Map<string, (typeof snaps)[number]>>();
  for (const s of snaps) (by.get(s.clusterId) ?? by.set(s.clusterId, new Map()).get(s.clusterId)!).set(s.day, s);
  const clusters = c.store.clusters.all();
  const catOf = new Map(clusters.map((cl, i) => [cl.id, (i % 11) + 1]));
  const series = clusters.map((cl) => ({ clusterId: cl.id, label: cl.label, cat: catOf.get(cl.id)!, values: weeks.map((d) => { const s = by.get(cl.id)?.get(d); return s ? s.posts + 2 * s.breakouts : 0; }) }));
  const last = lastSnapshotByCluster(c.store);
  const rows: TrendRow[] = clusters.map((cl) => {
    const s = last.get(cl.id);
    const inCluster = c.posts.filter((p) => c.primaryCluster.get(p.id) === cl.id);
    const ownedBest = inCluster.filter((p) => p.isOwned).map((p) => ({ p, m: c.measures.get(p.id) })).sort((a, b) => (b.m?.breakout ?? 0) - (a.m?.breakout ?? 0))[0];
    const angles = angleStats(clusterAngleRows(c.store, cl.id, { now: c.now, windowDays: 28 })).map((x) => ({ angle: x.angle, posts: x.posts, best: x.best, bestText: x.best ? fmtRatio(x.best) : null, exhausted: x.exhausted }));
    const mom = s?.momentum ?? null;
    return {
      clusterId: cl.id,
      label: cl.label,
      timing: s?.timing ?? null,
      momentum: mom,
      momentumText: mom === null ? null : fmtRatio(mom),
      direction: mom === null ? 'flat' : mom >= 1.15 ? 'up' : mom <= 0.85 ? 'down' : 'flat',
      creators: s?.creators ?? 0,
      platforms: s?.platforms ?? 0,
      posts: s?.posts ?? 0,
      breakouts: s?.breakouts ?? 0,
      cat: catOf.get(cl.id)!,
      coverage: { covered: Boolean(ownedBest), postId: ownedBest?.p.id ?? null, ladder: ownedBest ? ladderView(ownedBest.m ?? null) : null },
      angles: angles.slice(0, 5),
      ideaIds: ideas.filter((i) => i.clusterId === cl.id).map((i) => i.id),
    };
  });
  const order: Record<string, number> = { early: 0, open: 1, closing: 2, closed: 3 };
  rows.sort((a, b) => (order[a.timing ?? 'closed'] ?? 4) - (order[b.timing ?? 'closed'] ?? 4) || (b.momentum ?? 0) - (a.momentum ?? 0));
  return {
    weeks,
    series,
    rows,
    feedItems: c.store.trendItems.all().slice(0, 10).map((t) => ({ id: t.id, feed: t.feed, title: t.title, url: t.url, score: t.score, seenAt: t.seenAt, clusterLabel: t.clusterId ? (c.clusters.get(t.clusterId) ?? null) : null })),
  };
}

function ideaCard(c: Ctx, i: LabIdea, scriptByIdea: Map<string, string>, minEvidence = 2): IdeaCard | null {
  const evidence = i.evidence.flatMap((e) => {
    const p = c.postById.get(e.postId);
    return p ? [{ postId: e.postId, why: e.why, card: specimen(c, p) }] : [];
  });
  if (evidence.length < minEvidence) return null; // AC4: an idea citing unknown posts is dropped
  return {
    id: i.id,
    title: i.title,
    topic: i.clusterId ? (c.clusters.get(i.clusterId) ?? null) : null,
    clusterId: i.clusterId,
    angle: i.angle,
    tension: i.tension,
    family: i.formatFamily,
    familyLabel: familyLabel(i.formatFamily),
    strand: strandView(i.strand),
    hookRecs: i.hookRecs.map((h) => ({ form: h.form, formLabel: humanize(h.form), trigger: h.trigger, triggerLabel: humanize(h.trigger), lift: h.lift, liftText: h.lift === null ? null : fmtRatio(h.lift), n: h.n, enough: enough(h.n) })),
    evidence,
    timing: i.timing,
    fit: i.fit,
    fitText: i.fit.toFixed(2),
    thin: i.thin,
    status: i.status,
    dismissReason: i.dismissReason,
    createdAt: i.createdAt,
    actedOnAt: i.actedOnAt,
    scriptId: scriptByIdea.get(i.id) ?? null,
    href: `/lab?idea=${encodeURIComponent(i.id)}`,
  };
}

export function scriptRow(c: Ctx, id: string): ScriptRow | null {
  const s = c.store.scripts.get(id);
  const v = c.store.scripts.latestVersion(id);
  if (!s || !v) return null;
  const pub = s.publishedPostId ? c.measures.get(s.publishedPostId) ?? null : null;
  return {
    id: s.id,
    href: `/lab?script=${encodeURIComponent(s.id)}`,
    title: s.title,
    status: s.status,
    version: v.version,
    updatedAt: v.createdAt,
    ideaId: s.ideaId,
    gatePassed: v.gate.passed,
    failing: v.gate.checks.filter((x) => !x.ok).length,
    words: v.body.sections.reduce((a, x) => a + wordCount(x.spoken), 0),
    budget: wordBudget(v.body.durationS, v.body.wpm),
    durationS: v.body.durationS,
    publishedPostId: s.publishedPostId,
    outcome: s.publishedPostId ? ladderView(pub) : null,
  };
}

function scriptSheet(c: Ctx, id: string, scriptByIdea: Map<string, string>): ScriptSheet | null {
  const s = c.store.scripts.get(id);
  const v = c.store.scripts.latestVersion(id);
  if (!s || !v) return null;
  const ideaRow = s.ideaId ? c.store.ideas.get(s.ideaId) : null;
  const idea = ideaRow ? ideaCard(c, ideaRow, scriptByIdea) : null;
  const budgets = sectionBudgets(v.body);
  const sections = v.body.sections.map((x, index) => {
    const b = budgets[index];
    return { index, type: x.type, label: beatLabel(x.type), token: beatToken(x.type), startPct: x.startPct, endPct: x.endPct, spoken: x.spoken, onScreen: x.onScreen, visualNote: x.visualNote, words: b.words, budget: b.budget, delta: b.delta, deltaText: `${b.delta >= 0 ? '+' : ''}${Math.round(b.delta * 100)}%`, over: b.over, failing: v.gate.checks.filter((ch) => !ch.ok && ch.section === index) };
  });
  const profile = c.store.profiles.latest().find((p) => p.formatFamily === (ideaRow?.formatFamily ?? ''));
  const pubPost = s.publishedPostId ? c.postById.get(s.publishedPostId) : undefined;
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    version: v.version,
    versions: c.store.scripts.versions(id).map((x) => ({ version: x.version, createdAt: x.createdAt, gatePassed: x.gate.passed, edited: Boolean(x.editDiff) })),
    idea,
    evidence: { tension: idea?.tension ?? null, posts: idea?.evidence.map((e) => e.card) ?? [], hookRecs: idea?.hookRecs ?? [], budget: { durationS: v.body.durationS, words: wordBudget(v.body.durationS, v.body.wpm), wpm: v.body.wpm } },
    hooks: v.body.hooks.map((h, i) => ({ form: h.form, formLabel: humanize(h.form), trigger: h.trigger, triggerLabel: humanize(h.trigger), spoken: h.spoken, onScreen: h.onScreen, words: h.words, chosen: i === v.body.hookChoice })),
    sections,
    cta: v.body.cta,
    caption: v.body.caption,
    titles: v.body.titles,
    strand: strandView(v.body.sections.map((x) => ({ type: x.type, startPct: x.startPct, endPct: x.endPct, summary: '' })), v.body.durationS) ?? { beats: [], hook: null, rehookTicks: [], durationS: v.body.durationS, template: '' },
    profileStrand: profile ? strandView(profile.strand) : null,
    gate: v.gate,
    publishedPost: pubPost ? specimen(c, pubPost) : null,
    outcomes: c.store.outcomes.all().filter((o) => o.scriptId === id).map((o) => ({ capturedAt: o.capturedAt, ladder: ladderView({ breakout: o.breakout, breakoutLo: null, breakoutHi: null, baselineN: c.measures.get(o.postId)?.baselineN ?? 0, baselineConfidence: c.measures.get(o.postId)?.baselineConfidence ?? 'low' }), depthText: o.depth === null ? null : `${pct1(o.depth)} deep` })),
    publishCandidates: s.status === 'draft'
      ? publishCandidates(c.store, id, 6).flatMap((x) => {
          const p = c.postById.get(x.postId);
          return p ? [{ ...specimen(c, p), similarity: x.similarity, similarityText: x.similarity === null ? null : `${Math.round(x.similarity * 100)}% match` }] : [];
        })
      : [],
  };
}

export function specimenSheet(c: Ctx, postId: string): SpecimenSheet | null {
  const p = c.postById.get(postId);
  if (!p) return null;
  const card = specimen(c, p);
  const d = c.dissections.get(p.id) ?? null;
  const m = c.measures.get(p.id) ?? null;
  const t = c.transcripts.get(p.id) ?? null;
  const snaps = c.store.metrics.forPost(p.id);
  const profile = d ? c.store.profiles.latest().find((x) => x.formatFamily === d.format) ?? null : null;
  let why: WhyLift[] = [];
  if (profile && d && m) {
    const rowFeatures = featuresOf({ post: p, dissection: d, measure: m, transcript: t, clusterId: c.primaryCluster.get(p.id) ?? null });
    why = profile.features
      .filter((f) => f.shown && f.lift !== null && f.lift > 1 && rowFeatures[f.feature] === f.value)
      .sort((a, b) => b.lift! - a.lift!)
      .map((f) => ({ feature: f.feature, featureLabel: FEATURE_LABEL[f.feature] ?? humanize(f.feature), value: f.value, valueLabel: valueLabel(c, f.feature, f.value), lift: f.lift!, liftText: fmtRatio(f.lift)!, n: f.n, lo: f.lo, hi: f.hi }));
  }
  const segments = t && t.status === 'done' && d?.beats.length ? cutTranscript(t.text, d.beats) : [];
  const followersN = c.store.creatorSnapshots.forSource(p.sourceId).filter((s) => s.followers !== null).length;
  return {
    ...card,
    caption: p.caption,
    dissection: d ? { hookForm: d.hookForm, hookFormLabel: humanize(d.hookForm), trigger: d.emotionalTrigger, triggerLabel: humanize(d.emotionalTrigger), channel: d.hookChannel, structure: d.structureType, structureLabel: humanize(d.structureType), pacing: d.pacing, pillar: d.pillar, cta: d.ctaType, firstFrameText: d.firstFrameText, tension: d.tension, confidences: d.confidences, modelId: d.modelId, promptVersion: d.promptVersion } : null,
    topics: c.store.topics.forPost(p.id).map((x) => ({ topic: x.topic, angle: x.angle, isPrimary: x.isPrimary, clusterId: x.clusterId, clusterLabel: x.clusterId ? (c.clusters.get(x.clusterId) ?? null) : null })),
    transcript: t ? { status: t.status, text: t.text, wordCount: t.wordCount, wpm: t.wpm, provider: t.provider, segments } : null,
    snapshots: snaps.map((s) => ({ capturedAt: s.capturedAt, hoursSincePost: p.postedAt ? Math.round(hoursBetween(p.postedAt, s.capturedAt) * 10) / 10 : null, views: s.views, likes: s.likes, comments: s.comments, shares: s.shares, saves: s.saves })),
    // reach and velocity are single-post ratios: "enough" means the denominator is real (a follower read / a launch read)
    reach: measured(m?.reach ?? null, m?.reach != null ? Math.max(MIN_N, followersN) : 0, (v) => `${fmtRatio(v)} their audience`),
    velocity: measured(m?.velocity ?? null, m?.velocity != null ? MIN_N : 0, (v) => `${fmtRatio(v)} the ${PLATFORM_LABEL[p.platform]} pace`),
    baseline: { n: m?.baselineN ?? 0, confidence: m?.baselineConfidence ?? 'low', median: m?.breakout ? (c.latest.get(p.id)?.views ?? 0) / m.breakout : null, ownWeight: m ? Math.min(1, m.baselineN / 10) : null, enough: enough(m?.baselineN ?? 0) },
    why,
    profileId: profile?.id ?? null,
  };
}

/** Split a transcript across beats by word position (a beat at 20-45% gets those words). */
export function cutTranscript(text: string, beats: readonly LabBeat[]): TranscriptSegment[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const n = words.length;
  return normalizeBeats(beats).map((b) => ({ type: b.type, startPct: b.startPct, endPct: b.endPct, token: beatToken(b.type), text: words.slice(Math.round((b.startPct / 100) * n), Math.round((b.endPct / 100) * n)).join(' ') }));
}

export function sourceRows(c: Ctx, kind: LabSourceKind): SourceRow[] {
  return c.store.sources.all(kind).filter((s) => s.status !== 'dismissed').map((s) => {
    const posts = c.posts.filter((p) => p.sourceId === s.id);
    const snaps = c.store.creatorSnapshots.forSource(s.id);
    return {
      id: s.id, kind: s.kind, platform: s.platform, handle: s.handle, displayName: s.displayName || s.handle, url: s.url, status: s.status, addedAt: s.addedAt, reason: s.reason, score: s.score,
      posts: posts.length, breakouts: posts.filter((p) => c.measures.get(p.id)?.isBreakout).length,
      followers: [...snaps].reverse().find((x) => x.followers !== null)?.followers ?? null,
      lastPostAt: posts[0]?.postedAt ?? null,
    };
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.posts - a.posts || a.handle.localeCompare(b.handle));
}

const ACTOR_LANE: Record<string, { lane: string; label: string }> = {
  'apify/instagram-post-scraper': { lane: 'instagram', label: 'Instagram posts' },
  'clockworks/tiktok-scraper': { lane: 'tiktok', label: 'TikTok posts' },
  'streamers/youtube-scraper': { lane: 'youtube', label: 'YouTube videos' },
  'apidojo/tweet-scraper': { lane: 'twitter', label: 'X posts' },
  'harvestapi/linkedin-profile-posts': { lane: 'linkedin', label: 'LinkedIn posts' },
  'apify/instagram-profile-scraper': { lane: 'profile', label: 'Instagram profiles' },
};

export function runRow(r: LabRun): RunRow {
  // the TikTok and YouTube search actors are the post actors: only scrape and profile runs take the actor's lane
  const known = r.actor && (r.kind === 'scrape' || r.kind === 'profile') ? ACTOR_LANE[r.actor] : undefined;
  const lane = known?.lane ?? r.kind;
  return {
    id: r.id, kind: r.kind, actor: r.actor, actorLabel: known?.label ?? humanize(r.kind), lane, status: r.status, items: r.items,
    costUsd: r.costUsd, costText: r.dry ? 'dry' : money(r.costUsd), dry: r.dry, startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationS: r.finishedAt ? Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000) : null, error: r.error,
  };
}

function runStrip(c: Ctx): RunStripView | null {
  const runs = c.store.runs.recent(80);
  if (runs.length === 0) return null;
  const laneOrder = ['instagram', 'tiktok', 'youtube', 'twitter', 'linkedin', 'transcribe', 'dissect', 'distill'];
  const label: Record<string, string> = { instagram: 'IG', tiktok: 'TikTok', youtube: 'YouTube', twitter: 'X', linkedin: 'LinkedIn', transcribe: 'transcribe', dissect: 'dissect', distill: 'profile' };
  const lanes: RunStripView['lanes'] = [];
  for (const lane of laneOrder) {
    const r = runs.find((x) => runRow(x).lane === lane);
    if (!r) continue;
    const status: RunStripView['lanes'][number]['status'] = r.status === 'succeeded' ? 'ok' : r.status === 'running' || r.status === 'queued' ? 'running' : r.status === 'blocked' ? 'blocked' : 'failed';
    const version = lane === 'distill' ? Math.max(0, ...c.store.profiles.latest().map((p) => p.version)) : null;
    lanes.push({ id: lane, label: label[lane], status, detail: version ? `v${version}` : r.items !== null ? `${r.items}` : null, at: r.finishedAt ?? r.startedAt });
  }
  const scrapes = runs.filter((r) => r.kind === 'scrape' && r.status === 'succeeded');
  return { lanes, lastSyncAt: scrapes[0]?.finishedAt ?? null, profileVersion: Math.max(0, ...c.store.profiles.latest().map((p) => p.version)) || null, dry: runs[0]?.dry ?? false };
}

function sourcesView(c: Ctx, mode: LabMode): SourcesView {
  const meter = spendMeter(c.store, c.now);
  const label: Record<string, string> = { apify: 'Apify', stt: 'Transcription', llm: 'Analysis (local claude)' };
  const sched = c.store.priors.get('schedule');
  const sv = sched?.value as { label?: string; nextAt?: string } | null;
  const owned = sourceRows(c, 'owned');
  return {
    owned,
    tracked: sourceRows(c, 'tracked'),
    suggested: sourceRows(c, 'suggested'),
    feeds: sourceRows(c, 'feed'),
    runs: c.store.runs.recent(40).map(runRow),
    spend: {
      ...meter,
      lines: meter.providers.map((p) => ({ provider: p.provider, label: label[p.provider], text: p.cap === null ? `${money(p.spent)} this month, no cap` : `${money(p.spent)} of ${money(p.cap)}`, pct: p.pct })),
    },
    schedule: sv?.label ? { installed: true, label: sv.label, nextAt: sv.nextAt ?? null, agent: 'glados.agent.lab' } : { installed: false, label: 'Not scheduled yet: syncs run when you press Run now', nextAt: null, agent: 'glados.agent.lab' },
    dryNote: mode.dryLabel,
    emptyHint: owned.length === 0 ? 'Add your accounts' : null,
  };
}

function breakoutsView(c: Ctx, f: BreakoutFilters = {}): BreakoutsView {
  const windowDays = f.windowDays && [7, 30, 90].includes(f.windowDays) ? f.windowDays : 30;
  const from = c.now.getTime() - windowDays * DAY;
  const inWindow = c.posts.filter((p) => p.postedAt && Date.parse(p.postedAt) >= from);
  const fmt = (p: LabPost) => c.dissections.get(p.id)?.format ?? null;
  const filtered = inWindow.filter((p) => (!f.format || fmt(p) === f.format) && (!f.platform || p.platform === f.platform) && (!f.quadrant || c.measures.get(p.id)?.quadrant === f.quadrant));
  const count = <K extends string>(key: (p: LabPost) => K | null) => {
    const m = new Map<K, number>();
    for (const p of inWindow) { const k = key(p); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const quadrantCounts = field(c, inWindow).counts;
  const breakouts = filtered.filter((p) => c.measures.get(p.id)?.isBreakout).sort((a, b) => (c.measures.get(b.id)?.breakout ?? 0) - (c.measures.get(a.id)?.breakout ?? 0));
  return {
    field: field(c, filtered),
    filters: {
      formats: [...count(fmt).entries()].map(([id, n]) => ({ id, label: familyLabel(id), n })).sort((a, b) => b.n - a.n),
      platforms: [...count((p) => p.platform).entries()].map(([id, n]) => ({ id, label: PLATFORM_LABEL[id] ?? id, n })).sort((a, b) => b.n - a.n),
      // counted over the plotted population (the Field's points), so a chip matches its corner label
      quadrants: (['ideal', 'loyal', 'clickbait', 'dud'] as const).map((id) => ({ id, label: QUADRANT_LABEL[id], n: quadrantCounts[id] })),
      windows: [7, 30, 90],
    },
    applied: { format: f.format ?? null, platform: f.platform ?? null, quadrant: f.quadrant ?? null, windowDays },
    specimens: breakouts.slice(0, 60).map((p) => specimen(c, p)),
    total: breakouts.length,
  };
}

/** The view for one tab (or every tab with tab 'all'), plus any deep-linked focus. */
export function buildLabView(db: LabStore | { lab: LabStore }, opts: BuildOpts): LabView {
  const store = 'lab' in db ? db.lab : db;
  const now = opts.now ?? new Date();
  const since = opts.since ?? new Date(now.getTime() - 7 * DAY);
  const tab = opts.tab ?? 'today';
  const sample = Boolean(opts.sample);
  const filming = Boolean(opts.filming);
  const empty = store.isEmpty();
  const c = context(store, now, since);

  const competitorMeasured = c.posts.filter((p) => !p.isOwned && (c.measures.get(p.id)?.baselineConfidence ?? 'low') !== 'low').length;
  const anyShown = store.profiles.latest().some((p) => p.features.some((f) => f.shown));
  const state: LabState = !opts.configured && !sample && !filming ? 'not_configured' : empty ? 'empty' : competitorMeasured < 30 || !anyShown ? 'thin' : 'ready';
  const mode: LabMode = {
    state,
    configured: opts.configured,
    sample,
    filming,
    dry: Boolean(opts.dry),
    dryReason: opts.dryReason ?? null,
    dryLabel: opts.dryLabel ?? null,
    setupHref: opts.setupHref,
    fixtureName: opts.fixtureName ?? null,
    defaultTab: state === 'empty' ? 'sources' : 'today',
  };
  const header = { title: 'Content Lab', subtitle: "What's breaking out in your formats, and what to make next.", lastSyncAt: null as string | null, source: 'Apify' as const, agent: { id: 'content-lab' as const, name: opts.agentName ?? 'Content Lab' } };

  const base: LabView = {
    generatedAt: now.toISOString(),
    mode,
    header,
    tabs: LAB_TABS.map((t) => ({ id: t.id, label: t.label, count: null })),
    tab,
    runStrip: null,
    focus: { post: null, idea: null, script: null },
  };
  if (state === 'not_configured') return base;

  const strip = runStrip(c);
  base.runStrip = strip;
  base.header.lastSyncAt = strip?.lastSyncAt ?? null;

  const ideasAll = store.ideas.all();
  const scriptByIdea = new Map(store.scripts.all().filter((s) => s.ideaId).map((s) => [s.ideaId!, s.id]));
  const cards = ideasAll.map((i) => ideaCard(c, i, scriptByIdea)).filter((x): x is IdeaCard => x !== null);
  const openIdeas = cards.filter((i) => i.status === 'open').sort((a, b) => b.fit - a.fit).slice(0, 10);
  const breakoutsAll = c.posts.filter((p) => c.measures.get(p.id)?.isBreakout);
  const profilesLatest = store.profiles.latest();
  const profilesAll = allProfiles(store);
  const scripts = store.scripts.all();

  base.tabs = LAB_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    count: t.id === 'breakouts' ? breakoutsAll.filter((p) => Date.parse(p.postedAt ?? '') >= now.getTime() - 30 * DAY).length : t.id === 'ideas' ? openIdeas.length : t.id === 'scripts' ? scripts.length : t.id === 'sources' ? store.sources.all().filter((s) => s.kind === 'suggested' && s.status === 'active').length || null : null,
  }));

  const want = (t: LabTab) => tab === 'all' || tab === t;
  const profileViews = () => profilesLatest.map((p) => profileView(c, p, profilesAll));

  if (want('today')) {
    const fresh = c.posts.filter((p) => !p.isOwned && c.measures.get(p.id)?.isBreakout && Date.parse(p.postedAt ?? '') >= since.getTime()).sort((a, b) => (c.measures.get(b.id)?.breakout ?? 0) - (c.measures.get(a.id)?.breakout ?? 0));
    const fv = field(c, c.posts.filter((p) => p.postedAt && Date.parse(p.postedAt) >= now.getTime() - 30 * DAY));
    const tv = trendsView(c, ideasAll);
    const hero = profilesLatest[0] ? profileView(c, profilesLatest[0], profilesAll) : null;
    base.today = {
      field: fv,
      heroProfile: hero,
      newBreakouts: fresh.slice(0, 6).map((p) => specimen(c, p)),
      openTrends: tv.rows.filter((r) => r.timing === 'early' || r.timing === 'open').slice(0, 5),
      nextIdeas: openIdeas.slice(0, 3),
      headline: { newBreakouts: fresh.length, strong: fresh.filter((p) => (c.measures.get(p.id)?.breakout ?? 0) >= 5).length, window: 'this week' },
    };
  }
  if (want('breakouts')) base.breakouts = breakoutsView(c, opts.filters);
  if (want('profile')) {
    const views = profileViews();
    base.profile = { profiles: views, selected: (opts.profileFamily && views.some((v) => v.family === opts.profileFamily) ? opts.profileFamily : views[0]?.family) ?? null, dna: dnaView(c) };
  }
  if (want('trends')) base.trends = trendsView(c, ideasAll);
  if (want('ideas')) base.ideas = { open: openIdeas, used: cards.filter((i) => i.status === 'used'), dismissed: cards.filter((i) => i.status === 'dismissed'), openCap: 10 };
  if (want('scripts')) base.scripts = { rows: scripts.map((s) => scriptRow(c, s.id)).filter((x): x is ScriptRow => x !== null) };
  if (want('sources')) base.sources = sourcesView(c, mode);

  base.focus = {
    post: opts.post ? specimenSheet(c, opts.post) : null,
    idea: opts.idea ? (cards.find((i) => i.id === opts.idea) ?? null) : null,
    script: opts.script ? scriptSheet(c, opts.script, scriptByIdea) : null,
  };
  return base;
}

/** One specimen sheet (GET /api/lab/specimen). */
export function buildSpecimen(db: LabStore | { lab: LabStore }, postId: string, opts: { now?: Date; since?: Date } = {}): SpecimenSheet | null {
  const store = 'lab' in db ? db.lab : db;
  const now = opts.now ?? new Date();
  return specimenSheet(context(store, now, opts.since ?? new Date(now.getTime() - 7 * DAY)), postId);
}

/** One script sheet (GET /api/lab/script). */
export function buildLegacyScriptSheet(db: LabStore | { lab: LabStore }, scriptId: string, opts: { now?: Date } = {}): ScriptSheet | null {
  const store = 'lab' in db ? db.lab : db;
  const now = opts.now ?? new Date();
  const scriptByIdea = new Map(store.scripts.all().filter((s) => s.ideaId).map((s) => [s.ideaId!, s.id]));
  return scriptSheet(context(store, now, new Date(now.getTime() - 7 * DAY)), scriptId, scriptByIdea);
}

/* ── Content Lab v2, lane G (07): card builders the generation views reuse (07 7.2) ── */

/** v1 IdeaCards for many ideas at once (one context). Event ideas may carry 0 to 3 evidence posts (07 7.3.4). */
export function ideaCardsFor(store: LabStore, ideas: readonly LabIdea[], opts: { now?: Date; minEvidence?: number } = {}): IdeaCard[] {
  const now = opts.now ?? new Date();
  const c = context(store, now, new Date(now.getTime() - 7 * DAY));
  const scriptByIdea = new Map(store.scripts.all().filter((s) => s.ideaId).map((s) => [s.ideaId!, s.id]));
  return ideas.flatMap((i) => {
    const card = ideaCard(c, i, scriptByIdea, opts.minEvidence ?? (i.eventId || i.source === 'event' ? 0 : 2));
    return card ? [card] : [];
  });
}

/** v1 SpecimenCards for the given posts, in order; unknown ids are skipped. */
export function specimenCardsFor(store: LabStore, postIds: readonly string[], opts: { now?: Date } = {}): SpecimenCard[] {
  const now = opts.now ?? new Date();
  const c = context(store, now, new Date(now.getTime() - 7 * DAY));
  return postIds.flatMap((id) => {
    const p = c.postById.get(id);
    return p ? [specimen(c, p)] : [];
  });
}
/* ── end lane G block ── */
