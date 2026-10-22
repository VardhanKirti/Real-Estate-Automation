import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDefaultSpec } from '@/lib/content-composer-spec';
import { findModel } from '@/lib/higgsfield/catalog';

/** Every test that touches the store points CONTENT_QUEUE_PATH at a fresh
 *  temp file, matching the pattern in tests/content-production.test.ts —
 *  the real data/content-queue.json is never mutated. */
function tempQueueFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-queue-spec-'));
  return path.join(dir, 'queue.json');
}

const prevQueuePath = process.env.CONTENT_QUEUE_PATH;

afterEach(() => {
  const dir = process.env.CONTENT_QUEUE_PATH ? path.dirname(process.env.CONTENT_QUEUE_PATH) : null;
  if (dir && dir.includes('content-queue-spec-')) rmSync(dir, { recursive: true, force: true });
  if (prevQueuePath === undefined) delete process.env.CONTENT_QUEUE_PATH;
  else process.env.CONTENT_QUEUE_PATH = prevQueuePath;
});

describe('POST /api/content/queue — v3 spec submission', () => {
  test('accepts a valid spec submission and appends it to the queue store', async () => {
    const file = tempQueueFile();
    process.env.CONTENT_QUEUE_PATH = file;

    const model = findModel('nano_banana_pro')!;
    const spec = buildDefaultSpec(model);
    const { POST } = await import('@/app/api/content/queue/route');
    const res = await POST(
      new Request('http://test/api/content/queue', {
        method: 'POST',
        body: JSON.stringify({
          toolKey: 'image',
          campaignId: 'higgsfield-api-reel',
          title: 'A still for the reel',
          spec,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.title).toBe('A still for the reel');
    expect(body.task.spec.model).toBe('nano_banana_pro');
    expect(body.task.type).toBe('image');

    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk.tasks.some((t: any) => t.id === body.task.id)).toBe(true);
  });

  test('rejects an unknown campaign even with an otherwise valid spec', async () => {
    const file = tempQueueFile();
    process.env.CONTENT_QUEUE_PATH = file;

    const model = findModel('nano_banana_pro')!;
    const spec = buildDefaultSpec(model);
    const { POST } = await import('@/app/api/content/queue/route');
    const res = await POST(
      new Request('http://test/api/content/queue', {
        method: 'POST',
        body: JSON.stringify({ toolKey: 'image', campaignId: 'not-a-real-campaign', title: 'x', spec }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('rejects a malformed spec with 400', async () => {
    const file = tempQueueFile();
    process.env.CONTENT_QUEUE_PATH = file;

    const { POST } = await import('@/app/api/content/queue/route');
    const res = await POST(
      new Request('http://test/api/content/queue', {
        method: 'POST',
        body: JSON.stringify({ toolKey: 'image', campaignId: 'higgsfield-api-reel', title: 'x', spec: { model: '' } }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('the legacy CreateTaskInput path still works unchanged', async () => {
    const file = tempQueueFile();
    process.env.CONTENT_QUEUE_PATH = file;

    const { POST } = await import('@/app/api/content/queue/route');
    const res = await POST(
      new Request('http://test/api/content/queue', {
        method: 'POST',
        body: JSON.stringify({
          actionKey: 'thumbnail',
          campaignId: 'higgsfield-api-reel',
          title: 'Legacy thumbnail',
          inputs: 'money phone reel cover',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.title).toBe('Legacy thumbnail');
  });
});
