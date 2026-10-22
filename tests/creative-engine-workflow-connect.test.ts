import { describe, expect, test } from 'vitest';
import { newEdge, newNode } from '@/lib/creative-engine/workflow';
import { History, applyConnect, clampPopover, connectVerdict, paletteMatches, paletteOrder, reconnect, removeEdges, removeNodes } from '@/lib/creative-engine/workflow-edit';
import type { WorkflowEdge, WorkflowNode } from '@/lib/creative-engine/schemas';

/** S05b steps 3 to 5: connect verdicts, reconnect, cascades, history, palette search and popover placement. Pure, no browser. */

function probe() {
  const t1 = newNode('text', 0, 0); t1.id = 't1'; t1.title = 'Prompt';
  const t2 = newNode('text', 0, 200); t2.id = 't2'; t2.title = 'Spare prompt';
  const v = newNode('video', 300, 0); v.id = 'v';
  const ed = newNode('videoEdit', 600, 0); ed.id = 'ed';
  const d = newNode('deliver', 900, 0); d.id = 'd';
  const nodes: WorkflowNode[] = [t1, t2, v, ed, d];
  const e1 = { ...newEdge('t1', 'text', 'v', 'prompt'), id: 'e1' };
  const e2 = { ...newEdge('v', 'video', 'ed', 'videos'), id: 'e2' };
  const e3 = { ...newEdge('t2', 'text', 'ed', 'prompt'), id: 'e3' };
  const e4 = { ...newEdge('ed', 'video', 'd', 'video'), id: 'e4' };
  const edges: WorkflowEdge[] = [e1, e2, e3, e4];
  return { nodes, edges };
}

describe('connectVerdict', () => {
  test('add on a free port', () => {
    const w = probe();
    expect(connectVerdict(w, 't2', 'text', 'v', 'prompt').kind).toBe('replace');
    expect(connectVerdict({ ...w, edges: w.edges.filter((e) => e.id !== 'e1') }, 't2', 'text', 'v', 'prompt')).toEqual({ kind: 'add' });
  });
  test('replace on an occupied single port names the edge to drop', () => {
    expect(connectVerdict(probe(), 't1', 'text', 'ed', 'prompt')).toEqual({ kind: 'replace', removeEdgeId: 'e3' });
  });
  test('a many port adds, and the same pair is a noop', () => {
    const w = probe();
    const v2 = newNode('video', 300, 300); v2.id = 'v2';
    const g = { ...w, nodes: [...w.nodes, v2] };
    expect(connectVerdict(g, 'v2', 'video', 'ed', 'videos')).toEqual({ kind: 'add' });
    expect(connectVerdict(g, 'v', 'video', 'ed', 'videos')).toEqual({ kind: 'noop', reason: 'Already linked' });
  });
  test('refuses type mismatch, self links and loops with a readable reason', () => {
    const w = probe();
    expect(connectVerdict(w, 'v', 'video', 'ed', 'prompt')).toEqual({ kind: 'refuse', reason: "Video can't feed a text input" });
    expect(connectVerdict(w, 'ed', 'video', 'ed', 'videos')).toEqual({ kind: 'refuse', reason: "A node can't feed itself" });
    expect(connectVerdict(w, 'ed', 'video', 'v', 'videos')).toEqual({ kind: 'refuse', reason: 'That would make a loop' });
  });
  test('loop after replace: the check runs on the graph without the replaced link', () => {
    // a → b (single port) and b → c. Feeding c's output into a's single input is a loop even though a.prompt is free.
    const a = newNode('videoEdit', 0, 0); a.id = 'a';
    const b = newNode('videoEdit', 300, 0); b.id = 'b';
    const s = newNode('video', -300, 0); s.id = 's';
    const g = { nodes: [a, b, s], edges: [{ id: 'x1', from: 'a', fromPort: 'video', to: 'b', toPort: 'startFrame' } as WorkflowEdge, { id: 'x2', from: 's', fromPort: 'video', to: 'a', toPort: 'videos' }] };
    // b's video into a.videos (many) would loop
    expect(connectVerdict(g, 'b', 'video', 'a', 'videos').kind).toBe('refuse');
    // replacing the only link into a single port whose old source is the loop's only path is allowed
    const t = newNode('text', 0, 0); t.id = 't';
    const u = newNode('llm', 300, 0); u.id = 'u';
    const e = newNode('enhance', 600, 0); e.id = 'e';
    const h = { nodes: [t, u, e], edges: [{ id: 'y1', from: 'u', fromPort: 'text', to: 'e', toPort: 'text' } as WorkflowEdge, { id: 'y2', from: 't', fromPort: 'text', to: 'u', toPort: 'text' }] };
    expect(connectVerdict(h, 't', 'text', 'e', 'text')).toEqual({ kind: 'replace', removeEdgeId: 'y1' });
    // and still refused when the new source is downstream of the target
    expect(connectVerdict(h, 'e', 'text', 'u', 'text').kind).toBe('refuse');
  });
  test('applyConnect keeps the edge count on replace and restores exactly on undo', () => {
    const w = probe();
    const v = connectVerdict(w, 't1', 'text', 'ed', 'prompt');
    const next = applyConnect(w, v, { ...newEdge('t1', 'text', 'ed', 'prompt'), id: 'new' });
    expect(next.edges).toHaveLength(4);
    expect(next.edges.some((e) => e.id === 'e3')).toBe(false);
    expect(next.edges.some((e) => e.id === 'new')).toBe(true);
    const h = new History<typeof w>();
    h.push(w);
    expect(h.undo(next)).toBe(w);
  });
});

describe('reconnect', () => {
  test('moves a link to another compatible input and keeps its id', () => {
    const r = reconnect(probe(), 'e1', 'ed', 'prompt');
    expect(r.kind).toBe('moved');
    if (r.kind !== 'moved') return;
    expect(r.replacedEdgeId).toBe('e3');
    expect(r.workflow.edges.find((e) => e.id === 'e1')).toMatchObject({ from: 't1', to: 'ed', toPort: 'prompt' });
    expect(r.workflow.edges).toHaveLength(3);
  });
  test('the same port is a noop; an incompatible or looping one is refused', () => {
    expect(reconnect(probe(), 'e1', 'v', 'prompt').kind).toBe('noop');
    expect(reconnect(probe(), 'e2', 'ed', 'prompt')).toEqual({ kind: 'refuse', reason: "Video can't feed a text input" });
    const w = probe();
    const v2 = newNode('video', 0, 0); v2.id = 'v2';
    const g = { ...w, nodes: [...w.nodes, v2], edges: [...w.edges, { id: 'e9', from: 'ed', fromPort: 'video', to: 'v2', toPort: 'videos' }] };
    expect(reconnect(g, 'e2', 'v', 'videos').kind).toBe('refuse');
  });
});

describe('cascades', () => {
  test('removeNodes drops their edges; removeEdges drops only the named ones', () => {
    const w = probe();
    const a = removeNodes(w, ['ed']);
    expect(a.nodes.map((n) => n.id)).not.toContain('ed');
    expect(a.edges.map((e) => e.id)).toEqual(['e1']);
    expect(removeEdges(w, ['e2', 'e4']).edges.map((e) => e.id)).toEqual(['e1', 'e3']);
  });
});

describe('History', () => {
  test('undo, redo, redo cleared by a new push, cap', () => {
    const h = new History<number>(3, 0);
    h.push(1, undefined, 0); h.push(2, undefined, 10); h.push(3, undefined, 20); h.push(4, undefined, 30);
    expect(h.undo(5)).toBe(4);
    expect(h.redo(4)).toBe(5);
    expect(h.undo(5)).toBe(4);
    h.push(4, undefined, 40);
    expect(h.canRedo).toBe(false);
    expect(h.undo(9)).toBe(4);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeNull();
  });
  test('pushes with one merge key inside the window fold into one step', () => {
    const h = new History<string>(100, 500);
    h.push('a', 'name', 0); h.push('ab', 'name', 100); h.push('abc', 'name', 200);
    expect(h.undo('abcd')).toBe('a');
    expect(h.canUndo).toBe(false);
  });
});

describe('paletteMatches', () => {
  test('empty query lists every type once, in palette order', () => {
    expect(paletteMatches('')).toEqual(paletteOrder());
    expect(new Set(paletteOrder()).size).toBe(paletteOrder().length);
  });
  test('aliases match, label prefix ranks first', () => {
    expect(paletteMatches('seedance')[0]).toBe('video');
    expect(paletteMatches('SEEDANCE')[0]).toBe('video');
    expect(paletteMatches('ugc')).toEqual(expect.arrayContaining(['talkingActor']));
    expect(paletteMatches('vid')[0]).toBe('video');
    expect(paletteMatches('zzzz')).toEqual([]);
  });
  test('connect context keeps only types that take the port type', () => {
    const vids = paletteMatches('', { needsInputType: 'video' });
    expect(vids).toContain('videoEdit');
    expect(vids).toContain('deliver');
    expect(vids).not.toContain('text');
    expect(paletteMatches('', { needsInputType: 'text', needsOutputType: 'text' }).sort()).toEqual(['enhance', 'llm']);
  });
});

describe('clampPopover', () => {
  const size = { w: 280, h: 420 };
  const vp = { w: 1280, h: 720 };
  test('opens right and down when it fits', () => {
    expect(clampPopover({ x: 100, y: 100 }, size, vp)).toEqual({ x: 100, y: 100, flipX: false, flipY: false });
  });
  test('flips at the right and bottom edges and stays inside', () => {
    const r = clampPopover({ x: 1270, y: 710 }, size, vp);
    expect(r.flipX && r.flipY).toBe(true);
    expect(r.x + size.w).toBeLessThanOrEqual(vp.w - 8);
    expect(r.y + size.h).toBeLessThanOrEqual(vp.h - 8);
    expect(r.x).toBeGreaterThanOrEqual(8);
    expect(r.y).toBeGreaterThanOrEqual(8);
  });
  test('all four corners and centre land fully inside', () => {
    for (const a of [{ x: 0, y: 0 }, { x: 1280, y: 0 }, { x: 0, y: 720 }, { x: 1280, y: 720 }, { x: 640, y: 360 }]) {
      const r = clampPopover(a, size, vp);
      expect(r.x).toBeGreaterThanOrEqual(8); expect(r.y).toBeGreaterThanOrEqual(8);
      expect(r.x + size.w).toBeLessThanOrEqual(vp.w - 8); expect(r.y + size.h).toBeLessThanOrEqual(vp.h - 8);
    }
  });
  test('a tiny viewport pins to the margin', () => {
    expect(clampPopover({ x: 50, y: 50 }, size, { w: 200, h: 200 })).toMatchObject({ x: 8, y: 8 });
  });
});
