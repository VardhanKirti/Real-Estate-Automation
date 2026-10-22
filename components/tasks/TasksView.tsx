'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { ListChecks, Loader, PauseCircle, Timer, AlertTriangle } from 'lucide-react';
import { StatCard } from '@/components/tasks/StatCard';
import { TaskOverview } from '@/components/tasks/TaskOverview';
import { ScheduleRail } from '@/components/tasks/ScheduleRail';
import { Board } from '@/components/tasks/Board';
import { WorkloadTable } from '@/components/tasks/WorkloadTable';
import { ActivityGraph } from '@/components/tasks/ActivityGraph';
import { OutcomeTrend } from '@/components/tasks/OutcomeTrend';
import {
  taskStats, formatRuntime, type LinkedTask, workloadRows, activityByWeekday, departmentRamp, sinceText,
} from '@/lib/tasks-metrics';
import type { AgentRun, AgentTask, Agent, Department } from '@/lib/schemas';

/**
 * The page body (docs/TASKS-REDESIGN.md §4). Metrics are derived here from the
 * server's data so a mutation only has to `router.refresh()` — one source of
 * truth, no client cache to drift out of step.
 */
export function TasksView({
  tasks, runs, agents, departments, rangeDays, rangeLabel, now, linked = null,
}: {
  tasks: AgentTask[];
  runs: AgentRun[];
  agents: Agent[];
  departments: Department[];
  rangeDays: number;
  rangeLabel: string;
  now: number;
  /** ?task=<id>: the board opens with this task selected */
  linked?: LinkedTask;
}) {
  const router = useRouter();

  const stats = useMemo(() => taskStats(tasks, runs, rangeDays, now), [tasks, runs, rangeDays, now]);
  const rows = useMemo(() => workloadRows(tasks, agents, departments), [tasks, agents, departments]);
  const activity = useMemo(() => activityByWeekday(runs, rangeDays, now), [runs, rangeDays, now]);

  const agentNames = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const deptColorByAgent = useMemo(() => {
    const ramp = departmentRamp(departments);
    return Object.fromEntries(agents.map((a) => [a.id, ramp[a.departmentId] ?? 'var(--accent)']));
  }, [agents, departments]);

  const refresh = () => router.refresh();

  return (
    <div className="flex flex-col gap-4">
      {/* Zone 1 — the stat strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          icon={<ListChecks className="h-3.5 w-3.5" strokeWidth={1.6} />}
          label="Total tasks"
          value={String(stats.total.value)}
          countTo={stats.total.value}
          delta={stats.total.delta}
          caption={`Created in the ${rangeLabel.toLowerCase()}`}
        />
        <StatCard
          icon={<Loader className="h-3.5 w-3.5" strokeWidth={1.6} />}
          label="In progress"
          value={String(stats.inProgress)}
          countTo={stats.inProgress}
          caption="Being worked on right now"
        />
        <StatCard
          icon={<PauseCircle className="h-3.5 w-3.5" strokeWidth={1.6} />}
          label="Needs you"
          value={String(stats.needsYou)}
          countTo={stats.needsYou}
          caption="Blocked until you act"
          tone={stats.needsYou > 0 ? 'warn' : 'default'}
        />
        <StatCard
          icon={<Timer className="h-3.5 w-3.5" strokeWidth={1.6} />}
          label="Agent runtime"
          value={stats.runtimeMs && stats.runsInWindow > 0 ? formatRuntime(stats.runtimeMs.value) : '—'}
          delta={stats.runtimeMs?.delta ?? undefined}
          caption={
            !stats.lastRunAt
              ? 'No agent has run yet'
              : stats.runsInWindow === 0
                ? `No runs in the ${rangeLabel.toLowerCase()} · last run ${sinceText(stats.lastRunAt, now)}`
                : 'Time agents spent running'
          }
        />
        <StatCard
          icon={<AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.6} />}
          label="Overdue"
          value={stats.overdue == null ? '—' : String(stats.overdue)}
          countTo={stats.overdue ?? undefined}
          caption={stats.overdue == null ? 'No due dates set' : 'Past due and not done'}
          tone={stats.overdue ? 'warn' : 'default'}
        />
      </div>

      {/* Zone 2 — overview + schedule */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <TaskOverview tasks={tasks} now={now} />
        <ScheduleRail tasks={tasks} agentNames={agentNames} now={now} />
      </div>

      {/* Zone 3 — the board */}
      <Board
        tasks={tasks}
        agentNames={agentNames}
        deptColorByAgent={deptColorByAgent}
        now={now}
        onChanged={refresh}
        linked={linked}
      />

      {/* Zone 4 — workload + activity */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <WorkloadTable rows={rows} />
        <div id="outcomes" className="flex scroll-mt-6 flex-col gap-4">
          <ActivityGraph
            activity={activity}
            rangeLabel={rangeLabel}
            rangeDays={rangeDays}
            lastRunAt={stats.lastRunAt}
            now={now}
          />
          <OutcomeTrend runs={runs} now={now} lastRunAt={stats.lastRunAt} />
        </div>
      </div>
    </div>
  );
}
