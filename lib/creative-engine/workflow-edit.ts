import { z } from 'zod';
import { NODE_TYPES, WorkflowEdgeSchema, type NodeType, type PortType, type Workflow, type WorkflowEdge, type WorkflowNode } from '@/lib/creative-engine/schemas';
import { NODE_SPECS, PALETTE } from '@/lib/creative-engine/workflow';

/**
 * Pure graph edits for the workflow builder (browser-safe, no node imports).
 *
 * The client only ever owns a workflow's *layout*: node id, type, title,
 * position and settings, plus the edges. Runtime fields (runId,
 * outputAssetId, outputText, error, resolvedAt) are written by the engine
 * alone. A stale autosave that carried `runId: null` back used to make the
 * engine see a submitted node as ready and submit it to Arcads a second
 * time (S05b R10). `mergeLayout` is the one door a client edit goes
 * through, so that can't happen.
 */

export const LayoutNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES),
  title: z.string().max(60).default(''),
  x: z.number().default(0),
  y: z.number().default(0),
  settings: z.record(z.string(), z.unknown()).default({}),
});
export type LayoutNode = z.infer<typeof LayoutNodeSchema>;

export const LayoutSchema = z.object({ nodes: z.array(LayoutNodeSchema), edges: z.array(WorkflowEdgeSchema) });
export type Layout = z.infer<typeof LayoutSchema>;

/** The client-owned part of a workflow; what autosave sends. */
export function toLayout(w: Pick<Workflow, 'nodes' | 'edges'>): Layout {
  return { nodes: w.nodes.map(({ id, type, title, x, y, settings }) => ({ id, type, title, x, y, settings })), edges: w.edges.map(({ id, from, fromPort, to, toPort }) => ({ id, from, fromPort, to, toPort })) };
}

/** The PATCH payload for an edit: the layout when it changed, the name when it changed, or null when nothing did. */
export function layoutDiff(prev: Workflow | null, next: Workflow): { name?: string; layout?: Layout } | null {
  const out: { name?: string; layout?: Layout } = {};
  const nextLayout = toLayout(next);
  if (!prev || JSON.stringify(toLayout(prev)) !== JSON.stringify(nextLayout)) out.layout = nextLayout;
  if (!prev || prev.name !== next.name) out.name = next.name;
  return out.layout || out.name !== undefined ? out : null;
}

export class LayoutError extends Error {}

const RUNTIME_CLEAR = { runId: null, outputAssetId: null, outputText: null, error: null, resolvedAt: null } as const;

/**
 * Merge a client layout onto the stored workflow. Stored nodes keep every
 * runtime field; new ids start with runtime fields cleared; ids missing
 * from the layout are removed. A node whose type changed, or an edge that
 * names an unknown node or port, is refused with a LayoutError. Edges whose
 * port types don't match are kept (validateGraph reports them).
 */
export function mergeLayout(stored: Workflow, layout: Layout): Workflow {
  const byId = new Map(stored.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const nodes: WorkflowNode[] = layout.nodes.map((l) => {
    if (seen.has(l.id)) throw new LayoutError(`duplicate node id ${l.id}`);
    seen.add(l.id);
    const prev = byId.get(l.id);
    if (prev && prev.type !== l.type) throw new LayoutError(`node ${l.id} is a ${prev.type}; its type can't change`);
    const base = prev ?? { ...RUNTIME_CLEAR };
    return { ...base, id: l.id, type: l.type, title: l.title, x: l.x, y: l.y, settings: l.settings } as WorkflowNode;
  });
  const types = new Map(nodes.map((n) => [n.id, n.type]));
  const edges: WorkflowEdge[] = layout.edges.map((e) => {
    const ft = types.get(e.from); const tt = types.get(e.to);
    if (!ft || !tt) throw new LayoutError(`link ${e.id} names a node that isn't in the workflow`);
    if (!NODE_SPECS[ft].outputs.some((p) => p.name === e.fromPort)) throw new LayoutError(`link ${e.id}: ${ft} has no output "${e.fromPort}"`);
    if (!NODE_SPECS[tt].inputs.some((p) => p.name === e.toPort)) throw new LayoutError(`link ${e.id}: ${tt} has no input "${e.toPort}"`);
    return { id: e.id, from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort };
  });
  return { ...stored, nodes, edges };
}

/* ───────────────────────────── connect, replace, reconnect (S05b FR-15 to FR-19) ───────────────────────────── */

/**
 * What dropping a wire on an input port would do. `add` links, `replace`
 * swaps the one link a single-input port already has, `noop` changes
 * nothing (the exact link exists), `refuse` names why it can't happen.
 */
export type ConnectVerdict = { kind: 'add' } | { kind: 'replace'; removeEdgeId: string } | { kind: 'noop'; reason: string } | { kind: 'refuse'; reason: string };

type Graph = Pick<Workflow, 'nodes' | 'edges'>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Adding from→to makes a loop when `from` is reachable from `to`. */
function reaches(edges: WorkflowEdge[], start: string, goal: string): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === goal) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

export function connectVerdict(w: Graph, from: string, fromPort: string, to: string, toPort: string): ConnectVerdict {
  const a = w.nodes.find((n) => n.id === from);
  const b = w.nodes.find((n) => n.id === to);
  if (!a || !b) return { kind: 'refuse', reason: 'That node is no longer on the canvas' };
  if (a.id === b.id) return { kind: 'refuse', reason: "A node can't feed itself" };
  const out = NODE_SPECS[a.type].outputs.find((p) => p.name === fromPort);
  const inp = NODE_SPECS[b.type].inputs.find((p) => p.name === toPort);
  if (!out) return { kind: 'refuse', reason: `${a.title} has no output "${fromPort}"` };
  if (!inp) return { kind: 'refuse', reason: `${b.title} has no input "${toPort}"` };
  if (out.type !== inp.type) return { kind: 'refuse', reason: `${cap(out.type)} can't feed ${inp.type === 'image' || inp.type === 'audio' ? 'an' : 'a'} ${inp.type} input` };
  if (w.edges.some((e) => e.from === from && e.fromPort === fromPort && e.to === to && e.toPort === toPort)) return { kind: 'noop', reason: 'Already linked' };
  const occupied = inp.many ? undefined : w.edges.find((e) => e.to === to && e.toPort === toPort);
  // the loop check runs on the graph as it would be: after the replaced link is gone
  const rest = occupied ? w.edges.filter((e) => e.id !== occupied.id) : w.edges;
  if (reaches(rest, to, from)) return { kind: 'refuse', reason: 'That would make a loop' };
  return occupied ? { kind: 'replace', removeEdgeId: occupied.id } : { kind: 'add' };
}

/** Apply a verdict: add the edge, or swap it for the replaced one. A noop or refuse returns the graph unchanged. */
export function applyConnect<T extends Graph>(w: T, verdict: ConnectVerdict, edge: WorkflowEdge): T {
  if (verdict.kind === 'add') return { ...w, edges: [...w.edges, edge] };
  if (verdict.kind === 'replace') return { ...w, edges: [...w.edges.filter((e) => e.id !== verdict.removeEdgeId), edge] };
  return w;
}

export type ReconnectResult<T> = { kind: 'moved'; workflow: T; replacedEdgeId: string | null } | { kind: 'noop'; reason: string } | { kind: 'refuse'; reason: string };

/** Move an existing link's target end to another input port. The link keeps its id. */
export function reconnect<T extends Graph>(w: T, edgeId: string, to: string, toPort: string): ReconnectResult<T> {
  const e = w.edges.find((x) => x.id === edgeId);
  if (!e) return { kind: 'refuse', reason: 'That link is gone' };
  if (e.to === to && e.toPort === toPort) return { kind: 'noop', reason: 'Same port' };
  const without = { ...w, edges: w.edges.filter((x) => x.id !== edgeId) };
  const v = connectVerdict(without, e.from, e.fromPort, to, toPort);
  if (v.kind === 'refuse' || v.kind === 'noop') return v;
  return { kind: 'moved', workflow: applyConnect(without, v, { ...e, to, toPort }), replacedEdgeId: v.kind === 'replace' ? v.removeEdgeId : null };
}

export function removeEdges<T extends Graph>(w: T, ids: Iterable<string>): T {
  const drop = new Set(ids);
  return { ...w, edges: w.edges.filter((e) => !drop.has(e.id)) };
}

/** Remove nodes and every edge touching them. */
export function removeNodes<T extends Graph>(w: T, ids: Iterable<string>): T {
  const drop = new Set(ids);
  return { ...w, nodes: w.nodes.filter((n) => !drop.has(n.id)), edges: w.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to)) };
}

/** The port type an edge carries (its source output's type), or null if the source is gone. */
export function edgeType(w: Graph, e: WorkflowEdge): PortType | null {
  const a = w.nodes.find((n) => n.id === e.from);
  return a ? NODE_SPECS[a.type].outputs.find((p) => p.name === e.fromPort)?.type ?? null : null;
}

/** First input / output of a node type that carries `t`. */
export function firstInput(type: NodeType, t: PortType): string | null { return NODE_SPECS[type].inputs.find((p) => p.type === t)?.name ?? null; }
export function firstOutput(type: NodeType, t: PortType): string | null { return NODE_SPECS[type].outputs.find((p) => p.type === t)?.name ?? null; }

/* ───────────────────────────── history ───────────────────────────── */

/**
 * Undo/redo of whole-graph snapshots (cap 100). `push` records the state
 * BEFORE an edit. Pushes with the same merge key inside `windowMs` fold into
 * one step (typing in a field, nudging). A new push clears redo.
 */
export class History<T> {
  private past: { s: T; label: string }[] = [];
  private future: { s: T; label: string }[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  constructor(private readonly cap = 100, private readonly windowMs = 800) {}
  /** Record the state before an edit. `label` names the edit for the Undo button ("remove link"). */
  push(before: T, mergeKey?: string, now = Date.now(), label = 'edit'): void {
    if (mergeKey && mergeKey === this.lastKey && now - this.lastAt < this.windowMs && this.past.length) { this.lastAt = now; this.future = []; return; }
    this.past.push({ s: before, label });
    if (this.past.length > this.cap) this.past.shift();
    this.future = [];
    this.lastKey = mergeKey ?? null;
    this.lastAt = now;
  }
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push({ s: current, label: prev.label });
    this.lastKey = null;
    return prev.s;
  }
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push({ s: current, label: next.label });
    this.lastKey = null;
    return next.s;
  }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  /** What Undo / Redo would revert or redo, for the button titles. */
  get undoLabel(): string | null { return this.past.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this.future.at(-1)?.label ?? null; }
  clear(): void { this.past = []; this.future = []; this.lastKey = null; }
}

/* ───────────────────────────── palette (S05b FR-38 to FR-42) ───────────────────────────── */

export type PaletteContext = { needsInputType?: PortType; needsOutputType?: PortType };

/** Every node type in palette order (PALETTE groups, first appearance wins). */
export function paletteOrder(): NodeType[] {
  const seen = new Set<NodeType>();
  for (const g of PALETTE) for (const t of g.types) seen.add(t);
  return [...seen];
}

export function fitsContext(t: NodeType, ctx?: PaletteContext): boolean {
  if (!ctx) return true;
  if (ctx.needsInputType && !firstInput(t, ctx.needsInputType)) return false;
  if (ctx.needsOutputType && !firstOutput(t, ctx.needsOutputType)) return false;
  return true;
}

/**
 * Search the palette. Case-insensitive substring over label, hint, category
 * label and aliases; label-prefix matches rank first, then label matches,
 * then alias matches, then hint or category. An empty query returns every
 * type in palette order. `ctx` keeps only types that can take (or give) a
 * port type, for "connect" and "insert on a link".
 */
export function paletteMatches(q: string, ctx?: PaletteContext): NodeType[] {
  const query = q.trim().toLowerCase();
  const types = paletteOrder().filter((t) => fitsContext(t, ctx));
  if (!query) return types;
  const groupLabel = new Map<NodeType, string>();
  for (const g of PALETTE) for (const t of g.types) if (!groupLabel.has(t)) groupLabel.set(t, g.label);
  const scored: { t: NodeType; score: number; i: number }[] = [];
  types.forEach((t, i) => {
    const s = NODE_SPECS[t];
    const label = s.label.toLowerCase();
    let score = -1;
    if (label.startsWith(query)) score = 0;
    else if (label.split(/[\s-]+/).some((w) => w.startsWith(query))) score = 1;
    else if (label.includes(query)) score = 2;
    else if ((s.aliases ?? []).some((a) => a.toLowerCase().startsWith(query))) score = 3;
    else if ((s.aliases ?? []).some((a) => a.toLowerCase().includes(query))) score = 4;
    else if (s.hint.toLowerCase().includes(query) || (groupLabel.get(t) ?? '').toLowerCase().includes(query)) score = 5;
    if (score >= 0) scored.push({ t, score, i });
  });
  return scored.sort((x, y) => x.score - y.score || x.i - y.i).map((x) => x.t);
}

/* ───────────────────────────── popover placement ───────────────────────────── */

/**
 * Place a popover of `size` at `anchor` inside `viewport`: right and down of
 * the anchor; flip left when it would cross the right edge, flip up when it
 * would cross the bottom; then clamp so it is fully inside with `margin`.
 * A popover larger than the viewport pins to the top-left margin.
 */
export function clampPopover(anchor: { x: number; y: number }, size: { w: number; h: number }, viewport: { w: number; h: number }, margin = 8): { x: number; y: number; flipX: boolean; flipY: boolean } {
  const flipX = anchor.x + size.w > viewport.w - margin;
  const flipY = anchor.y + size.h > viewport.h - margin;
  let x = flipX ? anchor.x - size.w : anchor.x;
  let y = flipY ? anchor.y - size.h : anchor.y;
  x = Math.max(margin, Math.min(x, viewport.w - margin - size.w));
  y = Math.max(margin, Math.min(y, viewport.h - margin - size.h));
  return { x, y, flipX, flipY };
}

/* ───────────────────────────── selection edits (S05b FR-21 to FR-26) ───────────────────────────── */

/** Browser-safe short id for copies, unique within `taken`. */
function freshId(prefix: 'n' | 'e', taken: Set<string>): string {
  for (;;) {
    const c = globalThis.crypto;
    const id = `${prefix}-${c?.randomUUID ? c.randomUUID().slice(0, 6) : Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}

/** What Copy holds: the layout of some nodes and the links between them (never runtime fields). */
export type Clip = { kind: 'glados-workflow-clip'; nodes: LayoutNode[]; edges: WorkflowEdge[] };

export function copyNodes(w: Graph, ids: Iterable<string>): Clip {
  const keep = new Set(ids);
  const l = toLayout(w);
  return { kind: 'glados-workflow-clip', nodes: l.nodes.filter((n) => keep.has(n.id)), edges: l.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}

/** Parse a clip from the system clipboard (JSON); null when it isn't one. */
export function parseClip(text: string): Clip | null {
  try {
    const v = JSON.parse(text) as Partial<Clip>;
    if (v?.kind !== 'glados-workflow-clip') return null;
    const l = LayoutSchema.safeParse({ nodes: v.nodes, edges: v.edges });
    return l.success ? { kind: 'glados-workflow-clip', nodes: l.data.nodes, edges: l.data.edges } : null;
  } catch { return null; }
}

/**
 * Paste a clip with fresh ids. `at` puts the clip's top-left there; without
 * it the clip lands +40/+40 from where it was copied. Runtime fields start
 * cleared. `scriptIds` (this campaign's scripts) clears a pasted script
 * node's `scriptId` that doesn't exist here, so it shows as a problem
 * instead of pointing at another campaign (edge case 15).
 */
export function pasteNodes<T extends Graph>(w: T, clip: Clip, at?: { x: number; y: number } | null, scriptIds?: Set<string>): { workflow: T; ids: string[] } {
  if (!clip.nodes.length) return { workflow: w, ids: [] };
  const taken = new Set([...w.nodes.map((n) => n.id), ...w.edges.map((e) => e.id)]);
  const minX = Math.min(...clip.nodes.map((n) => n.x)); const minY = Math.min(...clip.nodes.map((n) => n.y));
  const dx = at ? at.x - minX : 40; const dy = at ? at.y - minY : 40;
  const map = new Map<string, string>();
  const nodes: WorkflowNode[] = clip.nodes.map((n) => {
    const id = freshId('n', taken); map.set(n.id, id);
    const settings: Record<string, unknown> = { ...n.settings };
    if (n.type === 'script' && scriptIds && settings.scriptId && !scriptIds.has(String(settings.scriptId))) settings.scriptId = null;
    return { id, type: n.type, title: n.title, x: Math.round(n.x + dx), y: Math.round(n.y + dy), settings, ...RUNTIME_CLEAR };
  });
  const edges: WorkflowEdge[] = clip.edges.filter((e) => map.has(e.from) && map.has(e.to)).map((e) => ({ id: freshId('e', taken), from: map.get(e.from)!, fromPort: e.fromPort, to: map.get(e.to)!, toPort: e.toPort }));
  return { workflow: { ...w, nodes: [...w.nodes, ...nodes], edges: [...w.edges, ...edges] }, ids: nodes.map((n) => n.id) };
}

/** Duplicate nodes in place, offset by (dx, dy), with the links between them. */
export function duplicateNodes<T extends Graph>(w: T, ids: Iterable<string>, dx = 40, dy = 40): { workflow: T; ids: string[] } {
  const clip = copyNodes(w, ids);
  if (!clip.nodes.length) return { workflow: w, ids: [] };
  const minX = Math.min(...clip.nodes.map((n) => n.x)); const minY = Math.min(...clip.nodes.map((n) => n.y));
  return pasteNodes(w, clip, { x: minX + dx, y: minY + dy });
}

/** Move nodes by (dx, dy). */
export function moveNodes<T extends Graph>(w: T, ids: Iterable<string>, dx: number, dy: number): T {
  const set = new Set(ids);
  return { ...w, nodes: w.nodes.map((n) => (set.has(n.id) ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) } : n)) };
}

/** Snap a coordinate to the 11px grid (half the 22px dot grid). */
export const snap = (v: number, grid = 11): number => Math.round(v / grid) * grid;

/** The nodes whose box intersects a world-space rectangle (marquee). */
export function nodesInRect(nodes: { id: string; x: number; y: number; w: number; h: number }[], r: { x1: number; y1: number; x2: number; y2: number }): string[] {
  const x1 = Math.min(r.x1, r.x2); const x2 = Math.max(r.x1, r.x2); const y1 = Math.min(r.y1, r.y2); const y2 = Math.max(r.y1, r.y2);
  return nodes.filter((n) => n.x < x2 && n.x + n.w > x1 && n.y < y2 && n.y + n.h > y1).map((n) => n.id);
}

/**
 * Tidy: lay nodes out left to right by dependency rank (longest path from a
 * source), x = 40 + rank × 300, rows stacked by height + 32. Nodes with no
 * links go in column 0. Deterministic: order within a column follows the
 * current y, then id. `heights` are measured sizes (default 140).
 */
export function tidy<T extends Graph>(w: T, heights: Record<string, number> = {}): T {
  const linked = new Set(w.edges.flatMap((e) => [e.from, e.to]));
  const rank = new Map<string, number>(w.nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < w.nodes.length; i++) {
    let changed = false;
    for (const e of w.edges) {
      const r = (rank.get(e.from) ?? 0) + 1;
      if (rank.has(e.to) && r > (rank.get(e.to) ?? 0)) { rank.set(e.to, r); changed = true; }
    }
    if (!changed) break;
  }
  const cols = new Map<number, WorkflowNode[]>();
  for (const n of w.nodes) { const r = linked.has(n.id) ? rank.get(n.id) ?? 0 : 0; cols.set(r, [...(cols.get(r) ?? []), n]); }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [r, list] of cols) {
    let y = 40;
    for (const n of [...list].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))) { pos.set(n.id, { x: 40 + r * 300, y }); y += (heights[n.id] ?? 140) + 32; }
  }
  return { ...w, nodes: w.nodes.map((n) => ({ ...n, ...pos.get(n.id)! })) };
}

/* ───────────────────────────── run scope and cost (S05b FR-58, FR-60) ───────────────────────────── */

export type RunScope = 'all' | 'failed' | 'from';

/** Every node downstream of `ids` (not including them). */
function downstream(w: Graph, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) { const id = stack.pop()!; for (const e of w.edges) if (e.from === id && !out.has(e.to)) { out.add(e.to); stack.push(e.to); } }
  return out;
}

/**
 * The nodes a run of `scope` resets and runs. `all`: every node. `failed`:
 * nodes with an error, plus everything below them that hasn't resolved.
 * `from`: the node and everything below it. The gate and the engine both
 * use this, so the count the gate shows is the count the engine submits.
 */
export function nodesInScope(w: Graph, scope: RunScope = 'all', nodeId?: string | null): WorkflowNode[] {
  if (scope === 'all') return w.nodes;
  if (scope === 'from') {
    if (!nodeId || !w.nodes.some((n) => n.id === nodeId)) return [];
    const set = downstream(w, [nodeId]); set.add(nodeId);
    return w.nodes.filter((n) => set.has(n.id));
  }
  const failed = w.nodes.filter((n) => !!n.error).map((n) => n.id);
  const below = [...downstream(w, failed)].filter((id) => { const n = w.nodes.find((x) => x.id === id); return !!n && !n.outputAssetId && !n.resolvedAt; });
  const set = new Set([...failed, ...below]);
  return w.nodes.filter((n) => set.has(n.id));
}

/** Paid (Arcads) requests a run of `scope` makes: one per paid node in scope. */
export function paidCount(w: Graph, scope: RunScope = 'all', nodeId?: string | null): number {
  return nodesInScope(w, scope, nodeId).filter((n) => !NODE_SPECS[n.type].local).length;
}
