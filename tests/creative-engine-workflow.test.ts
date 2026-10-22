import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCampaign, mutateCampaign, readCampaign, readWorkflow, createWorkflow, readLedger } from '@/lib/creative-engine/store';
import { NODE_SPECS, PALETTE, TEMPLATES, blockingProblems, canConnect, newEdge, newNode, nodeStatus, topoOrder, validateGraph } from '@/lib/creative-engine/workflow';
import { advanceWorkflow, startWorkflow, syncWorkflows, WorkflowError } from '@/lib/creative-engine/workflow-run';
import { advanceArcadsRuns } from '@/lib/creative-engine/generate';
import { listRuns } from '@/lib/creative-engine/runs';
import { ArcadsClient } from '@/lib/arcads/client';
import { NODE_TYPES } from '@/lib/creative-engine/schemas';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-engine-wf-'));
  process.env.CREATIVE_ENGINE_STORE_DIR = dir;
  process.env.CREATIVE_ENGINE_ASSET_DIR = path.join(dir, 'assets');
  process.env.CREATIVE_ENGINE_DRY = '1';
});
afterEach(() => {
  delete process.env.CREATIVE_ENGINE_STORE_DIR;
  delete process.env.CREATIVE_ENGINE_ASSET_DIR;
  delete process.env.CREATIVE_ENGINE_DRY;
  fs.rmSync(dir, { recursive: true, force: true });
});

const campaignWithScript = () => {
  const c = createCampaign({ text: 'workflow test', product: '', audience: '', goal: 'unset' });
  return mutateCampaign(c.id, (x) => ({ ...x, scripts: [{ id: 'scr-1', angleId: 'a1', framework: 'hook-show-demo-result-verdict', controls: { targetSeconds: 8, tone: 'best-friend', intro: 'show', cta: 'Link', noStageDirections: true }, versions: [{ n: 1, by: 'dry', fullScript: 'Hook line. Show line. Demo line.', hook: 'Hook line.', wordCount: 6, fits: true, targetSeconds: 8, beats: [{ name: 'Hook', spoken: 'Hook line.', action: '', seconds: 2 }, { name: 'Show', spoken: 'Show line.', action: '', seconds: 3 }], cta: 'Link', notes: '', instruction: null, at: new Date().toISOString() }], approvedVersion: 1, createdAt: new Date().toISOString() }] }))!;
};

describe('node registry', () => {
  test('every node type has a spec, a palette slot and parseable defaults', () => {
    for (const t of NODE_TYPES) {
      expect(NODE_SPECS[t]).toBeTruthy();
      expect(() => NODE_SPECS[t].settings.parse({})).not.toThrow();
    }
    // every type but the not-addable "missing" placeholder has a palette slot
    expect(new Set(PALETTE.flatMap((p) => p.types)).size).toBe(NODE_TYPES.length - 1);
    expect(PALETTE.some((p) => p.types.includes('missing'))).toBe(false);
  });
  test('connections are typed, single-input ports take one edge, loops are refused', () => {
    const t = newNode('text', 0, 0, { text: 'hi' }); const v = newNode('video', 0, 0); const i = newNode('image', 0, 0); const d = newNode('deliver', 0, 0);
    const w = { id: 'w', campaignId: 'c', name: 'n', nodes: [t, v, i, d], edges: [] as ReturnType<typeof newEdge>[], runStartedAt: null, createdAt: '', updatedAt: '' };
    expect(canConnect(w, t, 'text', v, 'prompt')).toBeNull();
    expect(canConnect(w, t, 'text', v, 'images')).toMatch(/text cannot feed image/);
    expect(canConnect(w, v, 'video', v, 'videos')).toMatch(/itself/);
    w.edges.push(newEdge(t.id, 'text', v.id, 'prompt'));
    expect(canConnect(w, i, 'image', v, 'startFrame')).toBeNull();
    w.edges.push(newEdge(i.id, 'image', v.id, 'startFrame'));
    expect(canConnect(w, i, 'image', v, 'startFrame')).toMatch(/already has an input/);
    w.edges.push(newEdge(v.id, 'video', d.id, 'video'));
    expect(topoOrder(w)!.map((n) => n.id).indexOf(d.id)).toBe(3);
    // image ← video would loop through nothing yet; make a real loop: video.video → videoEdit → image? use videos port of the same chain
    const e = newNode('videoEdit', 0, 0);
    w.nodes.push(e); w.edges.push(newEdge(v.id, 'video', e.id, 'videos'));
    expect(canConnect(w, e, 'video', v, 'videos')).toMatch(/loop/);
  });
  test('validateGraph names the exact gap', () => {
    const v = newNode('video', 0, 0); const w = { id: 'w', campaignId: 'c', name: 'n', nodes: [v], edges: [], runStartedAt: null, createdAt: '', updatedAt: '' };
    expect(blockingProblems(validateGraph(w))).toEqual([]); // a video node alone is legal: the prompt composes from its controls
    const ta = newNode('talkingActor', 0, 0);
    const w2 = { ...w, nodes: [ta] };
    expect(validateGraph(w2).map((p) => p.message)).toEqual(expect.arrayContaining([expect.stringMatching(/needs script/), expect.stringMatching(/needs a scene/)]));
    expect(validateGraph({ ...w, nodes: [] })[0].message).toBe('Create a node first');
  });
  test('templates build legal graphs for a campaign with an approved script', () => {
    for (const t of TEMPLATES) {
      const g = t.build({ scriptId: 'scr-1', beats: [{ name: 'Hook', spoken: 'x', seconds: 2 }, { name: 'Show', spoken: 'y', seconds: 3 }] });
      const w = { id: 'w', campaignId: 'c', name: t.name, ...g, runStartedAt: null, createdAt: '', updatedAt: '' };
      const problems = validateGraph(w).filter((p) => !/needs a scene/.test(p.message)); // actor scenes are picked in the UI
      expect(problems, t.id).toEqual([]);
      expect(topoOrder(w)).not.toBeNull();
    }
  });
});

describe('engine, dry', () => {
  test('local nodes resolve, Arcads nodes become runs, the poll delivers them, deliver completes', async () => {
    const c = campaignWithScript();
    const s = newNode('script', 0, 0, { scriptId: 'scr-1', beat: 1 }); const v = newNode('video', 0, 0, { model: 'seedance-2.0', duration: 6 }); const d = newNode('deliver', 0, 0);
    const w = createWorkflow({ campaignId: c.id, name: 'dry chain', nodes: [s, v, d], edges: [newEdge(s.id, 'text', v.id, 'prompt'), newEdge(v.id, 'video', d.id, 'video')] });
    const started = await startWorkflow(w.id);
    const st = (id: string) => listRuns(c.id).find((r) => r.id === id)?.status ?? null;
    const byId = (x: typeof started, id: string) => x.nodes.find((n) => n.id === id)!;
    expect(byId(started, s.id).outputText).toBe('Show line.');
    expect(byId(started, v.id).runId).toBeTruthy();
    expect(nodeStatus(started, byId(started, v.id), st)).toBe('running');
    expect(nodeStatus(started, byId(started, d.id), st)).toBe('waiting');
    // the dry poll delivers on the third pass
    for (let i = 0; i < 4; i += 1) { await advanceArcadsRuns(0); await syncWorkflows(); }
    const done = readWorkflow(w.id)!;
    expect(byId(done, v.id).outputAssetId).toBeTruthy();
    expect(readCampaign(c.id)!.assets.some((a) => a.id === byId(done, v.id).outputAssetId)).toBe(true);
    expect(nodeStatus(done, byId(done, d.id), st)).toBe('done');
    expect(readLedger().filter((e) => e.kind === 'workflow')).toHaveLength(1);
  });
  test('a graph with a problem refuses to start and charges nothing', async () => {
    const c = campaignWithScript();
    const w = createWorkflow({ campaignId: c.id, name: 'bad', nodes: [newNode('talkingActor', 0, 0)], edges: [] });
    await expect(startWorkflow(w.id)).rejects.toBeInstanceOf(WorkflowError);
    expect(listRuns(c.id)).toHaveLength(0);
  });
  test('a text node feeding an image node sends the text as the prompt (live-shaped fixture, not dry)', async () => {
    delete process.env.CREATIVE_ENGINE_DRY;
    const c = campaignWithScript();
    const t = newNode('text', 0, 0, { text: 'a kettle on a counter' }); const i = newNode('image', 0, 0, { model: 'nano-banana-2', aspectRatio: '1:1' });
    const w = createWorkflow({ campaignId: c.id, name: 'img', nodes: [t, i], edges: [newEdge(t.id, 'text', i.id, 'prompt')] });
    const log: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); log.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/v1/credits')) return new Response(JSON.stringify({ creditsIncluded: 100, creditsRemaining: 50, additionalCreditsUsed: 0 }), { status: 200 });
      if (url.includes('/v1/products')) return new Response(JSON.stringify({ items: [{ id: 'p1', name: 'P' }] }), { status: 200 });
      if (url.includes('/v2/images/generate')) return new Response(JSON.stringify({ id: 'img-1', type: 'nano-banana-2', status: 'pending', data: { creditsCharged: 0.03 } }), { status: 201 });
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    const client = new ArcadsClient('Basic x', fetchImpl, 'https://api.test');
    const { mutateWorkflow } = await import('@/lib/creative-engine/store');
    mutateWorkflow(w.id, (x) => ({ ...x, runStartedAt: new Date().toISOString() }));
    const after = await advanceWorkflow(w.id, false, client);
    const img = after.nodes.find((n) => n.id === i.id)!;
    expect(img.runId).toBeTruthy();
    expect(img.error).toBeNull();
    const create = log.find((l) => l.url.includes('/v2/images/generate'))!;
    expect(create.body).toMatchObject({ model: 'nano-banana-2', prompt: 'a kettle on a counter', aspectRatio: '1:1', productId: 'p1' });
    expect(readLedger()[0]).toMatchObject({ kind: 'workflow', creditsCharged: 0.03, source: 'response' });
  });
});
