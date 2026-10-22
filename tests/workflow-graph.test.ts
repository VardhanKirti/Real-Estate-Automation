process.env.GLADOS_DB = ':memory:';

import { describe, expect, test } from 'vitest';
import { buildWorkflowSteps } from '@/app/api/workflows/shared';
import { workflowStepParent } from '@/app/workflows/tree';
import { graphToInput, workflowToGraph } from '@/lib/workflow-graph';
import type { Workflow } from '@/lib/schemas';
import { BRAND_DEALS_WORKFLOW } from './fixtures/workflows/brand-deals';

function seededBrandDeals(): Workflow {
  return structuredClone(BRAND_DEALS_WORKFLOW);
}

describe('workflow ⇄ graph adapter', () => {
  test('the seeded brand-deal pipeline becomes a graph with the daemon’s branches', () => {
    const g = workflowToGraph(seededBrandDeals());
    expect(g.nodes.map((n) => n.type)).toEqual([
      'trigger-gmail',
      'flow-branch',
      'ai-qualify',
      'ai-agent',
      'ai-agent',
      'ai-classify',
      'app-telegram',
      'human-approve',
      'app-gsend',
      'core-set',
      'ai-agent',
    ]);
    const edge = (to: string) => g.edges.find((e) => e.to === to)!;
    expect(edge('wf-bd-3')).toMatchObject({ from: 'wf-bd-2', fromPort: 'no', label: 'continue' });
    expect(edge('wf-bd-5')).toMatchObject({ from: 'wf-bd-3', fromPort: 'yes', label: 'fits' });
    expect(edge('wf-bd-4')).toMatchObject({ from: 'wf-bd-3', fromPort: 'no', label: 'below threshold' });
    expect(edge('wf-bd-9')).toMatchObject({ from: 'wf-bd-8', fromPort: 'yes', label: 'SEND' });
    expect(edge('wf-bd-10')).toMatchObject({ from: 'wf-bd-8', fromPort: 'no', label: 'SKIP' });
    expect(edge('wf-bd-6')).toMatchObject({ from: 'wf-bd-5', fromPort: 'out', label: 'drafted' });
    expect(g.nodes.find((n) => n.id === 'wf-bd-5')!.config).toMatchObject({ bindings: { prompt: 'draft_rules' } });
    expect(g.nodes.find((n) => n.id === 'wf-bd-1')!.ownerAgentId).toBe('inbound-watcher');
  });

  test('graph → input → steps preserves the tree, labels, kinds, config and positions', () => {
    const wf = seededBrandDeals();
    const g = workflowToGraph(wf);
    const { input, problems } = graphToInput(g);
    expect(problems).toEqual([]);
    const rebuilt = buildWorkflowSteps(wf.id, input!.steps);
    const originalParents = wf.steps.map((_, i) => wf.steps[i].id).map((_, i) => {
      const p = workflowStepParent(i, wf.steps);
      return p == null ? null : wf.steps[p].title;
    });
    const rebuiltParents = rebuilt.map((_, i) => {
      const p = workflowStepParent(i, rebuilt);
      return p == null ? null : rebuilt[p].title;
    });
    // same titles in the same order, same parent for every step
    expect(rebuilt.map((s) => s.title)).toEqual(wf.steps.map((s) => s.title));
    expect(rebuiltParents).toEqual(originalParents);
    // branch conditions and edge labels survive
    const byTitle = (title: string) => rebuilt.find((s) => s.title === title)!;
    expect(byTitle('Qualify the brand').branch?.condition).toBe('continue');
    expect(byTitle('Send from the shared inbox').branch?.condition).toBe('SEND');
    expect(byTitle('Draft the reply').edgeLabel).toBe('drafted');
    expect(byTitle('Draft the reply').kind).toBe('ai-agent');
    expect(byTitle('Draft the reply').config).toMatchObject({ bindings: { prompt: 'draft_rules' } });
    expect(byTitle('Inbound lands in the shared inbox').pos).toEqual({ x: 60, y: 300 });
    expect(byTitle('Inbound lands in the shared inbox').ownerAgentId).toBe('inbound-watcher');
    // round-tripping the rebuilt steps again is stable
    const again = graphToInput(workflowToGraph({ ...wf, steps: rebuilt }));
    expect(again.input!.steps.map((s) => [s.title, s.branchFromIndex, s.branchCondition])).toEqual(
      input!.steps.map((s) => [s.title, s.branchFromIndex, s.branchCondition]),
    );
  });

  test('refuses graphs the tree model cannot hold', () => {
    const g = workflowToGraph(seededBrandDeals());
    // a second root
    const orphan = { ...g.nodes[0], id: 'x-orphan', title: 'Orphan' };
    expect(graphToInput({ ...g, nodes: [...g.nodes, orphan] }).problems[0]).toMatch(/one starting step only/);
    // two parents
    const twoParents = { ...g, edges: [...g.edges, { id: 'e2', from: 'wf-bd-1', to: 'wf-bd-6', fromPort: 'out', toPort: 'in', label: null }] };
    expect(graphToInput(twoParents).problems[0]).toMatch(/2 incoming connections/);
    // unreachable node (has an incoming edge but from a node that is itself unreachable is impossible with one root; use a detached pair)
    const a = { ...g.nodes[0], id: 'det-a', title: 'Detached A' };
    const b = { ...g.nodes[1], id: 'det-b', title: 'Detached B' };
    const detached = { ...g, nodes: [...g.nodes, a, b], edges: [...g.edges, { id: 'e3', from: 'det-a', to: 'det-b', fromPort: 'out', toPort: 'in', label: null }] };
    expect(graphToInput(detached).problems[0]).toMatch(/one starting step only/);
  });

  test('legacy steps without canvas fields get an inferred kind and an auto layout', () => {
    const wf: Workflow = {
      id: 'wf-old',
      name: 'Old',
      subtitle: '',
      revenueUsd: 0,
      order: 0,
      steps: [
        { id: 'a', title: 'Plan', detail: 'd', ownerKind: 'human', owner: 'Operator', hoursPerWeek: 2, tools: [], edgeLabel: 'briefed', leakUsd: null, automation: null, branch: null },
        { id: 'b', title: 'Draft', detail: 'd', ownerKind: 'agent', owner: 'Bot', hoursPerWeek: 0, tools: [], edgeLabel: null, leakUsd: null, automation: null, branch: null },
      ],
    };
    const g = workflowToGraph(wf);
    expect(g.nodes.map((n) => n.type)).toEqual(['human-task', 'ai-agent']);
    expect(g.nodes[1].x).toBeGreaterThan(g.nodes[0].x);
    expect(g.edges[0]).toMatchObject({ from: 'a', to: 'b', label: 'briefed', fromPort: 'out' });
    expect(graphToInput(g).problems).toEqual([]);
  });
});
