/**
 * Section 05's rows of the one scheduler (08.5.1 rows 4 to 14). Registered in LAB_JOBS
 * (lib/lab/setup/jobs.ts). Each `due` is the Cadence column; 08's tick ANDs it with 09's
 * `isDueWithConfig(jobConfig(store, id), ...)` (lane S), so a `jobcfg:radar.*` edit applies on the
 * next tick. The X interval reads `jobcfg:radar.x` `everyMin` when set, else LAB_X_POLL_MIN.
 *
 * Only type imports from lib/lab/setup/jobs.ts: that module imports this one.
 */
import type { JobConfig, LabJobId, LabRadarSource, LabSpendLine } from '@/lib/schemas';
import type { JobCtx, JobResult, JobState, LabJob } from '@/lib/lab/setup/jobs';
import { labTz } from '@/lib/lab/setup/tz';
import { MIN, localParts } from '@/lib/lab/radar/util';
import { radarCtx, runBrief, runRadarEvents, runSource, sourceNeeds } from '@/lib/lab/radar/run';
import { briefDue } from '@/lib/lab/radar/morning-brief';

export const X_POLL_DEFAULT_MIN = 120;
export const X_POLL_FLOOR_MIN = 60;

/** 05 4: jobcfg `everyMin` (60 to 720) when present, else LAB_X_POLL_MIN (default 120, minimum 60). */
export function xPollMinutes(cfg: Pick<JobConfig, 'mode' | 'everyMin'> | null, env: Record<string, string | undefined> = process.env): number {
  if (cfg && cfg.mode === 'interval' && cfg.everyMin) return Math.min(720, Math.max(X_POLL_FLOOR_MIN, cfg.everyMin));
  const n = Number(env.LAB_X_POLL_MIN);
  return Number.isFinite(n) && n > 0 ? Math.max(X_POLL_FLOOR_MIN, Math.round(n)) : X_POLL_DEFAULT_MIN;
}

/** "Every N min": due when now - lastAt >= N min - 60 s (08.5.1). */
export const everyMinDue = (lastAt: string | null, now: Date, minutes: number): boolean => !lastAt || now.getTime() - Date.parse(lastAt) >= minutes * MIN - 60_000;

/** "Daily HH:MM": due when lastAt is before today's HH:MM local and now is at or after it. */
export function dailyDue(lastAt: string | null, now: Date, hhmm: number, tz: string): boolean {
  const p = localParts(now, tz);
  if (p.hour * 60 + p.minute < hhmm) return false;
  if (!lastAt) return true;
  const l = localParts(new Date(lastAt), tz);
  return l.day !== p.day || l.hour * 60 + l.minute < hhmm;
}

/** 05 4 cadences in minutes or a daily local time; the single source for AC-05-5. */
export const RADAR_CADENCE: Record<Exclude<LabRadarSource, never>, { everyMin: number } | { dailyAt: string }> = {
  vendor: { everyMin: 15 },
  hn: { everyMin: 30 },
  hf_models: { everyMin: 60 },
  hf_spaces: { everyMin: 60 },
  github: { everyMin: 60 },
  x: { everyMin: X_POLL_DEFAULT_MIN },
  producthunt: { dailyAt: '09:00' },
  tiktok_cc: { dailyAt: '09:00' },
  wikipedia: { dailyAt: '07:00' },
};

const hhmmMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

export function cadenceDue(source: LabRadarSource, state: JobState, now: Date, opts: { tz?: string; env?: Record<string, string | undefined>; cfg?: JobConfig | null } = {}): boolean {
  const c = RADAR_CADENCE[source];
  if ('dailyAt' in c) return dailyDue(state.lastAt, now, hhmmMin(c.dailyAt), opts.tz ?? labTz(opts.env));
  const minutes = source === 'x' ? xPollMinutes(opts.cfg ?? null, opts.env) : c.everyMin;
  return everyMinDue(state.lastAt, now, minutes);
}

const LINES: Partial<Record<LabRadarSource, LabSpendLine[]>> = { x: ['apify.radar_x'], producthunt: ['apify.radar_producthunt'], tiktok_cc: ['apify.radar_tiktok'] };

const ORDER: Record<LabRadarSource, number> = { vendor: 4, hn: 5, hf_models: 6, hf_spaces: 7, github: 8, x: 9, producthunt: 10, tiktok_cc: 11, wikipedia: 12 };

const ctxOf = (ctx: JobCtx, job: string) => radarCtx(ctx.store, { now: ctx.now, dry: ctx.dry, scheduled: true, job });

function sourceJob(source: LabRadarSource): LabJob {
  const id = `radar.${source}` as LabJobId;
  return {
    id,
    order: ORDER[source],
    owner: '05',
    due: (state, now) => cadenceDue(source, state, now),
    needs: (ctx) => sourceNeeds(ctxOf(ctx, id), source)?.reason ?? null,
    lines: LINES[source] ?? [],
    pauseScope: 'radar',
    runKind: null,
    run: async (ctx): Promise<JobResult> => {
      const r = await runSource(ctxOf(ctx, id), source);
      return { ok: r.status === 'ran' || r.status === 'deferred' || r.status === 'skipped', detail: r.detail, items: r.items };
    },
  };
}

/** 08.5.1 rows 4 to 14, section 05's bodies. */
export const RADAR_JOBS: readonly LabJob[] = [
  ...(['vendor', 'hn', 'hf_models', 'hf_spaces', 'github', 'x', 'producthunt', 'tiktok_cc', 'wikipedia'] as const).map(sourceJob),
  {
    id: 'radar.events',
    order: 13,
    owner: '05',
    due: () => true,
    needs: () => null,
    lines: ['llm'],
    pauseScope: 'radar',
    runKind: null,
    run: async (ctx) => {
      const r = await runRadarEvents(ctxOf(ctx, 'radar.events'));
      return { ok: true, detail: `${r.created} created, ${r.confirmed} confirmed, ${r.coverage} coverage rows`, items: r.created + r.confirmed };
    },
  },
  {
    id: 'brief',
    order: 14,
    owner: '05',
    due: (state, now) => briefDue(state.lastAt, now, labTz()),
    needs: () => null,
    lines: [],
    pauseScope: 'radar',
    runKind: null,
    run: async (ctx) => {
      const r = await runBrief(ctxOf(ctx, 'brief'));
      return { ok: true, detail: `${r.items} items; ${r.sent ? 'sent to the Wizard' : `not sent (${r.reason})`}`, items: r.items };
    },
  },
];
