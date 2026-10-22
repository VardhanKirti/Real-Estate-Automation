import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let file: string;

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-queue-spec-'));
  file = path.join(dir, 'queue.json');
  process.env.CONTENT_QUEUE_PATH = file;
});

afterEach(() => {
  delete process.env.CONTENT_QUEUE_PATH;
  if (file) rmSync(path.dirname(file), { recursive: true, force: true });
});

const post = (body: unknown) =>
  new Request('http://localhost/api/content/queue/spec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content/queue/spec', () => {
  test('queues a real spec-carrying task — the Train new avatar path', async () => {
    const { POST } = await import('@/app/api/content/queue/spec/route');
    const res = await POST(
      post({
        toolKey: 'avatar',
        campaignId: 'higgsfield-api-reel',
        title: 'Train new Soul: identity 2',
        spec: { model: 'soul_2', prompt: 'Train a new Soul identity named "identity 2".' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.title).toBe('Train new Soul: identity 2');
    expect(body.task.type).toBe('avatar');
    expect(body.task.spec.model).toBe('soul_2');
    expect(body.task.status).toBe('queued');

    const { readQueue } = await import('@/lib/content-production');
    const stored = readQueue(file);
    expect(stored.some((t) => t.title === 'Train new Soul: identity 2')).toBe(true);
  });

  test('rejects an unknown campaign with 400', async () => {
    const { POST } = await import('@/app/api/content/queue/spec/route');
    const res = await POST(
      post({
        toolKey: 'avatar',
        campaignId: 'not-a-real-campaign',
        title: 'Train new Soul: x',
        spec: { model: 'soul_2' },
      }),
    );
    expect(res.status).toBe(400);
  });

  test('rejects a missing spec model with 400', async () => {
    const { POST } = await import('@/app/api/content/queue/spec/route');
    const res = await POST(
      post({ toolKey: 'avatar', campaignId: 'higgsfield-api-reel', title: 'Train new Soul: x', spec: {} }),
    );
    expect(res.status).toBe(400);
  });

  test('rejects unparseable JSON with 400', async () => {
    const { POST } = await import('@/app/api/content/queue/spec/route');
    const res = await POST(new Request('http://localhost/api/content/queue/spec', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });
});
