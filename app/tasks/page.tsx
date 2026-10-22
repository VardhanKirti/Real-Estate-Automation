import { getDb } from '@/lib/data';
import { PageHeader } from '@/components/PageHeader';
import { RangePill } from '@/components/tasks/RangePill';
import { TasksView } from '@/components/tasks/TasksView';
import { linkedTask, resolveRange } from '@/lib/tasks-metrics';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { buildAgentDirectory } from '@/lib/agent-directory';
import { TasksG } from '@/components/tasks/TasksG';

export const dynamic = 'force-dynamic';

/**
 * Tasks — the overhaul from docs/TASKS-REDESIGN.md. The range lives in the
 * URL and is resolved here, so every metric on the page is computed against
 * one window rather than each panel choosing its own.
 */
export default function TasksPage(props: { searchParams?: { range?: string; task?: string } }) {
  const db = getDb();
  // `props?` because the smoke test renders every page with no arguments at
  // all; a default parameter here would fail Next's generated PageProps.
  const range = resolveRange(props?.searchParams?.range);
  const tasks = db.agentTasks.all();
  // ?task=<id> (Home's Needs you, the composer): open the board on that task
  const linked = linkedTask(tasks, props?.searchParams?.task);
  // a year of runs covers the widest range the pill offers
  const runs = db.agentRuns.recent(5000);

  // GladOS tree (glados-ui SPEC S04 §4.3, X5): same data, kit presentation.
  if (treeFor(getAppearance(), '/tasks') === 'glados') {
    return <TasksG tasks={tasks} runs={runs} dir={buildAgentDirectory(db)} rangeId={range.id} rangeDays={range.days} rangeLabel={range.label} now={Date.now()} linked={linked} />;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Agent work across the board"
        title="Tasks"
        right={<RangePill range={range.id} />}
      />
      <TasksView
        tasks={tasks}
        runs={runs}
        agents={db.agents.all()}
        departments={db.departments.all()}
        rangeDays={range.days}
        rangeLabel={range.label}
        now={Date.now()}
        linked={linked}
      />
    </div>
  );
}
