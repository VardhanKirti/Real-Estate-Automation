/**
 * Cost estimates (09.2.3, 09.2.4, 09.2.7). PURE: no node:*, no lib/db, no lib/lab/store, no
 * fetch, so the browser imports it (AC-09-7, tests/lab-estimate-pure.test.ts) and the plan panel
 * recomputes on every keystroke from SetupView.planner with no network call.
 *
 * The estimator never hard-codes a price. It hard-codes only which events a Lab run triggers,
 * per actor (LAB_ACTORS), and reads every price from the actor's price book (pricing-book.ts).
 */
import type { JobConfig, LabJobId, LabPlatform, LabSpendLine, LabSpendProvider } from '@/lib/schemas';
import { RECORDED_PRICES, RECORDED_PRICES_DATE, TIER_PLAN_LABEL, priceOf, type ActorPriceBook, type ApifyTier, type PriceSource } from '@/lib/lab/setup/pricing-book';
import type { ActorCalibration } from '@/lib/lab/setup/calibration';
import type { GateRates } from '@/lib/lab/setup/gates';
import { DEFAULT_JOB_CONFIG, runsIn30Days } from '@/lib/lab/setup/schedule';

export type RunSpec = {
  actorId: string;
  line: LabSpendLine;
  /** known = A_h */
  targets: { handle: string; limit: number; known: number | null }[];
  /** tweet scraper */
  queries?: number;
  /** instagram-post-scraper dataDetailLevel, default true */
  detailed?: boolean;
  /** tiktok */
  downloadVideos?: boolean;
  memoryMb?: number;
  /** what the gate would send now */
  reserveUsd?: number;
};

/** Which events a Lab run triggers, per actor (09.2.3). */
export type EventRule =
  | { kind: 'per_run'; event: string }
  | { kind: 'per_run_gb'; event: string }
  | { kind: 'per_item'; event: string; when?: (s: RunSpec) => boolean }
  | { kind: 'per_empty_target'; event: string }
  | { kind: 'per_minute'; event: string; when: (s: RunSpec) => boolean };

/** 09.2.3, as data. Lane R adds its two radar actors (rastriq/tiktok-trends-scraper, s-r/producthunt-launches) with their own rules (09.11). */
export const LAB_ACTORS: Record<string, { rules: EventRule[]; minBilledPerQuery?: number }> = {
  'apify/instagram-post-scraper': { rules: [{ kind: 'per_item', event: 'post' }, { kind: 'per_item', event: 'post-details', when: (s) => s.detailed !== false }] },
  'apify/instagram-profile-scraper': { rules: [{ kind: 'per_item', event: 'profile' }] },
  'clockworks/tiktok-scraper': { rules: [{ kind: 'per_run', event: 'actor-start' }, { kind: 'per_item', event: 'result' }, { kind: 'per_item', event: 'video-download', when: (s) => s.downloadVideos === true }] },
  'streamers/youtube-scraper': { rules: [{ kind: 'per_item', event: 'result' }] },
  'harvestapi/linkedin-profile-posts': { rules: [{ kind: 'per_run_gb', event: 'apify-actor-start' }, { kind: 'per_item', event: 'post' }, { kind: 'per_empty_target', event: 'no-result' }] },
  'apidojo/tweet-scraper': { rules: [{ kind: 'per_item', event: 'apify-default-dataset-item' }], minBilledPerQuery: 50 },
  'apify/instagram-comment-scraper': { rules: [{ kind: 'per_item', event: 'comment' }] },
  'clockworks/tiktok-comments-scraper': { rules: [{ kind: 'per_item', event: 'result' }] },
  'streamers/youtube-comments-scraper': { rules: [{ kind: 'per_item', event: 'result' }] },
  'apify/instagram-hashtag-scraper': { rules: [{ kind: 'per_item', event: 'result' }] },
};

/** Actors that allow one concurrent run per account (09.1.3 item 5, 09.5.3 guard). */
export const SINGLE_RUN_ACTORS: readonly string[] = ['apidojo/tweet-scraper'];

/** The post actor per platform (v1 POST_ACTORS ids, kept here so this file stays pure). */
export const POST_ACTOR_IDS: Record<LabPlatform, string> = {
  instagram: 'apify/instagram-post-scraper',
  tiktok: 'clockworks/tiktok-scraper',
  youtube: 'streamers/youtube-scraper',
  linkedin: 'harvestapi/linkedin-profile-posts',
  twitter: 'apidojo/tweet-scraper',
};

export type RunEstimate = {
  actorId: string;
  line: LabSpendLine;
  /** known false = search or tweets */
  items: { expected: number; low: number; high: number; known: boolean };
  usd: { low: number; point: number; high: number; ceiling: number | null };
  /** the point estimate's breakdown */
  events: { name: string; count: number; usd: number }[];
  tier: ApifyTier;
  tierSource: 'account' | 'assumed';
  priceSource: PriceSource;
  priceDate: string;
  calibrated: { n: number; applied: boolean };
  state: 'ok' | 'model_stale' | 'needs_headroom' | 'off';
  priceChange: { startsAt: string; fromUsd: number; toUsd: number } | null;
};

export type PlanSelection = {
  tracked: { platform: LabPlatform; count: number; postsPerWeek?: number }[];
  owned: { platform: LabPlatform; count: number }[];
  /** SCRAPE_DEPTH unless edited */
  depth: { first: number; cycle: number };
  addOns: { tiktokDownloads: boolean; comments: boolean };
  /** current config when not editing */
  schedule: Record<LabJobId, JobConfig>;
  /** creators added this month (backfill) */
  newThisMonth: { platform: LabPlatform; count: number }[];
};

export type PlanEstimate = {
  perRun: RunEstimate[];
  perJob: { job: LabJobId; runsPerMonth: number; usd: { low: number; point: number; high: number } }[];
  perLine: { line: LabSpendLine; usd: { low: number; point: number; high: number }; cap: number | null; fit: 'fits' | 'tight' | 'over'; stopDay: number | null }[];
  month: { low: number; point: number; high: number };
  /** first reads of new creators */
  backfillOnce: number;
  /** 09.8 'Live prices for your Starter plan' etc. */
  label: string;
};

/** What SetupView ships to the browser (09.2.7). `tier` is resolveTier()'s return. */
export type PlanInputs = {
  books: Record<string, ActorPriceBook>;
  tier: { tier: ApifyTier; planId: string | null; source: 'account' | 'assumed'; checkedAt: string | null };
  calibration: Record<string, ActorCalibration>;
  lineCaps: Record<LabSpendLine, number | null>;
  providerCaps: Record<LabSpendProvider, number | null>;
  spentThisMonth: Record<LabSpendLine, number>;
  current: PlanSelection;
  rates: GateRates;
  now: string;
  tz: string;
};

/* ── calibration factors (09.2.5) ─────────────────────────────────────────── */

/** Settled runs needed before calibration applies. */
export const CALIBRATION_MIN_N = 5;
/** Shrinkage: k = 1 + (n / (n + 5)) x (k_obs - 1); one strange run moves the next estimate a sixth of the way. */
export const shrink = (n: number, kObs: number, prior = 1): number => prior + (n / (n + 5)) * (kObs - prior);

/** The volume and price factors an estimate applies (all 1, prior v_lo 0.8, under n 5). */
export function calibrationFactors(cal: ActorCalibration | null, unknownCount: boolean): { vLo: number; vMed: number; kLo: number; kMed: number; kHi: number; applied: boolean; n: number } {
  const vPrior = unknownCount ? 0.5 : 1;
  const vLoPrior = unknownCount ? 0.4 : 0.8;
  const n = cal?.n ?? 0;
  if (!cal || n < CALIBRATION_MIN_N) return { vLo: vLoPrior, vMed: vPrior, kLo: 1, kMed: 1, kHi: 1, applied: false, n };
  const vMed = cal.volume ? shrink(n, cal.volume.med, vPrior) : vPrior;
  const vLo = cal.volume ? shrink(n, cal.volume.p10, vLoPrior) : vLoPrior;
  const kMed = cal.price ? shrink(n, cal.price.med) : 1;
  const kHi = cal.price ? shrink(n, cal.price.p90) : 1;
  return { vLo: Math.min(vLo, vMed), vMed, kLo: Math.min(1, kMed), kMed, kHi: Math.max(1, kHi), applied: Boolean(cal.volume || cal.price), n };
}

/* ── one run (09.2.4) ─────────────────────────────────────────────────────── */

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** The book an estimate prices from: `book`, or the recorded book when an event a rule names is missing (model_stale). */
function bookFor(spec: RunSpec, book: ActorPriceBook): { book: ActorPriceBook; stale: boolean } {
  const rules = LAB_ACTORS[spec.actorId]?.rules ?? [];
  const names = new Set(book.events.map((e) => e.name));
  const missing = rules.some((r) => !names.has(r.event) && ruleOn(r, spec));
  if (!missing) return { book, stale: false };
  const recorded = RECORDED_PRICES[spec.actorId];
  return { book: recorded ?? book, stale: true };
}

const ruleOn = (r: EventRule, s: RunSpec): boolean => (r.kind === 'per_item' ? (r.when ? r.when(s) : true) : r.kind === 'per_minute' ? r.when(s) : true);

/**
 * Estimate one run (one actor, one input) for a tier, with this actor's calibration (or null).
 * Low and point bill the expected items; the high bound bills maxItems, and for the tweet scraper
 * at least 50 per query (09.2.4, LC-09-3).
 */
export function estimateRun(spec: RunSpec, inBook: ActorPriceBook, tier: ApifyTier, cal: ActorCalibration | null): RunEstimate {
  const { book, stale } = bookFor(spec, inBook);
  const model = LAB_ACTORS[spec.actorId] ?? { rules: [{ kind: 'per_item', event: book.events.find((e) => e.primary)?.name ?? 'result' }] as EventRule[] };
  const price = (name: string) => {
    const e = book.events.find((x) => x.name === name);
    return e ? priceOf(e, tier).usd : 0;
  };
  const queries = Math.max(1, spec.queries ?? (model.minBilledPerQuery ? spec.targets.length : 1));
  const M = spec.targets.reduce((a, t) => a + Math.max(0, t.limit), 0);
  const unknownCount = Boolean(model.minBilledPerQuery) || spec.targets.some((t) => t.known === null);
  const known = !model.minBilledPerQuery;
  const E = model.minBilledPerQuery ? M : spec.targets.reduce((a, t) => a + Math.min(t.limit, t.known ?? t.limit), 0);
  const Z = spec.targets.filter((t) => t.known === 0).length;
  const memGB = Math.max(1, Math.ceil((spec.memoryMb ?? book.defaultMemoryMb) / 1024));
  const f = calibrationFactors(cal, Boolean(model.minBilledPerQuery));

  const perRunUsd = model.rules.reduce((a, r) => a + (r.kind === 'per_run' ? price(r.event) : r.kind === 'per_run_gb' ? memGB * price(r.event) : 0), 0);
  const perItemUsd = model.rules.reduce((a, r) => a + (r.kind === 'per_item' && ruleOn(r, spec) ? price(r.event) : 0), 0);
  const emptyUsd = model.rules.reduce((a, r) => a + (r.kind === 'per_empty_target' ? Z * price(r.event) : 0), 0);
  const billed = (x: number, high: boolean) => (high && model.minBilledPerQuery ? queries * Math.max(x / queries, model.minBilledPerQuery) : x);
  const C = (x: number, high = false) => perRunUsd + billed(x, high) * perItemUsd + emptyUsd;

  const xPt = E * f.vMed;
  const xLo = E * f.vLo;
  const xHi = M;
  const low = r6(C(xLo) * f.kLo);
  const point = r6(C(xPt) * f.kMed);
  let high = r6(C(xHi, true) * f.kHi);
  const ceiling = spec.reserveUsd ?? null;
  if (ceiling !== null) high = Math.min(high, ceiling);

  const events: RunEstimate['events'] = [];
  for (const r of model.rules) {
    let count = 0;
    if (r.kind === 'per_run') count = 1;
    else if (r.kind === 'per_run_gb') count = memGB;
    else if (r.kind === 'per_item' && ruleOn(r, spec)) count = xPt;
    else if (r.kind === 'per_empty_target') count = Z;
    if (count > 0) events.push({ name: r.event, count: r6(count), usd: r6(count * price(r.event) * f.kMed) });
  }

  let priceChange: RunEstimate['priceChange'] = null;
  if (book.next) {
    const primary = book.events.find((e) => e.primary) ?? book.events[0];
    const nextPrimary = primary ? book.next.events.find((e) => e.name === primary.name) : undefined;
    if (primary && nextPrimary) {
      const fromUsd = priceOf(primary, tier).usd;
      const toUsd = priceOf(nextPrimary, tier).usd;
      if (fromUsd !== toUsd) priceChange = { startsAt: book.next.startsAt, fromUsd, toUsd };
    }
  }
  const needs = book.minMaxTotalChargeUsd !== null && spec.reserveUsd !== undefined && book.minMaxTotalChargeUsd > spec.reserveUsd + 1e-9;
  return {
    actorId: spec.actorId,
    line: spec.line,
    items: { expected: r6(xPt), low: r6(xLo), high: xHi, known: known && !unknownCount },
    usd: { low, point, high, ceiling },
    events,
    tier,
    tierSource: 'assumed',
    priceSource: stale ? 'recorded' : book.source,
    priceDate: (stale ? RECORDED_PRICES_DATE : book.fetchedAt ?? book.entryStartedAt ?? RECORDED_PRICES_DATE).slice(0, 10),
    calibrated: { n: f.n, applied: f.applied },
    state: stale ? 'model_stale' : needs ? 'needs_headroom' : 'ok',
    priceChange,
  };
}

/* ── a plan, a month (09.2.4) ─────────────────────────────────────────────── */

/** Owned slots and tracked reads over 30 days from the sync config (default: 4 slots a day, tracked once a day). */
export function syncRunsPerMonth(cfg: JobConfig, from: Date, tz: string): { owned: number; tracked: number } {
  const slots = runsIn30Days(cfg, 'sync', from, tz);
  if (slots === 0) return { owned: 0, tracked: 0 };
  const trackedEveryH = cfg.params?.trackedEveryH ?? 20;
  const slotSpacingH = (30 * 24) / slots;
  const every = Math.max(1, Math.ceil(trackedEveryH / slotSpacingH - 1e-9));
  return { owned: slots, tracked: Math.floor(slots / every) };
}

/** Posts read per creator each cycle: min(first, max(cycle, young + 1)), young = posts under 14 days = 2 x posts a week. */
export const cycleDepth = (depth: { first: number; cycle: number }, postsPerWeek: number): number => Math.min(depth.first, Math.max(depth.cycle, Math.round(2 * postsPerWeek) + 1));

/** A sync run spec for `count` creators on one platform at `limit` posts each. */
export function syncRunSpec(platform: LabPlatform, count: number, limit: number, opts: { downloadVideos?: boolean } = {}): RunSpec {
  return {
    actorId: POST_ACTOR_IDS[platform],
    line: 'apify.sync',
    targets: Array.from({ length: count }, (_, k) => ({ handle: `${platform}-${k}`, limit, known: null })),
    ...(platform === 'twitter' ? { queries: count } : {}),
    downloadVideos: platform === 'tiktok' ? Boolean(opts.downloadVideos) : undefined,
  };
}

const add = (a: { low: number; point: number; high: number }, b: { low: number; point: number; high: number }, k = 1) => ({ low: a.low + b.low * k, point: a.point + b.point * k, high: a.high + b.high * k });
const ZERO = { low: 0, point: 0, high: 0 };
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const r4u = (u: { low: number; point: number; high: number }) => ({ low: r4(u.low), point: r4(u.point), high: r4(u.high) });

/**
 * Cap fit of a month on one line (09.2.4): fits at or under 80% of the cap, tight at or under it,
 * over above it with the day the line stops (first day d where spent + d x dailyPoint > cap).
 */
export function capFit(monthPoint: number, cap: number | null, opts: { spentOther?: number; spentSoFar?: number; days?: number } = {}): { fit: 'fits' | 'tight' | 'over'; stopDay: number | null } {
  if (cap === null) return { fit: 'fits', stopDay: null };
  const total = monthPoint + (opts.spentOther ?? 0);
  if (total <= 0.8 * cap + 1e-9) return { fit: 'fits', stopDay: null };
  if (total <= cap + 1e-9) return { fit: 'tight', stopDay: null };
  const days = opts.days ?? 30;
  const daily = monthPoint / days;
  const base = opts.spentSoFar ?? opts.spentOther ?? 0;
  let stopDay: number | null = null;
  if (daily > 0) for (let d = 1; d <= days; d++) if (base + d * daily > cap + 1e-9) { stopDay = d; break; }
  return { fit: 'over', stopDay };
}

/** The price label of 09.8 for the plan panel and the run confirm. */
export function priceLabel(inputs: Pick<PlanInputs, 'tier' | 'books'>, opts: { sample?: boolean } = {}): string {
  if (opts.sample) return 'Sample prices. Nothing runs or spends here.';
  if (inputs.tier.source === 'assumed') return "Free-plan prices. Paste your Apify key to use your plan's prices.";
  const books = Object.values(inputs.books);
  if (books.length && books.every((b) => b.source === 'recorded')) return `Prices recorded on ${fmtDay(RECORDED_PRICES_DATE, true)}.`;
  const cached = books.filter((b) => b.source === 'cached' && b.fetchedAt).map((b) => b.fetchedAt!).sort()[0];
  if (cached) return `Prices from ${fmtDay(cached, false)}; Apify did not answer since.`;
  return `Live prices for your ${TIER_PLAN_LABEL[inputs.tier.tier]} plan`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'd MMM' or 'd MMM yyyy' of an ISO date (UTC calendar date). */
export function fmtDay(iso: string, year: boolean): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** Posts a week assumed for a creator without history (09.3.3 prior f). */
export const DEFAULT_POSTS_PER_WEEK = 4;

/**
 * Price a selection over a month (09.2.4): tracked reads at their cycle depth, owned reads every
 * sync slot, and the first 50-post reads of creators added this month (once). Every number comes
 * from the price books in `inputs`; the browser runs this on each edit.
 */
export function estimatePlan(inputs: PlanInputs, sel: PlanSelection): PlanEstimate {
  const now = new Date(inputs.now);
  const tier = inputs.tier.tier;
  const book = (id: string) => inputs.books[id] ?? RECORDED_PRICES[id];
  const cal = (id: string) => inputs.calibration[id] ?? null;
  const est = (spec: RunSpec): RunEstimate => {
    const b = book(spec.actorId);
    const e = b ? estimateRun(spec, b, tier, cal(spec.actorId)) : estimateRun(spec, { actorId: spec.actorId, model: 'FREE', entryStartedAt: RECORDED_PRICES_DATE, events: [], minMaxTotalChargeUsd: null, defaultMemoryMb: 1024, next: null, source: 'recorded', fetchedAt: null }, tier, null);
    return { ...e, tierSource: inputs.tier.source, priceChange: e.priceChange && Date.parse(e.priceChange.startsAt) - now.getTime() <= 31 * 86_400_000 ? e.priceChange : null };
  };
  const syncCfg = sel.schedule.sync ?? DEFAULT_JOB_CONFIG;
  const runs = syncRunsPerMonth(syncCfg, now, inputs.tz);
  const depth = { first: sel.depth.first, cycle: syncCfg.params?.cycleDepth ?? sel.depth.cycle };
  const downloads = sel.addOns.tiktokDownloads;

  const perRun: RunEstimate[] = [];
  let syncMonth = { ...ZERO };
  for (const t of sel.tracked) {
    if (t.count <= 0) continue;
    const e = est(syncRunSpec(t.platform, t.count, cycleDepth(depth, t.postsPerWeek ?? DEFAULT_POSTS_PER_WEEK), { downloadVideos: downloads }));
    perRun.push(e);
    syncMonth = add(syncMonth, e.usd, runs.tracked);
  }
  for (const o of sel.owned) {
    if (o.count <= 0) continue;
    const e = est(syncRunSpec(o.platform, o.count, cycleDepth(depth, DEFAULT_POSTS_PER_WEEK), { downloadVideos: downloads }));
    perRun.push(e);
    syncMonth = add(syncMonth, e.usd, runs.owned);
  }
  let backfillOnce = 0;
  for (const n of sel.newThisMonth) {
    if (n.count <= 0) continue;
    backfillOnce += est(syncRunSpec(n.platform, n.count, depth.first, { downloadVideos: downloads })).usd.point;
  }

  const perJob: PlanEstimate['perJob'] = [{ job: 'sync', runsPerMonth: runs.owned, usd: r4u(syncMonth) }];
  const syncLineCap = inputs.lineCaps['apify.sync'] ?? null;
  const fit = capFit(syncMonth.point, syncLineCap);
  const perLine: PlanEstimate['perLine'] = [{ line: 'apify.sync', usd: r4u(syncMonth), cap: syncLineCap, fit: fit.fit, stopDay: fit.stopDay }];
  return {
    perRun,
    perJob,
    perLine,
    month: r4u(syncMonth),
    backfillOnce: r4(backfillOnce),
    label: priceLabel(inputs),
  };
}

/** runsPerMonth(job, config) of 09.2.4 for the clock-driven jobs. */
export function runsPerMonth(job: LabJobId, cfg: JobConfig, from: Date, tz: string): number {
  return runsIn30Days(cfg, job, from, tz);
}
