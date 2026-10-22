/**
 * The one scheduler (08.5.1). One LaunchAgent fires `lab-sync tick` every 15 minutes; the tick
 * runs whichever LAB_JOBS are due, in `order`. Sections 04 to 07 supply job bodies only
 * (job-bodies.ts adapts them); due-ness, order, the lock, pause scopes and job state are here.
 *
 * Due-ness: a job's `jobcfg:<id>` (09.5.3) decides first (paused, quiet hours, its own times or
 * interval); with no config, the 08.5.1 Cadence column decides. Event jobs ("when X ran") read
 * `tick.ran`. A tick reads every `jobcfg:*` row before deciding, so an edit in Setup applies at
 * the next tick with no plist change.
 *
 * Failure isolation: a job that throws is recorded (`fails + 1`, the first 300 chars of the
 * message) and the tick moves on. A CapError from a scheduled job has already written its
 * `blocked` run (spend.ts) and skips the rest of that line (or provider) for the tick.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LAB_JOB_IDS, LAB_SPEND_LINES, providerOf, type JobConfig, type LabJobId, type LabJobState, type LabRunKind, type LabSpendLine } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { readEnvLocal } from '@/lib/creds';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { CapError, lineOffReason } from '@/lib/lab/spend';
import { automationDirs, pausedBy, radarPausedBy, touchSchedule } from '@/lib/lab/schedule';
import { cadenceDue, defaultCadence, isDueWithConfig, jobConfig, localClock, DEFAULT_JOB_CONFIG } from '@/lib/lab/setup/schedule';
import { SINGLE_RUN_ACTORS } from '@/lib/lab/setup/estimate';
import { newBatchId } from '@/lib/lab/setup/progress';
import * as B from '@/lib/lab/setup/job-bodies';
import { labTz } from '@/lib/lab/setup/tz';
import { dataPath } from '@/lib/paths';
import { RADAR_JOBS } from '@/lib/lab/radar/jobs';

export type { LabJobId } from '@/lib/schemas';
/** lab_priors `job:<id>` value. */
export type JobState = LabJobState;
/** Results of jobs earlier in this tick, plus what the tick read before deciding (09.5.3). */
export type TickSoFar = { ran: Partial<Record<LabJobId, JobResult>>; config?: Partial<Record<LabJobId, JobConfig>>; tz?: string; env?: Record<string, string | undefined> };
/** `scheduled` is false for Run now (`--manual`, 09.5.4); `batchId` tags the paid runs a job starts (09.4.2). */
export type JobCtx = { store: LabStore; now: Date; scheduled: boolean; dry: boolean; batchId?: string | null; /** Run now after the CapDialog: pass the cap once (manual only, never scheduled) */ override?: boolean };
export type JobResult = { ok: boolean; detail: string; items?: number };

export type LabJob = {
  id: LabJobId;
  /** position inside one tick (08.5.1 table) */
  order: number;
  /** spec section that implements run() */
  owner: '04' | '05' | '06' | '07' | '08';
  due: (state: JobState, now: Date, tick: TickSoFar) => boolean;
  /** null = can run; else the skip reason */
  needs: (ctx: JobCtx) => string | null;
  /** [] = free */
  lines: LabSpendLine[];
  /** 'radar' jobs also stop on PAUSED-radar (05) */
  pauseScope: 'lab' | 'radar';
  /** The lab_runs kind a free network job records (08.5.2); paid jobs write theirs through gatedCall. */
  runKind: LabRunKind | null;
  run: (ctx: JobCtx) => Promise<JobResult>;
};

export { labTz } from '@/lib/lab/setup/tz';

/* ── due helpers ──────────────────────────────────────────────────────────── */

const tzOf = (tick: TickSoFar) => tick.tz ?? labTz(tick.env ?? process.env);
const cfgOf = (id: LabJobId, tick: TickSoFar) => tick.config?.[id] ?? DEFAULT_JOB_CONFIG;

/** The clock part of due-ness: the config (paused, quiet, its own cadence), else the default cadence. */
export function clockDue(id: LabJobId, state: JobState, now: Date, tick: TickSoFar): boolean {
  const cfg = cfgOf(id, tick);
  const tz = tzOf(tick);
  if (!isDueWithConfig(cfg, state, now, tz)) return false;
  if (cfg.mode !== 'default') return true;
  return cadenceDue(defaultCadence(id, tick.env ?? {}), state, now, tz);
}
const ran = (tick: TickSoFar, id: LabJobId, items = false) => {
  const r = tick.ran[id];
  return Boolean(r?.ok && (!items || (r.items ?? 0) > 0));
};
const sameLocalDay = (a: string | null, now: Date, tz: string) => {
  if (!a) return false;
  const x = localClock(new Date(a), tz);
  const y = localClock(now, tz);
  return x.y === y.y && x.m === y.m && x.d === y.d;
};
/** "when advance ingested items" (also a dry sync, which ingests in the same tick). */
const ingested = (tick: TickSoFar) => ran(tick, 'advance', true) || ran(tick, 'sync', true) || ran(tick, 'snapshots', true);

/* ── needs helpers ────────────────────────────────────────────────────────── */

const envNow = () => ({ ...process.env, ...readEnvLocal() });
const needApify = (ctx: JobCtx) => (ctx.dry || resolveApifyToken() ? null : 'Add an Apify key');
const needLine = (ctx: JobCtx, line: LabSpendLine) => (ctx.dry ? null : lineOffReason(line, { store: ctx.store }));
/** 09.5.3 single-run guard: an open run of the same actor defers the job to the next tick. */
const needSingleRun = (ctx: JobCtx, actor: string) => (SINGLE_RUN_ACTORS.includes(actor) && ctx.store.runs.openForActor(actor).some((r) => !r.dry) ? 'Waiting for the other X run to finish' : null);
const first = (...xs: (string | null)[]) => xs.find((x) => x !== null) ?? null;

const job = (id: LabJobId, owner: LabJob['owner'], o: Partial<Omit<LabJob, 'id' | 'order' | 'owner'>> & Pick<LabJob, 'run'>): LabJob => ({
  id,
  order: LAB_JOB_IDS.indexOf(id) + 1,
  owner,
  due: (state, now, tick) => clockDue(id, state, now, tick),
  needs: () => null,
  lines: [],
  pauseScope: 'lab',
  runKind: null,
  ...o,
});

/** The only scheduler (08.5.1 table, 24 rows, `order` 1 to 24). */
const S_ROWS: readonly LabJob[] = [
  job('advance', '04', { run: B.advanceBody }),
  job('measure.verdicts', '04', { due: (s, now, t) => ran(t, 'advance', true) && clockDue('measure.verdicts', s, now, t), run: B.verdictsBody }),
  job('health', '08', { runKind: 'health', run: (ctx) => B.healthBody(ctx) }),
  job('radar.vendor', '05', { pauseScope: 'radar', runKind: 'radar', run: B.radarSourceBody('vendor') }),
  job('radar.hn', '05', { pauseScope: 'radar', runKind: 'radar', run: B.radarSourceBody('hn') }),
  job('radar.hf_models', '05', { pauseScope: 'radar', runKind: 'radar', run: B.radarSourceBody('hf_models') }),
  job('radar.hf_spaces', '05', { pauseScope: 'radar', runKind: 'radar', run: B.radarSourceBody('hf_spaces') }),
  job('radar.github', '05', { pauseScope: 'radar', runKind: 'radar', run: B.radarSourceBody('github') }),
  job('radar.x', '05', {
    pauseScope: 'radar',
    lines: ['apify.radar_x'],
    needs: (ctx) => first(needApify(ctx), ctx.store.sources.all('watch').some((s) => s.status === 'active') ? null : 'Add accounts to the X watch list', needLine(ctx, 'apify.radar_x'), needSingleRun(ctx, 'apidojo/tweet-scraper')),
    run: B.radarSourceBody('x'),
  }),
  job('radar.producthunt', '05', {
    pauseScope: 'radar',
    lines: ['apify.radar_producthunt'],
    needs: (ctx) => (ctx.dry || resolveApifyToken() || envNow().PRODUCTHUNT_TOKEN ? null : 'Add a Product Hunt token or an Apify key'),
    run: B.radarSourceBody('producthunt'),
  }),
  job('radar.tiktok_cc', '05', { pauseScope: 'radar', lines: ['apify.radar_tiktok'], needs: (ctx) => first(needApify(ctx), needLine(ctx, 'apify.radar_tiktok')), run: B.radarSourceBody('tiktok_cc') }),
  job('radar.wikipedia', '05', { pauseScope: 'radar', runKind: 'radar', run: B.radarSourceBody('wikipedia') }),
  job('radar.events', '05', { pauseScope: 'radar', lines: ['llm'], run: B.radarEventsBody }),
  job('brief', '05', { pauseScope: 'radar', runKind: 'brief', run: (ctx) => B.briefBody(ctx) }),
  job('snapshots', '04', {
    lines: ['apify.snapshots', 'apify.x'],
    needs: (ctx) => first(needApify(ctx), ctx.store.sources.all('owned').some((s) => s.status === 'active') ? null : 'Add your own accounts'),
    run: B.snapshotsBody,
  }),
  job('ledger.early', '06', {
    due: (s, now, t) => ran(t, 'measure.verdicts') && clockDue('ledger.early', s, now, t),
    needs: (ctx) => (ctx.store.posts.all().some((p) => p.isOwned && p.postedAt && ctx.now.getTime() - Date.parse(p.postedAt) < 30 * 3_600_000) ? null : 'No post of yours is under 30 hours old'),
    run: B.ledgerEarlyBody,
  }),
  job('sync', '04', {
    lines: ['apify.sync'],
    needs: (ctx) => first(needApify(ctx), ctx.store.sources.all().some((s) => s.status === 'active' && (s.kind === 'owned' || s.kind === 'tracked' || s.kind === 'suggested')) ? null : 'Add your accounts first'),
    run: B.syncBody,
  }),
  job('analyse', '04', { lines: ['stt', 'stt.controls', 'llm'], due: (s, now, t) => ingested(t) && clockDue('analyse', s, now, t), run: B.analyseBody }),
  job('gen.embed', '07', {
    lines: ['embed'],
    due: (s, now, t) => {
      const cfg = cfgOf('gen.embed', t);
      if (!isDueWithConfig(cfg, s, now, tzOf(t))) return false;
      return ran(t, 'analyse') || cadenceDue({ kind: 'times', times: ['04:00'] }, s, now, tzOf(t));
    },
    run: B.embedBody,
  }),
  job('gen.frames', '07', {
    lines: ['downloads'],
    due: (s, now, t) => ingested(t) && clockDue('gen.frames', s, now, t),
    needs: () => (envNow().LAB_FRAMES?.trim() === '1' ? null : 'Frame contact sheets are off (LAB_FRAMES)'),
    run: B.framesBody,
  }),
  job('gen.comments', '07', {
    lines: ['comments'],
    due: (s, now, t) => ran(t, 'sync') && !sameLocalDay(s.lastAt, now, tzOf(t)) && clockDue('gen.comments', s, now, t),
    needs: (ctx) => first(envNow().LAB_COMMENTS?.trim() === '1' ? null : 'Comments are off (LAB_COMMENTS)', needLine(ctx, 'comments'), needApify(ctx)),
    run: B.commentsBody,
  }),
  job('intel', '07', { lines: ['llm', 'apify.sync'], due: (s, now, t) => ran(t, 'analyse') && clockDue('intel', s, now, t), run: B.intelBody }),
  job('discover', '04', { lines: ['apify.sync'], needs: needApify, run: B.discoverBody }),
  job('ledger', '06', { run: B.ledgerBody }),
];

/**
 * The only scheduler (08.5.1 table, 24 rows, `order` 1 to 24). The radar rows (orders 4 to 14)
 * keep this table's config-aware due-ness, lines and pause scope, and also apply section 05's
 * own `needs` from lib/lab/radar/jobs.ts (sourceNeeds).
 */
const RADAR_BY_ID = new Map(RADAR_JOBS.map((r) => [r.id, r]));
export const LAB_JOBS: readonly LabJob[] = S_ROWS.map((j) => {
  const r = RADAR_BY_ID.get(j.id);
  return r ? { ...j, needs: (ctx: JobCtx) => first(j.needs(ctx), r.needs(ctx)) } : j;
});

/* ── job state ────────────────────────────────────────────────────────────── */

const EMPTY_STATE: JobState = { lastAt: null, lastOkAt: null, lastDetail: '', fails: 0, skippedReason: null };
export function jobState(store: LabStore, id: string): JobState {
  const v = store.priors.get(`job:${id}`)?.value as Partial<JobState> | null | undefined;
  return v ? { ...EMPTY_STATE, ...v } : { ...EMPTY_STATE };
}
function writeState(store: LabStore, id: string, state: JobState & { dry?: boolean }, now: Date): void {
  store.priors.set({ key: `job:${id}`, value: state, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
}

/* ── the overlap lock (08.5.3) ────────────────────────────────────────────── */

export const LOCK_MAX_AGE_MS = 50 * 60_000;
const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Take the tick lock. Null when a live tick younger than 50 minutes holds it. A stale or dead lock is removed and reported. */
export function takeLock(file: string, now: Date, store: LabStore | null): (() => void) | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number; startedAt?: string };
    const fresh = raw.startedAt && now.getTime() - Date.parse(raw.startedAt) < LOCK_MAX_AGE_MS;
    if (fresh && raw.pid && pidAlive(raw.pid)) return null;
    fs.rmSync(file, { force: true });
    store?.priors.set({ key: 'schedule:lock_removed', value: { at: now.toISOString(), pid: raw.pid ?? null }, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
  } catch {
    /* no lock */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: now.toISOString() }));
  return () => fs.rmSync(file, { force: true });
}

/* ── the tick ─────────────────────────────────────────────────────────────── */

export type TickOpts = {
  now?: Date;
  /** --only, may repeat */
  only?: readonly LabJobId[];
  /** --force: every job is due (config pauses included; the PAUSED files still stop everything) */
  force?: boolean;
  /** --manual: started runs are recorded with scheduled 0 (Run now) */
  manual?: boolean;
  /** --batch: tag started runs with this batch id (follow-on stages) */
  batchId?: string | null;
  /** --override: pass a cap once (only with --manual, from the CapDialog) */
  override?: boolean;
  dry: boolean;
  /** tests inject jobs, the pause probe, the lock file and the env */
  jobs?: readonly LabJob[];
  exists?: (p: string) => boolean;
  lockFile?: string | null;
  env?: Record<string, string | undefined>;
};
export type TickResult = { ran: Partial<Record<LabJobId, JobResult>>; skipped: Partial<Record<LabJobId, string>>; paused: string | null; locked: boolean; batchId: string | null };

/**
 * One tick. Returns what ran and what was skipped (with the reason). The kill switch (PAUSED or
 * PAUSED-lab) stops every job before anything is read; PAUSED-radar skips the radar scope.
 */
export async function runTick(store: LabStore, opts: TickOpts): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? envNow();
  const exists = opts.exists ?? fs.existsSync;
  const dirs = automationDirs(env);
  const out: TickResult = { ran: {}, skipped: {}, paused: null, locked: false, batchId: null };
  const paused = pausedBy(dirs, exists);
  if (paused) {
    out.paused = paused;
    return out;
  }
  const radarPaused = radarPausedBy(dirs, exists);
  const release = opts.lockFile === null ? () => {} : takeLock(opts.lockFile ?? dataPath('lab-tick.lock'), now, store);
  if (!release) {
    out.locked = true;
    return out;
  }
  const tickState = jobState(store, 'tick');
  writeState(store, 'tick', { ...tickState, lastAt: now.toISOString() }, now);
  try {
    const jobs = [...(opts.jobs ?? LAB_JOBS)].sort((a, b) => a.order - b.order);
    const config = Object.fromEntries(LAB_JOB_IDS.map((id) => [id, jobConfig(store, id)])) as Record<LabJobId, JobConfig>;
    const tick: TickSoFar = { ran: out.ran, config, tz: labTz(env), env };
    const blockedLines = new Set<LabSpendLine>();
    let batchId = opts.batchId ?? null;
    const ctx: JobCtx = { store, now, scheduled: !opts.manual, dry: opts.dry, batchId, override: Boolean(opts.override && opts.manual) };
    for (const j of jobs) {
      if (opts.only?.length && !opts.only.includes(j.id)) continue;
      if (j.pauseScope === 'radar' && radarPaused) {
        out.skipped[j.id] = `Paused by ${path.basename(radarPaused)}`;
        continue;
      }
      const state = jobState(store, j.id);
      if (!opts.force && !j.due(state, now, tick)) continue;
      const blocked = j.lines.find((l) => blockedLines.has(l));
      const reason = blocked ? `Cap reached on ${blocked} this tick` : j.needs(ctx);
      if (reason) {
        out.skipped[j.id] = reason;
        writeState(store, j.id, { ...state, skippedReason: reason }, now);
        continue;
      }
      const startedIso = new Date(now.getTime() - 1).toISOString();
      const before = new Set(store.runs.recent(500).map((r) => r.id));
      let res: JobResult;
      try {
        res = await j.run({ ...ctx, batchId });
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        res = { ok: false, detail: msg };
        if (err instanceof CapError) {
          const lines = err.scope === 'provider' ? LAB_SPEND_LINES.filter((l) => providerOf(l) === err.provider) : err.line ? [err.line] : j.lines;
          for (const l of lines) blockedLines.add(l);
        }
      }
      out.ran[j.id] = res;
      // tag the paid runs this job started: job id, scheduled, and the tick's batch (09.4.2)
      const started = store.runs.recent(500).filter((r) => !before.has(r.id) && r.startedAt >= startedIso.slice(0, 19));
      const paid = started.filter((r) => r.line && r.status !== 'blocked' && providerOf(r.line) !== 'llm');
      if (paid.length && !batchId) batchId = newBatchId();
      for (const r of started) store.runs.update(r.id, { job: r.job ?? j.id, scheduled: !opts.manual, ...(paid.includes(r) && !r.batchId ? { batchId } : {}) });
      if (j.runKind && j.lines.length === 0 && !started.some((r) => r.kind === j.runKind)) {
        // free network jobs still write a lab_runs row (08.5.2)
        store.runs.insert({ id: `lrun-${j.id.replace(/\W/g, '')}-${now.getTime().toString(36)}`, kind: j.runKind, apifyRunId: null, datasetId: null, actor: null, input: { job: j.id }, status: res.ok ? 'succeeded' : 'failed', items: res.items ?? null, costUsd: 0, dry: opts.dry, startedAt: now.toISOString(), finishedAt: new Date().toISOString(), error: res.ok ? null : res.detail, line: null, job: j.id, scheduled: !opts.manual, batchId: null, progress: null });
      }
      writeState(store, j.id, { lastAt: now.toISOString(), lastOkAt: res.ok ? now.toISOString() : state.lastOkAt, lastDetail: res.detail.slice(0, 300), fails: res.ok ? 0 : state.fails + 1, skippedReason: null, dry: opts.dry }, now);
    }
    out.batchId = batchId;
    writeState(store, 'tick', { lastAt: now.toISOString(), lastOkAt: new Date().toISOString(), lastDetail: `${Object.keys(out.ran).length} ran, ${Object.keys(out.skipped).length} skipped`, fails: 0, skippedReason: null, dry: opts.dry }, now);
    touchSchedule(store, now);
    return out;
  } finally {
    release();
  }
}

/** One row per job for `lab-sync -- jobs`: last ok, next due, skip reason. No calls. */
export function jobsTable(store: LabStore, now: Date = new Date()): { id: LabJobId; order: number; owner: string; lastOkAt: string | null; lastDetail: string; skippedReason: string | null; dueNow: boolean }[] {
  const config = Object.fromEntries(LAB_JOB_IDS.map((id) => [id, jobConfig(store, id)])) as Record<LabJobId, JobConfig>;
  const tick: TickSoFar = { ran: {}, config, tz: labTz(), env: envNow() };
  return LAB_JOBS.map((j) => {
    const s = jobState(store, j.id);
    return { id: j.id, order: j.order, owner: j.owner, lastOkAt: s.lastOkAt, lastDetail: s.lastDetail, skippedReason: s.skippedReason, dueNow: j.due(s, now, tick) };
  });
}
