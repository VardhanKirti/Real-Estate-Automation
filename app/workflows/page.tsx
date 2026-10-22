import { getDb } from '@/lib/data';
import { WorkflowCanvas } from '@/components/WorkflowCanvas';
import { readRules } from '@/lib/brand-deal-rules';
import { OPERATOR_NAME } from '@/lib/operator';
import type { AgentRun } from '@/lib/schemas';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';

export const dynamic = 'force-dynamic';

/**
 * /workflows — the canvas editor over the real workflows table.
 *
 * Everything the canvas shows is loaded here from the database and the
 * daemon's rules file: the roster (so a step binds to a real agent id, not
 * a display name), the people list for human owners, every recorded run
 * for the roster, and the live brand-deal rules (or the reason they are not
 * configured on this machine).
 */
export default function WorkflowsPage(props: { searchParams?: { wf?: string } }) {
  // Called with no argument by tests/smoke.test.ts; a parameter-level default
  // would widen the type to `| undefined` and break Next's PageProps check.
  const searchParams = props?.searchParams;
  const db = getDb();
  const workflows = db.workflows.all();
  const agents = db.agents.all().map((a) => ({ id: a.id, name: a.name, status: a.status }));
  const people = Array.from(new Set([`${OPERATOR_NAME} · Operator`, ...db.people.all().map((p) => p.name), ...workflows.flatMap((w) => w.steps.filter((s) => s.ownerKind === 'human').map((s) => s.owner))]));
  const runs: AgentRun[] = agents.flatMap((a) => db.agentRuns.byAgent(a.id).slice(0, 25));
  const read = readRules();
  const g = treeFor(getAppearance(), '/workflows') === 'glados';
  const rules = read.configured ? { configured: true as const, rules: read.rules, updatedAt: read.updatedAt } : { configured: false as const, reason: read.reason };

  return (
    <div>
      <WorkflowCanvas
        workflows={workflows}
        agents={agents}
        people={people}
        runs={runs}
        rules={rules}
        setupHref="/agents/setup/brand-deal-drafter"
        initialId={searchParams?.wf ?? null}
        skin={g ? 'g' : undefined}
      />
    </div>
  );
}
