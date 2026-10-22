/**
 * Workflow ⇄ canvas graph adapter.
 *
 * The DB stores a workflow as an ordered step list with tree parents
 * (`branch.from`, see app/workflows/tree.ts). The canvas edits a node/edge
 * graph. This module is the only place the two shapes meet, so the canvas
 * can never save something the tree model cannot represent: one root, every
 * node reachable, at most one parent per node. Anything else comes back as a
 * `problems` list and the save is refused with the reason.
 */
import type { WorkflowInput, WorkflowStepInput } from '@/app/api/workflows/shared';
import { workflowStepParent } from '@/app/workflows/tree';
import type { Workflow, WorkflowStep } from '@/lib/schemas';

export type GraphNode = {
  id: string;
  type: string;
  title: string;
  sub: string;
  detail: string;
  owner: string;
  ownerKind: 'human' | 'agent';
  ownerAgentId: string | null;
  hours: number;
  tools: string[];
  /** ok | suggested | off — the node's badge; `suggested` mirrors automation.state */
  status: 'ok' | 'suggested' | 'off';
  expanded: boolean;
  config: Record<string, unknown>;
  automation: WorkflowStep['automation'];
  leakUsd: number | null;
  x: number;
  y: number;
};
export type GraphEdge = { id: string; from: string; to: string; fromPort: string; toPort: string; label: string | null };
export type Graph = {
  id: string;
  name: string;
  subtitle: string;
  revenueUsd: number;
  order: number;
  ratioTarget: number | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** Node types whose outputs are a yes/no pair rather than a single `out`. */
export const YES_NO_KINDS = new Set(['flow-branch', 'ai-qualify', 'human-approve']);

/** A step written before the canvas has no `kind`; pick the closest honest one. */
export function inferKind(step: WorkflowStep, index: number): string {
  if (step.kind) return step.kind;
  if (step.ownerKind === 'human') return 'human-task';
  if (index === 0) return 'trigger-schedule';
  return 'ai-agent';
}

const COL = 320;
const ROW = 170;

export function workflowToGraph(w: Workflow): Graph {
  const steps = w.steps;
  const parents = steps.map((_, i) => workflowStepParent(i, steps));
  // depth + sibling slot for the auto-layout of steps that carry no position
  const depth = steps.map((_, i) => {
    let d = 0;
    let p = parents[i];
    while (p != null && d < 999) {
      d += 1;
      p = parents[p];
    }
    return d;
  });
  const slotAtDepth = new Map<number, number>();
  const nodes: GraphNode[] = steps.map((s, i) => {
    const slot = slotAtDepth.get(depth[i]) ?? 0;
    slotAtDepth.set(depth[i], slot + 1);
    return {
      id: s.id,
      type: inferKind(s, i),
      title: s.title,
      sub: s.owner,
      detail: s.detail,
      owner: s.owner,
      ownerKind: s.ownerKind,
      ownerAgentId: s.ownerAgentId ?? null,
      hours: s.hoursPerWeek,
      tools: s.tools,
      status: s.automation?.state === 'suggested' ? 'suggested' : 'ok',
      expanded: false,
      config: { ...(s.config ?? {}) },
      automation: s.automation,
      leakUsd: s.leakUsd,
      x: s.pos?.x ?? 60 + depth[i] * COL,
      y: s.pos?.y ?? 288 + slot * ROW,
    };
  });
  const edges: GraphEdge[] = [];
  const childCount = new Map<number, number>();
  steps.forEach((s, i) => {
    const p = parents[i];
    if (p == null) return;
    const parent = steps[p];
    const parentKind = inferKind(parent, p);
    const label = s.branch ? s.branch.condition : parent.edgeLabel;
    let fromPort = 'out';
    if (YES_NO_KINDS.has(parentKind)) {
      const cfg = (parent.config ?? {}) as Record<string, unknown>;
      const n = childCount.get(p) ?? 0;
      childCount.set(p, n + 1);
      if (label && cfg.yes === label) fromPort = 'yes';
      else if (label && cfg.no === label) fromPort = 'no';
      else fromPort = n === 0 ? 'yes' : 'no';
    }
    edges.push({ id: `e-${parent.id}-${s.id}-${fromPort}`, from: parent.id, to: s.id, fromPort, toPort: 'in', label: label ?? null });
  });
  return {
    id: w.id,
    name: w.name,
    subtitle: w.subtitle,
    revenueUsd: w.revenueUsd,
    order: w.order,
    ratioTarget: w.ratioTarget ?? null,
    nodes,
    edges,
  };
}

/**
 * Orders the graph into the flat input shape the API saves. Refuses (via
 * `problems`) graphs the tree model cannot hold: no root, more than one
 * root, unreachable nodes, or a node with two parents.
 */
export function graphToInput(g: Graph): { input: WorkflowInput | null; problems: string[] } {
  const problems: string[] = [];
  const mainEdges = g.edges.filter((e) => e.toPort === 'in');
  const incoming = new Map<string, GraphEdge[]>();
  for (const e of mainEdges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);
  const roots = g.nodes.filter((n) => !(incoming.get(n.id) ?? []).length);
  if (!g.nodes.length) problems.push('the workflow has no steps');
  if (roots.length > 1) problems.push(`one starting step only — ${roots.map((r) => r.title).join(', ')} all lack an incoming connection`);
  for (const n of g.nodes) {
    const ins = incoming.get(n.id) ?? [];
    if (ins.length > 1) problems.push(`${n.title} has ${ins.length} incoming connections; the tree model allows one`);
  }
  if (problems.length) return { input: null, problems };

  // breadth-first from the root, children in their existing node order (the
  // stored step order on load, creation order for new nodes) so a save that
  // changes nothing re-derives the same step ids and records no new version
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const nodeIndex = new Map(g.nodes.map((n, i) => [n.id, i]));
  const order: GraphNode[] = [];
  const seen = new Set<string>();
  const queue = [roots[0]];
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    order.push(n);
    const kids = mainEdges
      .filter((e) => e.from === n.id)
      .map((e) => byId.get(e.to)!)
      .filter(Boolean)
      .sort((a, b) => nodeIndex.get(a.id)! - nodeIndex.get(b.id)!);
    queue.push(...kids);
  }
  const unreachable = g.nodes.filter((n) => !seen.has(n.id));
  if (unreachable.length) return { input: null, problems: [`not connected to the flow: ${unreachable.map((n) => n.title).join(', ')}`] };

  const index = new Map(order.map((n, i) => [n.id, i]));
  const steps: WorkflowStepInput[] = order.map((n, i) => {
    const inEdge = (incoming.get(n.id) ?? [])[0] ?? null;
    const parent = inEdge ? byId.get(inEdge.from)! : null;
    const parentIdx = parent ? index.get(parent.id)! : null;
    const parentIsYesNo = parent ? YES_NO_KINDS.has(parent.type) : false;
    // Linear when the parent is the previous step, has exactly one child and
    // is not a yes/no node; otherwise an explicit branch carries the label.
    const parentChildren = parent ? mainEdges.filter((e) => e.from === parent.id).length : 0;
    const linear = parent != null && parentIdx === i - 1 && parentChildren === 1 && !parentIsYesNo;
    const outgoing = mainEdges.filter((e) => e.from === n.id);
    const outLabel = outgoing.length === 1 && !YES_NO_KINDS.has(n.type) ? (outgoing[0].label ?? null) : null;
    return {
      title: n.title,
      detail: n.detail || n.sub || n.title,
      ownerKind: n.ownerKind,
      owner: n.owner,
      hoursPerWeek: n.hours,
      tools: n.tools,
      automation: n.automation,
      branchFromIndex: linear || parentIdx == null ? null : parentIdx,
      branchCondition: linear || parentIdx == null ? null : (inEdge?.label ?? inEdge?.fromPort ?? 'branch'),
      edgeLabel: outLabel,
      ownerAgentId: n.ownerAgentId,
      kind: n.type,
      config: n.config,
      pos: { x: Math.round(n.x), y: Math.round(n.y) },
    };
  });
  return { input: { name: g.name, subtitle: g.subtitle, steps, ratioTarget: g.ratioTarget }, problems: [] };
}
