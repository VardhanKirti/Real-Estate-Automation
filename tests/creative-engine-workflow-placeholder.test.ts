import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCampaign, createWorkflow, readWorkflow, readWorkflows } from '@/lib/creative-engine/store';
import { NODE_SPECS, TEMPLATES, newEdge, newNode, validateGraph } from '@/lib/creative-engine/workflow';
import { mergeLayout, toLayout } from '@/lib/creative-engine/workflow-edit';

/**
 * S05b edge case 11 (a stored node whose type no longer exists loads as a
 * "Missing node type" placeholder instead of hiding the whole workflow) and
 * the "One video per beat" template layout.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-engine-wf-missing-'));
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

function withRetiredNode() {
  const c = createCampaign({ text: 'missing type', product: '', audience: '', goal: 'unset' });
  const t = newNode('text', 0, 0, { text: 'hi' }); const v = newNode('video', 300, 0); const d = newNode('deliver', 600, 0);
  const w = createWorkflow({ campaignId: c.id, name: 'Old flow', nodes: [t, v, d], edges: [newEdge(t.id, 'text', v.id, 'prompt'), newEdge(v.id, 'video', d.id, 'video')] });
  // rewrite the file as if "video" had been removed from the registry
  const file = path.join(dir, 'workflows', `${w.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.nodes = raw.nodes.map((n: { type: string }) => (n.type === 'video' ? { ...n, type: 'retiredModel', settings: { foo: 1 } } : n));
  fs.writeFileSync(file, JSON.stringify(raw));
  return { c, w, t, v, d };
}

describe('missing node type placeholder', () => {
  test('the workflow still lists and reads, with the node as a placeholder and its links dropped', () => {
    const { c, w, v, t, d } = withRetiredNode();
    expect(readWorkflows(c.id).map((x) => x.id)).toContain(w.id);
    const back = readWorkflow(w.id)!;
    const ph = back.nodes.find((n) => n.id === v.id)!;
    expect(ph.type).toBe('missing');
    expect(ph.settings.originalType).toBe('retiredModel');
    expect(ph.x).toBe(300);
    expect(back.nodes.map((n) => n.id)).toEqual([t.id, v.id, d.id]);
    expect(back.edges).toEqual([]);
  });

  test('Run is blocked with "Remove or replace", and the placeholder is not paid', () => {
    const { w } = withRetiredNode();
    const problems = validateGraph(readWorkflow(w.id)!);
    expect(problems.some((p) => p.level === 'error' && /Remove or replace .*"retiredModel" no longer exists/.test(p.message))).toBe(true);
    expect(NODE_SPECS.missing.local).toBe(true);
  });

  test('a layout save keeps the placeholder, can delete it, and undo can bring it back', () => {
    const { w, v } = withRetiredNode();
    const stored = readWorkflow(w.id)!;
    expect(mergeLayout(stored, toLayout(stored)).nodes.find((n) => n.id === v.id)?.type).toBe('missing');
    const without = { ...stored, nodes: stored.nodes.filter((n) => n.id !== v.id) };
    expect(mergeLayout(stored, toLayout(without)).nodes).toHaveLength(2);
    const gone = mergeLayout(stored, toLayout(without));
    const undone = mergeLayout({ ...stored, nodes: gone.nodes }, toLayout(stored));
    expect(undone.nodes.find((n) => n.id === v.id)).toMatchObject({ type: 'missing', runId: null });
  });
});

describe('"One video per beat" layout', () => {
  test('one row per beat, every link runs left to right, no two nodes overlap', () => {
    const beats = ['Hook', 'Show', 'Demo', 'Result', 'Verdict'].map((name) => ({ name, spoken: name, seconds: 3 }));
    const g = TEMPLATES.find((t) => t.id === 'beats')!.build({ scriptId: 's', beats });
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const e of g.edges) expect(byId.get(e.from)!.x + 224).toBeLessThan(byId.get(e.to)!.x);
    const H = 220; // a video node is the tallest here
    for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) {
      const a = g.nodes[i]; const b = g.nodes[j];
      expect(a.x < b.x + 224 && a.x + 224 > b.x && a.y < b.y + H && a.y + H > b.y).toBe(false);
    }
  });
});
