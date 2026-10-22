import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PipelineSchema,
  compilePipeline,
  createPipeline,
  deletePipeline,
  getPipeline,
  readPipelines,
  runPreview,
  seedPipelines,
  topologicalTaskOrder,
  updatePipeline,
  validatePipeline,
  writePipelines,
  type Pipeline,
  type PipelineNode,
} from '@/lib/content-pipelines';
import { readQueue, resolveQueue, type MediaManifest } from '@/lib/content-production';

/** Every test that touches the store points PIPELINES_STORE_PATH (and, for
 *  compile tests, CONTENT_QUEUE_PATH too) at fresh temp files so the real
 *  data/*.json is never mutated. */
function tempFile(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  return path.join(dir, 'store.json');
}

function baseNode(overrides: Partial<PipelineNode> = {}): PipelineNode {
  return {
    id: 'n1',
    kind: 'generate',
    label: 'Node',
    model: 'nano_banana_pro',
    params: {},
    aspectRatio: null,
    duration: null,
    prompt: null,
    mediaBindings: [],
    inputKind: null,
    ...overrides,
  };
}

function emptyPipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipeline-test',
    name: 'Test pipeline',
    description: '',
    nodes: [],
    edges: [],
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('seedPipelines', () => {
  test('exactly two starter templates, each valid against the real catalog', () => {
    const templates = seedPipelines();
    expect(templates.map((p) => p.id)).toEqual(['pipeline-thumbnail-pack', 'pipeline-clip-pass']);
    for (const p of templates) {
      expect(() => PipelineSchema.parse(p)).not.toThrow();
      expect(validatePipeline(p)).toEqual([]);
    }
  });

  test('no demo/sample/placeholder language anywhere in template copy', () => {
    const banned = /\b(demo|sample|placeholder|lorem)\b/i;
    for (const p of seedPipelines()) {
      expect(p.name).not.toMatch(banned);
      expect(p.description).not.toMatch(banned);
      for (const n of p.nodes) {
        expect(n.label).not.toMatch(banned);
        if (n.prompt) expect(n.prompt).not.toMatch(banned);
      }
    }
  });

});

describe('validatePipeline', () => {
  test('empty pipeline is valid (nothing to check)', () => {
    expect(validatePipeline(emptyPipeline())).toEqual([]);
  });

  test('flags an edge that references a missing node', () => {
    const p = emptyPipeline({ nodes: [baseNode()], edges: [{ from: 'n1', to: 'ghost' }] });
    const problems = validatePipeline(p);
    expect(problems.some((m) => m.includes('ghost'))).toBe(true);
  });

  test('flags a generate node with no model', () => {
    const p = emptyPipeline({ nodes: [baseNode({ model: null })] });
    expect(validatePipeline(p).some((m) => m.includes('require a model'))).toBe(true);
  });

  test('flags a generate node whose model does not exist in the catalog', () => {
    const p = emptyPipeline({ nodes: [baseNode({ model: 'not_a_real_model' })] });
    expect(validatePipeline(p).some((m) => m.includes('unknown model'))).toBe(true);
  });

  test('flags a cycle in the edge graph', () => {
    const p = emptyPipeline({
      nodes: [baseNode({ id: 'a' }), baseNode({ id: 'b' })],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    expect(validatePipeline(p).some((m) => m.includes('cycle'))).toBe(true);
  });

  test('accepts a well-typed node-sourced media binding (image output into an image role)', () => {
    const p = emptyPipeline({
      nodes: [
        { ...baseNode({ id: 'src', kind: 'input', model: null, inputKind: 'image', label: 'Reference' }) },
        baseNode({
          id: 'gen',
          model: 'nano_banana_pro',
          mediaBindings: [{ role: 'image_references', source: { type: 'node', ref: 'src' } }],
        }),
      ],
      edges: [{ from: 'src', to: 'gen' }],
    });
    expect(validatePipeline(p)).toEqual([]);
  });

  test('the socket type-checker rejects an image-output node feeding an audio role', () => {
    const p = emptyPipeline({
      nodes: [
        baseNode({ id: 'img', kind: 'input', model: null, inputKind: 'image', label: 'Reference image' }),
        baseNode({
          id: 'sync',
          model: 'sync_so',
          mediaBindings: [{ role: 'input_audio', source: { type: 'node', ref: 'img' } }],
        }),
      ],
      edges: [{ from: 'img', to: 'sync' }],
    });
    const problems = validatePipeline(p);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((m) => m.includes('input_audio') && m.includes('image'))).toBe(true);
  });

  test('rejects a video-output node feeding an image role too (general mismatch, not just audio)', () => {
    const p = emptyPipeline({
      nodes: [
        baseNode({ id: 'vid', kind: 'input', model: null, inputKind: 'video', label: 'Source video' }),
        baseNode({
          id: 'gen',
          model: 'nano_banana_pro',
          mediaBindings: [{ role: 'image_references', source: { type: 'node', ref: 'vid' } }],
        }),
      ],
      edges: [{ from: 'vid', to: 'gen' }],
    });
    expect(validatePipeline(p).length).toBeGreaterThan(0);
  });

  test('a text-kind input can never satisfy a media role (no text role exists)', () => {
    const p = emptyPipeline({
      nodes: [
        baseNode({ id: 'url', kind: 'input', model: null, inputKind: 'text', label: 'Source URL' }),
        baseNode({
          id: 'gen',
          model: 'nano_banana_pro',
          mediaBindings: [{ role: 'image_references', source: { type: 'node', ref: 'url' } }],
        }),
      ],
      edges: [{ from: 'url', to: 'gen' }],
    });
    expect(validatePipeline(p).length).toBeGreaterThan(0);
  });

  test('flags an unknown media role name', () => {
    const p = emptyPipeline({
      nodes: [baseNode({ mediaBindings: [{ role: 'not_a_real_role', source: { type: 'upload', ref: '/x.png' } }] })],
    });
    expect(validatePipeline(p).some((m) => m.includes('unknown media role'))).toBe(true);
  });

  test('does not type-check non-node-sourced bindings (upload/library/text/identity)', () => {
    const p = emptyPipeline({
      nodes: [
        baseNode({
          model: 'sync_so',
          mediaBindings: [{ role: 'input_audio', source: { type: 'upload', ref: '/content-media/uploads/x.mp3' } }],
        }),
      ],
    });
    expect(validatePipeline(p)).toEqual([]);
  });
});

describe('topologicalTaskOrder / compilePipeline', () => {
  let queueFile: string;
  afterEach(() => {
    if (queueFile) rmSync(path.dirname(queueFile), { recursive: true, force: true });
  });

  test('orders generate/transform nodes upstream-before-downstream, skipping input/output nodes', () => {
    const p = seedPipelines().find((x) => x.id === 'pipeline-thumbnail-pack')!;
    const order = topologicalTaskOrder(p).map((n) => n.id);
    expect(order).toEqual(['gen-thumbnails', 'upscale-thumbnails']);
  });

  test('compilePipeline produces one task per generate/transform node with correct dependsOn chains', () => {
    queueFile = tempFile('content-queue');
    const p = seedPipelines().find((x) => x.id === 'pipeline-thumbnail-pack')!;
    const tasks = compilePipeline(p, 'campaign-test', queueFile);

    expect(tasks).toHaveLength(2);
    const [genTask, upscaleTask] = tasks;

    expect(genTask.pipelineId).toBe(p.id);
    expect(genTask.nodeId).toBe('gen-thumbnails');
    expect(genTask.dependsOn ?? []).toEqual([]); // sourced from an input node — no upstream task
    expect(genTask.model).toBe('nano_banana_pro');
    expect(genTask.spec?.batch).toBe(3); // params.batch is pulled out of the model params
    expect(genTask.spec?.params.batch).toBeUndefined();
    expect(genTask.spec?.medias).toEqual([{ role: 'image_references', ref: 'node:input-frame' }]);

    expect(upscaleTask.nodeId).toBe('upscale-thumbnails');
    expect(upscaleTask.dependsOn).toEqual([genTask.id]);
    expect(upscaleTask.spec?.medias).toEqual([{ role: 'image_references', ref: `node:gen-thumbnails` }]);

    // The queue store really has both rows (alongside the store's own
    // seeded content, exactly like a fresh content-queue.json), and the
    // second reads 'blocked' until the first is marked delivered in the
    // media manifest.
    const stored = readQueue(queueFile);
    expect(stored.map((t) => t.id)).toEqual(expect.arrayContaining([genTask.id, upscaleTask.id]));
    const manifest: MediaManifest = { assets: [] };
    const resolved = resolveQueue(stored, manifest);
    const upscaleResolved = resolved.find((t) => t.id === upscaleTask.id)!;
    expect(upscaleResolved.status).toBe('blocked');
  });

  test('an identity-sourced media binding never leaks into spec.medias', () => {
    queueFile = tempFile('content-queue');
    const REF = '00000000-0000-4000-8000-000000000001';
    const p = {
      id: 'pipeline-identity-test',
      name: 'Identity still',
      description: 'Generates a still from a saved identity.',
      nodes: [
        {
          id: 'gen-still',
          kind: 'generate' as const,
          label: 'Generate identity still',
          model: 'soul_2',
          params: { quality: '2k' },
          aspectRatio: '9:16',
          duration: null,
          prompt: 'straight-to-camera frame, natural light',
          mediaBindings: [{ role: 'image', source: { type: 'identity' as const, ref: REF } }],
          inputKind: null,
        },
      ],
      edges: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const tasks = compilePipeline(p as Parameters<typeof compilePipeline>[0], 'campaign-test', queueFile);
    const stillTask = tasks.find((t) => t.nodeId === 'gen-still')!;
    expect(stillTask.spec?.medias).toEqual([]);
    if (stillTask.spec?.identity) expect(stillTask.spec.identity.id).toBe(REF);
  });

  test('chains dependsOn across generate nodes fed by node-sourced media', () => {
    queueFile = tempFile('content-queue');
    const node = (id: string, model: string, bindings: { role: string; source: { type: 'node'; ref: string } }[]) => ({
      id,
      kind: 'generate' as const,
      label: id,
      model,
      params: {},
      aspectRatio: '9:16',
      duration: null,
      prompt: 'test',
      mediaBindings: bindings,
      inputKind: null,
    });
    const p = {
      id: 'pipeline-chain-test',
      name: 'Chain',
      description: 'Two generate nodes in sequence.',
      nodes: [node('gen-a', 'soul_2', []), node('gen-b', 'kling3_0', [{ role: 'image', source: { type: 'node' as const, ref: 'gen-a' } }])],
      edges: [{ from: 'gen-a', to: 'gen-b' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const tasks = compilePipeline(p as Parameters<typeof compilePipeline>[0], 'campaign-test', queueFile);
    const byNode = new Map(tasks.map((t) => [t.nodeId, t]));
    expect(byNode.get('gen-a')!.dependsOn ?? []).toEqual([]);
    expect(byNode.get('gen-b')!.dependsOn).toEqual([byNode.get('gen-a')!.id]);
  });

  test('throws rather than compiling an invalid pipeline', () => {
    const p = emptyPipeline({ nodes: [baseNode({ model: null })] });
    expect(() => compilePipeline(p, 'campaign-test', tempFile('content-queue'))).toThrow(/invalid/);
  });
});

describe('runPreview', () => {
  test('totals match the sum of per-node estimateCredits, batch respected', () => {
    const p = seedPipelines().find((x) => x.id === 'pipeline-thumbnail-pack')!;
    const preview = runPreview(p);
    expect(preview.nodes.map((n) => n.nodeId)).toEqual(['gen-thumbnails', 'upscale-thumbnails']);
    const sum = preview.nodes.reduce((n, x) => n + x.credits, 0);
    expect(preview.totalCredits).toBe(sum);
    expect(preview.totalCredits).toBeGreaterThan(0);
    // batch of 3 on the nano_banana_pro node multiplies its per-unit credits.
    const genPreview = preview.nodes.find((n) => n.nodeId === 'gen-thumbnails')!;
    expect(genPreview.credits).toBe(2 * 3);
  });

  test('an empty pipeline previews to zero nodes and zero credits', () => {
    expect(runPreview(emptyPipeline())).toEqual({ nodes: [], totalCredits: 0 });
  });
});

describe('pipeline store CRUD round trip', () => {
  let file: string;
  afterEach(() => {
    if (file) rmSync(path.dirname(file), { recursive: true, force: true });
  });

  test('a fresh store seeds the starter templates on first read', () => {
    file = tempFile('content-pipelines');
    const pipelines = readPipelines(file);
    expect(pipelines.map((p) => p.id).sort()).toEqual(
      ['pipeline-thumbnail-pack', 'pipeline-clip-pass'].sort(),
    );
  });

  test('createPipeline appends a real row that readPipelines then returns', () => {
    file = tempFile('content-pipelines');
    const before = readPipelines(file).length;
    const created = createPipeline(
      { name: 'Fresh pipeline', description: 'A pipeline built in the test.', nodes: [], edges: [] },
      file,
    );
    expect(created.id).toMatch(/^pipeline-/);
    const after = readPipelines(file);
    expect(after.length).toBe(before + 1);
    expect(getPipeline(created.id, file)?.name).toBe('Fresh pipeline');
  });

  test('updatePipeline replaces name/nodes in place, keeps id and createdAt', () => {
    file = tempFile('content-pipelines');
    const created = createPipeline({ name: 'Before', description: '', nodes: [], edges: [] }, file);
    const updated = updatePipeline(
      created.id,
      { name: 'After', description: 'updated', nodes: [baseNode()], edges: [] },
      file,
    );
    expect(updated?.name).toBe('After');
    expect(updated?.id).toBe(created.id);
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.nodes).toHaveLength(1);
  });

  test('updatePipeline on an unknown id returns null and changes nothing', () => {
    file = tempFile('content-pipelines');
    const before = readPipelines(file);
    const result = updatePipeline('not-a-real-id', { name: 'X', description: '', nodes: [], edges: [] }, file);
    expect(result).toBeNull();
    expect(readPipelines(file)).toEqual(before);
  });

  test('deletePipeline removes exactly the added row and nothing else', () => {
    file = tempFile('content-pipelines');
    const seeded = readPipelines(file).map((p) => p.id);
    const created = createPipeline({ name: 'To delete', description: '', nodes: [], edges: [] }, file);
    expect(deletePipeline(created.id, file)).toBe(true);
    const finalIds = readPipelines(file).map((p) => p.id);
    expect(finalIds).not.toContain(created.id);
    expect(finalIds.sort()).toEqual(seeded.sort());
  });

  test('deletePipeline on an unknown id returns false and changes nothing', () => {
    file = tempFile('content-pipelines');
    const before = readPipelines(file);
    expect(deletePipeline('not-a-real-id', file)).toBe(false);
    expect(readPipelines(file)).toEqual(before);
  });

  test('writePipelines + readPipelines round-trip a full pipeline unchanged', () => {
    file = tempFile('content-pipelines');
    const p = seedPipelines()[0];
    writePipelines([p], file);
    expect(readPipelines(file)).toEqual([p]);
  });
});
