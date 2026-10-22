/**
 * The Setup domain view (08.3.1, 08.5.4, 08.6.5; 09's planner, gates, forecastRecord). 01 D13:
 * the domain view lives here and belongs to lane S; 01's SetupSheetView wraps it unchanged.
 * Building it never makes a network call (AC-08-9): network health comes from its cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@/lib/brand';
import { readEnvLocal } from '@/lib/creds';
import { LAB_RADAR_SOURCES, LAB_SPEND_LINES, LAB_SPEND_PROVIDERS, providerOf, type LabJobId, type LabRadarSource, type LabRunKind, type LabSourceKind, type LabSpendLine, type LabSpendProvider } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { SourceRow } from '@/lib/lab/view/legacy';
import { PLATFORM_LABEL } from '@/lib/lab/view/legacy';
import { PROVIDER_FLAGS, capEnvFor, capFor, isGeneralLine, lineCapFor, lineOffReason, monthStart } from '@/lib/lab/spend';
import { automationDirs, pausedBy, LAB_AGENT_LABEL, TICK_LABEL } from '@/lib/lab/schedule';
import { labBrainRoot } from '@/lib/lab/brain';
import { isDry } from '@/lib/lab/dry';
import { checklistView, type ChecklistView } from '@/lib/lab/setup/checklist';
import type { LabKeyRow } from '@/lib/lab/setup/keys';
import { keyRows } from '@/lib/lab/setup/key-rows';
import { healthResults, type LabHealthResult, type LabHealthState } from '@/lib/lab/setup/health';
import { JOB_PRESETS, activePreset, isPresetJob, jobConfig, nextRuns, runsIn30Days, type ScheduleJobRow } from '@/lib/lab/setup/schedule';
import { estimatePlan, priceLabel, type PlanInputs } from '@/lib/lab/setup/estimate';
import { gateCounts, predictGates, type GateEta } from '@/lib/lab/setup/gates';
import { forecastRecord, gateAdjust, type ForecastRecord } from '@/lib/lab/setup/forecasts';
import { planInputs } from '@/lib/lab/setup/planner';
import { isPrivateInstance } from '@/lib/lab/setup/instance';
import { LAB_JOBS, jobState } from '@/lib/lab/setup/jobs';

/** A source row in Setup > Sources: v1's SourceRow (08.3.1 calls it LabSourceRow). */
export type LabSourceRow = SourceRow;

export type SourcesSetupView = {
  owned: LabSourceRow[];
  tracked: LabSourceRow[];
  suggested: LabSourceRow[];
  /** X watch list (kind 'watch', platform 'x') */
  watch: LabSourceRow[];
  /** 05 LAB_RADAR_SOURCES; off list = lab_priors 'radar:disabled' */
  radarSources: { id: LabRadarSource; enabled: boolean; lastOkAt: string | null; state: LabHealthState }[];
  feeds: { id: string; label: string; enabled: boolean; lastOkAt: string | null; state: LabHealthState }[];
};

/** 08.5.4 */
export type ScheduleView = {
  /** prior 'schedule' present */
  installed: boolean;
  /** "Every 15 minutes on this machine" | "Not scheduled yet" */
  label: string;
  /** 'glados.agent.lab' on GladOS; null on FounderOS */
  agentLabel: string | null;
  heartbeat: LabHealthResult;
  paused: { by: string | null; scope: 'lab' | 'all' | null };
  /** 09.5.5 */
  jobs: ScheduleJobRow[];
  /** LAB_BRIEF_TELEGRAM === '1'; default false */
  brief: { telegram: boolean };
  privateInstance: boolean;
};

/** 08.6.5 */
export type SpendView = {
  /** 'YYYY-MM' */
  month: string;
  dry: boolean;
  providers: {
    provider: LabSpendProvider; label: string; enabled: boolean; offReason: string | null;
    spent: number; reserved: number; cap: number | null; pct: number | null; unsettled: number;
    /** 08.16 "Line caps add to ..." */
    lineCapSum: number | null; capWarning: string | null;
    lines: { line: LabSpendLine; label: string; enabled: boolean; offReason: string | null; spent: number; reserved: number; cap: number | null; pct: number | null; unsettled: number; priceNote: string; thinned: boolean }[];
  }[];
  blocked: { runId: string; line: LabSpendLine; scope: 'line' | 'provider'; message: string; at: string } | null;
  /** newest 50 */
  runs: { id: string; at: string; kind: LabRunKind; line: LabSpendLine | null; actor: string | null; items: number | null; costUsd: number | null; actualSource: 'provider' | 'published_price' | 'dry' | null; status: string; scheduled: boolean; job: LabJobId | null; error: string | null }[];
  /** sum over providers, settled + reserved */
  monthTotal: number;
};

/** 08.3.1 */
export type SetupView = {
  /** BRAND.name; isClient = BRAND.id === 'founderos' */
  brand: { name: string; isClient: boolean };
  mode: { dry: boolean; dryLabel: string | null; sample: boolean; filming: boolean; readOnly: boolean };
  checklist: ChecklistView;
  /** in LAB_KEYS order */
  keys: LabKeyRow[];
  sources: SourcesSetupView;
  schedule: ScheduleView;
  spend: SpendView;
  health: LabHealthResult[];
  /** 09.2.7: the browser runs estimatePlan and predictGates on it */
  planner: PlanInputs;
  /** 09.3.8 predictGates for the current selection */
  gates: GateEta[];
  /** 09.3.6, the same value 06's LedgerView carries */
  forecastRecord: ForecastRecord;
  /** the section the URL asked for (`?setup=<section>`), or the default (08.3) */
  focus: SetupSection;
  /** 08.16 strings the sheet shows with this view */
  notes: { brainInDry: string | null; checklistComplete: string | null; ownedHeader: string | null };
};

export const SETUP_SECTIONS = ['checklist', 'keys', 'sources', 'schedule', 'spend'] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

export type SetupViewOpts = { now?: Date; dry?: boolean; dryLabel?: string | null; sample?: boolean; filming?: boolean; readOnly?: boolean; section?: string | null; env?: Record<string, string | undefined> };

/* ── labels (08.6.5, 09.5.2) ──────────────────────────────────────────────── */

export const PROVIDER_LABEL: Record<LabSpendProvider, string> = { apify: 'Apify', stt: 'Speech to text', comments: 'Comments', downloads: 'Video downloads', embed: 'Embeddings', llm: 'Local claude CLI' };
export const LINE_LABEL: Record<LabSpendLine, string> = {
  'apify.sync': 'Daily sync',
  'apify.snapshots': 'Your posts at fixed ages',
  'apify.x': 'Your X posts',
  'apify.verify': 'Actor checks',
  'apify.radar_x': 'Radar: X watch list',
  'apify.radar_tiktok': 'Radar: TikTok Creative Center',
  'apify.radar_producthunt': 'Radar: Product Hunt',
  stt: 'Your posts and breakouts',
  'stt.controls': 'Comparison posts',
  comments: 'Comments',
  downloads: 'Video downloads',
  embed: 'Embeddings',
  llm: 'Local claude CLI',
};
const PRICE_NOTE: Record<LabSpendLine, string> = {
  'apify.sync': "Priced from Apify's published event prices for your plan.",
  'apify.snapshots': "Priced from Apify's published event prices for your plan.",
  'apify.x': '$0.40 per 1,000 tweets, 50 at least per query.',
  'apify.verify': 'About $0.40 once.',
  'apify.radar_x': '$0.40 per 1,000 tweets, one combined query per poll.',
  'apify.radar_tiktok': '$1.00 per 1,000 hashtags plus $0.025 a start.',
  'apify.radar_producthunt': '$0.00075 a row plus $0.002 a run, only without a Product Hunt token.',
  stt: 'from the published price',
  'stt.controls': 'from the published price',
  comments: "Priced from the comment actors' published prices.",
  downloads: "Priced from TikTok's published video-download price.",
  embed: 'from the published price',
  llm: '$0, runs on this machine',
};

export const JOB_LABEL: Record<LabJobId, { label: string; what: string }> = {
  advance: { label: 'Finish running scrapes', what: 'Reads finished Apify runs and saves their posts.' },
  'measure.verdicts': { label: 'Measures and verdicts', what: 'Recomputes ratios and picks comparison posts after new reads.' },
  health: { label: 'Health checks', what: 'Checks every key and refreshes Apify prices, every 6 hours.' },
  'radar.vendor': { label: 'Radar: vendor feeds', what: 'AI vendor blogs and changelogs, every 15 minutes.' },
  'radar.hn': { label: 'Radar: Hacker News', what: 'Launch posts on Hacker News, every 30 minutes.' },
  'radar.hf_models': { label: 'Radar: Hugging Face models', what: 'Trending models, hourly.' },
  'radar.hf_spaces': { label: 'Radar: Hugging Face Spaces', what: 'Trending Spaces, hourly.' },
  'radar.github': { label: 'Radar: GitHub', what: 'New repositories gaining stars, hourly.' },
  'radar.x': { label: 'Radar: X watch list', what: 'X watch list, one combined query' },
  'radar.producthunt': { label: 'Radar: Product Hunt', what: 'Product Hunt launches (actor path only)' },
  'radar.tiktok_cc': { label: 'Radar: TikTok Creative Center', what: 'TikTok Creative Center trends' },
  'radar.wikipedia': { label: 'Radar: Wikipedia', what: 'Page views for launch names, daily.' },
  'radar.events': { label: 'Radar: events', what: 'Groups signals into launches and windows, every tick.' },
  brief: { label: 'Morning brief', what: 'Composes the brief at 07:30.' },
  snapshots: { label: 'Your posts at fixed ages', what: 'Your new posts every 2 h, then reads at fixed ages' },
  'ledger.early': { label: 'Early forecasts', what: 'Freezes early forecasts for your newest posts.' },
  sync: { label: 'Daily sync', what: 'Your accounts each slot, tracked creators once a day, 15 newest posts each (50 the first time)' },
  analyse: { label: 'Transcribe and dissect', what: 'Transcribes and dissects new posts after a scrape.' },
  'gen.embed': { label: 'Embeddings', what: 'Indexes transcripts, ideas and comments for Ask the Lab.' },
  'gen.frames': { label: 'Frame contact sheets', what: 'Six frames per video for dissection.' },
  'gen.comments': { label: 'Comments', what: 'Comments on selected posts' },
  intel: { label: 'Intel', what: 'Profiles, topics and ideas after new dissections.' },
  discover: { label: 'Discovery', what: 'Keyword and hashtag search for new creators' },
  ledger: { label: 'Ledger', what: 'Grades predictions and refreshes tokens at 03:30.' },
};

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const usd = (x: number) => `$${x.toFixed(2)}`;

/* ── sources (08.3.1) ─────────────────────────────────────────────────────── */

function sourceRows(store: LabStore, kind: LabSourceKind): LabSourceRow[] {
  return store.sources.all(kind).filter((s) => s.status !== 'dismissed').map((s) => {
    const posts = store.posts.bySource(s.id);
    const snaps = store.creatorSnapshots.forSource(s.id);
    return {
      id: s.id, kind: s.kind, platform: s.platform, handle: s.handle, displayName: s.displayName || s.handle, url: s.url, status: s.status, addedAt: s.addedAt, reason: s.reason, score: s.score,
      posts: posts.length, breakouts: posts.filter((p) => store.measures.get(p.id)?.isBreakout).length,
      followers: [...snaps].reverse().find((x) => x.followers !== null)?.followers ?? null,
      lastPostAt: posts.map((p) => p.postedAt ?? '').sort().pop() || null,
    };
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.posts - a.posts || a.handle.localeCompare(b.handle));
}

function sourcesView(store: LabStore, health: LabHealthResult[]): SourcesSetupView {
  const disabled = new Set(((store.priors.get('radar:disabled')?.value as unknown) ?? []) as string[]);
  const intel = jobState(store, 'intel');
  return {
    owned: sourceRows(store, 'owned'),
    tracked: sourceRows(store, 'tracked'),
    suggested: sourceRows(store, 'suggested'),
    watch: sourceRows(store, 'watch'),
    radarSources: LAB_RADAR_SOURCES.map((id) => ({ id, enabled: !disabled.has(id), lastOkAt: jobState(store, `radar.${id}`).lastOkAt, state: health.find((h) => h.id === `radar.${id}`)?.state ?? 'not_configured' })),
    feeds: store.sources.all('feed').map((s) => ({ id: s.id, label: PLATFORM_LABEL[s.platform] ?? s.platform, enabled: s.status === 'active', lastOkAt: intel.lastOkAt, state: (s.status === 'active' ? 'ok' : 'off') as LabHealthState })),
  };
}

/* ── spend (08.6.5) ───────────────────────────────────────────────────────── */

const linesOf = (p: LabSpendProvider) => LAB_SPEND_LINES.filter((l) => providerOf(l) === p);

export function spendView(store: LabStore, now: Date, opts: { dry: boolean; env?: Record<string, string | undefined> }): SpendView {
  const env = opts.env ?? { ...process.env, ...readEnvLocal() };
  const since = monthStart(now);
  const rows = store.spend.since(since).filter((s) => !s.dry);
  const sum = (xs: typeof rows, f: (r: (typeof rows)[number]) => number) => r4(xs.reduce((a, r) => a + f(r), 0));
  const settledUsd = (r: (typeof rows)[number]) => (r.actualUsd !== null ? r.actualUsd : 0);
  const pendingUsd = (r: (typeof rows)[number]) => (r.actualUsd === null ? r.estUsd ?? r.reservedUsd ?? 0 : 0);
  const providers = LAB_SPEND_PROVIDERS.map((provider) => {
    const pr = rows.filter((r) => r.provider === provider);
    const cap = capFor(provider, env);
    const flag = PROVIDER_FLAGS[provider];
    const offReason = flag && !flag.on(env[flag.env]) ? `Off. Turn on with ${flag.env} and a cap above $0.` : cap === 0 ? `Off. Turn on with ${capEnvFor(provider)} above $0.` : null;
    const spent = sum(pr, settledUsd);
    const reserved = sum(pr, pendingUsd);
    const subLines = linesOf(provider).filter((l) => !isGeneralLine(l));
    const lineCaps = subLines.map((l) => lineCapFor(l, env)).filter((x): x is number => x !== null);
    const lineCapSum = lineCaps.length ? r4(lineCaps.reduce((a, b) => a + b, 0)) : null;
    const capWarning = cap !== null && lineCapSum !== null && cap < lineCapSum ? `Line caps add to ${usd(lineCapSum)} but the ${PROVIDER_LABEL[provider]} cap is ${usd(cap)}. Lines stop when the ${PROVIDER_LABEL[provider]} cap is reached.` : null;
    const showLines = linesOf(provider).length > 1 ? linesOf(provider) : [];
    const lines = showLines.map((line) => {
      const lr = pr.filter((r) => (r.line ?? (provider === 'apify' ? 'apify.sync' : provider)) === line);
      const lcap = lineCapFor(line, env);
      const lspent = sum(lr, settledUsd);
      const lres = sum(lr, pendingUsd);
      const off = lineOffReason(line, { env, store });
      return {
        line, label: LINE_LABEL[line], enabled: off === null, offReason: off, spent: lspent, reserved: lres, cap: lcap,
        pct: lcap ? Math.min(1, (lspent + lres) / lcap) : null, unsettled: lr.filter((r) => r.actualUsd === null).length,
        priceNote: PRICE_NOTE[line], thinned: line === 'apify.snapshots' && lcap !== null && lcap > 0 && lspent + lres >= 0.8 * lcap,
      };
    });
    return { provider, label: PROVIDER_LABEL[provider], enabled: offReason === null, offReason, spent, reserved, cap, pct: cap ? Math.min(1, (spent + reserved) / cap) : null, unsettled: pr.filter((r) => r.actualUsd === null).length, lineCapSum, capWarning, lines };
  });
  const blockedRun = store.runs.recent(300).find((r) => r.status === 'blocked' && r.startedAt >= since) ?? null;
  const sources = new Map(store.spend.all().filter((s) => s.runId).map((s) => [s.runId!, s.actualSource ?? null]));
  const runs = store.runs.recent(50).map((r) => ({
    id: r.id, at: r.startedAt, kind: r.kind, line: r.line ?? null, actor: r.actor, items: r.items, costUsd: r.costUsd,
    actualSource: (r.dry ? 'dry' : sources.get(r.id) ?? null) as 'provider' | 'published_price' | 'dry' | null,
    status: r.status, scheduled: Boolean(r.scheduled), job: (r.job ?? null) as LabJobId | null, error: r.error,
  }));
  return {
    month: since.slice(0, 7),
    dry: opts.dry,
    providers,
    blocked: blockedRun ? { runId: blockedRun.id, line: blockedRun.line ?? 'apify.sync', scope: blockedRun.error && blockedRun.line && blockedRun.error.startsWith(blockedRun.line) ? 'line' : 'provider', message: blockedRun.error ?? 'Stopped by a cap.', at: blockedRun.startedAt } : null,
    runs,
    monthTotal: r4(providers.reduce((a, p) => a + p.spent + p.reserved, 0)),
  };
}

/* ── schedule (08.5.4, 09.5.5) ───────────────────────────────────────────── */

function scheduleView(store: LabStore, now: Date, ctx: { health: LabHealthResult[]; planner: PlanInputs; sample: boolean; dry: boolean; env: Record<string, string | undefined> }): ScheduleView {
  const sched = store.priors.get('schedule')?.value as { label?: string } | null | undefined;
  const installed = Boolean(sched);
  const client = BRAND.id === 'founderos';
  const heartbeat = ctx.health.find((h) => h.id === 'schedule.heartbeat')!;
  const by = pausedBy(automationDirs(ctx.env), fs.existsSync);
  const tz = ctx.planner.tz;
  const plan = estimatePlan(ctx.planner, ctx.planner.current);
  const syncJob = plan.perJob.find((j) => j.job === 'sync');
  const syncLine = plan.perLine.find((l) => l.line === 'apify.sync');
  const blockedSince = monthStart(now);
  const blockedLines = new Set(store.runs.recent(300).filter((r) => r.status === 'blocked' && r.startedAt >= blockedSince && r.line).map((r) => r.line!));
  const jobs: ScheduleJobRow[] = LAB_JOBS.map((j) => {
    const cfg = jobConfig(store, j.id);
    const st = jobState(store, j.id);
    const editable = isPresetJob(j.id);
    const runs = runsIn30Days(cfg, j.id, now, tz, ctx.env, 0);
    const line = j.lines.find((l) => providerOf(l) !== 'llm') ?? null;
    let cost: ScheduleJobRow['cost'] = { perRun: null, runsPerMonth: runs, month: null, line, fit: null, stopDay: null };
    if (j.id === 'sync' && syncJob && syncLine) {
      cost = { perRun: syncJob.runsPerMonth ? r4(syncJob.usd.point / syncJob.runsPerMonth) : null, runsPerMonth: syncJob.runsPerMonth, month: syncJob.usd, line: 'apify.sync', fit: syncLine.fit, stopDay: syncLine.stopDay };
    }
    const off = line ? lineOffReason(line, { env: ctx.env, store }) : null;
    const needs = j.needs({ store, now, scheduled: true, dry: ctx.dry });
    let state: ScheduleJobRow['state'] = 'on';
    let stateText = st.lastDetail || '';
    if (ctx.sample) [state, stateText] = ['sample', 'Sample data. Nothing runs here.'];
    else if (client && heartbeat.state !== 'ok') [state, stateText] = ['client', 'Runs when lab-sync tick is called. Call it every 15 minutes from cron or launchd.'];
    else if (cfg.paused) [state, stateText] = ['paused', 'Paused. Run now still works.'];
    else if (off && !ctx.dry) [state, stateText] = ['off', off];
    else if (line && blockedLines.has(line)) [state, stateText] = ['blocked', `${LINE_LABEL[line]}: stopped by its cap this month. Pass the cap once, or raise it.`];
    else if (st.skippedReason === 'Waiting for the other X run to finish') [state, stateText] = ['deferred', st.skippedReason];
    else if (needs) [state, stateText] = ['needs', needs];
    else if (!installed && !client) [state, stateText] = ['not_scheduled', 'Saved. Nothing runs on its own until the schedule is installed.'];
    return {
      id: j.id,
      label: JOB_LABEL[j.id].label,
      what: JOB_LABEL[j.id].what,
      paid: editable,
      editable,
      config: cfg,
      presets: editable ? JOB_PRESETS[j.id as keyof typeof JOB_PRESETS].map((p) => ({ id: p.id, label: p.label })) : [],
      activePreset: activePreset(cfg, j.id),
      next: nextRuns(cfg, j.id, now, tz, 3, ctx.env),
      cost,
      state,
      stateText,
      lastOkAt: st.lastOkAt,
      skippedReason: st.skippedReason,
    };
  });
  return {
    installed,
    label: installed ? sched?.label ?? TICK_LABEL : client ? 'Runs when lab-sync tick is called. Call it every 15 minutes from cron or launchd.' : 'Not scheduled yet',
    agentLabel: client ? null : LAB_AGENT_LABEL,
    heartbeat,
    paused: { by: by ? (client ? path.basename(by) : by) : null, scope: by ? (path.basename(by) === 'PAUSED' ? 'all' : 'lab') : null },
    jobs,
    brief: { telegram: (ctx.env.LAB_BRIEF_TELEGRAM ?? '').trim() === '1' },
    privateInstance: isPrivateInstance(ctx.env),
  };
}

/* ── the view ─────────────────────────────────────────────────────────────── */

const isSection = (s: string | null | undefined): s is SetupSection => (SETUP_SECTIONS as readonly string[]).includes(s ?? '');

/** 08.3.1 builder (01 25.2 name). Never makes a network call (AC-08-9). */
export function setupView(store: LabStore, opts: SetupViewOpts = {}): SetupView {
  const now = opts.now ?? new Date();
  const env = opts.env ?? { ...process.env, ...readEnvLocal() };
  const dry = opts.dry ?? isDry();
  const sample = Boolean(opts.sample);
  const filming = Boolean(opts.filming);
  const recorded = dry || sample || filming;
  const health = healthResults(store, { now, env });
  const planner = planInputs(store, now, { recorded, env });
  const checklist = checklistView(store, { health, dry: recorded, dryLabel: sample ? 'sample data' : opts.dryLabel ?? null, now });
  const keys = sample
    ? keyRows(store, { health, dry: false, now }).map((k) => sampleRow(k, health))
    : keyRows(store, { health, dry, now });
  const counts = gateCounts(store, now);
  const gates = predictGates(planner.rates, planner.current, counts, now, gateAdjust(store));
  const focus: SetupSection = isSection(opts.section) ? opts.section : checklist.complete ? 'keys' : 'checklist';
  return {
    brand: { name: BRAND.name, isClient: BRAND.id === 'founderos' },
    mode: { dry, dryLabel: opts.dryLabel ?? null, sample, filming, readOnly: Boolean(opts.readOnly) },
    checklist,
    keys,
    sources: sourcesView(store, health),
    schedule: scheduleView(store, now, { health, planner, sample, dry, env }),
    spend: spendView(store, now, { dry, env }),
    health,
    planner: { ...planner, current: planner.current },
    gates,
    forecastRecord: forecastRecord(store),
    focus,
    notes: {
      brainInDry: dry && !filming ? `Brain docs from dry runs go to ${labBrainRoot()}.` : null,
      checklistComplete: checklist.complete ? 'Setup done. The Lab runs on its own now.' : null,
      ownedHeader: recorded ? priceLabel(planner, { sample: true }) : null,
    },
  };
}

/** In the sample world the key rows show as fixture connections (08.7.2 `fresh`), driven by the sample store's health. */
function sampleRow(k: LabKeyRow, health: LabHealthResult[]): LabKeyRow {
  const fields = k.fields.map((f) => ({ ...f, present: true, masked: '••••' }));
  if (k.id === 'xwatch' || k.id === 'claude_cli') return { ...k, fields };
  const h = health.filter((x) => x.id === (k.id === 'apify' ? 'apify.auth' : k.id === 'openai' ? 'openai.auth' : k.id === 'youtube' ? 'youtube.token' : k.id === 'instagram' ? 'instagram.token' : `${k.id}.auth`));
  const fail = h.find((x) => x.state === 'fail');
  const warn = h.find((x) => x.state === 'warn' && /^Expires in/.test(x.detail));
  if (fail) return { ...k, fields, state: 'error', detail: fail.detail, action: { kind: 'none', label: '' } };
  if (warn) return { ...k, fields, state: 'expiring', detail: warn.detail, action: { kind: 'none', label: '' } };
  return { ...k, fields, state: 'connected', detail: 'Sample connection.', action: { kind: 'none', label: '' } };
}

