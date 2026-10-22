import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCampaign, createWorkflow, mutateWorkflow, readWorkflow, WorkflowConflictError } from '@/lib/creative-engine/store';
import { newEdge, newNode } from '@/lib/creative-engine/workflow';
import { LayoutError, layoutDiff, mergeLayout, toLayout } from '@/lib/creative-engine/workflow-edit';
import { advanceWorkflow, syncWorkflows } from '@/lib/creative-engine/workflow-run';
import { ArcadsClient } from '@/lib/arcads/client';
import { DELETE, PATCH } from '@/app/api/creative-engine/workflows/[id]/route';
import type { Workflow, WorkflowNode } from '@/lib/creative-engine/schemas';

/**
 * S05b R10 / AC5b.16: a client save can never change runtime fields, and a
 * stale autosave during a run never makes the engine submit a paid node a
 * second time. No real Arcads request is ever made: the "live" client below
 * is a fake that counts submissions.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-engine-wf-edit-'));
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

const OLD = '2000-01-01T00:00:00.000Z'; // a copy read before the run wrote anything
const RUNTIME = ['runId', 'outputAssetId', 'outputText', 'error', 'resolvedAt'] as const;
const runtimeOf = (n: WorkflowNode) => Object.fromEntries(RUNTIME.map((k) => [k, n[k]]));

const patch = (id: string, body: unknown) => PATCH(new Request(`http://x/api/creative-engine/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: { id } });

/** A text → image workflow on a campaign, with the image node already "submitted" (runtime fields set server side). */
function submittedWorkflow() {
  const c = createCampaign({ text: 'layout test', product: '', audience: '', goal: 'unset' });
  const t = newNode('text', 0, 0, { text: 'a lamp on a desk' }); const i = newNode('image', 300, 0, { model: 'nano-banana-2', aspectRatio: '1:1' });
  const w = createWorkflow({ campaignId: c.id, name: 'img', nodes: [t, i], edges: [newEdge(t.id, 'text', i.id, 'prompt')] });
  const stale = readWorkflow(w.id)!; // the client copy, read before the run
  const at = new Date().toISOString();
  const live = mutateWorkflow(w.id, (x) => ({ ...x, runStartedAt: at, nodes: x.nodes.map((n) => (n.id === i.id ? { ...n, runId: 'run-live', error: null } : { ...n, outputText: 'a lamp on a desk', resolvedAt: at })) }))!;
  return { c, t, i, stale, live };
}

describe('mergeLayout (pure)', () => {
  const base = (): Workflow => {
    const a = { ...newNode('text', 0, 0, { text: 'x' }), outputText: 'x', resolvedAt: '2026-10-08T00:00:00.000Z' };
    const b = { ...newNode('video', 300, 0), runId: 'run-1', outputAssetId: 'asset-1', error: null, resolvedAt: '2026-10-08T00:00:01.000Z' };
    return { id: 'w', campaignId: 'c', name: 'n', nodes: [a, b], edges: [newEdge(a.id, 'text', b.id, 'prompt')], runStartedAt: '2026-10-08T00:00:00.000Z', createdAt: '', updatedAt: '' };
  };
  test('stored runtime fields survive any layout, including one built from a cleared copy', () => {
    const w = base();
    const cleared = { ...w, nodes: w.nodes.map((n) => ({ ...n, x: n.x + 50, runId: null, outputAssetId: null, outputText: null, error: 'x', resolvedAt: null })) };
    const merged = mergeLayout(w, toLayout(cleared));
    expect(merged.nodes.map(runtimeOf)).toEqual(w.nodes.map(runtimeOf));
    expect(merged.nodes.map((n) => n.x)).toEqual([50, 350]);
  });
  test('new ids start cleared, missing ids are removed, edges follow the layout', () => {
    const w = base();
    const extra = newNode('deliver', 600, 0);
    const layout = toLayout({ nodes: [w.nodes[1], extra], edges: [newEdge(w.nodes[1].id, 'video', extra.id, 'video')] });
    const merged = mergeLayout(w, layout);
    expect(merged.nodes.map((n) => n.id)).toEqual([w.nodes[1].id, extra.id]);
    expect(runtimeOf(merged.nodes[1])).toEqual({ runId: null, outputAssetId: null, outputText: null, error: null, resolvedAt: null });
    expect(merged.edges).toHaveLength(1);
  });
  test('a type change, an unknown node, an unknown port and a duplicate id are refused', () => {
    const w = base();
    const l = toLayout(w);
    expect(() => mergeLayout(w, { ...l, nodes: [{ ...l.nodes[0], type: 'image' }, l.nodes[1]] })).toThrow(LayoutError);
    expect(() => mergeLayout(w, { ...l, edges: [{ ...l.edges[0], to: 'n-ghost' }] })).toThrow(/isn't in the workflow/);
    expect(() => mergeLayout(w, { ...l, edges: [{ ...l.edges[0], toPort: 'nope' }] })).toThrow(/no input "nope"/);
    expect(() => mergeLayout(w, { ...l, nodes: [l.nodes[0], l.nodes[0]] })).toThrow(/duplicate/);
  });
  test('a type-mismatched edge is kept (validateGraph reports it)', () => {
    const w = base();
    const l = toLayout(w);
    const merged = mergeLayout(w, { ...l, edges: [{ ...l.edges[0], toPort: 'images' }] });
    expect(merged.edges[0].toPort).toBe('images');
  });
  test('layoutDiff sends nothing for runtime-only changes, the layout for a move, the name for a rename', () => {
    const w = base();
    expect(layoutDiff(w, { ...w, nodes: w.nodes.map((n) => ({ ...n, runId: null })) })).toBeNull();
    const moved = layoutDiff(w, { ...w, nodes: w.nodes.map((n) => ({ ...n, x: n.x + 1 })) })!;
    expect(moved.layout!.nodes[0]).not.toHaveProperty('runId');
    expect(moved.name).toBeUndefined();
    expect(layoutDiff(w, { ...w, name: 'renamed' })).toEqual({ name: 'renamed' });
  });
});

describe('PATCH /api/creative-engine/workflows/[id]', () => {
  test('a layout PATCH can never change runId, outputAssetId, error or resolvedAt', async () => {
    const { stale, live } = submittedWorkflow();
    const res = await patch(live.id, { layout: toLayout({ ...stale, nodes: stale.nodes.map((n) => ({ ...n, x: n.x + 10 })) }) });
    expect(res.status).toBe(200);
    const after = readWorkflow(live.id)!;
    expect(after.nodes.map(runtimeOf)).toEqual(live.nodes.map(runtimeOf));
    expect(after.nodes.map((n) => n.x)).toEqual(live.nodes.map((n) => n.x + 10));
  });
  test('the legacy whole-node body goes through the same merge, so it cannot clobber runtime fields either', async () => {
    const { stale, live } = submittedWorkflow();
    const res = await patch(live.id, { nodes: stale.nodes.map((n) => ({ ...n, title: 'renamed', runId: null, outputAssetId: 'forged', error: 'forged' })), edges: stale.edges });
    expect(res.status).toBe(200);
    const after = readWorkflow(live.id)!;
    expect(after.nodes.map(runtimeOf)).toEqual(live.nodes.map(runtimeOf));
    expect(after.nodes.every((n) => n.title === 'renamed')).toBe(true);
  });
  test('a stale baseUpdatedAt answers 409 with the current copy; force overrides the layout but never runtime fields', async () => {
    const { stale, live } = submittedWorkflow();
    const layout = toLayout({ ...stale, nodes: stale.nodes.map((n) => ({ ...n, y: 99 })) });
    const res = await patch(live.id, { layout, baseUpdatedAt: OLD });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.kind).toBe('conflict');
    expect(body.workflow.updatedAt).toBe(live.updatedAt);
    expect(readWorkflow(live.id)!.nodes.every((n) => n.y === 0)).toBe(true);
    const forced = await patch(live.id, { layout, baseUpdatedAt: OLD, force: true });
    expect(forced.status).toBe(200);
    const after = readWorkflow(live.id)!;
    expect(after.nodes.every((n) => n.y === 99)).toBe(true);
    expect(after.nodes.map(runtimeOf)).toEqual(live.nodes.map(runtimeOf));
    const fresh = await patch(live.id, { name: 'ok', baseUpdatedAt: after.updatedAt });
    expect(fresh.status).toBe(200);
  });
  test('mutateWorkflow refuses a stale expectUpdatedAt', () => {
    const { live } = submittedWorkflow();
    expect(() => mutateWorkflow(live.id, (x) => x, { expectUpdatedAt: 'old' })).toThrow(WorkflowConflictError);
  });
  test('a structurally invalid layout is refused with 400 and nothing is written', async () => {
    const { live } = submittedWorkflow();
    const l = toLayout(live);
    const res = await patch(live.id, { layout: { ...l, nodes: [{ ...l.nodes[0], type: 'video' }, l.nodes[1]] } });
    expect(res.status).toBe(400);
    expect((await res.json()).kind).toBe('layout');
    expect(readWorkflow(live.id)!.updatedAt).toBe(live.updatedAt);
  });
  test('reset still clears run state; a PATCH for a deleted workflow is 404 and never recreates it', async () => {
    const { live } = submittedWorkflow();
    const r = await patch(live.id, { reset: true });
    expect(r.status).toBe(200);
    expect(readWorkflow(live.id)!.nodes.every((n) => n.runId === null)).toBe(true);
    const del = await DELETE(new Request('http://x', { method: 'DELETE' }), { params: { id: live.id } });
    expect(del.status).toBe(200);
    const late = await patch(live.id, { layout: toLayout(live) });
    expect(late.status).toBe(404);
    expect(readWorkflow(live.id)).toBeNull();
  });
});

describe('R10 regression: a stale autosave during a run never causes a second paid submission', () => {
  test('counting fake client: one submission before the stale save, still one after syncWorkflows', async () => {
    delete process.env.CREATIVE_ENGINE_DRY;
    const c = createCampaign({ text: 'r10', product: '', audience: '', goal: 'unset' });
    const t = newNode('text', 0, 0, { text: 'a lamp on a desk' }); const i = newNode('image', 300, 0, { model: 'nano-banana-2', aspectRatio: '1:1' });
    const w = createWorkflow({ campaignId: c.id, name: 'r10', nodes: [t, i], edges: [newEdge(t.id, 'text', i.id, 'prompt')] });
    const stale = readWorkflow(w.id)!; // what the canvas holds: runId null everywhere

    let submissions = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/credits')) return new Response(JSON.stringify({ creditsIncluded: 100, creditsRemaining: 50, additionalCreditsUsed: 0 }), { status: 200 });
      if (url.includes('/v1/products')) return new Response(JSON.stringify({ items: [{ id: 'p1', name: 'P' }] }), { status: 200 });
      if (url.includes('/v2/images/generate')) { submissions += 1; return new Response(JSON.stringify({ id: `img-${submissions}`, type: 'nano-banana-2', status: 'pending', data: { creditsCharged: 0.03 } }), { status: 201 }); }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    const client = new ArcadsClient('Basic x', fetchImpl, 'https://api.test');

    // Run: the engine submits the image node and writes its runId server side.
    mutateWorkflow(w.id, (x) => ({ ...x, runStartedAt: new Date().toISOString() }));
    const started = await advanceWorkflow(w.id, false, client);
    const runId = started.nodes.find((n) => n.id === i.id)!.runId;
    expect(runId).toBeTruthy();
    expect(submissions).toBe(1);

    // The canvas autosaves a move from its stale copy, in both the new and the legacy body.
    const moved = { ...stale, nodes: stale.nodes.map((n) => ({ ...n, x: n.x + 40 })) };
    expect((await patch(w.id, { layout: toLayout(moved) })).status).toBe(200);
    expect((await patch(w.id, { nodes: moved.nodes, edges: moved.edges })).status).toBe(200);
    expect(readWorkflow(w.id)!.nodes.find((n) => n.id === i.id)!.runId).toBe(runId);

    // The poll clock runs: nothing is ready, so nothing is submitted again.
    await syncWorkflows(client);
    await syncWorkflows(client);
    expect(submissions).toBe(1);

    // Control: the test can see a double charge. Clearing runId the way the old PATCH did makes the engine pay again.
    mutateWorkflow(w.id, (x) => ({ ...x, nodes: x.nodes.map((n) => (n.id === i.id ? { ...n, runId: null } : n)) }));
    await syncWorkflows(client);
    expect(submissions).toBe(2);
  });
});
