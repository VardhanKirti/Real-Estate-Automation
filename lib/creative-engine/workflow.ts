import { z } from 'zod';
import { ConsoleControlsSchema, IMAGE_MODELS, VIDEO_MODELS, type NodeType, type PortType, type Workflow, type WorkflowEdge, type WorkflowNode } from '@/lib/creative-engine/schemas';

/**
 * Workflow builder — the node registry (PLAN: Arcads' palette with our UI).
 * A node is one public Arcads endpoint or one local operation. Ports are
 * typed; an edge is legal only between equal types. `validateGraph` is the
 * gate before Run: acyclic, every required input connected, every setting
 * parses. The engine (workflow-run.ts) walks the graph in dependency order.
 *
 * Not in the registry on purpose: captions, extend, upscale, stitch,
 * background removal, translate. Arcads lists them as asset types but the
 * public API has no endpoint for them (reference/arcads-openapi-2026-10-01.json).
 */

export type Port = { name: string; type: PortType; required?: boolean; many?: boolean };

export type NodeSpec = {
  type: NodeType;
  label: string;
  category: 'input' | 'transform' | 'image' | 'video' | 'audio' | 'preset' | 'output';
  /** CSS token for the node tint */
  tint: string;
  inputs: Port[];
  outputs: Port[];
  settings: z.ZodTypeAny;
  /** true = resolved locally in the engine, no Arcads call */
  local?: boolean;
  /** one line for the palette */
  hint: string;
  /** extra words the palette search matches (model names, common synonyms) */
  aliases?: string[];
};

const ASPECT6 = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
const PRESET_TYPES = ['camera-movement', 'gestures', 'showyourapp', 'unboxing-pov', 'gameplay-ad'] as const;
export type PresetType = (typeof PRESET_TYPES)[number];

export const NODE_SPECS: Record<NodeType, NodeSpec> = {
  text: { type: 'text', label: 'Text', category: 'input', tint: '--o-node-0', inputs: [], outputs: [{ name: 'text', type: 'text' }], local: true, hint: 'A prompt, a script, or any text', aliases: ['prompt', 'note', 'copy'], settings: z.object({ text: z.string().max(5000).default('') }) },
  script: { type: 'script', label: 'Approved script', category: 'input', tint: '--o-node-0', inputs: [], outputs: [{ name: 'text', type: 'text' }], local: true, hint: 'The campaign script, full text or one beat', aliases: ['beat', 'hook', 'scripter'], settings: z.object({ scriptId: z.string().nullable().default(null), beat: z.number().int().min(0).nullable().default(null) }) },
  media: { type: 'media', label: 'Media', category: 'input', tint: '--o-node-0', inputs: [], outputs: [{ name: 'image', type: 'image' }, { name: 'video', type: 'video' }, { name: 'audio', type: 'audio' }], local: true, hint: 'A local file: image, video or audio', aliases: ['file', 'upload', 'photo', 'clip', 'sound'], settings: z.object({ path: z.string().default(''), kind: z.enum(['image', 'video', 'audio']).default('image') }) },
  asset: { type: 'asset', label: 'Asset', category: 'input', tint: '--o-node-0', inputs: [], outputs: [{ name: 'image', type: 'image' }, { name: 'video', type: 'video' }], local: true, hint: 'A delivered asset of this campaign or the Arcads library', aliases: ['library', 'delivered', 'reuse'], settings: z.object({ assetId: z.string().nullable().default(null), arcadsAssetId: z.string().nullable().default(null), kind: z.enum(['image', 'video']).default('video') }) },
  llm: { type: 'llm', label: 'LLM', category: 'transform', tint: '--o-node-5', inputs: [{ name: 'text', type: 'text', required: true, many: true }], outputs: [{ name: 'text', type: 'text' }], local: true, hint: 'Rewrite, expand or extract with Claude', aliases: ['claude', 'ai', 'rewrite'], settings: z.object({ instruction: z.string().max(2000).default('Rewrite this as a 20-word spoken hook.') }) },
  enhance: { type: 'enhance', label: 'Enhance prompt', category: 'transform', tint: '--o-node-5', inputs: [{ name: 'text', type: 'text', required: true }], outputs: [{ name: 'text', type: 'text' }], local: true, hint: 'Ask Arcads to rewrite the prompt before generating (+8 credits on the consumer)', aliases: ['improve', 'rewrite'], settings: z.object({}) },
  video: { type: 'video', label: 'Video model', category: 'video', tint: '--o-node-1', inputs: [{ name: 'prompt', type: 'text' }, { name: 'images', type: 'image', many: true }, { name: 'videos', type: 'video', many: true }, { name: 'audio', type: 'audio', many: true }, { name: 'startFrame', type: 'image' }, { name: 'endFrame', type: 'image' }], outputs: [{ name: 'video', type: 'video' }], hint: 'Text-to-video on any of the 11 models, the console\'s controls as settings', aliases: ['seedance', 'kling', 'sora', 'grok', 'minimax', 'happy horse', 'text to video', 't2v'], settings: ConsoleControlsSchema.partial() },
  image: { type: 'image', label: 'Image model', category: 'image', tint: '--o-node-3', inputs: [{ name: 'prompt', type: 'text', required: true }, { name: 'images', type: 'image', many: true }], outputs: [{ name: 'image', type: 'image' }], hint: 'Text-to-image on 12 models', aliases: ['nano banana', 'seedream', 'gpt image', 'soul', 'photo', 'still', 'text to image'], settings: z.object({ model: z.enum(IMAGE_MODELS).default('nano-banana-2'), aspectRatio: z.enum(ASPECT6).default('9:16'), nbGenerations: z.number().int().min(1).max(4).default(1), enhance: z.boolean().default(false) }) },
  talkingActor: { type: 'talkingActor', label: 'Talking actor', category: 'video', tint: '--o-node-2', inputs: [{ name: 'script', type: 'text', required: true }], outputs: [{ name: 'video', type: 'video' }], hint: 'A real-looking actor speaks the script', aliases: ['voice', 'actor', 'ugc', 'avatar', 'spokesperson'], settings: z.object({ situationId: z.string().nullable().default(null), voiceId: z.string().nullable().default(null), model: z.enum(['arcads_1.0', 'audio_driven', 'omnihuman']).default('arcads_1.0') }) },
  veo31: { type: 'veo31', label: 'Veo 3.1', category: 'video', tint: '--o-node-1', inputs: [{ name: 'prompt', type: 'text', required: true }, { name: 'images', type: 'image', many: true }, { name: 'startFrame', type: 'image' }, { name: 'endFrame', type: 'image' }], outputs: [{ name: 'video', type: 'video' }], hint: 'Veo 3.1 direct, with resolution and frames', aliases: ['veo', 'google'], settings: z.object({ resolution: z.enum(['360p', '480p', '720p', '1080p', '4K']).default('720p'), aspectRatio: z.enum(['16:9', '9:16']).default('9:16') }) },
  videoEdit: { type: 'videoEdit', label: 'AI video editing', category: 'video', tint: '--o-node-6', inputs: [{ name: 'prompt', type: 'text', required: true }, { name: 'videos', type: 'video', many: true }, { name: 'images', type: 'image', many: true }, { name: 'startFrame', type: 'image' }], outputs: [{ name: 'video', type: 'video' }], hint: 'Omni Flash: edit a source video with a prompt, or generate', aliases: ['omni flash', 'edit', 'restyle'], settings: z.object({ aspectRatio: z.enum(['16:9', '9:16']).nullable().default(null), duration: z.number().int().min(3).max(10).nullable().default(null) }) },
  broll: { type: 'broll', label: 'B-roll', category: 'video', tint: '--o-node-4', inputs: [{ name: 'prompt', type: 'text', required: true }, { name: 'reference', type: 'image' }, { name: 'startFrame', type: 'image' }, { name: 'endFrame', type: 'image' }], outputs: [{ name: 'video', type: 'video' }], hint: 'A 5 or 10 second B-roll clip', aliases: ['b roll', 'cutaway', 'stock'], settings: z.object({ aspectRatio: z.enum(ASPECT6).default('9:16'), duration: z.union([z.literal(5), z.literal(10)]).default(5) }) },
  scene: { type: 'scene', label: 'Scene', category: 'video', tint: '--o-node-4', inputs: [{ name: 'prompt', type: 'text', required: true }, { name: 'script', type: 'text' }, { name: 'reference', type: 'image' }, { name: 'startFrame', type: 'image' }], outputs: [{ name: 'video', type: 'video' }], hint: 'A scene from a prompt and a script, with continuity context', aliases: ['continuity', 'shot'], settings: z.object({ aspectRatio: z.enum(ASPECT6).default('9:16'), contextPrompt: z.string().max(2000).default(''), contextScript: z.string().max(2000).default('') }) },
  music: { type: 'music', label: 'Music', category: 'audio', tint: '--o-node-5', inputs: [{ name: 'prompt', type: 'text', required: true }], outputs: [{ name: 'audio', type: 'audio' }], hint: 'A music bed with ElevenLabs or Suno', aliases: ['elevenlabs', 'suno', 'song', 'soundtrack', 'audio bed'], settings: z.object({ model: z.enum(['elevenlabs', 'suno_v6']).default('elevenlabs'), duration: z.number().int().min(3).max(600).default(15), instrumentalOnly: z.boolean().default(true), lyrics: z.string().max(5000).default('') }) },
  audioDriven: { type: 'audioDriven', label: 'Audio-driven actor', category: 'video', tint: '--o-node-2', inputs: [{ name: 'script', type: 'text', required: true }], outputs: [{ name: 'video', type: 'video' }], hint: 'An actor driven by the generated speech', aliases: ['voice', 'actor', 'ugc', 'lip sync'], settings: z.object({ situationId: z.string().nullable().default(null), voiceId: z.string().nullable().default(null) }) },
  omnihuman: { type: 'omnihuman', label: 'Omnihuman', category: 'video', tint: '--o-node-2', inputs: [{ name: 'script', type: 'text', required: true }], outputs: [{ name: 'video', type: 'video' }], hint: 'Omnihuman talking video from a script', aliases: ['voice', 'actor', 'ugc', 'avatar'], settings: z.object({ situationId: z.string().nullable().default(null), voiceId: z.string().nullable().default(null) }) },
  preset: { type: 'preset', label: 'Preset', category: 'preset', tint: '--o-node-3', inputs: [{ name: 'images', type: 'image', many: true }, { name: 'videos', type: 'video', many: true }, { name: 'prompt', type: 'text' }], outputs: [{ name: 'video', type: 'video' }], hint: 'Camera movement, gestures, show your app, unboxing POV, gameplay ad', aliases: ['camera movement', 'gestures', 'show your app', 'unboxing', 'gameplay'], settings: z.object({ presetType: z.enum(PRESET_TYPES).default('gestures'), situationId: z.string().nullable().default(null), aspectRatio: z.enum(ASPECT6).default('9:16'), strength: z.number().min(0).max(1).default(0.5) }) },
  missing: { type: 'missing', label: 'Missing node type', category: 'transform', tint: '--o-dim', inputs: [], outputs: [], local: true, hint: 'This node type no longer exists. Remove it, or replace it with a node that does the same job', settings: z.object({ originalType: z.string().default('unknown') }).passthrough() },
  deliver: { type: 'deliver', label: 'Deliver', category: 'output', tint: '--o-node-0', inputs: [{ name: 'video', type: 'video', many: true }, { name: 'image', type: 'image', many: true }, { name: 'audio', type: 'audio', many: true }], outputs: [], local: true, hint: 'Collects the final outputs of this workflow', aliases: ['output', 'final', 'export', 'collect'], settings: z.object({}).passthrough() },
};

export const PALETTE: { category: NodeSpec['category']; label: string; types: NodeType[] }[] = [
  { category: 'input', label: 'Inputs', types: ['text', 'script', 'media', 'asset'] },
  { category: 'transform', label: 'Text', types: ['llm', 'enhance'] },
  { category: 'video', label: 'Video models', types: ['video', 'veo31', 'videoEdit', 'broll', 'scene'] },
  { category: 'video', label: 'Actors', types: ['talkingActor', 'audioDriven', 'omnihuman'] },
  { category: 'image', label: 'Image models', types: ['image'] },
  { category: 'audio', label: 'Audio', types: ['music'] },
  { category: 'preset', label: 'Presets', types: ['preset'] },
  { category: 'output', label: 'Output', types: ['deliver'] },
];

/** Browser-safe short id (this module is imported by the canvas, so no node:crypto here). */
function shortId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().slice(0, 6);
  return Math.random().toString(36).slice(2, 8);
}

export function newNode(type: NodeType, x: number, y: number, settings: Record<string, unknown> = {}): WorkflowNode {
  const spec = NODE_SPECS[type];
  return { id: `n-${shortId()}`, type, title: spec.label, x, y, settings: spec.settings.parse(settings), runId: null, outputAssetId: null, outputText: null, error: null, resolvedAt: null };
}

export function newEdge(from: string, fromPort: string, to: string, toPort: string): WorkflowEdge {
  return { id: `e-${shortId()}`, from, fromPort, to, toPort };
}

/**
 * A problem with the graph. Only `error` blocks Run; `warn` marks the node
 * in the problem colour; `info` shows only in the problem list (FR-68).
 */
export type ProblemLevel = 'error' | 'warn' | 'info';
export type GraphProblem = { nodeId: string | null; message: string; level: ProblemLevel };

/** Safety limit on paid nodes per run (Q-WF-2). */
export const MAX_PAID_NODES = 40;

/** Does this node call Arcads (one paid request per run)? */
export function isPaid(n: Pick<WorkflowNode, 'type'>): boolean {
  return !NODE_SPECS[n.type].local;
}

/** Only errors block Run. */
export function blockingProblems(problems: GraphProblem[]): GraphProblem[] {
  return problems.filter((p) => p.level === 'error');
}

/** Is this connection legal? Same port type, the target port exists, no self loop, one edge per single-input port. */
export function canConnect(w: Workflow, from: WorkflowNode, fromPort: string, to: WorkflowNode, toPort: string): string | null {
  if (from.id === to.id) return 'a node cannot feed itself';
  const out = NODE_SPECS[from.type].outputs.find((p) => p.name === fromPort);
  const inp = NODE_SPECS[to.type].inputs.find((p) => p.name === toPort);
  if (!out) return `${from.title} has no output "${fromPort}"`;
  if (!inp) return `${to.title} has no input "${toPort}"`;
  if (out.type !== inp.type) return `${out.type} cannot feed ${inp.type}`;
  if (!inp.many && w.edges.some((e) => e.to === to.id && e.toPort === toPort)) return `${to.title}.${toPort} already has an input`;
  if (wouldCycle(w, from.id, to.id)) return 'that would make a loop';
  return null;
}

function wouldCycle(w: Workflow, from: string, to: string): boolean {
  // adding from→to cycles if `from` is reachable from `to`
  const next = new Map<string, string[]>();
  for (const e of w.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

/** Dependency order, or null when the graph has a cycle. */
export function topoOrder(w: Pick<Workflow, 'nodes' | 'edges'>): WorkflowNode[] | null {
  const indeg = new Map(w.nodes.map((n) => [n.id, 0]));
  const next = new Map<string, string[]>();
  for (const e of w.edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  }
  const queue = w.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const out: WorkflowNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(w.nodes.find((n) => n.id === id)!);
    for (const t of next.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  return out.length === w.nodes.length ? out : null;
}

/** Everything that must hold before Run charges a credit (errors), plus what is worth fixing (warn, info). */
export function validateGraph(w: Pick<Workflow, 'nodes' | 'edges'>): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const err = (nodeId: string | null, message: string) => { problems.push({ nodeId, message, level: 'error' }); };
  const warn = (nodeId: string | null, message: string) => { problems.push({ nodeId, message, level: 'warn' }); };
  if (w.nodes.length === 0) return [{ nodeId: null, message: 'Create a node first', level: 'error' }];
  if (!topoOrder(w)) err(null, 'The graph has a loop');
  const ids = new Set(w.nodes.map((n) => n.id));
  for (const e of w.edges) if (!ids.has(e.from) || !ids.has(e.to)) err(null, `edge ${e.id} points at a missing node`);
  const seenEdge = new Set<string>();
  for (const e of w.edges) {
    const k = `${e.from}|${e.fromPort}|${e.to}|${e.toPort}`;
    if (seenEdge.has(k)) { const a = w.nodes.find((n) => n.id === e.from); const b = w.nodes.find((n) => n.id === e.to); err(e.to, `${a?.title ?? 'A node'} is linked to ${b?.title ?? 'a node'}.${e.toPort} twice`); }
    seenEdge.add(k);
  }
  for (const n of w.nodes) {
    if (n.type === 'missing') { err(n.id, `Remove or replace ${n.title}: its type "${String(n.settings.originalType ?? 'unknown')}" no longer exists`); continue; }
    const spec = NODE_SPECS[n.type];
    const parsed = spec.settings.safeParse(n.settings);
    if (!parsed.success) err(n.id, `${n.title}: ${parsed.error.issues[0]?.message ?? 'bad settings'}`);
    for (const p of spec.inputs) {
      if (p.required && !w.edges.some((e) => e.to === n.id && e.toPort === p.name)) err(n.id, `${n.title} needs ${p.name}`);
    }
    for (const e of w.edges.filter((x) => x.to === n.id)) {
      const from = w.nodes.find((x) => x.id === e.from);
      if (!from) continue;
      const out = NODE_SPECS[from.type].outputs.find((p) => p.name === e.fromPort);
      const inp = spec.inputs.find((p) => p.name === e.toPort);
      if (!out || !inp || out.type !== inp.type) err(n.id, `${from.title}.${e.fromPort} cannot feed ${n.title}.${e.toPort}`);
    }
    if (n.type === 'text' && !String(n.settings.text ?? '').trim()) err(n.id, `${n.title} is empty`);
    if (n.type === 'media' && !String(n.settings.path ?? '').trim()) err(n.id, `${n.title} has no file`);
    if (n.type === 'asset' && !n.settings.assetId && !n.settings.arcadsAssetId) err(n.id, `${n.title} has no asset picked`);
    if (n.type === 'script' && !n.settings.scriptId) err(n.id, `${n.title} has no script picked`);
    if ((n.type === 'talkingActor' || n.type === 'audioDriven' || n.type === 'omnihuman' || n.type === 'preset') && !n.settings.situationId) err(n.id, `${n.title} needs a scene (situation)`);
    if (n.type === 'preset') {
      const pt = n.settings.presetType as PresetType;
      const hasImg = w.edges.some((e) => e.to === n.id && e.toPort === 'images');
      const hasVid = w.edges.some((e) => e.to === n.id && e.toPort === 'videos');
      if (pt === 'gameplay-ad' && !hasVid) err(n.id, 'Gameplay ad needs a gameplay video');
      if (pt !== 'gameplay-ad' && !hasImg) err(n.id, `${pt} needs an image`);
    }
  }
  // FR-68: not wrong, but worth a look (never blocks Run)
  const delivers = w.nodes.filter((n) => n.type === 'deliver');
  const reachesDeliver = new Set<string>(delivers.map((d) => d.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const e of w.edges) if (reachesDeliver.has(e.to) && !reachesDeliver.has(e.from)) { reachesDeliver.add(e.from); changed = true; }
  }
  for (const n of w.nodes) {
    const spec = NODE_SPECS[n.type];
    if (n.type === 'missing') continue; // already an error above
    if (n.type === 'deliver') { if (!w.edges.some((e) => e.to === n.id)) warn(n.id, `${n.title} has nothing to collect`); continue; }
    if (spec.category === 'input') { if (!w.edges.some((e) => e.from === n.id)) warn(n.id, `${n.title} isn't linked to anything`); continue; }
    if (delivers.length && !reachesDeliver.has(n.id)) warn(n.id, `${n.title} isn't connected to Deliver; its output still lands in the campaign`);
  }
  if (!delivers.length) problems.push({ nodeId: null, message: 'No Deliver node: every output still lands in the campaign, none is marked final', level: 'info' });
  const paid = w.nodes.filter(isPaid).length;
  if (paid > MAX_PAID_NODES) err(null, `Split this workflow; one run is capped at ${MAX_PAID_NODES} paid requests (this one has ${paid})`);
  return problems;
}

/** The nodes feeding a given input port, in edge order. */
export function upstream(w: Workflow, nodeId: string, port: string): WorkflowNode[] {
  return w.edges.filter((e) => e.to === nodeId && e.toPort === port).map((e) => w.nodes.find((n) => n.id === e.from)).filter((n): n is WorkflowNode => !!n);
}

/** Node status derived on read, never stored as truth. */
export type NodeStatus = 'idle' | 'ready' | 'waiting' | 'running' | 'done' | 'failed';

export function nodeStatus(w: Workflow, n: WorkflowNode, runStatus: (runId: string) => 'running' | 'delivered' | 'failed' | 'stale' | 'abandoned' | 'queued' | null): NodeStatus {
  if (!w.runStartedAt) return 'idle';
  if (w.runScope && !w.runScope.includes(n.id)) {
    // outside a scoped run (Run failed only, Run from here): the node keeps what it had
    if (n.error) return 'failed';
    if (n.resolvedAt || n.outputAssetId) return 'done';
    if (n.runId) { const s = runStatus(n.runId); return s === 'delivered' ? 'done' : s === 'failed' || s === 'stale' || s === 'abandoned' ? 'failed' : 'running'; }
    return 'idle';
  }
  if (n.error) return 'failed';
  if (n.resolvedAt && n.resolvedAt >= w.runStartedAt) return 'done';
  if (n.runId) {
    const s = runStatus(n.runId);
    if (s === 'delivered') return 'done';
    if (s === 'failed' || s === 'stale' || s === 'abandoned') return 'failed';
    return 'running';
  }
  const deps = w.edges.filter((e) => e.to === n.id).map((e) => w.nodes.find((x) => x.id === e.from)).filter((x): x is WorkflowNode => !!x);
  return deps.every((d) => nodeStatus(w, d, runStatus) === 'done') ? 'ready' : 'waiting';
}

/* ───────────────────────────── starter templates ───────────────────────────── */

export type Template = { id: string; name: string; hint: string; build: (ctx: { scriptId: string | null; beats: { name: string; spoken: string; seconds: number }[] }) => { nodes: WorkflowNode[]; edges: WorkflowEdge[] } };

export const TEMPLATES: Template[] = [
  {
    id: 'script-ugc', name: 'Script to talking actor', hint: 'The approved script spoken by an actor, delivered.',
    build: ({ scriptId }) => {
      const s = newNode('script', 40, 120, { scriptId }); const a = newNode('talkingActor', 320, 120); const d = newNode('deliver', 620, 120);
      return { nodes: [s, a, d], edges: [newEdge(s.id, 'text', a.id, 'script'), newEdge(a.id, 'video', d.id, 'video')] };
    },
  },
  {
    id: 'prompt-video-edit', name: 'Prompt, video, edit', hint: 'A text prompt becomes a video, then an edit pass rewrites it.',
    build: () => {
      const t = newNode('text', 40, 60, { text: 'A person in a plain t-shirt holds the product up to the camera in window light.' }); const v = newNode('video', 320, 60); const e = newNode('text', 320, 330, { text: 'Make the lighting warmer and add a slow push-in.' }); const ed = newNode('videoEdit', 620, 180); const d = newNode('deliver', 920, 180);
      return { nodes: [t, v, e, ed, d], edges: [newEdge(t.id, 'text', v.id, 'prompt'), newEdge(v.id, 'video', ed.id, 'videos'), newEdge(e.id, 'text', ed.id, 'prompt'), newEdge(ed.id, 'video', d.id, 'video')] };
    },
  },
  {
    id: 'image-start-frame', name: 'Image to video', hint: 'Generate a still, then animate it as the start frame.',
    build: () => {
      const t = newNode('text', 40, 60, { text: 'Product on a kitchen counter, morning light, phone photo.' }); const i = newNode('image', 320, 60); const t2 = newNode('text', 320, 330, { text: 'The camera slowly pushes in while steam rises.' }); const v = newNode('veo31', 620, 180); const d = newNode('deliver', 920, 180);
      return { nodes: [t, i, t2, v, d], edges: [newEdge(t.id, 'text', i.id, 'prompt'), newEdge(i.id, 'image', v.id, 'startFrame'), newEdge(t2.id, 'text', v.id, 'prompt'), newEdge(v.id, 'video', d.id, 'video')] };
    },
  },
  {
    id: 'beats', name: 'One video per beat', hint: 'Each beat of the approved script becomes its own clip.',
    build: ({ scriptId, beats }) => {
      // one row per beat (script, then its video), every row feeding one Deliver centred on the right:
      // wires run left to right and never cross a node
      const nodes: WorkflowNode[] = []; const edges: WorkflowEdge[] = [];
      const ROW = 240;
      const d = newNode('deliver', 700, 40 + Math.round((Math.max(1, beats.length) - 1) * ROW / 2) + 40);
      beats.forEach((b, i) => {
        const s = newNode('script', 40, 40 + i * ROW, { scriptId, beat: i }); s.title = b.name;
        const v = newNode('video', 340, 40 + i * ROW, { duration: Math.max(4, Math.min(15, b.seconds)) });
        nodes.push(s, v); edges.push(newEdge(s.id, 'text', v.id, 'prompt'), newEdge(v.id, 'video', d.id, 'video'));
      });
      nodes.push(d);
      return { nodes, edges };
    },
  },
];

/** What a template makes, for the start card: its paid-request count and a tiny diagram (S05b FR-46). */
export type TemplateSummary = { id: string; name: string; hint: string; paidRequests: number; needsScript: boolean; preview: { nodes: { x: number; y: number; type: NodeType }[]; edges: { from: number; to: number }[] } };

export function templateSummary(t: Template, ctx: Parameters<Template['build']>[0]): TemplateSummary {
  const g = t.build(ctx);
  const index = new Map(g.nodes.map((n, i) => [n.id, i]));
  return {
    id: t.id, name: t.name, hint: t.hint,
    paidRequests: g.nodes.filter(isPaid).length,
    needsScript: (t.id === 'beats' && ctx.beats.length === 0) || (t.id === 'script-ugc' && !ctx.scriptId),
    preview: { nodes: g.nodes.map((n) => ({ x: n.x, y: n.y, type: n.type })), edges: g.edges.map((e) => ({ from: index.get(e.from) ?? 0, to: index.get(e.to) ?? 0 })) },
  };
}
