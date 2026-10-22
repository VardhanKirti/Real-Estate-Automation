import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { ROLE_KIND, findModel, type ModelFamily } from '@/lib/higgsfield/catalog';
import { identityAssets, readHiggsfieldAccount, type IdentityAsset } from '@/lib/higgsfield/account';
import { addSpecTask, estimateCredits, findContentTool, type ProductionTask, type SpecMedia, type TaskSpec } from '@/lib/content-production';
import { dataPath } from '@/lib/paths';

/**
 * The Pipelines system: a media DAG builder sharing the /workflows visual
 * language (branching flowchart, openable nodes) but purpose-built for
 * Higgsfield generation chains — CONTENT-V3-SCAFFOLD.md §6. This module
 * carries the schema, the file-backed pipeline store, and the compiler that
 * turns a validated DAG into real production-queue tasks via
 * lib/content-production.ts's addSpecTask.
 *
 * Server-only (node:fs, and it pulls in content-production.ts which is also
 * fs-backed) — client components (PipelineBoard, PipelineBuilder) must only
 * `import type` from here, never a runtime value, so this module never ends
 * up in a browser bundle. The pure pieces they DO need at runtime — schemas
 * for validation feedback, credit math — come from lib/content-schema.ts and
 * lib/higgsfield/catalog.ts instead, exactly like the rest of Content v3.
 */

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const NODE_KINDS = ['input', 'generate', 'transform', 'output'] as const;
export const PipelineNodeKindSchema = z.enum(NODE_KINDS);
export type PipelineNodeKind = z.infer<typeof PipelineNodeKindSchema>;

/** The media kind an input node carries. 'text' covers a YouTube URL or a
 *  literal text value fed straight into a downstream node's params (a
 *  parameter, not a role-typed media slot — the catalog has no text role,
 *  so a text-kind input can never satisfy a mediaBinding; see
 *  validatePipeline). */
export const INPUT_KINDS = ['image', 'video', 'audio', 'text'] as const;
export const InputKindSchema = z.enum(INPUT_KINDS);
export type InputKind = z.infer<typeof InputKindSchema>;

export const MEDIA_SOURCE_TYPES = ['upload', 'library', 'identity', 'text', 'node'] as const;
export const MediaSourceTypeSchema = z.enum(MEDIA_SOURCE_TYPES);
export type MediaSourceType = z.infer<typeof MediaSourceTypeSchema>;

export const MediaSourceSchema = z.object({
  type: MediaSourceTypeSchema,
  /** upload/library: a path under /content-media/. identity: an id from
   *  data/higgsfield/account.json (characters or elements). text: the
   *  literal value. node: an upstream node's id in this same pipeline. */
  ref: z.string().min(1),
});
export type MediaSource = z.infer<typeof MediaSourceSchema>;

export const MediaBindingSchema = z.object({
  /** An HfMediaRole from the catalog (image, start_image, input_audio, …). */
  role: z.string().min(1),
  source: MediaSourceSchema,
});
export type MediaBinding = z.infer<typeof MediaBindingSchema>;

const ParamValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]);

export const PipelineNodeSchema = z.object({
  id: z.string().min(1),
  kind: PipelineNodeKindSchema,
  label: z.string().min(1),
  /** Required for generate/transform (checked in validatePipeline, not the
   *  schema, so a mid-edit draft with a not-yet-picked model still parses). A
   *  reserved `params.batch` (1-8) sets the parallel-run count for a
   *  generate/transform node — see splitBatchParam — everything else in
   *  params is passed straight through as the model's real parameters. */
  model: z.string().min(1).nullable().default(null),
  params: z.record(ParamValueSchema).default({}),
  aspectRatio: z.string().nullable().default(null),
  duration: z.number().nullable().default(null),
  prompt: z.string().nullable().default(null),
  mediaBindings: z.array(MediaBindingSchema).default([]),
  /** input nodes only — the media kind this input carries. */
  inputKind: InputKindSchema.nullable().default(null),
});
export type PipelineNode = z.infer<typeof PipelineNodeSchema>;

/** Visual graph edge. Media flow is expressed separately, through each
 *  node's mediaBindings with source.type 'node' — edges exist so the
 *  builder and board can draw the flowchart without re-deriving topology
 *  from every media role on every node. */
export const PipelineEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type PipelineEdge = z.infer<typeof PipelineEdgeSchema>;

export const PipelineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  nodes: z.array(PipelineNodeSchema).default([]),
  edges: z.array(PipelineEdgeSchema).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Pipeline = z.infer<typeof PipelineSchema>;

/** The shape a create/update request carries — everything but the id and
 *  timestamps, which the store assigns. */
export const PipelineInputSchema = PipelineSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type PipelineInput = z.infer<typeof PipelineInputSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A node's output media kind, for the socket type-checker: a generate/
 *  transform node's kind comes from its model's catalog entry; an input
 *  node carries an explicit inputKind; an output node has no output kind of
 *  its own (nothing downstream should source from one). */
function nodeOutputKind(node: PipelineNode): 'image' | 'video' | 'audio' | 'text' | null {
  if (node.kind === 'input') return node.inputKind;
  if (node.kind === 'generate' || node.kind === 'transform') {
    if (!node.model) return null;
    return findModel(node.model)?.output ?? null;
  }
  return null; // output nodes produce nothing downstream can bind to
}

/**
 * Checks: every edge endpoint exists, the graph is acyclic (over edges),
 * every generate/transform node names a model that exists in the catalog,
 * and every 'node'-sourced mediaBinding is type-checked — the upstream
 * node's output kind must equal ROLE_KIND[binding.role]. Returns a list of
 * human-readable problems; an empty list means the pipeline is valid.
 */
export function validatePipeline(pipeline: Pipeline): string[] {
  const problems: string[] = [];
  const byId = new Map(pipeline.nodes.map((n) => [n.id, n]));

  const seenIds = new Set<string>();
  for (const node of pipeline.nodes) {
    if (seenIds.has(node.id)) problems.push(`duplicate node id: ${node.id}`);
    seenIds.add(node.id);
  }

  for (const edge of pipeline.edges) {
    if (!byId.has(edge.from)) problems.push(`edge references unknown node: ${edge.from}`);
    if (!byId.has(edge.to)) problems.push(`edge references unknown node: ${edge.to}`);
  }

  // Acyclicity over the visual edge graph.
  const adjacency = new Map<string, string[]>();
  for (const edge of pipeline.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    else adjacency.set(edge.from, [edge.to]);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  let cyclic = false;
  function dfs(id: string) {
    if (cyclic) return;
    color.set(id, GRAY);
    for (const next of adjacency.get(id) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        cyclic = true;
        return;
      }
      if (c === WHITE) dfs(next);
    }
    color.set(id, BLACK);
  }
  for (const node of pipeline.nodes) {
    if ((color.get(node.id) ?? WHITE) === WHITE) dfs(node.id);
  }
  if (cyclic) problems.push('the pipeline graph has a cycle — a node cannot depend on its own output');

  for (const node of pipeline.nodes) {
    if (node.kind === 'generate' || node.kind === 'transform') {
      if (!node.model) {
        problems.push(`node "${node.label}" (${node.id}): generate/transform nodes require a model`);
      } else if (!findModel(node.model)) {
        problems.push(`node "${node.label}" (${node.id}): unknown model "${node.model}"`);
      }
    }

    for (const binding of node.mediaBindings) {
      const roleKind = ROLE_KIND[binding.role as keyof typeof ROLE_KIND];
      if (!roleKind) {
        problems.push(`node "${node.label}" (${node.id}): unknown media role "${binding.role}"`);
        continue;
      }
      if (binding.source.type !== 'node') continue;
      const upstream = byId.get(binding.source.ref);
      if (!upstream) {
        problems.push(`node "${node.label}" (${node.id}): media binding "${binding.role}" sources unknown node "${binding.source.ref}"`);
        continue;
      }
      const upstreamKind = nodeOutputKind(upstream);
      if (upstreamKind === null) {
        problems.push(
          `node "${node.label}" (${node.id}): media binding "${binding.role}" sources "${upstream.label}", which has no determinable output`,
        );
        continue;
      }
      if (upstreamKind !== roleKind) {
        problems.push(
          `node "${node.label}" (${node.id}): media binding "${binding.role}" expects ${roleKind} but "${upstream.label}" outputs ${upstreamKind}`,
        );
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/** node.params carries an optional reserved `batch` key (1-8, default 1) —
 *  everything else passes straight through as the model's real parameters. */
function splitBatchParam(params: PipelineNode['params']): { batch: number; params: TaskSpec['params'] } {
  const { batch: rawBatch, ...rest } = params;
  const batch = typeof rawBatch === 'number' && rawBatch >= 1 && rawBatch <= 8 ? Math.round(rawBatch) : 1;
  return { batch, params: rest as TaskSpec['params'] };
}

function resolveIdentity(assetId: string): TaskSpec['identity'] {
  const account = readHiggsfieldAccount();
  if (!account) return null;
  const asset: IdentityAsset | undefined = identityAssets(account).find((a) => a.id === assetId);
  if (!asset) return null;
  return { kind: asset.kind, id: asset.id, name: asset.name };
}

/** Dependency edges among generate/transform nodes only, derived from
 *  'node'-sourced mediaBindings (the real data dependency — distinct from
 *  the visual `edges` array, which can carry input/output nodes too). */
function taskDependencies(pipeline: Pipeline): Map<string, Set<string>> {
  const byId = new Map(pipeline.nodes.map((n) => [n.id, n]));
  const deps = new Map<string, Set<string>>();
  for (const node of pipeline.nodes) {
    if (node.kind !== 'generate' && node.kind !== 'transform') continue;
    const set = new Set<string>();
    for (const binding of node.mediaBindings) {
      if (binding.source.type !== 'node') continue;
      const upstream = byId.get(binding.source.ref);
      if (upstream && (upstream.kind === 'generate' || upstream.kind === 'transform')) set.add(upstream.id);
    }
    deps.set(node.id, set);
  }
  return deps;
}

/** Topological order over generate/transform nodes, upstream before
 *  downstream. Assumes an already-validated (acyclic) pipeline. */
export function topologicalTaskOrder(pipeline: Pipeline): PipelineNode[] {
  const deps = taskDependencies(pipeline);
  const nodes = pipeline.nodes.filter((n) => n.kind === 'generate' || n.kind === 'transform');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const result: PipelineNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string) {
    if (visited.has(id) || !byId.has(id)) return;
    if (visiting.has(id)) return; // a cycle here means validatePipeline should have already rejected this pipeline
    visiting.add(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
    result.push(byId.get(id)!);
  }
  for (const node of nodes) visit(node.id);
  return result;
}

/**
 * Compiles a validated pipeline into real production-queue tasks, one per
 * generate/transform node, in dependency order. Each task carries the full
 * fulfillment spec plus {pipelineId, nodeId, dependsOn} so the Production
 * queue can show per-node status and gate downstream nodes as 'blocked'
 * until their upstream delivers (resolveQueue in lib/content-schema.ts).
 * Throws if the pipeline fails validatePipeline — callers (the run route)
 * are expected to check first so they can surface the problem list instead.
 */
export function compilePipeline(pipeline: Pipeline, campaignId: string, file?: string): ProductionTask[] {
  const problems = validatePipeline(pipeline);
  if (problems.length > 0) throw new Error(`pipeline "${pipeline.name}" is invalid: ${problems.join('; ')}`);

  const order = topologicalTaskOrder(pipeline);
  const taskIdByNode = new Map<string, string>();
  const tasks: ProductionTask[] = [];

  for (const node of order) {
    const model = findModel(node.model!)!; // validated above
    const tool = findContentTool(model.family as ModelFamily)!; // family names match tool keys 1:1
    const { batch, params } = splitBatchParam(node.params);

    const medias: SpecMedia[] = [];
    let identity: TaskSpec['identity'] = null;
    const dependsOn: string[] = [];

    for (const binding of node.mediaBindings) {
      if (binding.source.type === 'identity') {
        identity = resolveIdentity(binding.source.ref);
        continue;
      }
      if (binding.source.type === 'node') {
        const upstreamTaskId = taskIdByNode.get(binding.source.ref);
        if (upstreamTaskId) dependsOn.push(upstreamTaskId);
        medias.push({ role: binding.role, ref: `node:${binding.source.ref}` });
        continue;
      }
      medias.push({ role: binding.role, ref: binding.source.ref });
    }

    const spec: TaskSpec = {
      model: node.model!,
      params,
      aspectRatio: node.aspectRatio ?? null,
      duration: node.duration ?? null,
      prompt: node.prompt ?? '',
      medias,
      identity,
      skill: null,
      batch,
    };

    const task = addSpecTask(
      { toolKey: tool.key, campaignId, title: node.label, spec },
      { pipelineId: pipeline.id, nodeId: node.id, dependsOn: dependsOn.length > 0 ? dependsOn : undefined },
      file,
    );
    taskIdByNode.set(node.id, task.id);
    tasks.push(task);
  }

  return tasks;
}

export type PipelinePreviewNode = {
  nodeId: string;
  label: string;
  kind: PipelineNodeKind;
  model: string | null;
  credits: number;
};
export type PipelinePreview = { nodes: PipelinePreviewNode[]; totalCredits: number };

/** Ordered node list + per-node ~credits + total, for the cost-gated
 *  confirm — pure, no side effects, safe to call before Run is pressed. */
export function runPreview(pipeline: Pipeline): PipelinePreview {
  const order = topologicalTaskOrder(pipeline);
  const nodes: PipelinePreviewNode[] = order.map((node) => {
    const { batch } = splitBatchParam(node.params);
    return {
      nodeId: node.id,
      label: node.label,
      kind: node.kind,
      model: node.model,
      credits: estimateCredits({ model: node.model!, batch }),
    };
  });
  return { nodes, totalCredits: nodes.reduce((n, x) => n + x.credits, 0) };
}

// ---------------------------------------------------------------------------
// Store (file-backed, seeded on first read)
// ---------------------------------------------------------------------------

export function pipelinesStorePath(): string {
  return process.env.PIPELINES_STORE_PATH ?? dataPath('content-pipelines.json');
}

function now(): string {
  return new Date().toISOString();
}

function inputNode(id: string, label: string, inputKind: InputKind): PipelineNode {
  return {
    id,
    kind: 'input',
    label,
    model: null,
    params: {},
    aspectRatio: null,
    duration: null,
    prompt: null,
    mediaBindings: [],
    inputKind,
  };
}

function outputNode(id: string, label: string, fromNodeId: string, role: 'image_references' | 'video_references'): PipelineNode {
  return {
    id,
    kind: 'output',
    label,
    model: null,
    params: {},
    aspectRatio: null,
    duration: null,
    prompt: null,
    mediaBindings: [{ role, source: { type: 'node', ref: fromNodeId } }],
    inputKind: null,
  };
}

/**
 * Two starter templates built from the real model catalog. No invented
 * model ids, no "demo"/"sample"/"placeholder" copy anywhere.
 */
export function seedPipelines(): Pipeline[] {
  const seededAt = '2026-09-02T09:00:00-07:00';

  const thumbnailPack: Pipeline = {
    id: 'pipeline-thumbnail-pack',
    name: 'Thumbnail pack',
    description: 'A reference frame goes into three 4K thumbnail concepts, then the pick gets a generative upscale before it lands in the campaign.',
    nodes: [
      inputNode('input-frame', 'Reference frame', 'image'),
      {
        id: 'gen-thumbnails',
        kind: 'generate',
        label: 'Generate thumbnail set',
        model: 'nano_banana_pro',
        params: { resolution: '4k', batch: 3 },
        aspectRatio: '16:9',
        duration: null,
        prompt: 'Reel cover built from the reference frame — bold subject, high contrast, room for a short headline',
        mediaBindings: [{ role: 'image_references', source: { type: 'node', ref: 'input-frame' } }],
        inputKind: null,
      },
      {
        id: 'upscale-thumbnails',
        kind: 'transform',
        label: 'Upscale to delivery size',
        model: 'topaz_image_generative',
        params: { output_width: 3840, output_height: 2160, variant: 'Redefine' },
        aspectRatio: null,
        duration: null,
        prompt: null,
        mediaBindings: [{ role: 'image_references', source: { type: 'node', ref: 'gen-thumbnails' } }],
        inputKind: null,
      },
      outputNode('deliver-thumbnails', 'Deliver to campaign', 'upscale-thumbnails', 'image_references'),
    ],
    edges: [
      { from: 'input-frame', to: 'gen-thumbnails' },
      { from: 'gen-thumbnails', to: 'upscale-thumbnails' },
      { from: 'upscale-thumbnails', to: 'deliver-thumbnails' },
    ],
    createdAt: seededAt,
    updatedAt: seededAt,
  };

  const clipPass: Pipeline = {
    id: 'pipeline-clip-pass',
    name: 'Clip pass',
    description: 'One YouTube video becomes ten subtitled vertical clips, ready to post individually.',
    nodes: [
      inputNode('input-url', 'Source video URL', 'text'),
      {
        id: 'gen-clips',
        kind: 'generate',
        label: 'Cut into subtitled clips',
        model: 'clipify',
        params: {
          urls: ['https://www.youtube.com/watch?v=REPLACE_WITH_SOURCE'],
          clips_num: 10,
          clip_aspect: '9:16',
          subtitle_position: 'bottom',
        },
        aspectRatio: null,
        duration: null,
        prompt: null,
        mediaBindings: [],
        inputKind: null,
      },
      outputNode('deliver-clips', 'Deliver clips to campaign', 'gen-clips', 'video_references'),
    ],
    edges: [
      { from: 'input-url', to: 'gen-clips' },
      { from: 'gen-clips', to: 'deliver-clips' },
    ],
    createdAt: seededAt,
    updatedAt: seededAt,
  };

  return [thumbnailPack, clipPass];
}

const PipelinesFileSchema = z.object({ pipelines: z.array(PipelineSchema) });

function ensureSeeded(file: string): void {
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ pipelines: seedPipelines() }, null, 2)}\n`, 'utf8');
}

export function readPipelines(file: string = pipelinesStorePath()): Pipeline[] {
  ensureSeeded(file);
  try {
    const raw = readFileSync(file, 'utf8');
    return PipelinesFileSchema.parse(JSON.parse(raw)).pipelines;
  } catch {
    return seedPipelines();
  }
}

export function writePipelines(pipelines: Pipeline[], file: string = pipelinesStorePath()): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ pipelines }, null, 2)}\n`, 'utf8');
}

export function getPipeline(id: string, file: string = pipelinesStorePath()): Pipeline | undefined {
  return readPipelines(file).find((p) => p.id === id);
}

export function createPipeline(input: PipelineInput, file: string = pipelinesStorePath()): Pipeline {
  const ts = now();
  const pipeline: Pipeline = PipelineSchema.parse({
    id: `pipeline-${randomUUID()}`,
    ...input,
    createdAt: ts,
    updatedAt: ts,
  });
  const pipelines = readPipelines(file);
  pipelines.push(pipeline);
  writePipelines(pipelines, file);
  return pipeline;
}

export function updatePipeline(id: string, input: PipelineInput, file: string = pipelinesStorePath()): Pipeline | null {
  const pipelines = readPipelines(file);
  const idx = pipelines.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const updated: Pipeline = PipelineSchema.parse({
    ...input,
    id,
    createdAt: pipelines[idx].createdAt,
    updatedAt: now(),
  });
  pipelines[idx] = updated;
  writePipelines(pipelines, file);
  return updated;
}

export function deletePipeline(id: string, file: string = pipelinesStorePath()): boolean {
  const pipelines = readPipelines(file);
  const next = pipelines.filter((p) => p.id !== id);
  if (next.length === pipelines.length) return false;
  writePipelines(next, file);
  return true;
}
