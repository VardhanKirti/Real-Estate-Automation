import os from 'node:os';
import path from 'node:path';
import type { LabStore } from '@/lib/lab/store';

/**
 * The launchd schedule for the Lab sync (SPEC §4.2): LaunchAgent `glados.agent.lab`
 * (template: deploy/glados.agent.lab.plist) runs `scripts/lab-sync.ts sync` at fixed
 * hours. The job honours the operator's kill switch: a `PAUSED` file (everything) or
 * `PAUSED-lab` (this job) in the brain's Automation folder stops it before any read.
 *
 * The Sources tab reads the `schedule` prior ({ label, nextAt }); the installer writes it
 * with `lab-sync mark-scheduled` and each sync refreshes nextAt. Until then the view says
 * "Not scheduled yet".
 */

export const LAB_AGENT_LABEL = 'glados.agent.lab';
/** Local hours the plist template fires at (StartCalendarInterval). Keep in sync with deploy/glados.agent.lab.plist. */
export const SYNC_HOURS = [0, 6, 12, 18] as const;
/** `PAUSED-radar` (05) stops only the radar jobs and the morning brief (scope 'radar'). */
export const PAUSE_FILES = ['PAUSED', 'PAUSED-lab', 'PAUSED-radar'] as const;
export const RADAR_PAUSE_FILE = 'PAUSED-radar';
const SCOPE_FILES: Record<'lab' | 'radar', readonly string[]> = { lab: ['PAUSED', 'PAUSED-lab'], radar: PAUSE_FILES };
/** v2 (08.5.1): the LaunchAgent fires `lab-sync tick` every 15 minutes. */
export const TICK_LABEL = 'Every 15 minutes on this machine';
export const TICK_INTERVAL_S = 900;

/** Where the Automation folder may live, in the order lib/agents/real.ts looks. */
export function automationDirs(env: Record<string, string | undefined> = process.env, home = os.homedir()): string[] {
  return [env.GLADOS_AUTOMATION_DIR, path.join(home, 'Sync/brain/Automation'), path.join(home, 'Desktop/brain/Automation')].filter((p): p is string => Boolean(p));
}

/**
 * The kill-switch file that is set, or null. `exists` is injectable for tests. Scope 'lab' (the
 * default, every job) honours PAUSED and PAUSED-lab; scope 'radar' (05: radar jobs and the brief)
 * also honours PAUSED-radar.
 */
export function pausedBy(dirs: readonly string[], exists: (p: string) => boolean, scope: 'lab' | 'radar' = 'lab'): string | null {
  for (const d of dirs) for (const f of SCOPE_FILES[scope]) if (exists(path.join(d, f))) return path.join(d, f);
  return null;
}

/** The PAUSED-radar file when set, else null. */
export function radarPausedBy(dirs: readonly string[], exists: (p: string) => boolean): string | null {
  for (const d of dirs) if (exists(path.join(d, RADAR_PAUSE_FILE))) return path.join(d, RADAR_PAUSE_FILE);
  return null;
}

/** The next local fire time after `now` for the given hours. */
export function nextRunAt(now: Date, hours: readonly number[] = SYNC_HOURS): Date {
  const sorted = [...hours].sort((a, b) => a - b);
  for (let day = 0; day < 2; day++) {
    for (const h of sorted) {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, h, 0, 0, 0);
      if (t.getTime() > now.getTime()) return t;
    }
  }
  return new Date(now.getTime() + 86_400_000);
}

export function scheduleLabel(hours: readonly number[] | 'tick' = 'tick'): string {
  if (hours === 'tick') return TICK_LABEL;
  return `Every ${24 / hours.length} hours on this machine (${hours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')})`;
}

/** Record that the LaunchAgent is installed (the view's `schedule.installed`). */
export function markScheduled(store: LabStore, now: Date, label = scheduleLabel()): void {
  const tick = label === TICK_LABEL;
  const nextAt = tick ? new Date(Math.ceil((now.getTime() + 1) / (TICK_INTERVAL_S * 1000)) * TICK_INTERVAL_S * 1000) : nextRunAt(now);
  store.priors.set({ key: 'schedule', value: { label, nextAt: nextAt.toISOString(), agent: LAB_AGENT_LABEL, ...(tick ? { interval: TICK_INTERVAL_S } : {}) }, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
}

/** After a scheduled sync: move nextAt forward when a schedule is recorded. */
export function touchSchedule(store: LabStore, now: Date): void {
  const cur = store.priors.get('schedule');
  const v = cur?.value as { label?: string } | null | undefined;
  if (v?.label) markScheduled(store, now, v.label);
}
