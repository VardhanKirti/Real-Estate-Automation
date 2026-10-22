import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCampaign, createWorkflow, mutateCampaign, mutateWorkflow, pruneWorkflowVersions, readCampaign, readWorkflow, readWorkflowVersions, readWorkflows, writeWorkflowVersion, type WorkflowVersion } from '@/lib/creative-engine/store';
import { MAX_PAID_NODES, TEMPLATES, blockingProblems, newEdge, newNode, nodeStatus, templateSummary, validateGraph } from '@/lib/creative-engine/workflow';
import { copyNodes, duplicateNodes, moveNodes, nodesInRect, nodesInScope, paidCount, parseClip, pasteNodes, tidy } from '@/lib/creative-engine/workflow-edit';
import { planWorkflow, resetWorkflow, restoreResetSnapshot, startWorkflow, stopWorkflow, WorkflowError } from '@/lib/creative-engine/workflow-run';
import { listRuns } from '@/lib/creative-engine/runs';
import { ArcadsClient } from '@/lib/arcads/client';
import type { Workflow } from '@/lib/creative-engine/schemas';

/**
 * S05b steps 6 to 9: selection edits, validation levels, run scopes, the
 * run plan the gate shows, stop, reset undo, versions and Deliver. Paid
 * counts are checked against a counting fake Arcads client; nothing real
 * is ever called.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-engine-wfrun-'));
  process.env.CREATIVE_ENGINE_STORE_DIR = dir;
  process.env.CREATIVE_ENGINE_ASSET_DIR = path.join(dir, 'assets');
  delete process.env.CREATIVE_ENGINE_DRY;
});
afterEach(() => {
  delete process.env.CREATIVE_ENGINE_STORE_DIR;
  delete process.env.CREATIVE_ENGINE_ASSET_DIR;
  delete process.env.CREATIVE_ENGINE_DRY;
  fs.rmSync(dir, { recursive: true, force: true });
});

const graph = (nodes: Workflow['nodes'], edges: Workflow['edges']): Workflow => ({ id: 'w', campaignId: 'c', name: 'g', nodes, edges, runStartedAt: null, createdAt: '', updatedAt: '' });

/** A fake Arcads client that answers everything and counts generate requests. */
function countingClient() {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/generate')) { calls.push(url); return new Response(JSON.stringify({ id: `a-${calls.length}`, type: 'nano-banana-2', status: 'pending', data: { creditsCharged: 0.03 } }), { status: 201 }); }
    if (url.includes('/v1/credits')) return new Response(JSON.stringify({ creditsIncluded: 100, creditsRemaining: 50, additionalCreditsUsed: 0 }), { status: 200 });
    if (url.includes('/v1/products')) return new Response(JSON.stringify({ items: [{ id: 'p1', name: 'P' }] }), { status: 200 });
    if (url.includes('presigned')) return new Response(JSON.stringify({ presignedUrl: 'https://up.test/put', filePath: 'f/1.png' }), { status: 200 });
    if (init?.method === 'PUT') return new Response('', { status: 200 });
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { client: new ArcadsClient('Basic x', fetchImpl, 'https://api.test'), calls };
}

/** text → image A ; text → image B ; A and B → Deliver */
function twoImages() {
  const c = createCampaign({ text: 'lamp', product: '', audience: '', goal: 'unset' });
  const t1 = newNode('text', 0, 0, { text: 'a desk lamp, morning' }); const t2 = newNode('text', 0, 200, { text: 'a desk lamp, night' });
  const a = newNode('image', 300, 0, { model: 'nano-banana-2', aspectRatio: '1:1' }); const b = newNode('image', 300, 200, { model: 'nano-banana-2', aspectRatio: '1:1' });
  const d = newNode('deliver', 600, 100);
  const w = createWorkflow({ campaignId: c.id, name: 'two', nodes: [t1, t2, a, b, d], edges: [newEdge(t1.id, 'text', a.id, 'prompt'), newEdge(t2.id, 'text', b.id, 'prompt'), newEdge(a.id, 'image', d.id, 'image'), newEdge(b.id, 'image', d.id, 'image')] });
  return { c, w, t1, t2, a, b, d };
}

/** Put a real file on disk and a campaign asset pointing at it. */
function fileAsset(campaignId: string, id: string) {
  const rel = `${campaignId}/${id}.png`;
  fs.mkdirSync(path.join(dir, 'assets', campaignId), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', rel), 'png');
  mutateCampaign(campaignId, (c) => ({ ...c, assets: [...c.assets, { id, generationId: 'g', kind: 'image', path: `/content-media/creative-engine/${rel}`, thumbnailPath: null, sourceUrl: null, model: 'nano-banana-2', creditsCharged: 0.03, durationSec: null, at: new Date().toISOString() }] }));
}

describe('validation levels (FR-68)', () => {
  test('only errors block; warnings mark nodes; info has no node', () => {
    const t = newNode('text', 0, 0, { text: 'x' }); const v = newNode('video', 300, 0); const loose = newNode('text', 0, 300, { text: 'y' });
    const p = validateGraph(graph([t, v, loose], [newEdge(t.id, 'text', v.id, 'prompt')]));
    expect(blockingProblems(p)).toEqual([]);
    expect(p.find((x) => x.nodeId === loose.id)).toMatchObject({ level: 'warn', message: expect.stringMatching(/isn't linked/) });
    expect(p.find((x) => x.nodeId === null)).toMatchObject({ level: 'info', message: expect.stringMatching(/No Deliver/) });
  });
  test('dangling node, empty Deliver, duplicate edge, loop and the 40 paid cap', () => {
    const t = newNode('text', 0, 0, { text: 'x' }); const v = newNode('video', 300, 0); const v2 = newNode('video', 300, 300); const d = newNode('deliver', 600, 0);
    const e = newEdge(t.id, 'text', v.id, 'prompt');
    const p = validateGraph(graph([t, v, v2, d], [e, { ...e, id: 'dup' }, newEdge(v.id, 'video', d.id, 'video')]));
    expect(p.find((x) => x.nodeId === v2.id)).toMatchObject({ level: 'warn', message: expect.stringMatching(/isn't connected to Deliver/) });
    expect(p.find((x) => /twice/.test(x.message))).toMatchObject({ level: 'error', nodeId: v.id });
    expect(validateGraph(graph([d], [])).find((x) => x.nodeId === d.id)?.message).toMatch(/nothing to collect/);
    const many = Array.from({ length: MAX_PAID_NODES + 1 }, (_, i) => newNode('video', 0, i * 10));
    expect(blockingProblems(validateGraph(graph(many, []))).some((x) => /capped at 40/.test(x.message))).toBe(true);
    const a = newNode('llm', 0, 0); const b = newNode('llm', 300, 0);
    expect(validateGraph(graph([a, b], [newEdge(a.id, 'text', b.id, 'text'), newEdge(b.id, 'text', a.id, 'text')])).find((x) => /loop/.test(x.message))?.level).toBe('error');
  });
  test('every template has no blocking problem with an approved script (actor scenes aside), and the start card counts its paid requests', () => {
    const ctx = { scriptId: 's', beats: [{ name: 'Hook', spoken: 'x', seconds: 2 }, { name: 'Show', spoken: 'y', seconds: 3 }] };
    for (const t of TEMPLATES) {
      const g = t.build(ctx);
      expect(blockingProblems(validateGraph(graph(g.nodes, g.edges))).filter((p) => !/needs a scene/.test(p.message)), t.id).toEqual([]);
    }
    const s = TEMPLATES.map((t) => templateSummary(t, ctx));
    expect(s.map((x) => x.paidRequests)).toEqual([1, 2, 2, 2]);
    expect(s[1].preview.nodes).toHaveLength(5);
    expect(s[1].preview.edges).toHaveLength(4);
    expect(templateSummary(TEMPLATES[3], { scriptId: null, beats: [] }).needsScript).toBe(true);
  });
});

describe('selection edits (FR-21 to FR-26)', () => {
  const base = () => {
    const t = newNode('text', 10, 10, { text: 'x' }); const v = { ...newNode('video', 300, 10), runId: 'run-1', outputAssetId: 'ast-1', error: 'old', resolvedAt: 'now' };
    return graph([t, v], [newEdge(t.id, 'text', v.id, 'prompt')]);
  };
  test('copy then paste gives new ids, remaps the internal link and clears runtime fields (AC5b.15)', () => {
    const w = base();
    const clip = copyNodes(w, w.nodes.map((n) => n.id));
    expect(parseClip(JSON.stringify(clip))).toEqual(clip);
    expect(parseClip('{"kind":"other"}')).toBeNull();
    const { workflow, ids } = pasteNodes(w, clip, { x: 500, y: 500 });
    expect(ids).toHaveLength(2);
    expect(workflow.nodes).toHaveLength(4);
    const pasted = workflow.nodes.filter((n) => ids.includes(n.id));
    expect(pasted.every((n) => !w.nodes.some((o) => o.id === n.id))).toBe(true);
    expect(pasted.every((n) => n.runId === null && n.outputAssetId === null && n.error === null && n.resolvedAt === null)).toBe(true);
    expect(Math.min(...pasted.map((n) => n.x))).toBe(500);
    const link = workflow.edges.find((e) => ids.includes(e.from));
    expect(link && ids.includes(link.to)).toBe(true);
  });
  test('duplicate offsets by 40, paste clears a script id this campaign lacks', () => {
    const w = base();
    const d = duplicateNodes(w, [w.nodes[0].id]);
    expect(d.workflow.nodes.at(-1)).toMatchObject({ x: 50, y: 50, type: 'text' });
    const s = graph([newNode('script', 0, 0, { scriptId: 'scr-elsewhere' })], []);
    const p = pasteNodes(graph([], []), copyNodes(s, [s.nodes[0].id]), null, new Set(['scr-here']));
    expect(p.workflow.nodes[0].settings.scriptId).toBeNull();
  });
  test('move, marquee and tidy', () => {
    const w = base();
    expect(moveNodes(w, [w.nodes[0].id], 11, -11).nodes[0]).toMatchObject({ x: 21, y: -1 });
    expect(nodesInRect([{ id: 'a', x: 0, y: 0, w: 100, h: 50 }, { id: 'b', x: 400, y: 0, w: 100, h: 50 }], { x1: 120, y1: 60, x2: -10, y2: 10 })).toEqual(['a']);
    const loose = newNode('text', 900, 900, { text: 'z' });
    const t = tidy({ ...w, nodes: [...w.nodes, loose] }, { [w.nodes[0].id]: 100 });
    expect(t.nodes.map((n) => [n.x, n.y])).toEqual([[40, 40], [340, 40], [40, 172]]);
    expect(tidy(t, { [w.nodes[0].id]: 100 })).toEqual(t);
  });
});

describe('run scope and the gate plan (FR-58, FR-60): the count the gate shows is what the engine submits', () => {
  test('scope all: plan says 2 paid, the counting client sees 2 generate calls (AC5b.18)', async () => {
    const { w } = twoImages();
    const plan = planWorkflow(w.id, 'all')!;
    expect(plan.dry).toBe(false);
    expect(plan.paid.map((p) => p.type)).toEqual(['image', 'image']);
    expect(plan.local).toHaveLength(3);
    const { client, calls } = countingClient();
    await startWorkflow(w.id, { scope: 'all', client });
    expect(calls).toHaveLength(plan.paid.length);
  });
  test('scope failed: only the failed node is re-submitted, the delivered one keeps its asset (AC5b.18, AC5b.19)', async () => {
    const { c, w, a, b } = twoImages();
    fileAsset(c.id, 'ast-a');
    mutateWorkflow(w.id, (x) => ({ ...x, runStartedAt: new Date().toISOString(), nodes: x.nodes.map((n) => (n.id === a.id ? { ...n, runId: 'run-a', outputAssetId: 'ast-a', resolvedAt: new Date().toISOString() } : n.id === b.id ? { ...n, runId: 'run-b', error: 'content check' } : n.type === 'text' ? { ...n, outputText: String(n.settings.text), resolvedAt: new Date().toISOString() } : n)) }));
    const plan = planWorkflow(w.id, 'failed')!;
    expect(plan.paid.map((p) => p.nodeId)).toEqual([b.id]);
    expect(paidCount(readWorkflow(w.id)!, 'failed')).toBe(1);
    const { client, calls } = countingClient();
    const after = await startWorkflow(w.id, { scope: 'failed', client });
    expect(calls).toHaveLength(1);
    expect(after.nodes.find((n) => n.id === a.id)).toMatchObject({ outputAssetId: 'ast-a', runId: 'run-a' });
    expect(after.nodes.find((n) => n.id === b.id)!.error).toBeNull();
    const st = (id: string) => listRuns(c.id).find((r) => r.id === id)?.status ?? null;
    expect(nodeStatus(after, after.nodes.find((n) => n.id === a.id)!, st)).toBe('done');
  });
  test('scope from: the node and everything below it', async () => {
    const { w, a, d } = twoImages();
    expect(nodesInScope(readWorkflow(w.id)!, 'from', a.id).map((n) => n.id).sort()).toEqual([a.id, d.id].sort());
    // the text above A has no output yet: the run says so instead of charging
    expect(planWorkflow(w.id, 'from', a.id)!.blocked).toMatch(/has no output yet/);
    await expect(startWorkflow(w.id, { scope: 'from', nodeId: a.id, client: countingClient().client })).rejects.toBeInstanceOf(WorkflowError);
  });
  test('filming forces dry for the workflow engine (Q-ENG-7)', () => {
    process.env.CREATIVE_ENGINE_DRY = '1';
    const { w } = twoImages();
    expect(planWorkflow(w.id, 'all')!.dry).toBe(true);
  });
});

describe('conflict stamp and history labels (FR-20, FR-28)', () => {
  test('an engine write during a run never looks like another tab; a design change elsewhere does', async () => {
    const { w } = twoImages();
    const route = await import('@/app/api/creative-engine/workflows/[id]/route');
    const patch = (body: unknown) => route.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: { id: w.id } });
    const base = readWorkflow(w.id)!.layoutAt!;
    expect(base).toBeTruthy();
    mutateWorkflow(w.id, (x) => ({ ...x, runStartedAt: new Date().toISOString() })); // the engine
    const { toLayout } = await import('@/lib/creative-engine/workflow-edit');
    const ok = await patch({ layout: toLayout(readWorkflow(w.id)!), baseUpdatedAt: base });
    expect(ok.status).toBe(200);
    const stamp = (await ok.json()).workflow.layoutAt;
    expect(stamp).not.toBe(base);
    await patch({ name: 'other tab' });
    expect((await patch({ layout: toLayout(readWorkflow(w.id)!), baseUpdatedAt: stamp })).status).toBe(409);
  });
  test('History names the step Undo and Redo would take', async () => {
    const { History } = await import('@/lib/creative-engine/workflow-edit');
    const h = new History<number>();
    expect(h.undoLabel).toBeNull();
    h.push(1, undefined, 0, 'add node'); h.push(2, undefined, 10, 'remove link');
    expect(h.undoLabel).toBe('remove link');
    h.undo(3);
    expect(h.undoLabel).toBe('add node');
    expect(h.redoLabel).toBe('remove link');
  });
});

describe('stop, reset undo, versions, Deliver', () => {
  test('stop abandons the in-flight run and marks pending nodes stopped (AC5b.20)', async () => {
    const { c, w, a, b, d } = twoImages();
    const { client } = countingClient();
    await startWorkflow(w.id, { client });
    const stopped = stopWorkflow(w.id)!;
    const runA = stopped.nodes.find((n) => n.id === a.id)!.runId!;
    expect(listRuns(c.id).find((r) => r.id === runA)?.status).toBe('abandoned');
    for (const id of [a.id, b.id, d.id]) expect(stopped.nodes.find((n) => n.id === id)!.error).toBe('stopped');
    expect(stopped.nodes.filter((n) => n.type === 'text').every((n) => n.error === null)).toBe(true);
  });
  test('reset keeps a snapshot; restoring it puts the run results back once', async () => {
    const { w } = twoImages();
    await startWorkflow(w.id, { client: countingClient().client });
    const ran = readWorkflow(w.id)!;
    resetWorkflow(w.id);
    expect(readWorkflow(w.id)!.nodes.every((n) => n.runId === null)).toBe(true);
    const back = restoreResetSnapshot(w.id)!;
    expect(back.nodes.map((n) => n.runId)).toEqual(ran.nodes.map((n) => n.runId));
    expect(back.runStartedAt).toBe(ran.runStartedAt);
    expect(restoreResetSnapshot(w.id)).toBeNull();
  });
  test('a run snapshots a version; the sidecar is not a workflow; prune keeps run versions longest', async () => {
    const { w } = twoImages();
    await startWorkflow(w.id, { client: countingClient().client });
    const v = readWorkflowVersions(w.id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ n: 1, reason: 'run', name: 'two' });
    expect(Object.keys(v[0].nodes[0]).sort()).toEqual(['id', 'settings', 'title', 'type', 'x', 'y']);
    expect(readWorkflows().map((x) => x.id)).toEqual([w.id]);
    writeWorkflowVersion(readWorkflow(w.id)!, { note: 'mine' });
    expect(readWorkflowVersions(w.id).map((x) => x.n)).toEqual([2, 1]);
    const list: WorkflowVersion[] = Array.from({ length: 35 }, (_, i) => ({ n: i + 1, at: '', note: '', reason: i === 0 ? 'run' : 'save', name: 'x', nodes: [], edges: [] }));
    const kept = pruneWorkflowVersions(list, 30);
    expect(kept).toHaveLength(30);
    expect(kept.some((x) => x.n === 1)).toBe(true);
    expect(kept.some((x) => x.n === 2)).toBe(false);
  });
  test('versions API: GET 404s for an unknown workflow, POST saves, restore brings the old design back without touching runtime', async () => {
    const { w, a } = twoImages();
    const versions = await import('@/app/api/creative-engine/workflows/[id]/versions/route');
    const restore = await import('@/app/api/creative-engine/workflows/[id]/versions/[n]/restore/route');
    expect((await versions.GET(new Request('http://x'), { params: { id: 'nope' } })).status).toBe(404);
    expect((await versions.POST(new Request('http://x', { method: 'POST', body: '{}' }), { params: { id: w.id } })).status).toBe(200);
    mutateWorkflow(w.id, (x) => ({ ...x, name: 'renamed', nodes: x.nodes.map((n) => (n.id === a.id ? { ...n, x: 999, runId: 'keep-me' } : n)) }));
    const res = await restore.POST(new Request('http://x', { method: 'POST' }), { params: { id: w.id, n: '1' } });
    expect(res.status).toBe(200);
    const after = readWorkflow(w.id)!;
    expect(after.name).toBe('two');
    expect(after.nodes.find((n) => n.id === a.id)).toMatchObject({ x: 300, runId: 'keep-me' });
    expect(readWorkflowVersions(w.id)[0]).toMatchObject({ reason: 'restore' });
  });
  test('Deliver writes deliveries and tags its assets final (AC5b.24)', async () => {
    process.env.CREATIVE_ENGINE_DRY = '1';
    const { c, w, a, b, d } = twoImages();
    fileAsset(c.id, 'ast-a'); fileAsset(c.id, 'ast-b');
    const now = new Date().toISOString();
    mutateWorkflow(w.id, (x) => ({ ...x, runStartedAt: now, nodes: x.nodes.map((n) => (n.id === a.id ? { ...n, outputAssetId: 'ast-a', resolvedAt: now } : n.id === b.id ? { ...n, outputAssetId: 'ast-b', resolvedAt: now } : n.type === 'text' ? { ...n, outputText: 'x', resolvedAt: now } : n)) }));
    const { advanceWorkflow } = await import('@/lib/creative-engine/workflow-run');
    const done = await advanceWorkflow(w.id);
    expect(done.nodes.find((n) => n.id === d.id)!.resolvedAt).toBeTruthy();
    expect(done.deliveries).toEqual([{ runAt: now, assetIds: ['ast-a', 'ast-b'] }]);
    expect(readCampaign(c.id)!.assets.filter((x) => x.final).map((x) => [x.id, x.workflowId])).toEqual([['ast-a', w.id], ['ast-b', w.id]]);
  });
});
