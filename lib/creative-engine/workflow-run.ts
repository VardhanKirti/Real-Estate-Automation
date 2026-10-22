import fs from 'node:fs';
import { relFromPublic } from '@/lib/creative-engine/migrate';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ArcadsClient, createArcadsClient, explainArcadsError, type CreateResponse } from '@/lib/arcads/client';
import { buildVideoBody, validateRequest } from '@/lib/arcads/validate';
import { composePrompt } from '@/lib/creative-engine/compose';
import { claudeJson } from '@/lib/creative-engine/claude';
import { isDry } from '@/lib/creative-engine/dry';
import { enforceCap, refreshCredits, resolveProductId } from '@/lib/creative-engine/generate';
import { abandonRun, failRun, listRuns, startRun } from '@/lib/creative-engine/runs';
import { ConsoleControlsSchema, type Campaign, type Generation, type Workflow, type WorkflowNode } from '@/lib/creative-engine/schemas';
import { appendLedger, assetRoot, clearResetSnapshot, lastCharge, mutateCampaign, mutateRun, mutateWorkflow, readCampaign, readResetSnapshot, readWorkflow, readWorkflows, writeResetSnapshot, writeWorkflowVersion } from '@/lib/creative-engine/store';
import { matchVoice, readCatalog } from '@/lib/arcads/catalog';
import { NODE_SPECS, blockingProblems, isPaid, nodeStatus, topoOrder, upstream, validateGraph, type GraphProblem } from '@/lib/creative-engine/workflow';
import { nodesInScope, type RunScope } from '@/lib/creative-engine/workflow-edit';

/**
 * Workflow engine. Run = validate, stamp runStartedAt, then `advance`.
 * `advance` walks nodes in dependency order: a node whose inputs are all
 * done either resolves locally (text, script, media, asset, llm, enhance,
 * deliver) or submits to Arcads and gets a Run. The existing read-driven
 * poll (advanceArcadsRuns) delivers those runs and files the asset on the
 * campaign; `syncWorkflows`, called right after it, copies the asset id
 * onto the node and advances again so the next layer submits. Nothing is
 * predicted: each Arcads node is charged exactly as any console request.
 */

type RunStatus = ReturnType<typeof listRuns>[number]['status'];

export class WorkflowError extends Error {
  constructor(public problems: GraphProblem[]) {
    super(problems.map((p) => p.message).join('; '));
  }
}

/**
 * Dry for the workflow engine: CREATIVE_ENGINE_DRY, or Filming mode (Q-ENG-7: the
 * demo world never spends real credits). Read per call. `isDry()` already
 * folds in Filming, so this is the same check under the engine's name.
 */
export function engineDry(): boolean {
  return isDry();
}

export type StartOptions = { override?: boolean; scope?: RunScope; nodeId?: string | null; /** tests: a fake Arcads client (counts submissions) */ client?: ArcadsClient | null };

/** Why a scoped run can't start (an upstream node of the scope has no output yet), or null. */
function scopeBlocked(w: Workflow, scope: RunScope, nodeId: string | null | undefined): string | null {
  const inScope = nodesInScope(w, scope, nodeId);
  if (!inScope.length) return scope === 'failed' ? 'Nothing failed, so there is nothing to re-run' : 'Pick a node to run from';
  if (scope === 'all') return null;
  const ids = new Set(inScope.map((n) => n.id));
  for (const e of w.edges) {
    if (!ids.has(e.to) || ids.has(e.from)) continue;
    const up = w.nodes.find((n) => n.id === e.from);
    if (up && up.type !== 'media' && !up.outputAssetId && up.outputText === null && !up.resolvedAt) return `${up.title} has no output yet. Run all first`;
  }
  return null;
}

/**
 * Run: validate (errors only block), check the cap, snapshot a version,
 * reset the nodes in scope and advance. Nodes outside the scope keep their
 * outputs and resolvedAt (S05b FR-60), so "Run failed only" never re-charges
 * what already delivered.
 */
export async function startWorkflow(id: string, opts: boolean | StartOptions = {}): Promise<Workflow> {
  const o: StartOptions = typeof opts === 'boolean' ? { override: opts } : opts;
  const scope = o.scope ?? 'all';
  const w = readWorkflow(id);
  if (!w) throw new Error('workflow not found');
  const problems = blockingProblems(validateGraph(w));
  if (problems.length) throw new WorkflowError(problems);
  const blocked = scopeBlocked(w, scope, o.nodeId);
  if (blocked) throw new WorkflowError([{ nodeId: o.nodeId ?? null, message: blocked, level: 'error' }]);
  const inScope = new Set(nodesInScope(w, scope, o.nodeId).map((n) => n.id));
  const hasArcads = w.nodes.some((n) => inScope.has(n.id) && isPaid(n));
  if (hasArcads && !engineDry() && !(o.client ?? createArcadsClient())) throw new Error('Arcads not configured — set ARCADS_BASIC_AUTH');
  if (hasArcads && !engineDry()) enforceCap(!!o.override);
  writeWorkflowVersion(w, { reason: 'run', note: scope === 'all' ? 'Run' : scope === 'failed' ? 'Run failed only' : `Run from ${w.nodes.find((n) => n.id === o.nodeId)?.title ?? 'a node'}` });
  clearResetSnapshot(id);
  const started = mutateWorkflow(id, (x) => ({
    ...x,
    runStartedAt: new Date().toISOString(),
    runScope: scope === 'all' ? null : [...inScope],
    nodes: x.nodes.map((n) => (inScope.has(n.id) ? { ...n, runId: null, outputAssetId: null, outputText: n.type === 'text' ? n.outputText : null, error: null, resolvedAt: null } : n)),
  }))!;
  return advanceWorkflow(started.id, !!o.override, o.client);
}

/** What a Run of `scope` would do, without doing it: the gate shows this (S05b FR-58). Same scope rule as the engine. */
const LEDGER_MODEL: Partial<Record<WorkflowNode['type'], string>> = { veo31: 'veo31', videoEdit: 'omni-flash', broll: 'b-roll', scene: 'scene', audioDriven: 'audioDriven', omnihuman: 'omnihuman' };

export type RunPlan = {
  dry: boolean;
  scope: RunScope;
  paid: { nodeId: string; title: string; type: string; model: string | null; detail: string; enhance: boolean; delivered: boolean; lastCharged: { credits: number; model: string; at: string } | null }[];
  local: { nodeId: string; title: string; type: string }[];
  problems: GraphProblem[];
  blocked: string | null;
};

export function planWorkflow(id: string, scope: RunScope = 'all', nodeId?: string | null): RunPlan | null {
  const w = readWorkflow(id);
  if (!w) return null;
  const inScope = nodesInScope(w, scope, nodeId);
  const enhancedBy = (n: WorkflowNode) => w.edges.some((e) => e.to === n.id && w.nodes.find((x) => x.id === e.from)?.type === 'enhance');
  return {
    dry: engineDry(),
    scope,
    paid: inScope.filter(isPaid).map((n) => {
      const parsed = NODE_SPECS[n.type].settings.safeParse(n.settings);
      const s = (parsed.success ? parsed.data : n.settings) as Record<string, unknown>;
      // the model name the ledger records for this node (submitArcadsNode's attach), so "last charged" finds it
      const model = typeof s.model === 'string' ? s.model : typeof s.presetType === 'string' ? s.presetType : LEDGER_MODEL[n.type] ?? null;
      const detail = [s.duration ? `${String(s.duration)}s` : null, typeof s.aspectRatio === 'string' ? s.aspectRatio : null, typeof s.resolution === 'string' ? s.resolution : null].filter(Boolean).join(' · ');
      const lc = model ? lastCharge(model, typeof s.duration === 'number' ? s.duration : null) : null;
      return { nodeId: n.id, title: n.title, type: n.type, model, detail, enhance: !!s.enhance || enhancedBy(n), delivered: !!n.outputAssetId, lastCharged: lc && lc.creditsCharged !== null ? { credits: lc.creditsCharged, model: lc.model, at: lc.at } : null };
    }),
    local: inScope.filter((n) => !isPaid(n)).map((n) => ({ nodeId: n.id, title: n.title, type: n.type })),
    problems: validateGraph(w),
    blocked: scopeBlocked(w, scope, nodeId),
  };
}

/**
 * Stop (S05b FR-61): abandon the in-flight runs of this workflow and mark
 * every node that hasn't resolved `stopped`. Arcads has no cancel, so a
 * request already sent keeps running and stays charged; its asset still
 * lands in the campaign through the runs poll.
 */
export function stopWorkflow(id: string): Workflow | null {
  const w = readWorkflow(id);
  if (!w) return null;
  if (!w.runStartedAt) return w;
  const runs = listRuns(w.campaignId);
  const scope = w.runScope ? new Set(w.runScope) : null;
  for (const n of w.nodes) {
    if (!n.runId || n.outputAssetId || n.error) continue;
    const r = runs.find((x) => x.id === n.runId);
    if (r && (r.status === 'running' || r.status === 'queued')) abandonRun(r.id);
  }
  return mutateWorkflow(id, (x) => ({ ...x, nodes: x.nodes.map((n) => ((scope && !scope.has(n.id)) || n.error || n.outputAssetId || (n.resolvedAt && n.resolvedAt >= (x.runStartedAt ?? '')) ? n : { ...n, error: 'stopped' })) }));
}

/** Reset keeps what it cleared for one Undo (S05b FR-62). */
export function resetWorkflow(id: string): Workflow | null {
  const w = readWorkflow(id);
  if (!w) return null;
  writeResetSnapshot(id, { at: new Date().toISOString(), runStartedAt: w.runStartedAt, runScope: w.runScope ?? null, nodes: w.nodes.map((n) => ({ id: n.id, runId: n.runId, outputAssetId: n.outputAssetId, outputText: n.outputText, error: n.error, resolvedAt: n.resolvedAt })) });
  return mutateWorkflow(id, (x) => ({ ...x, runStartedAt: null, runScope: null, nodes: x.nodes.map((n) => ({ ...n, runId: null, outputAssetId: null, outputText: null, error: null, resolvedAt: null })) }));
}

/** Undo a Reset: put the cleared runtime fields back from the server-side snapshot. Nodes added since stay clear. */
export function restoreResetSnapshot(id: string): Workflow | null {
  const snap = readResetSnapshot(id);
  if (!snap) return null;
  const byId = new Map(snap.nodes.map((n) => [n.id, n]));
  const next = mutateWorkflow(id, (x) => ({ ...x, runStartedAt: snap.runStartedAt, runScope: snap.runScope, nodes: x.nodes.map((n) => { const r = byId.get(n.id); return r ? { ...n, runId: r.runId, outputAssetId: r.outputAssetId, outputText: r.outputText, error: r.error, resolvedAt: r.resolvedAt } : n; }) }));
  clearResetSnapshot(id);
  return next;
}

function runStatusLookup(campaignId: string): (runId: string) => RunStatus | null {
  const runs = listRuns(campaignId);
  return (runId) => runs.find((r) => r.id === runId)?.status ?? null;
}

/** Local file path of a delivered campaign asset, or null when it is not on disk. */
function assetFile(campaign: Campaign, assetId: string): { abs: string; kind: 'video' | 'image' } | null {
  const a = campaign.assets.find((x) => x.id === assetId);
  if (!a?.path) return null;
  const rel = relFromPublic(a.path);
  const abs = path.join(assetRoot(), rel);
  return fs.existsSync(abs) ? { abs, kind: a.kind } : null;
}

type Inputs = { texts: Record<string, string[]>; files: Record<string, { abs: string; kind: 'image' | 'video' | 'audio' }[]> };

/** Gather resolved upstream outputs per input port. Throws when an upstream node has nothing yet. */
function gatherInputs(w: Workflow, campaign: Campaign, n: WorkflowNode): Inputs {
  const texts: Inputs['texts'] = {};
  const files: Inputs['files'] = {};
  for (const port of NODE_SPECS[n.type].inputs) {
    for (const up of upstream(w, n.id, port.name)) {
      if (port.type === 'text') {
        if (up.outputText === null) throw new Error(`${up.title} has no text yet`);
        (texts[port.name] ??= []).push(up.outputText);
      } else {
        if (up.type === 'media') {
          const p = String(up.settings.path ?? '');
          if (!fs.existsSync(p)) throw new Error(`${up.title}: file not found ${p}`);
          (files[port.name] ??= []).push({ abs: p, kind: up.settings.kind as 'image' | 'video' | 'audio' });
        } else {
          if (!up.outputAssetId) throw new Error(`${up.title} has no output yet`);
          const f = assetFile(campaign, up.outputAssetId);
          if (!f) throw new Error(`${up.title}: output file missing`);
          (files[port.name] ??= []).push({ abs: f.abs, kind: f.kind });
        }
      }
    }
  }
  return { texts, files };
}

function fileTypeFor(p: string): string {
  const ext = p.toLowerCase().split('.').pop() ?? '';
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mp3', wav: 'audio/wav', m4a: 'audio/m4a' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

async function uploadAll(client: ArcadsClient, list: { abs: string }[] | undefined): Promise<string[]> {
  return Promise.all((list ?? []).map((f) => client.upload(new Uint8Array(fs.readFileSync(f.abs)), fileTypeFor(f.abs))));
}

function b64(abs: string): string {
  return `data:${fileTypeFor(abs)};base64,${fs.readFileSync(abs).toString('base64')}`;
}

/** Resolve one local node now. */
async function resolveLocal(w: Workflow, campaign: Campaign, n: WorkflowNode): Promise<Partial<WorkflowNode>> {
  const s = NODE_SPECS[n.type].settings.parse(n.settings) as Record<string, unknown>;
  const now = new Date().toISOString();
  switch (n.type) {
    case 'text':
      return { outputText: String(s.text ?? ''), resolvedAt: now };
    case 'script': {
      const script = campaign.scripts.find((x) => x.id === s.scriptId);
      const v = script?.versions.find((x) => x.n === script.approvedVersion) ?? script?.versions.at(-1);
      if (!v) throw new Error('script not found or has no version');
      const beat = typeof s.beat === 'number' ? v.beats[s.beat] : null;
      return { outputText: beat ? beat.spoken : v.fullScript, resolvedAt: now };
    }
    case 'media':
      return { resolvedAt: now };
    case 'asset': {
      if (s.assetId) {
        if (!assetFile(campaign, String(s.assetId))) throw new Error('that asset is not on disk');
        return { outputAssetId: String(s.assetId), resolvedAt: now };
      }
      // an Arcads library asset: download it into the campaign first
      const client = isDry() ? null : createArcadsClient();
      if (!client) throw new Error('Arcads not configured');
      const url = await client.downloadUrl(String(s.arcadsAssetId));
      if (!url) throw new Error('no download link for that library asset');
      const { rehost } = await import('@/lib/creative-engine/assets');
      const assetId = `ast-${randomUUID().slice(0, 8)}`;
      const kind = s.kind as 'image' | 'video';
      const hosted = await rehost({ campaignId: campaign.id, assetId, sourceUrl: url, kind });
      mutateCampaign(campaign.id, (c) => ({ ...c, assets: [...c.assets, { id: assetId, generationId: 'library', kind, path: hosted.path, thumbnailPath: null, sourceUrl: url, model: 'library', creditsCharged: 0, durationSec: null, at: now }] }));
      return { outputAssetId: assetId, resolvedAt: now };
    }
    case 'llm': {
      const { texts } = gatherInputs(w, campaign, n);
      const input = (texts.text ?? []).join('\n\n');
      if (engineDry()) return { outputText: `${String(s.instruction)}\n\n${input}`.slice(0, 400), resolvedAt: now };
      const res = await claudeJson(`${String(s.instruction)}\n\nInput:\n"""\n${input}\n"""\n\nReply with STRICT JSON only: {"text":"..."}. No markdown.`, z.object({ text: z.string().min(1) }), { timeoutMs: 90_000 });
      if (!res.ok) throw new Error(res.unavailable ? 'Claude is not available on this host' : res.error);
      return { outputText: res.data.text, resolvedAt: now };
    }
    case 'enhance': {
      const { texts } = gatherInputs(w, campaign, n);
      return { outputText: (texts.text ?? []).join('\n'), resolvedAt: now }; // the consumer sends enhance:true (see submitArcadsNode)
    }
    case 'deliver': {
      gatherInputs(w, campaign, n); // throws when anything upstream is missing
      // the final outputs: every asset feeding this node, tagged on the campaign and recorded on the workflow (FR-64)
      const assetIds = [...new Set(w.edges.filter((e) => e.to === n.id).map((e) => w.nodes.find((x) => x.id === e.from)?.outputAssetId).filter((x): x is string => !!x))];
      if (assetIds.length) mutateCampaign(campaign.id, (c) => ({ ...c, assets: c.assets.map((a) => (assetIds.includes(a.id) ? { ...a, workflowId: w.id, final: true } : a)) }));
      mutateWorkflow(w.id, (x) => ({ ...x, deliveries: [...(x.deliveries ?? []), { runAt: x.runStartedAt ?? now, assetIds }].slice(-50) }));
      return { resolvedAt: now };
    }
    default:
      throw new Error(`${n.type} is not a local node`);
  }
}

/** Is any upstream of this node an Enhance node? Then the consumer asks Arcads to enhance. */
function enhanced(w: Workflow, n: WorkflowNode): boolean {
  return w.edges.some((e) => e.to === n.id && w.nodes.find((x) => x.id === e.from)?.type === 'enhance');
}

/** Submit one Arcads node and attach a Run + Generation so the poll clock delivers it onto the campaign. */
async function submitArcadsNode(w: Workflow, campaign: Campaign, n: WorkflowNode, client: ArcadsClient | null): Promise<Partial<WorkflowNode>> {
  const s = NODE_SPECS[n.type].settings.parse(n.settings) as Record<string, unknown>;
  const { texts, files } = gatherInputs(w, campaign, n);
  const prompt = (texts.prompt ?? texts.script ?? texts.text ?? []).join('\n');
  const productId = await resolveProductId(client, campaign, null);
  const run = startRun({ campaignId: campaign.id, kind: 'workflow', title: `${w.name} · ${n.title}`, dry: !client });
  const generation: Generation = { id: `gen-${randomUUID().slice(0, 8)}`, kind: 'workflow', scriptId: null, request: { workflowId: w.id, nodeId: n.id, type: n.type, settings: s, prompt }, runIds: [run.id], assetIds: [], at: new Date().toISOString() };
  mutateCampaign(campaign.id, (c) => ({ ...c, generations: [...c.generations, generation] }));
  const attach = (created: CreateResponse, model: string, pollPath: 'assets' | 'talking-actors' = 'assets') => {
    mutateRun(run.id, (r) => ({ ...r, arcads: { id: created.id, type: created.type, model, creditsCharged: created.creditsCharged, pollPath, lastPolledAt: null, lastStatus: created.status, lastRaw: created.raw, creditsBefore: before, sourceUrl: null, thumbnailUrl: null } }));
    if (created.creditsCharged !== null) appendLedger({ at: new Date().toISOString(), kind: 'workflow', model, durationSec: null, creditsCharged: created.creditsCharged, runId: run.id, dry: false, source: 'response' });
  };
  let before: number | null = null;
  try {
    if (!client) {
      mutateRun(run.id, (r) => ({ ...r, arcads: { id: `dry-wf-${run.id}`, type: n.type, model: String(s.model ?? n.type), creditsCharged: 0, pollPath: 'assets', lastPolledAt: null, lastStatus: 'pending', lastRaw: null, creditsBefore: null, sourceUrl: null, thumbnailUrl: null } }));
      appendLedger({ at: new Date().toISOString(), kind: 'workflow', model: String(s.model ?? n.type), durationSec: null, creditsCharged: 0, runId: run.id, dry: true, source: 'dry' });
      return { runId: run.id };
    }
    before = (await refreshCredits(client))?.creditsRemaining ?? null;
    switch (n.type) {
      case 'video': {
        const controls = ConsoleControlsSchema.parse({ ...s, dialogue: s.dialogue ?? '', enhance: !!s.enhance || enhanced(w, n) });
        const blocking = validateRequest(controls).filter((l) => l.level === 'error');
        if (blocking.length) throw new Error(blocking.map((l) => l.message).join('; '));
        const composed = prompt.trim() ? { prompt: prompt.trim() } : composePrompt(controls);
        const uploaded = { referenceImages: await uploadAll(client, files.images), referenceVideos: await uploadAll(client, files.videos), referenceAudios: await uploadAll(client, files.audio), startFrame: (await uploadAll(client, files.startFrame))[0] ?? null, endFrame: (await uploadAll(client, files.endFrame))[0] ?? null };
        attach(await client.generateVideo(buildVideoBody(controls, composed.prompt, productId, uploaded)), controls.model);
        break;
      }
      case 'image': {
        const body: Record<string, unknown> = { model: s.model, productId, prompt, aspectRatio: s.aspectRatio };
        const refs = await uploadAll(client, files.images);
        if (refs.length) body.referenceImages = refs;
        if (s.model === 'soul' && Number(s.nbGenerations) > 1) body.nbGenerations = s.nbGenerations;
        if (s.enhance || enhanced(w, n)) body.enhance = true;
        attach(await client.generateImage(body), String(s.model));
        break;
      }
      case 'talkingActor': {
        let voiceId = (s.voiceId as string | null) ?? undefined;
        if (!voiceId) voiceId = matchVoice(await readCatalog(), String(s.situationId))?.id;
        const { results, raw } = await client.generateTalkingActors({ productId, script: prompt, actors: [{ situationId: String(s.situationId), voiceId }], model: s.model as 'arcads_1.0' });
        if (!results[0]) throw new Error(`talking-actors reply had no id: ${raw.slice(0, 120)}`);
        attach({ id: results[0].id, status: results[0].status, type: 'talking-actor', creditsCharged: null, raw }, String(s.model), 'talking-actors');
        break;
      }
      case 'veo31': {
        const body: Record<string, unknown> = { productId, prompt, resolution: s.resolution, aspectRatio: s.aspectRatio };
        const start = (await uploadAll(client, files.startFrame))[0];
        if (start) { body.startFrame = start; const end = (await uploadAll(client, files.endFrame))[0]; if (end) body.endFrame = end; }
        else { const refs = await uploadAll(client, files.images); if (refs.length) body.referenceImages = refs; }
        attach(await client.generateVeo31(body), 'veo31');
        break;
      }
      case 'videoEdit': {
        const body: Record<string, unknown> = { productId, prompt };
        if (s.aspectRatio) body.aspectRatio = s.aspectRatio;
        if (s.duration) body.duration = s.duration;
        const vids = await uploadAll(client, files.videos); if (vids.length) body.referenceVideos = vids;
        const imgs = await uploadAll(client, files.images); if (imgs.length) body.referenceImages = imgs;
        const start = (await uploadAll(client, files.startFrame))[0]; if (start) body.startFrame = start;
        attach(await client.generateOmniFlash(body), 'omni-flash');
        break;
      }
      case 'broll': {
        const body: Record<string, unknown> = { productId, prompt, aspectRatio: s.aspectRatio, duration: s.duration };
        if (files.reference?.[0]) body.refImageAsBase64 = b64(files.reference[0].abs);
        if (files.startFrame?.[0]) body.startFrameAsBase64 = b64(files.startFrame[0].abs);
        if (files.endFrame?.[0]) body.endFrameAsBase64 = b64(files.endFrame[0].abs);
        attach(await client.generateBRoll(body), 'b-roll');
        break;
      }
      case 'scene': {
        const body: Record<string, unknown> = { productId, prompt, aspectRatio: s.aspectRatio };
        const script = (texts.script ?? []).join('\n'); if (script) body.script = script;
        if (s.contextPrompt) body.contextPrompt = s.contextPrompt;
        if (s.contextScript) body.contextScript = s.contextScript;
        if (files.reference?.[0]) body.refImageAsBase64 = b64(files.reference[0].abs);
        if (files.startFrame?.[0]) body.startFrameAsBase64 = b64(files.startFrame[0].abs);
        attach(await client.generateScene(body), 'scene');
        break;
      }
      case 'music': {
        const body: Record<string, unknown> = { productId, prompt, model: s.model, duration: s.duration, instrumentalOnly: s.instrumentalOnly };
        if (s.model === 'suno_v6' && s.lyrics && !s.instrumentalOnly) body.lyrics = s.lyrics;
        attach(await client.generateMusic(body), String(s.model));
        break;
      }
      case 'audioDriven':
      case 'omnihuman': {
        let voiceId = (s.voiceId as string | null) ?? undefined;
        if (!voiceId) voiceId = matchVoice(await readCatalog(), String(s.situationId))?.id;
        const body = { productId, text: prompt, videos: [{ situationId: String(s.situationId), voiceId }] };
        attach(n.type === 'audioDriven' ? await client.generateAudioDriven(body) : await client.generateOmnihuman(body), n.type);
        break;
      }
      case 'preset': {
        const pt = String(s.presetType);
        const body: Record<string, unknown> = { productId, situationId: s.situationId };
        if (pt === 'gameplay-ad') { body.referenceVideos = await uploadAll(client, files.videos); if (prompt) body.prompt = prompt; }
        else { body.referenceImages = await uploadAll(client, files.images); if (pt === 'camera-movement' || pt === 'gestures') body.aspectRatio = s.aspectRatio; if (pt === 'camera-movement') body.strength = s.strength; }
        attach(await client.generatePreset(pt, body), pt);
        break;
      }
      default:
        throw new Error(`${n.type} cannot be submitted`);
    }
    return { runId: run.id };
  } catch (err) {
    const msg = explainArcadsError(err).message;
    failRun(run.id, msg);
    return { runId: run.id, error: msg };
  }
}

/** One pass: resolve or submit every node whose inputs are done. Returns the workflow after the pass. */
export async function advanceWorkflow(id: string, override = false, clientOverride?: ArcadsClient | null): Promise<Workflow> {
  let w = readWorkflow(id);
  if (!w || !w.runStartedAt) return w!;
  const campaign = readCampaign(w.campaignId);
  if (!campaign) return w;
  const order = topoOrder(w);
  if (!order) return w;
  const client = clientOverride === undefined ? (isDry() ? null : createArcadsClient()) : clientOverride;
  const dry = engineDry();
  const scope = w.runScope ? new Set(w.runScope) : null;
  const status = runStatusLookup(w.campaignId);
  for (const node of order) {
    w = readWorkflow(id)!;
    const n = w.nodes.find((x) => x.id === node.id)!;
    if (scope && !scope.has(n.id)) continue; // outside a scoped run: keeps what it had, never re-submitted
    const st = nodeStatus(w, n, status);
    if (st !== 'ready') continue;
    const fresh = readCampaign(w.campaignId)!;
    let patch: Partial<WorkflowNode>;
    try {
      if (NODE_SPECS[n.type].local) patch = await resolveLocal(w, fresh, n);
      else {
        if (!client && !dry) { patch = { error: 'Arcads not configured' }; }
        else { if (client) enforceCap(override); patch = await submitArcadsNode(w, fresh, n, client); }
      }
    } catch (err) {
      patch = { error: err instanceof Error ? err.message : String(err) };
    }
    mutateWorkflow(id, (x) => ({ ...x, nodes: x.nodes.map((m) => (m.id === n.id ? { ...m, ...patch } : m)) }));
  }
  return readWorkflow(id)!;
}

/** After the poll clock delivers runs, copy asset ids onto nodes and advance every live workflow. */
export async function syncWorkflows(clientOverride?: ArcadsClient | null): Promise<number> {
  let touched = 0;
  for (const w of readWorkflows()) {
    if (!w.runStartedAt) continue;
    const campaign = readCampaign(w.campaignId);
    if (!campaign) continue;
    const runs = listRuns(w.campaignId);
    let changed = false;
    const nodes = w.nodes.map((n) => {
      if (!n.runId || n.outputAssetId || n.error) return n;
      const r = runs.find((x) => x.id === n.runId);
      if (!r) return n;
      if (r.status === 'delivered') {
        const gen = campaign.generations.find((g) => g.runIds.includes(n.runId!));
        const assetId = gen?.assetIds.at(-1) ?? campaign.assets.find((a) => a.generationId === gen?.id)?.id ?? null;
        if (assetId) { changed = true; return { ...n, outputAssetId: assetId, resolvedAt: new Date().toISOString() }; }
      }
      if (r.status === 'failed' || r.status === 'stale' || r.status === 'abandoned') { changed = true; return { ...n, error: r.error ?? r.status }; }
      return n;
    });
    if (changed) mutateWorkflow(w.id, (x) => ({ ...x, nodes }));
    const anyReady = (() => { const fresh = readWorkflow(w.id)!; const st = runStatusLookup(w.campaignId); return fresh.nodes.some((n) => nodeStatus(fresh, n, st) === 'ready'); })();
    if (anyReady) { await advanceWorkflow(w.id, false, clientOverride); touched += 1; }
  }
  return touched;
}
