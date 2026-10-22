import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CREATE_ACTIONS,
  EMPTY_MANIFEST,
  ProductionTaskSchema,
  TASK_MODEL,
  addTask,
  assetUrl,
  deleteTask,
  productionTasks,
  readQueue,
  resolveTask,
  writeQueue,
  type MediaManifest,
  type ProductionTask,
} from '@/lib/content-production';

const baseTask: ProductionTask = {
  id: 'hf-thumb-01',
  campaignId: 'higgsfield-api-reel',
  type: 'thumbnail',
  title: 'Reel cover — money phone',
  inputs: 'test input',
  model: TASK_MODEL.thumbnail,
  creditEstimate: 2,
  status: 'queued',
  outputRef: null,
  createdAt: '2026-09-01T16:40:00-07:00',
};

/** Every test that touches the store points CONTENT_QUEUE_PATH at a fresh
 *  temp file, so the real data/content-queue.json is never mutated. */
function tempQueueFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-queue-'));
  return path.join(dir, 'queue.json');
}

describe('productionTasks (seeded, real store + manifest on disk)', () => {
  test('every task validates against the schema', () => {
    for (const t of productionTasks()) {
      expect(() => ProductionTaskSchema.parse(t)).not.toThrow();
    }
  });

  test('a fresh install ships no production tasks', () => {
    expect(productionTasks()).toEqual([]);
  });

  test('the queue stays empty until the operator enqueues work', () => {
    expect(productionTasks().length).toBe(0);
  });

  test('every task defaults to queued, never a hardcoded delivered, with no live manifest', () => {
    for (const t of productionTasks(EMPTY_MANIFEST)) {
      expect(t.status).toBe('queued');
    }
  });
});

describe('resolveTask (status derivation)', () => {
  test('stays queued when the manifest has no matching taskId', () => {
    const resolved = resolveTask(baseTask, EMPTY_MANIFEST);
    expect(resolved.status).toBe('queued');
    expect(resolved.outputRef).toBeNull();
  });

  test('becomes delivered only when the manifest holds a matching taskId', () => {
    const manifest: MediaManifest = {
      assets: [
        {
          id: 'asset-1',
          file: 'hf-thumb-01.png',
          taskId: 'hf-thumb-01',
          model: TASK_MODEL.thumbnail,
          credits: 2,
          kind: 'image',
          createdAt: '2026-08-30T00:00:00.000Z',
        },
      ],
    };
    const resolved = resolveTask(baseTask, manifest);
    expect(resolved.status).toBe('delivered');
    expect(resolved.outputRef).toBe(assetUrl(manifest.assets[0]));
  });

  test('an unrelated asset in the manifest does not flip an unrelated task', () => {
    const manifest: MediaManifest = {
      assets: [
        {
          id: 'asset-2',
          file: 'other.png',
          taskId: 'some-other-task',
          model: TASK_MODEL.thumbnail,
          credits: 2,
          kind: 'image',
          createdAt: '2026-08-30T00:00:00.000Z',
        },
      ],
    };
    const resolved = resolveTask(baseTask, manifest);
    expect(resolved.status).toBe('queued');
  });

  test('a task claiming delivered without a resolvable asset is demoted back to queued', () => {
    const staleDelivered: ProductionTask = { ...baseTask, status: 'delivered', outputRef: '/content-media/gone.png' };
    const resolved = resolveTask(staleDelivered, EMPTY_MANIFEST);
    expect(resolved.status).toBe('queued');
    expect(resolved.outputRef).toBeNull();
  });
});

describe('CREATE_ACTIONS', () => {
  test('exactly the five studio actions, in order', () => {
    expect(CREATE_ACTIONS.map((a) => a.label)).toEqual([
      'Thumbnail',
      'Clips',
      'Upscale',
      'Ad variants',
      'Reel cover',
    ]);
  });

  test('reel cover shares the thumbnail model — it is a thumbnail, just framed for a Reel', () => {
    const thumb = CREATE_ACTIONS.find((a) => a.key === 'thumbnail')!;
    const reel = CREATE_ACTIONS.find((a) => a.key === 'reel-cover')!;
    expect(reel.model).toBe(thumb.model);
    expect(reel.type).toBe('thumbnail');
  });

  test('every action carries a positive credit estimate and a real model id', () => {
    for (const a of CREATE_ACTIONS) {
      expect(a.creditEstimate).toBeGreaterThan(0);
      expect(Object.values(TASK_MODEL)).toContain(a.model);
    }
  });
});

describe('queue store round trip (create → read → delete)', () => {
  let file: string;
  afterEach(() => {
    if (file) rmSync(path.dirname(file), { recursive: true, force: true });
  });

  test('addTask appends a real row that readQueue then returns', () => {
    file = tempQueueFile();
    const before = readQueue(file).length; // seeds on first read
    const task = addTask(
      { actionKey: 'clips', campaignId: 'higgsfield-api-reel', title: 'New clip pass', inputs: 'Raw footage' },
      file,
    );
    expect(task.type).toBe('clips');
    expect(task.model).toBe(TASK_MODEL.clips);
    expect(task.status).toBe('queued');

    const after = readQueue(file);
    expect(after.length).toBe(before + 1);
    expect(after.map((t) => t.id)).toContain(task.id);
  });

  test('deleteTask removes exactly the added row and nothing else', () => {
    file = tempQueueFile();
    const seeded = readQueue(file).map((t) => t.id);
    const task = addTask(
      { actionKey: 'upscale', campaignId: 'higgsfield-api-reel', title: 'New upscale', inputs: 'Master cut' },
      file,
    );
    expect(readQueue(file).map((t) => t.id)).toContain(task.id);

    const removed = deleteTask(task.id, file);
    expect(removed).toBe(true);

    const finalIds = readQueue(file).map((t) => t.id);
    expect(finalIds).not.toContain(task.id);
    expect(finalIds.sort()).toEqual(seeded.sort());
  });

  test('deleteTask on an unknown id returns false and changes nothing', () => {
    file = tempQueueFile();
    const before = readQueue(file);
    const removed = deleteTask('not-a-real-id', file);
    expect(removed).toBe(false);
    expect(readQueue(file)).toEqual(before);
  });

  test('a freshly-seeded store round-trips through productionTasks with derived status', () => {
    file = tempQueueFile();
    writeQueue([baseTask], file);
    expect(productionTasks(EMPTY_MANIFEST, file)).toEqual([baseTask]);

    const manifest: MediaManifest = {
      assets: [
        {
          id: 'asset-1',
          file: 'hf-thumb-01.jpg',
          taskId: 'hf-thumb-01',
          model: TASK_MODEL.thumbnail,
          credits: 2,
          kind: 'image',
          createdAt: '2026-09-01T17:15:59-07:00',
        },
      ],
    };
    const [resolved] = productionTasks(manifest, file);
    expect(resolved.status).toBe('delivered');
    expect(resolved.outputRef).toBe('/content-media/hf-thumb-01.jpg');
  });
});
