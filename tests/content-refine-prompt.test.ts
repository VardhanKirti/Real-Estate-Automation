import { describe, expect, test, vi } from 'vitest';
import { buildRefinePrompt, parseRefineReply } from '@/app/api/content/refine-prompt/logic';

describe('buildRefinePrompt', () => {
  test('includes the model name and the raw direction', () => {
    const prompt = buildRefinePrompt({ direction: 'money phone reel cover', modelName: 'Nano Banana Pro' });
    expect(prompt).toContain('Nano Banana Pro');
    expect(prompt).toContain('money phone reel cover');
  });

  test('injects the campaign brief when given', () => {
    const prompt = buildRefinePrompt({
      direction: 'x',
      modelName: 'Nano Banana Pro',
      campaignBrief: 'Must feel organic, no promo intros',
    });
    expect(prompt).toContain('Must feel organic, no promo intros');
  });

  test('appends the retry instruction when a prior error is given', () => {
    const prompt = buildRefinePrompt({ direction: 'x', modelName: 'Y', priorError: 'bad json' });
    expect(prompt).toContain('bad json');
    expect(prompt).toContain('Reply again with ONLY corrected strict JSON');
  });
});

describe('parseRefineReply', () => {
  test('accepts a valid reply wrapped in a CLI envelope', () => {
    const stdout = JSON.stringify({ result: JSON.stringify({ prompt: 'a sharper prompt' }) });
    const parsed = parseRefineReply(stdout);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.prompt).toBe('a sharper prompt');
  });

  test('strips a markdown code fence around the JSON', () => {
    const fenced = '```json\n' + JSON.stringify({ prompt: 'fenced prompt' }) + '\n```';
    const stdout = JSON.stringify({ result: fenced });
    const parsed = parseRefineReply(stdout);
    expect(parsed.ok).toBe(true);
  });

  test('rejects non-JSON text honestly, never a fabricated prompt', () => {
    const stdout = JSON.stringify({ result: 'Sure! Here is a rewritten prompt: ...' });
    const parsed = parseRefineReply(stdout);
    expect(parsed.ok).toBe(false);
  });

  test('rejects JSON missing the prompt field', () => {
    const stdout = JSON.stringify({ result: JSON.stringify({ notPrompt: 'x' }) });
    const parsed = parseRefineReply(stdout);
    expect(parsed.ok).toBe(false);
  });
});

// ── Full route, CLI mocked — same approach as tests/workflows-draft.test.ts ──
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('POST /api/content/refine-prompt (CLI mocked)', () => {
  test('returns the refined prompt on a clean valid reply', async () => {
    const { execFile } = await import('node:child_process');
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(null, JSON.stringify({ result: JSON.stringify({ prompt: 'refined direction' }) }), '');
      return { on: vi.fn() } as any;
    });

    const { POST } = await import('@/app/api/content/refine-prompt/route');
    const res = await POST(
      new Request('http://test/api/content/refine-prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'money phone', modelId: 'nano_banana_pro', campaignId: 'higgsfield-api-reel' }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.prompt).toBe('refined direction');
  });

  test('retries once on an invalid first reply and succeeds on the second', async () => {
    const { execFile } = await import('node:child_process');
    let call = 0;
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      call += 1;
      if (call === 1) cb(null, JSON.stringify({ result: 'not json at all' }), '');
      else cb(null, JSON.stringify({ result: JSON.stringify({ prompt: 'fixed on retry' }) }), '');
      return { on: vi.fn() } as any;
    });

    const { POST } = await import('@/app/api/content/refine-prompt/route');
    const res = await POST(
      new Request('http://test/api/content/refine-prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'x', modelId: 'nano_banana_pro' }),
      }),
    );
    const body = await res.json();
    expect(call).toBe(2);
    expect(body.ok).toBe(true);
    expect(body.prompt).toBe('fixed on retry');
  });

  test('degrades honestly to 503 "Refinement unavailable" when the CLI is missing (ENOENT)', async () => {
    const { execFile } = await import('node:child_process');
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      cb(err, '', '');
      return { on: vi.fn() } as any;
    });

    const { POST } = await import('@/app/api/content/refine-prompt/route');
    const res = await POST(
      new Request('http://test/api/content/refine-prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'x', modelId: 'nano_banana_pro' }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.unavailable).toBe(true);
    expect(body.error).toBe('Refinement unavailable');
  });

  test('rejects a missing prompt/modelId with 400 before ever touching the CLI', async () => {
    const { execFile } = await import('node:child_process');
    vi.mocked(execFile).mockClear();
    const { POST } = await import('@/app/api/content/refine-prompt/route');
    const res = await POST(
      new Request('http://test/api/content/refine-prompt', { method: 'POST', body: JSON.stringify({ prompt: '' }) }),
    );
    expect(res.status).toBe(400);
    expect(execFile).not.toHaveBeenCalled();
  });
});
