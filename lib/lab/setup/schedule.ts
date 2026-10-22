/**
 * Schedule editor model (09.5.3, 09.5.5) and the due rules of the one local scheduler (08.5.1).
 * Config rows live in lab_priors `jobcfg:<jobId>` (zod JobConfigSchema in lib/schemas.ts); an
 * absent row means the 08.5.1 default cadence, so a fresh install needs no migration.
 *
 * PURE apart from `jobConfig` (which reads the store it is handed): no node:*, no fetch, so the
 * schedule editor's "Next runs" and the plan panel's month estimate run in the browser.
 *
 * Times are wall-clock in labTz(). A listed time that does not exist on a DST spring-forward day
 * runs at the first tick after the gap; a time that occurs twice runs once (the first instant).
 * Missed slots run once on the next tick, never once per missed slot.
 */
import { JobConfigSchema, type JobConfig, type LabJobId, type LabJobState, type LabSpendLine } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';

export type { JobConfig } from '@/lib/schemas';
type JobState = LabJobState;

/** The config an absent `jobcfg:<id>` row stands for: the 08.5.1 default cadence. */
export const DEFAULT_JOB_CONFIG: JobConfig = { v: 1, paused: false, mode: 'default', updatedAt: '', history: [] };

/** The tick interval of the LaunchAgent (StartInterval 900). */
export const TICK_MIN = 15;

/** 09.5.5: one row per job in Setup > Schedule (08's ScheduleView.jobs[]). */
export type ScheduleJobRow = {
  id: LabJobId;
  label: string;
  /** 09.5.2 "What it scrapes" */
  what: string;
  paid: boolean;
  editable: boolean;
  config: JobConfig;
  presets: { id: string; label: string }[];
  activePreset: string | null;
  /** next 3 due instants, ISO */
  next: string[];
  cost: { perRun: number | null; runsPerMonth: number; month: { low: number; point: number; high: number } | null; line: LabSpendLine | null; fit: 'fits' | 'tight' | 'over' | null; stopDay: number | null };
  state: 'on' | 'paused' | 'off' | 'needs' | 'blocked' | 'deferred' | 'not_scheduled' | 'sample' | 'client';
  stateText: string;
  lastOkAt: string | null;
  skippedReason: string | null;
};

/* ── default cadences (08.5.1 Cadence column) ─────────────────────────────── */

export type Cadence =
  | { kind: 'every_tick' }
  /** due when now - lastAt >= everyMin - 60 s */
  | { kind: 'interval'; everyMin: number }
  /** "Daily HH:MM": due when lastAt is before the most recent slot and now is at or after it */
  | { kind: 'times'; times: string[]; weekdays?: number[]; orEvent?: boolean }
  /** "when X ran this tick": decided by the tick, not the clock */
  | { kind: 'event' };

/** X watch list interval: LAB_X_POLL_MIN (default 120, minimum 60), the default when no jobcfg row exists. */
export function xPollMin(env: Record<string, string | undefined> = {}): number {
  const n = Number(env.LAB_X_POLL_MIN);
  return Number.isFinite(n) && n > 0 ? Math.max(60, Math.round(n)) : 120;
}

/** The 08.5.1 cadence of each job; the values JOB_PRESETS call "default". */
export function defaultCadence(job: LabJobId, env: Record<string, string | undefined> = {}): Cadence {
  switch (job) {
    case 'advance':
    case 'radar.events':
      return { kind: 'every_tick' };
    case 'health':
      return { kind: 'interval', everyMin: 360 };
    case 'radar.vendor':
      return { kind: 'interval', everyMin: 15 };
    case 'radar.hn':
      return { kind: 'interval', everyMin: 30 };
    case 'radar.hf_models':
    case 'radar.hf_spaces':
    case 'radar.github':
      return { kind: 'interval', everyMin: 60 };
    case 'radar.x':
      return { kind: 'interval', everyMin: xPollMin(env) };
    case 'radar.producthunt':
    case 'radar.tiktok_cc':
      return { kind: 'times', times: ['09:00'] };
    case 'radar.wikipedia':
      return { kind: 'times', times: ['07:00'] };
    case 'brief':
      return { kind: 'times', times: ['07:30'] };
    case 'snapshots':
      return { kind: 'interval', everyMin: 30 };
    case 'sync':
      return { kind: 'times', times: ['00:00', '06:00', '12:00', '18:00'] };
    case 'gen.embed':
      return { kind: 'times', times: ['04:00'], orEvent: true };
    case 'discover':
      return { kind: 'times', times: ['06:00'], weekdays: [1] };
    case 'ledger':
      return { kind: 'times', times: ['03:30'] };
    case 'measure.verdicts':
    case 'ledger.early':
    case 'analyse':
    case 'gen.frames':
    case 'gen.comments':
    case 'intel':
      return { kind: 'event' };
  }
}

/** The cadence a config stands for: its own times or interval, else the job's default. */
export function effectiveCadence(cfg: JobConfig, job: LabJobId, env: Record<string, string | undefined> = {}): Cadence {
  if (cfg.mode === 'times' && cfg.times?.length) return { kind: 'times', times: cfg.times, weekdays: cfg.weekdays };
  if (cfg.mode === 'interval' && cfg.everyMin) return { kind: 'interval', everyMin: cfg.everyMin };
  return defaultCadence(job, env);
}

/* ── presets (09.5.3) ─────────────────────────────────────────────────────── */

export type JobPresetKey = 'sync' | 'snapshots' | 'radar.x' | 'radar.tiktok_cc' | 'radar.producthunt' | 'discover' | 'gen.comments';
type Preset = { id: string; label: string; config: Partial<JobConfig> };
const daily = (id: string, label: string, times: string[], weekdays?: JobConfig['weekdays']): Preset => ({ id, label, config: { mode: 'times', times, ...(weekdays ? { weekdays } : {}) } });
const every = (id: string, label: string, everyMin: number): Preset => ({ id, label, config: { mode: 'interval', everyMin } });
const dflt = (label: string): Preset => ({ id: 'default', label, config: { mode: 'default' } });

export const JOB_PRESETS: Record<JobPresetKey, Preset[]> = {
  sync: [dflt('Four times a day (default)'), daily('twice', 'Twice a day (07:00, 19:00)', ['07:00', '19:00']), daily('once', 'Once a day (07:00)', ['07:00']), every('every2h', 'Every 2 hours', 120)],
  snapshots: [dflt('New posts every 2 hours (default)'), every('every1h', 'New posts every hour', 60), every('every4h', 'New posts every 4 hours', 240), every('every6h', 'New posts every 6 hours', 360)],
  'radar.x': [dflt('Every 2 hours (default)'), every('every1h', 'Every hour', 60), every('every4h', 'Every 4 hours', 240), every('every12h', 'Every 12 hours', 720)],
  'radar.tiktok_cc': [dflt('Daily after 09:00 (default)'), daily('morning', 'Daily at 07:00', ['07:00']), daily('evening', 'Daily at 18:00', ['18:00'])],
  'radar.producthunt': [dflt('Daily after 09:00 (default)'), daily('morning', 'Daily at 07:00', ['07:00']), daily('evening', 'Daily at 18:00', ['18:00'])],
  discover: [dflt('Mondays at 06:00 (default)'), daily('thursday', 'Thursdays at 06:00', ['06:00'], [4]), daily('twice', 'Mondays and Thursdays at 06:00', ['06:00'], [1, 4])],
  'gen.comments': [dflt('Once a day after the sync (default)'), { id: 'off', label: 'Off', config: { paused: true } }],
};

export const isPresetJob = (job: LabJobId): job is JobPresetKey => Object.prototype.hasOwnProperty.call(JOB_PRESETS, job);

/** The preset a config matches, or null (a custom schedule). */
export function activePreset(cfg: JobConfig, job: LabJobId): string | null {
  if (!isPresetJob(job)) return null;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const p of JOB_PRESETS[job]) {
    const c = p.config;
    if (c.paused !== undefined && c.paused !== cfg.paused) continue;
    if (c.paused === undefined && cfg.paused) continue;
    const mode = c.mode ?? 'default';
    if (mode !== cfg.mode) continue;
    if (mode === 'times' && (!same(c.times, cfg.times) || !same(c.weekdays ?? null, cfg.weekdays?.length ? cfg.weekdays : null))) continue;
    if (mode === 'interval' && c.everyMin !== cfg.everyMin) continue;
    if (cfg.quiet) continue;
    return p.id;
  }
  return null;
}

/** lab_priors `jobcfg:<id>` parsed, or the default when absent or invalid. */
export function jobConfig(store: LabStore, id: LabJobId): JobConfig {
  const raw = store.priors.get(`jobcfg:${id}`)?.value;
  const parsed = JobConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_JOB_CONFIG;
}

/* ── wall clock in a zone ─────────────────────────────────────────────────── */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  return f;
}
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type LocalClock = { y: number; m: number; d: number; hh: number; mm: number; ss: number; weekday: number };

/** The wall clock of an instant in `tz`. */
export function localClock(at: Date, tz: string): LocalClock {
  const parts = fmt(tz).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), hh: Number(get('hour')) % 24, mm: Number(get('minute')), ss: Number(get('second')), weekday: WEEKDAY[get('weekday')] ?? 0 };
}

/** Wall clock as a comparable number (minutes since an epoch, ignoring the zone). */
const wallMs = (c: Pick<LocalClock, 'y' | 'm' | 'd' | 'hh' | 'mm'>) => Date.UTC(c.y, c.m - 1, c.d, c.hh, c.mm);

/**
 * The instant at which `tz`'s wall clock reads y-m-d hh:mm. In a spring-forward gap: the first
 * instant at or after it (the end of the gap). Twice (fall back): the first occurrence.
 */
export function zonedInstant(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const want = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t: number) => wallMs(localClock(new Date(t), tz)) - Math.floor(t / 60_000) * 60_000;
  const t1 = want - offset(want);
  const t2 = want - offset(t1);
  const ok = [t1, t2].filter((t) => wallMs(localClock(new Date(t), tz)) === want);
  if (ok.length) return new Date(Math.min(...ok));
  // gap: binary search for the first instant whose wall clock is at or after `want`
  let lo = Math.min(t1, t2) - 3 * 3_600_000;
  let hi = Math.max(t1, t2) + 3 * 3_600_000;
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000;
    if (wallMs(localClock(new Date(mid), tz)) >= want) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

const parseHm = (s: string): [number, number] => {
  const [h, m] = s.split(':').map(Number);
  return [h ?? 0, m ?? 0];
};
const minutesOf = (c: Pick<LocalClock, 'hh' | 'mm'>) => c.hh * 60 + c.mm;

/** True when `at` falls inside quiet hours (may cross midnight). */
export function inQuiet(quiet: JobConfig['quiet'], at: Date, tz: string): boolean {
  if (!quiet) return false;
  const [fh, fm] = parseHm(quiet.from);
  const [th, tm] = parseHm(quiet.to);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  const now = minutesOf(localClock(at, tz));
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** The first instant at or after `at` when quiet hours are over. */
function quietEnd(quiet: NonNullable<JobConfig['quiet']>, at: Date, tz: string): Date {
  const [th, tm] = parseHm(quiet.to);
  for (let k = 0; k < 2; k++) {
    const c = localClock(new Date(at.getTime() + k * 86_400_000), tz);
    const t = zonedInstant(c.y, c.m, c.d, th, tm, tz);
    if (t.getTime() >= at.getTime()) return t;
  }
  return new Date(at.getTime() + 86_400_000);
}

/** The most recent listed time at or before `now` on an allowed weekday (looking back 8 days). */
export function lastSlot(times: readonly string[], weekdays: readonly number[] | undefined, now: Date, tz: string): Date | null {
  let best: Date | null = null;
  for (let back = 0; back <= 8; back++) {
    const c = localClock(new Date(now.getTime() - back * 86_400_000), tz);
    for (const t of times) {
      const [h, m] = parseHm(t);
      const at = zonedInstant(c.y, c.m, c.d, h, m, tz);
      if (at.getTime() > now.getTime()) continue;
      if (weekdays?.length && !weekdays.includes(localClock(zonedInstant(c.y, c.m, c.d, 12, 0, tz), tz).weekday)) continue;
      if (!best || at.getTime() > best.getTime()) best = at;
    }
    if (best) return best;
  }
  return best;
}

/** Interval mode rounds to the tick: a 100-minute interval runs every 105 minutes. */
export const tickRounded = (everyMin: number) => Math.max(TICK_MIN, Math.ceil((everyMin - 1) / TICK_MIN) * TICK_MIN);

/** Due-ness of a cadence by the clock alone (08.5.1 rules). 'event' cadences answer true: the tick decides. */
export function cadenceDue(c: Cadence, state: Pick<JobState, 'lastAt'> | null, now: Date, tz: string): boolean {
  const lastAt = state?.lastAt ? Date.parse(state.lastAt) : null;
  switch (c.kind) {
    case 'every_tick':
    case 'event':
      return true;
    case 'interval':
      return lastAt === null || now.getTime() - lastAt >= c.everyMin * 60_000 - 60_000;
    case 'times': {
      const slot = lastSlot(c.times, c.weekdays, now, tz);
      if (!slot) return false;
      return lastAt === null || lastAt < slot.getTime();
    }
  }
}

/**
 * Due-ness under a config (09.5.3). Paused is never due; inside quiet hours is not due (the slot
 * stays owed and runs once at the first tick after `quiet.to`). Mode 'default' answers true:
 * 08's LAB_JOBS[i].due then applies the job's own Cadence column. Weekdays limit both modes.
 */
export function isDueWithConfig(cfg: JobConfig, state: JobState, now: Date, tz: string): boolean {
  if (cfg.paused) return false;
  if (inQuiet(cfg.quiet ?? null, now, tz)) return false;
  if (cfg.mode === 'default') return true;
  if (cfg.mode === 'times') return cfg.times?.length ? cadenceDue({ kind: 'times', times: cfg.times, weekdays: cfg.weekdays }, state, now, tz) : false;
  if (cfg.weekdays?.length && !(cfg.weekdays as readonly number[]).includes(localClock(now, tz).weekday)) return false;
  return cadenceDue({ kind: 'interval', everyMin: cfg.everyMin ?? 60 }, state, now, tz);
}

/**
 * Next n due instants after `from` (09.5.3), after quiet-hour moves (several slots inside one
 * quiet window collapse into one run at its end). Event-driven jobs have no clock: [].
 */
export function nextRuns(cfg: JobConfig, job: LabJobId, from: Date, tz: string, n: number, env: Record<string, string | undefined> = {}): string[] {
  if (cfg.paused || n <= 0) return [];
  const cad = effectiveCadence(cfg, job, env);
  const quiet = cfg.quiet ?? null;
  const out: number[] = [];
  const push = (t: Date) => {
    let at = t;
    if (quiet && inQuiet(quiet, at, tz)) at = quietEnd(quiet, at, tz);
    if (out.length && out[out.length - 1] >= at.getTime()) return;
    out.push(at.getTime());
  };
  if (cad.kind === 'event') return [];
  if (cad.kind === 'every_tick' || cad.kind === 'interval') {
    const step = (cad.kind === 'every_tick' ? TICK_MIN : tickRounded(cad.everyMin)) * 60_000;
    const weekdays: readonly number[] | undefined = cfg.mode === 'interval' ? cfg.weekdays : undefined;
    // first tick strictly after `from`, on the 15-minute grid
    let t = Math.floor(from.getTime() / (TICK_MIN * 60_000)) * TICK_MIN * 60_000 + TICK_MIN * 60_000;
    let guard = 0;
    while (out.length < n && guard++ < 100_000) {
      const at = new Date(t);
      if (!weekdays?.length || weekdays.includes(localClock(at, tz).weekday)) push(at);
      t = out.length ? Math.max(t + step, out[out.length - 1] + step) : t + step;
    }
    return out.slice(0, n).map((x) => new Date(x).toISOString());
  }
  const times = [...cad.times].sort();
  for (let day = 0; day < 400 && out.length < n; day++) {
    const c = localClock(new Date(from.getTime() + day * 86_400_000), tz);
    const noon = zonedInstant(c.y, c.m, c.d, 12, 0, tz);
    if (cad.weekdays?.length && !cad.weekdays.includes(localClock(noon, tz).weekday)) continue;
    for (const s of times) {
      const [h, m] = parseHm(s);
      const at = zonedInstant(c.y, c.m, c.d, h, m, tz);
      if (at.getTime() <= from.getTime()) continue;
      push(at);
      if (out.length >= n) break;
    }
  }
  return out.slice(0, n).map((x) => new Date(x).toISOString());
}

/** How many runs a config makes in the 30 days after `from` (09.2.4 runsPerMonth); event jobs answer `eventRuns`. */
export function runsIn30Days(cfg: JobConfig, job: LabJobId, from: Date, tz: string, env: Record<string, string | undefined> = {}, eventRuns = 0): number {
  if (cfg.paused) return 0;
  const cad = effectiveCadence(cfg, job, env);
  if (cad.kind === 'event') return eventRuns;
  const end = from.getTime() + 30 * 86_400_000;
  // generous upper bound on the count, then cut at 30 days
  const cap = cad.kind === 'times' ? cad.times.length * 31 + 2 : Math.ceil((30 * 1440) / (cad.kind === 'interval' ? tickRounded(cad.everyMin) : TICK_MIN)) + 2;
  return nextRuns(cfg, job, from, tz, cap, env).filter((s) => Date.parse(s) <= end).length;
}

/** A short summary of a config for its edit history ("Twice a day (07:00, 19:00)", "Every 120 min"). */
export function describeConfig(cfg: JobConfig, job: LabJobId): string {
  const preset = activePreset(cfg, job);
  if (preset && isPresetJob(job)) return JOB_PRESETS[job].find((p) => p.id === preset)!.label;
  const parts: string[] = [];
  if (cfg.paused) parts.push('Paused');
  if (cfg.mode === 'times' && cfg.times?.length) parts.push(`At ${cfg.times.join(', ')}`);
  else if (cfg.mode === 'interval' && cfg.everyMin) parts.push(`Every ${cfg.everyMin} min`);
  else parts.push('Default');
  if (cfg.weekdays?.length) parts.push(`on ${cfg.weekdays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`);
  if (cfg.quiet) parts.push(`quiet ${cfg.quiet.from} to ${cfg.quiet.to}`);
  return parts.join(', ');
}
