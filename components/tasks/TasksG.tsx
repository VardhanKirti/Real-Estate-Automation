'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import {
  GAreaChart,
  GBarChart,
  GButton,
  GCard,
  GCheck,
  GChip,
  GDelta,
  GDotNumber,
  GEmpty,
  GHeroCard,
  GInput,
  GList,
  GPage,
  GRow,
  GSearch,
  GSectionHeader,
  GSegmented,
  GStat,
  GTable,
  GTag,
  useToast,
  type GColumn,
} from '@/components/g';
import {
  HORIZONS,
  MIN_PREV_TASKS,
  TASK_RANGES,
  activityByWeekday,
  formatRuntime,
  outcomeTrend,
  rangeContaining,
  sinceText,
  taskOverview,
  taskStats,
  todoGroups,
  TASK_STATUS_LABEL,
  type LinkedTask,
  workloadRows,
  type Grain,
  type RangeId,
  type WorkloadRow,
} from '@/lib/tasks-metrics';
import type { AgentDirectory } from '@/lib/agent-directory';
import type { AgentRun, AgentTask } from '@/lib/schemas';
import { AgentSheetHost } from '@/components/agents/AgentSheet';
import { openAgentSheet } from '@/components/agents/agent-param';
import { TimeGrid } from './TimeGrid';

/**
 * /tasks under the GladOS style (glados-ui SPEC S04 §4.3, X5). Same data and
 * the same /api/agents/work calls as the Classic TasksView; presentation and
 * the honest fixes only: two heroes for the numbers that ask the operator to
 * act, small-base deltas hidden (F-T3), one schedule surface (F-T5), the
 * board with a 5 s Undo before a completion is sent (F-T6, AC04.16), an
 * anchored add popover instead of window.prompt (AC04.15), and one Run
 * outcomes card on the page range with honest empty copy (F-T8).
 */
const UNDO_MS = 5000;
const RANGE_LABEL: Record<RangeId, string> = { '7d': '7d', '30d': '30d', '90d': '90d', '12mo': '1y' };
const LOAD_TONE = { low: 'ok', medium: 'warn', high: 'err' } as const;

type RailFilter = { kind: 'blocked' | 'overdue' } | { kind: 'day'; key: string; label: string } | { kind: 'task'; id: string } | null;

export function TasksG({
  tasks,
  runs,
  dir,
  rangeId,
  rangeDays,
  rangeLabel,
  now,
  linked = null,
}: {
  /** ?task=<id> (Home's Needs you, the composer): the board opens filtered to this task */
  linked?: LinkedTask;
  tasks: AgentTask[];
  runs: AgentRun[];
  dir: AgentDirectory;
  rangeId: RangeId;
  rangeDays: number;
  rangeLabel: string;
  now: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();

  const agents = dir.agents;
  const stats = useMemo(() => taskStats(tasks, runs, rangeDays, now), [tasks, runs, rangeDays, now]);
  const rows = useMemo(() => workloadRows(tasks, agents, dir.departments), [tasks, agents, dir.departments]);
  const activity = useMemo(() => activityByWeekday(runs, rangeDays, now), [runs, rangeDays, now]);
  const trend = useMemo(() => outcomeTrend(runs, rangeDays, now), [runs, rangeDays, now]);
  const agentNames = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);

  // open on the finest grain that has something to show (the daily window is short)
  const [grain, setGrain] = useState<Grain>(() => (['daily', 'monthly', 'yearly'] as Grain[]).find((g) => taskOverview(tasks, g, now).some((b) => b.completed + b.pending > 0)) ?? 'daily');
  const overview = useMemo(() => taskOverview(tasks, grain, now), [tasks, grain, now]);

  const [filter, setFilterState] = useState<RailFilter>(() => (linked ? { kind: 'task', id: linked.id } : null));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const board = useRef<HTMLDivElement>(null);
  // a deep link lands on the board, not the top of the page
  const linkedId = linked?.id ?? null;
  useEffect(() => {
    if (!linkedId) return;
    setFilterState({ kind: 'task', id: linkedId });
    board.current?.scrollIntoView({ block: 'start' });
  }, [linkedId]);
  // leaving a linked task also drops ?task from the URL, so a reload does not reopen it
  const setFilter = (f: RailFilter) => {
    if (filter?.kind === 'task' && f?.kind !== 'task' && params?.get('task')) {
      const next = new URLSearchParams(params.toString());
      next.delete('task');
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    }
    setFilterState(f);
  };

  const setRange = (id: RangeId) => {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.set('range', id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const showRail = (f: RailFilter) => {
    setFilter(f);
    board.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Complete with a 5 s Undo window: the row hides at once, the PATCH fires only when the window closes.
  const complete = (t: AgentTask) => {
    setHidden((h) => new Set(h).add(t.id));
    const timer = setTimeout(async () => {
      timers.current.delete(t.id);
      await fetch('/api/agents/work', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'task', id: t.id, status: 'done' }),
      }).catch(() => null);
      router.refresh();
    }, UNDO_MS);
    timers.current.set(t.id, timer);
    toast({
      text: `Completed “${t.title}”`,
      tone: 'ok',
      ms: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const tm = timers.current.get(t.id);
          if (tm) clearTimeout(tm);
          timers.current.delete(t.id);
          setHidden((h) => {
            const n = new Set(h);
            n.delete(t.id);
            return n;
          });
        },
      },
    });
  };

  const create = async (title: string, horizon: string | null, dueAt: string | null) => {
    await fetch('/api/agents/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'task', title, ownerKind: 'me', agentId: null, horizon, dueAt }),
    }).catch(() => null);
    router.refresh();
  };

  const live = tasks.filter((t) => !hidden.has(t.id));
  const runtimeText = stats.runtimeMs && stats.runsInWindow > 0 ? formatRuntime(stats.runtimeMs.value) : null;
  const wl = rangeLabel.toLowerCase();

  return (
    <GPage className="wg-page">
      <GSectionHeader
        size="page"
        title="Tasks"
        caption={`Agent work across the board · ${wl}`}
        action={
          <div className="wg-head-actions">
            <GSegmented<RangeId> label="Range" value={rangeId} onChange={setRange} options={TASK_RANGES.map((r) => ({ value: r.id, label: RANGE_LABEL[r.id], title: r.label }))} />
            <GButton variant="ink" href={`/api/tasks/export?range=${rangeId}`} download>
              <Download size={14} strokeWidth={1.75} aria-hidden /> Export
            </GButton>
          </div>
        }
      />

      {/* Zone 1: the two numbers that ask the operator to act, then three plain stats */}
      <div className="wg-tasks-top">
        <GHeroCard
          variant="a"
          size="sm"
          caption="Needs you"
          value={stats.needsYou}
          status="blocked until you act"
          title="Tasks with status blocked. Shows them on the board."
          onClick={() => showRail({ kind: 'blocked' })}
        />
        <GHeroCard
          variant="b"
          size="sm"
          caption="Overdue"
          value={stats.overdue}
          status={stats.overdue == null ? 'no due dates set' : 'past due, not done'}
          title="Tasks past their due date and not done. Shows them on the board."
          onClick={() => showRail({ kind: 'overdue' })}
        />
        <GCard className="wg-tasks-stats">
          <GStat
            value={stats.total.value}
            label="Total tasks"
            source={`Tasks created in the ${wl}`}
            extra={<GDelta cur={stats.total.value} prev={stats.total.prev} min={MIN_PREV_TASKS} window={`vs the previous ${rangeDays} days`} />}
          />
          <GStat value={stats.inProgress} label="In progress" source="Tasks being worked on right now" />
          <GStat
            value={runtimeText}
            label="Agent runtime"
            source={`Time agents spent running in the ${wl}`}
            extra={
              runtimeText ? (
                stats.runtimeMs?.delta != null ? <GDelta cur={stats.runtimeMs.value} prev={stats.runtimeMs.prev} window={`vs the previous ${rangeDays} days`} /> : null
              ) : (
                <span className="wg-cap">{stats.lastRunAt ? `last run ${sinceText(stats.lastRunAt, now)}` : 'no runs recorded'}</span>
              )
            }
          />
        </GCard>
      </div>

      {/* Zone 2: overview + due next */}
      <div className="wg-tasks-2">
        <GCard>
          <GSectionHeader
            size={22}
            title="Task overview"
            caption="Completed and pending, by when they were created"
            action={
              <GSegmented<Grain>
                label="Grain"
                value={grain}
                onChange={setGrain}
                options={[
                  { value: 'daily', label: 'Daily' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'yearly', label: 'Yearly' },
                ]}
              />
            }
          />
          <GBarChart
            variant="grouped"
            label={`Tasks completed and pending, ${grain}`}
            height={180}
            keys={[
              { id: 'completed', label: 'Completed', color: 'muted' },
              { id: 'pending', label: 'Pending', color: 'accent' },
            ]}
            groups={overview.map((b) => ({ id: b.label, label: b.label, values: [b.completed, b.pending] }))}
            state={overview.every((b) => b.completed + b.pending === 0) ? 'empty' : 'ready'}
            emptyText="No tasks in this window"
            className="wg-chart"
          />
        </GCard>
        <DueNext tasks={live} agentNames={agentNames} now={now} onAdd={() => showRail(null)} />
      </div>

      {/* Zone 3: the board */}
      <div ref={board} className="wg-anchor">
        <GCard className="wg-board">
          <TodoRail tasks={live} filter={filter} setFilter={setFilter} agentNames={agentNames} now={now} onComplete={complete} onCreate={(title, horizon) => create(title, horizon, null)} />
          <TimeGrid
            tasks={live}
            agentNames={agentNames}
            now={now}
            dayFilter={filter?.kind === 'day' ? filter.key : null}
            onDay={(key, label) => setFilter(key ? { kind: 'day', key, label } : null)}
            onAdd={(title, at) => create(title, null, at.toISOString())}
          />
        </GCard>
      </div>

      {/* Zone 4: workload + outcomes */}
      <div className="wg-tasks-4">
        <Workload rows={rows} />
        <Outcomes trend={trend} activity={activity} runsTotal={runs.length} lastRunAt={stats.lastRunAt} rangeDays={rangeDays} rangeLabel={wl} now={now} onWiden={setRange} />
      </div>
      <AgentSheetHost dir={dir} />
    </GPage>
  );
}

function DueNext({ tasks, agentNames, now, onAdd }: { tasks: AgentTask[]; agentNames: Record<string, string>; now: number; onAdd: () => void }) {
  const next = tasks
    .filter((t) => t.dueAt && t.status !== 'done')
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
    .slice(0, 5);
  return (
    <GCard>
      <GSectionHeader size={22} title="Due next" caption="The next five dated tasks" />
      {next.length === 0 ? (
        <GEmpty inline title="Nothing has a due date" action={{ label: 'Add a to-do', onClick: onAdd }} />
      ) : (
        <GList>
          {next.map((t) => {
            const late = Date.parse(t.dueAt!) < now;
            return (
              <GRow
                key={t.id}
                title={t.title}
                meta={t.agentId ? agentNames[t.agentId] ?? t.agentId : 'You'}
                trailing={late ? <GTag tone="err">Overdue {sinceText(t.dueAt!, now)}</GTag> : <span className="wg-cap">{new Date(t.dueAt!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
                onClick={t.agentId ? () => openAgentSheet(t.agentId!) : undefined}
              />
            );
          })}
        </GList>
      )}
    </GCard>
  );
}

function TodoRail({
  tasks,
  filter,
  setFilter,
  agentNames,
  now,
  onComplete,
  onCreate,
}: {
  tasks: AgentTask[];
  filter: RailFilter;
  setFilter: (f: RailFilter) => void;
  agentNames: Record<string, string>;
  now: number;
  onComplete: (t: AgentTask) => void;
  onCreate: (title: string, horizon: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [horizon, setHorizon] = useState<string>('week');
  const groups = todoGroups(tasks);
  const filtered =
    filter == null
      ? null
      : filter.kind === 'task'
        ? tasks.filter((t) => t.id === filter.id)
        : tasks.filter((t) => {
          if (t.status === 'done') return false;
          if (filter.kind === 'blocked') return t.status === 'blocked';
          if (filter.kind === 'overdue') return t.dueAt != null && Date.parse(t.dueAt) < now;
          const key = filter.kind === 'day' ? filter.key : '';
          return t.dueAt != null && new Date(t.dueAt).toDateString() === key;
        });
  const filterLabel = filter?.kind === 'task' ? 'Linked task' : filter?.kind === 'blocked' ? 'Blocked' : filter?.kind === 'overdue' ? 'Overdue' : filter?.kind === 'day' ? `Due ${filter.label}` : '';

  const owner = (t: AgentTask) => (t.agentId ? agentNames[t.agentId] ?? t.agentId : 'You');
  const row = (t: AgentTask) => {
    const focus = filter?.kind === 'task' && t.id === filter.id;
    return (
      <GRow
        key={t.id}
        selected={focus}
        leading={t.status === 'done' ? undefined : <GCheck checked={false} onCheckedChange={() => onComplete(t)} aria-label={`Complete ${t.title}`} />}
        title={t.title}
        meta={focus ? `${owner(t)} · ${TASK_STATUS_LABEL[t.status]}` : filter ? owner(t) : undefined}
        hint={focus && t.detail ? t.detail : undefined}
      />
    );
  };

  return (
    <div className="wg-rail" data-task-focus={filter?.kind === 'task' ? filter.id : undefined}>
      <GSectionHeader size={22} title="To-do" />
      {filter && (
        <div className="wg-rail-filter">
          <GChip pressed onPressedChange={() => setFilter(null)} title="Clear the filter">
            {filterLabel} · {filtered?.length ?? 0}
          </GChip>
        </div>
      )}
      {filtered ? (
        filtered.length === 0 ? (
          <p className="wg-cap">
            {filter?.kind === 'task' ? 'That task is no longer on the board.' : 'Nothing here.'}
          </p>
        ) : <GList label={filterLabel}>{filtered.map(row)}</GList>
      ) : groups.length === 0 ? (
        <p className="wg-cap">Nothing on your own list.</p>
      ) : (
        groups.map((g) => (
          <div key={g.id} className="wg-rail-group">
            <span className="wg-cap">
              {g.label} · {g.tasks.length}
            </span>
            <GList label={g.label}>{g.tasks.map(row)}</GList>
          </div>
        ))
      )}
      <form
        className="wg-rail-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onCreate(draft.trim(), horizon);
          setDraft('');
        }}
      >
        <div className="wg-inline-add">
          <GInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a to-do" aria-label="New to-do" />
          <GButton type="submit" variant="icon" aria-label="Add to-do" disabled={!draft.trim()} disabledReason="Type a title first">
            <Plus size={16} strokeWidth={1.75} aria-hidden />
          </GButton>
        </div>
        <GSegmented label="Horizon" size="compact" value={horizon} onChange={setHorizon} options={HORIZONS.map((h) => ({ value: h.id, label: h.label.replace('This ', '') }))} />
      </form>
    </div>
  );
}

function Workload({ rows }: { rows: WorkloadRow[] }) {
  const [q, setQ] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const shown = rows.filter((r) => (!q || `${r.name} ${r.department}`.toLowerCase().includes(q.toLowerCase())) && (!openOnly || r.ongoing + r.pending > 0));
  const columns: GColumn<WorkloadRow>[] = [
    {
      key: 'name',
      label: 'Agent',
      sortValue: (r) => r.name,
      render: (r) => (
        <GButton size="compact" onClick={() => openAgentSheet(r.agentId)} title={`Open ${r.name} · ${r.department}`}>
          {r.name}
        </GButton>
      ),
    },
    { key: 'assigned', label: 'Assigned', numeric: true, sortValue: (r) => r.assigned, render: (r) => r.assigned },
    { key: 'done', label: 'Done', numeric: true, sortValue: (r) => r.completed, render: (r) => r.completed },
    { key: 'doing', label: 'In progress', numeric: true, sortValue: (r) => r.ongoing, render: (r) => r.ongoing },
    { key: 'pending', label: 'Pending', numeric: true, sortValue: (r) => r.pending, render: (r) => r.pending },
    {
      key: 'load',
      label: 'Load',
      title: 'Open work against the fleet median',
      sortValue: (r) => (r.load === 'high' ? 2 : r.load === 'medium' ? 1 : 0),
      render: (r) => <GTag tone={LOAD_TONE[r.load]}>{r.load}</GTag>,
    },
  ];
  return (
    <GCard>
      <GSectionHeader
        size={22}
        title="Workload"
        caption={`${rows.length} agents holding work`}
        action={
          <div className="wg-head-actions">
            <GSearch size="md" value={q} onValueChange={setQ} placeholder="Search" aria-label="Search agents" />
            <GChip pressed={openOnly} onPressedChange={setOpenOnly}>
              Open only
            </GChip>
          </div>
        }
      />
      <div className="wg-table-wrap">
        <GTable caption="Workload by agent" columns={columns} rows={shown} rowKey={(r) => r.agentId} sort={{ key: 'assigned', dir: 'desc' }} empty="No agent holds work" />
      </div>
    </GCard>
  );
}

function Outcomes({
  trend,
  activity,
  runsTotal,
  lastRunAt,
  rangeDays,
  rangeLabel,
  now,
  onWiden,
}: {
  trend: ReturnType<typeof outcomeTrend>;
  activity: ReturnType<typeof activityByWeekday>;
  runsTotal: number;
  lastRunAt: string | null;
  rangeDays: number;
  rangeLabel: string;
  now: number;
  onWiden: (id: RangeId) => void;
}) {
  let body;
  if (!trend || !activity) {
    if (runsTotal === 0 || !lastRunAt) {
      body = (
        <GEmpty
          inline
          kind="unconfigured"
          title="No agent runs recorded yet"
          body="Success rate is measured from real runs."
          setupHref="/agents"
          setupHint="Agents run on the host; bring one online to start recording runs."
        />
      );
    } else {
      const wider = rangeContaining(lastRunAt, now);
      const offer = wider && wider.days > rangeDays ? wider : null;
      body = (
        <GEmpty
          inline
          title={`No runs in the ${rangeLabel} · last run ${sinceText(lastRunAt, now)}`}
          body="The success rate is measured from runs in the page range."
          action={offer ? { label: `Widen to ${offer.days === 365 ? '12 months' : `${offer.days} days`}`, onClick: () => onWiden(offer.id) } : undefined}
        />
      );
    }
  } else {
    const total = trend.succeeded + trend.failed;
    body = (
      <>
        <div className="wg-outcomes-num">
          <GDotNumber value={`${activity.pct}%`} size={4} label={`${activity.pct}% of runs succeeded`} />
          <span className="wg-cap">
            of {total.toLocaleString()} runs succeeded · {rangeLabel}
          </span>
        </div>
        <GAreaChart
          label={`Runs succeeded and failed per day · ${rangeLabel}`}
          labels={trend.points.map((p) => p.label)}
          series={[
            { id: 'ok', label: 'Succeeded', values: trend.points.map((p) => p.succeeded), color: 'accent' },
            { id: 'fail', label: 'Failed', values: trend.points.map((p) => p.failed), color: 'err' },
          ]}
          height={120}
          className="wg-chart"
        />
        <span className="wg-cap">Busiest weekday: {activity.days[activity.peakIndex].label}</span>
        <GBarChart
          variant="series"
          label="Runs per weekday"
          height={56}
          bars={activity.days.map((d) => ({ id: d.label, label: d.label, value: d.runs }))}
          highlight={activity.days[activity.peakIndex].label}
        />
      </>
    );
  }
  return (
    <GCard id="outcomes" className="wg-anchor">
      <GSectionHeader size={22} title="Run outcomes" caption={`Fleet runs · ${rangeLabel}`} />
      <div className="wg-outcomes">{body}</div>
    </GCard>
  );
}
