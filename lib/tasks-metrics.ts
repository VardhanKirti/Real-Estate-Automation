/**
 * Every number on /tasks, derived here rather than in a component
 * (docs/TASKS-REDESIGN.md §2). The reference dashboards this page clones are
 * human team tools; their tiles are re-sourced onto what GladOS actually
 * records — `agent_tasks` for the work, `agent_runs` for what happened.
 *
 * Nothing here invents a number. A metric with no substrate returns null and
 * the tile renders its honest empty state instead of a flattering zero.
 */
import type { AgentRun, AgentTask, Agent, Department } from '@/lib/schemas';

export type RangeId = '7d' | '30d' | '90d' | '12mo';

export const TASK_RANGES: { id: RangeId; label: string; days: number }[] = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: '12mo', label: 'Last 12 months', days: 365 },
];

export function resolveRange(param: string | null | undefined): (typeof TASK_RANGES)[number] {
  return TASK_RANGES.find((r) => r.id === param) ?? TASK_RANGES[1];
}

const DAY = 86_400_000;
const ms = (iso: string): number => new Date(iso).getTime();
const within = (iso: string, from: number, to: number): boolean => {
  const t = ms(iso);
  return Number.isFinite(t) && t >= from && t < to;
};

/** Small-base thresholds (S04 F-T3, H26): a delta pill shows only when the
 *  previous window held at least this many items. Below it a percentage is
 *  noise ("850%" off a base of 2), so the pill is hidden. */
export const MIN_PREV_TASKS = 5;
export const MIN_PREV_RUNS = 10;

/**
 * Percentage change, or null when the previous value is under `min` (or not
 * positive): an increase from nothing or from a tiny base is not a number
 * worth showing.
 *
 * Local stand-in for `deltaIfMeaningful` in `lib/delta.ts` (SPEC X4, C41),
 * which lane 0a owns; same signature and rule, so the Phase 0 merge swaps
 * this for an import.
 */
export function deltaIfMeaningful(cur: number, prev: number, min: number): number | null {
  if (!(prev > 0) || prev < min) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** A headline number plus its change against the identical preceding window.
 *  `delta` is null when the previous window is under the small-base
 *  threshold; `prev` is that window's value. */
export type Stat = { value: number; prev: number; delta: number | null };

function stat(now: number, days: number, min: number, count: (from: number, to: number) => number): Stat {
  const from = now - days * DAY;
  const prevFrom = from - days * DAY;
  const value = count(from, now);
  const prev = count(prevFrom, from);
  return { value, prev, delta: deltaIfMeaningful(value, prev, min) };
}

/** Newest run start across every run passed in, or null. */
export function latestRunAt(runs: AgentRun[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const r of runs) {
    const t = ms(r.startedAt);
    if (Number.isFinite(t) && t > bestMs) {
      bestMs = t;
      best = r.startedAt;
    }
  }
  return best;
}

/** "just now", "12m ago", "5h ago", "46d ago": the "last run" caption. */
export function sinceText(iso: string, now: number): string {
  const mins = Math.floor((now - ms(iso)) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The smallest page range that would contain `iso` (the "Widen to ..."
 *  action on an empty run chart); null when even a year is too short. */
export function rangeContaining(iso: string, now: number): (typeof TASK_RANGES)[number] | null {
  const age = now - ms(iso);
  return TASK_RANGES.find((r) => r.days * DAY > age) ?? null;
}

export type TaskStats = {
  /** created in the window */
  total: Stat;
  inProgress: number;
  /** status `blocked` — waiting on the operator */
  needsYou: number;
  /** summed agent_run durations in the window; null when nothing has run.
   *  Its delta is gated on the previous window's run count, not its ms. */
  runtimeMs: Stat | null;
  /** runs started inside the window */
  runsInWindow: number;
  /** newest run on record (any window); null when nothing has run */
  lastRunAt: string | null;
  /** past due and not done; null when no task carries a due date at all */
  overdue: number | null;
  completed: Stat;
};

export function taskStats(
  tasks: AgentTask[],
  runs: AgentRun[],
  days: number,
  now: number,
): TaskStats {
  const countCreated = (from: number, to: number) =>
    tasks.filter((t) => within(t.createdAt, from, to)).length;
  const countDone = (from: number, to: number) =>
    tasks.filter((t) => t.status === 'done' && within(t.updatedAt, from, to)).length;

  const runtime = (from: number, to: number) =>
    runs
      .filter((r) => within(r.startedAt, from, to))
      .reduce((sum, r) => sum + Math.max(0, ms(r.finishedAt) - ms(r.startedAt)), 0);

  const countRuns = (from: number, to: number) =>
    runs.filter((r) => within(r.startedAt, from, to)).length;

  const dated = tasks.filter((t) => t.dueAt != null);

  const curRuns = countRuns(now - days * DAY, now);
  let runtimeMs: Stat | null = null;
  if (runs.length > 0) {
    const rt = stat(now, days, 0, runtime);
    const prevRuns = countRuns(now - 2 * days * DAY, now - days * DAY);
    // nothing ran in this window: no "down 100%"; the tile shows "—" + last run
    const meaningful = curRuns > 0 && prevRuns >= MIN_PREV_RUNS;
    runtimeMs = { ...rt, delta: meaningful ? deltaIfMeaningful(rt.value, rt.prev, 1) : null };
  }

  return {
    total: stat(now, days, MIN_PREV_TASKS, countCreated),
    inProgress: tasks.filter((t) => t.status === 'doing').length,
    needsYou: tasks.filter((t) => t.status === 'blocked').length,
    runtimeMs,
    runsInWindow: curRuns,
    lastRunAt: latestRunAt(runs),
    overdue:
      dated.length === 0
        ? null
        : dated.filter((t) => t.status !== 'done' && ms(t.dueAt!) < now).length,
    completed: stat(now, days, MIN_PREV_TASKS, countDone),
  };
}

/** `142h 40m`, the reference's own format. */
export function formatRuntime(msTotal: number): string {
  const totalMinutes = Math.round(msTotal / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Task overview — paired Pending / Completed bars ────────────────────────

export type Grain = 'daily' | 'monthly' | 'yearly';
export type OverviewBucket = { label: string; pending: number; completed: number };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Buckets for the paired-bar chart. `pending` counts tasks created in the
 * bucket that are not done; `completed` counts tasks that reached done in it.
 * Daily = trailing 14 days, monthly = 12 months, yearly = 5 years.
 */
export function taskOverview(tasks: AgentTask[], grain: Grain, now: number): OverviewBucket[] {
  const buckets: { label: string; from: number; to: number }[] = [];
  const d = new Date(now);

  if (grain === 'daily') {
    for (let i = 13; i >= 0; i--) {
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      const from = day.getTime();
      buckets.push({ label: WEEKDAYS[day.getDay()], from, to: from + DAY });
    }
  } else if (grain === 'monthly') {
    for (let i = 11; i >= 0; i--) {
      const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
      buckets.push({ label: MONTHS[start.getMonth()], from: start.getTime(), to: end.getTime() });
    }
  } else {
    for (let i = 4; i >= 0; i--) {
      const start = new Date(d.getFullYear() - i, 0, 1);
      const end = new Date(d.getFullYear() - i + 1, 0, 1);
      buckets.push({ label: String(start.getFullYear()), from: start.getTime(), to: end.getTime() });
    }
  }

  return buckets.map((b) => ({
    label: b.label,
    pending: tasks.filter((t) => t.status !== 'done' && within(t.createdAt, b.from, b.to)).length,
    completed: tasks.filter((t) => t.status === 'done' && within(t.updatedAt, b.from, b.to)).length,
  }));
}

// ── Workload, by agent ─────────────────────────────────────────────────────

export type LoadLevel = 'low' | 'medium' | 'high';
export type WorkloadRow = {
  agentId: string;
  name: string;
  department: string;
  departmentColor: string;
  assigned: number;
  completed: number;
  ongoing: number;
  pending: number;
  load: LoadLevel;
};

/**
 * One row per agent that holds work. Load is banded against the fleet's own
 * median open load, so it means "busy relative to this fleet" rather than
 * against a number invented here.
 */
/**
 * Department -> a colour from the app's categorical data ramp, by position.
 * The departments' own colours are a greyscale identity palette, which is
 * right on the org chart and useless for telling cards apart on a calendar;
 * the ramp is the token set meant for exactly this.
 */
export function departmentRamp(departments: Department[]): Record<string, string> {
  return Object.fromEntries(departments.map((d, i) => [d.id, `var(--ramp-${(i % 4) + 1})`]));
}

export function workloadRows(
  tasks: AgentTask[],
  agents: Agent[],
  departments: Department[],
): WorkloadRow[] {
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const ramp = departmentRamp(departments);
  const rows = agents
    .map((a) => {
      const mine = tasks.filter((t) => t.agentId === a.id);
      const dept = deptById.get(a.departmentId);
      return {
        agentId: a.id,
        name: a.name,
        department: dept?.name ?? '—',
        departmentColor: ramp[a.departmentId] ?? 'var(--text-3)',
        assigned: mine.length,
        completed: mine.filter((t) => t.status === 'done').length,
        ongoing: mine.filter((t) => t.status === 'doing').length,
        pending: mine.filter((t) => t.status === 'open' || t.status === 'blocked').length,
        load: 'low' as LoadLevel,
      };
    })
    .filter((r) => r.assigned > 0);

  const openLoads = rows.map((r) => r.ongoing + r.pending).sort((a, b) => a - b);
  // a true median — taking the upper of the middle pair let the busiest agent
  // in an even-sized fleet band as "medium"
  const mid = Math.floor(openLoads.length / 2);
  const median =
    openLoads.length === 0
      ? 0
      : openLoads.length % 2 === 1
        ? openLoads[mid]
        : (openLoads[mid - 1] + openLoads[mid]) / 2;
  for (const r of rows) {
    const open = r.ongoing + r.pending;
    r.load = open > median * 1.5 ? 'high' : open >= median ? 'medium' : 'low';
  }
  return rows.sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
}

// ── My Activity — weekday success rate ─────────────────────────────────────

export type ActivityDay = { label: string; pct: number; runs: number };
export type Activity = {
  /** overall success rate across the window */
  pct: number;
  delta: number | null;
  days: ActivityDay[];
  /** index of the busiest day — the one the marker line points at */
  peakIndex: number;
  peakRuns: number;
};

/** Success rate per weekday from `agent_runs.ok`. Null when nothing has run:
 *  the panel says so rather than drawing a flat zero. */
export function activityByWeekday(runs: AgentRun[], days: number, now: number): Activity | null {
  const from = now - days * DAY;
  const win = runs.filter((r) => within(r.startedAt, from, now));
  if (win.length === 0) return null;

  const buckets = WEEKDAYS.map((label) => ({ label, ok: 0, runs: 0 }));
  for (const r of win) {
    const b = buckets[new Date(r.startedAt).getDay()];
    b.runs++;
    if (r.ok) b.ok++;
  }
  // Monday-first, like the reference
  const ordered = [...buckets.slice(1), buckets[0]];

  const prev = runs.filter((r) => within(r.startedAt, from - days * DAY, from));
  const rate = (list: AgentRun[]) =>
    list.length === 0 ? null : Math.round((list.filter((r) => r.ok).length / list.length) * 100);
  const pct = rate(win)!;
  const prevPct = prev.length >= MIN_PREV_RUNS ? rate(prev) : null;

  let peakIndex = 0;
  ordered.forEach((b, i) => {
    if (b.runs > ordered[peakIndex].runs) peakIndex = i;
  });

  return {
    pct,
    delta: prevPct == null ? null : pct - prevPct,
    days: ordered.map((b) => ({
      label: b.label,
      pct: b.runs === 0 ? 0 : Math.round((b.ok / b.runs) * 100),
      runs: b.runs,
    })),
    peakIndex,
    peakRuns: ordered[peakIndex].runs,
  };
}

// ── Outcome trend — succeeded vs failed over a short window ────────────────

export type OutcomePoint = { label: string; succeeded: number; failed: number };
export type OutcomeTrend = {
  points: OutcomePoint[];
  succeeded: number;
  failed: number;
  /** change in success rate against the preceding window, in points */
  delta: number | null;
};

export function outcomeTrend(runs: AgentRun[], days: number, now: number): OutcomeTrend | null {
  const from = now - days * DAY;
  const win = runs.filter((r) => within(r.startedAt, from, now));
  if (win.length === 0) return null;

  const d = new Date(now);
  const points: OutcomePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    const a = day.getTime();
    const dayRuns = win.filter((r) => within(r.startedAt, a, a + DAY));
    points.push({
      label: `${day.getDate()} ${MONTHS[day.getMonth()]}`,
      succeeded: dayRuns.filter((r) => r.ok).length,
      failed: dayRuns.filter((r) => !r.ok).length,
    });
  }

  const rate = (list: AgentRun[]) =>
    list.length === 0 ? null : (list.filter((r) => r.ok).length / list.length) * 100;
  const prevRuns = runs.filter((r) => within(r.startedAt, from - days * DAY, from));
  const prevRate = prevRuns.length >= MIN_PREV_RUNS ? rate(prevRuns) : null;
  const nowRate = rate(win)!;

  return {
    points,
    succeeded: win.filter((r) => r.ok).length,
    failed: win.filter((r) => !r.ok).length,
    delta: prevRate == null ? null : Math.round((nowRate - prevRate) * 10) / 10,
  };
}

// ── Task deep link (?task=<id>) ────────────────────────────────────────────

export const TASK_STATUS_LABEL: Record<AgentTask['status'], string> = { open: 'Open', doing: 'In progress', blocked: 'Blocked', done: 'Done' };

/**
 * The task a `/tasks?task=<id>` link asks for (Home's Needs you rows, the
 * interject composer's toast; lib/home-today.ts `taskHref`). Null when the URL
 * names none; `task: null` when it names one that is not on the board any more,
 * so the page can say so instead of silently showing nothing.
 */
export type LinkedTask = { id: string; task: AgentTask | null } | null;

export function linkedTask(tasks: AgentTask[], id: string | string[] | null | undefined): LinkedTask {
  const want = (Array.isArray(id) ? id[0] : id)?.trim();
  if (!want) return null;
  return { id: want, task: tasks.find((t) => t.id === want) ?? null };
}

// ── To-Do rail grouping ────────────────────────────────────────────────────

export const HORIZONS: { id: 'week' | 'month' | 'quarter' | 'someday'; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'someday', label: 'Someday' },
];

/** The operator's own lane, grouped for the rail. Tasks with no horizon fall
 *  into an Unsorted group so nothing is silently hidden. */
export function todoGroups(tasks: AgentTask[]): { id: string; label: string; tasks: AgentTask[] }[] {
  const mine = tasks.filter((t) => t.ownerKind === 'me' && t.status !== 'done');
  const groups: { id: string; label: string; tasks: AgentTask[] }[] = HORIZONS.map((h) => ({
    id: h.id as string,
    label: h.label,
    tasks: mine.filter((t) => t.horizon === h.id),
  }));
  const unsorted = mine.filter((t) => t.horizon == null);
  if (unsorted.length > 0) groups.push({ id: 'unsorted', label: 'Unsorted', tasks: unsorted });
  return groups.filter((g) => g.tasks.length > 0);
}
