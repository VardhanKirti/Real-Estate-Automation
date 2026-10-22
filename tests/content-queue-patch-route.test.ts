import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeQueue, type ProductionTask } from '@/lib/content-production';

const baseTask: ProductionTask = {
  id: 'task-a',
  campaignId: 'higgsfield-api-reel',
  type: 'thumbnail',
  title: 'Reel cover — money phone',
  inputs: 'test input',
  model: 'nano_banana_pro',
  creditEstimate: 2,
  status: 'queued',
  outputRef: null,
  createdAt: '2026-09-01T16:40:00-07:00',
};

let file: string;

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-queue-patch-'));
  file = path.join(dir, 'queue.json');
  process.env.CONTENT_QUEUE_PATH = file;
  writeQueue([baseTask], file);
});

afterEach(() => {
  delete process.env.CONTENT_QUEUE_PATH;
  if (file) rmSync(path.dirname(file), { recursive: true, force: true });
});

const patch = (body: unknown) =>
  new Request('http://localhost/api/content/queue/task-a', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('PATCH /api/content/queue/[id]', () => {
  test('re-points the task to a real campaign', async () => {
    const { PATCH } = await import('@/app/api/content/queue/[id]/route');
    const res = await PATCH(patch({ campaignId: 'openai-gpt6-astra-launch' }), { params: { id: 'task-a' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.campaignId).toBe('openai-gpt6-astra-launch');

    const { readQueue } = await import('@/lib/content-production');
    const [stored] = readQueue(file);
    expect(stored.campaignId).toBe('openai-gpt6-astra-launch');
  });

  test('rejects an unknown campaign with 400', async () => {
    const { PATCH } = await import('@/app/api/content/queue/[id]/route');
    const res = await PATCH(patch({ campaignId: 'not-a-real-campaign' }), { params: { id: 'task-a' } });
    expect(res.status).toBe(400);
  });

  test('rejects a missing campaignId with 400', async () => {
    const { PATCH } = await import('@/app/api/content/queue/[id]/route');
    const res = await PATCH(patch({}), { params: { id: 'task-a' } });
    expect(res.status).toBe(400);
  });

  test('404s on an unknown task id', async () => {
    const { PATCH } = await import('@/app/api/content/queue/[id]/route');
    const res = await PATCH(patch({ campaignId: 'openai-gpt6-astra-launch' }), { params: { id: 'not-a-real-task' } });
    expect(res.status).toBe(404);
  });

  test('leaves every other field on the row untouched', async () => {
    const { PATCH } = await import('@/app/api/content/queue/[id]/route');
    const res = await PATCH(patch({ campaignId: 'openai-gpt6-astra-launch' }), { params: { id: 'task-a' } });
    const body = await res.json();
    expect(body.task.title).toBe(baseTask.title);
    expect(body.task.model).toBe(baseTask.model);
    expect(body.task.creditEstimate).toBe(baseTask.creditEstimate);
  });
});
