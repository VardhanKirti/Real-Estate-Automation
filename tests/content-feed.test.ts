import { describe, expect, test } from 'vitest';
import {
  buildRenderingItems,
  filterMediaAssets,
  groupDeliveredTasks,
  isVideoRef,
  mediaFilterOptions,
  modelDisplayName,
  specDigest,
  taskSpecOrFallback,
  upscaleSpec,
  TASK_TYPE_TOOL_KEY,
  type MediaFilterState,
} from '@/lib/content-feed';
import type { MediaAsset, ProductionTask, TaskSpec } from '@/lib/content-schema';

function task(overrides: Partial<ProductionTask> = {}): ProductionTask {
  return {
    id: 'task-1',
    campaignId: 'higgsfield-api-reel',
    type: 'video',
    title: 'Master cut',
    inputs: 'test input',
    model: 'kling3_0',
    creditEstimate: 8,
    status: 'queued',
    outputRef: null,
    createdAt: '2026-09-01T16:45:00-07:00',
    ...overrides,
  };
}

function spec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    model: 'kling3_0',
    params: {},
    aspectRatio: null,
    duration: null,
    prompt: '',
    medias: [],
    identity: null,
    skill: null,
    batch: 1,
    ...overrides,
  };
}

describe('specDigest', () => {
  test('video: aspect, duration, resolution, audio in that order', () => {
    const t = task({ spec: spec({ aspectRatio: '9:16', duration: 10, params: { resolution: '1080p', sound: true } }) });
    expect(specDigest(t)).toBe('9:16 · 10s · 1080p · audio');
  });

  test('video: generate_audio also counts as audio', () => {
    const t = task({
      type: 'ads',
      spec: spec({ model: 'ad_multiplier', aspectRatio: '16:9', duration: 6, params: { resolution: '4k', generate_audio: true } }),
    });
    expect(specDigest(t)).toBe('16:9 · 6s · 4k · audio');
  });

  test('video: sound off does not append audio', () => {
    const t = task({ spec: spec({ aspectRatio: '9:16', duration: 10, params: { resolution: '1080p', sound: false } }) });
    expect(specDigest(t)).toBe('9:16 · 10s · 1080p');
  });

  test('image: resolution only, no duration or audio', () => {
    const t = task({
      type: 'image',
      spec: spec({ model: 'nano_banana_pro', aspectRatio: '1:1', duration: null, params: { resolution: '4k' } }),
    });
    expect(specDigest(t)).toBe('1:1 · 4k');
  });

  test('image: falls back to output_width x output_height when no resolution param', () => {
    const t = task({
      type: 'upscale',
      spec: spec({ model: 'topaz_image_generative', aspectRatio: null, params: { output_width: 3840, output_height: 2160 } }),
    });
    expect(specDigest(t)).toBe('3840x2160');
  });

  test('clipify: clip count plus clip aspect', () => {
    const t = task({
      type: 'clips',
      spec: spec({ model: 'clipify', params: { clips_num: 10, clip_aspect: '9:16' } }),
    });
    expect(specDigest(t)).toBe('10 clips · 9:16');
  });

  test('clipify: singular "clip" for a count of 1', () => {
    const t = task({ type: 'clips', spec: spec({ model: 'clipify', params: { clips_num: 1 } }) });
    expect(specDigest(t)).toBe('1 clip');
  });

  test('legacy task with no spec digests to an empty string', () => {
    expect(specDigest(task({ spec: undefined }))).toBe('');
  });
});

describe('modelDisplayName / isVideoRef', () => {
  test('resolves a real catalog model to its display name', () => {
    expect(modelDisplayName('kling3_0')).toBe('Kling v3.0');
  });

  test('falls back to the raw id for an unknown model', () => {
    expect(modelDisplayName('not-a-real-model')).toBe('not-a-real-model');
  });

  test('classifies output refs by extension', () => {
    expect(isVideoRef('/content-media/x.mp4')).toBe(true);
    expect(isVideoRef('/content-media/x.mov')).toBe(true);
    expect(isVideoRef('/content-media/x.png')).toBe(false);
  });
});

describe('buildRenderingItems', () => {
  test('solo active tasks come through as standalone items', () => {
    const items = buildRenderingItems([task({ id: 'a', status: 'queued' }), task({ id: 'b', status: 'generating' })]);
    expect(items).toEqual([
      { kind: 'task', task: expect.objectContaining({ id: 'a' }) },
      { kind: 'task', task: expect.objectContaining({ id: 'b' }) },
    ]);
  });

  test('delivered tasks never appear in the rendering strip', () => {
    const items = buildRenderingItems([task({ id: 'a', status: 'delivered', outputRef: '/x.png' })]);
    expect(items).toEqual([]);
  });

  test('tasks sharing a pipelineId collapse into one pipeline item', () => {
    const items = buildRenderingItems([
      task({ id: 'a', pipelineId: 'p1', nodeId: 'n1', title: 'Refs pass', status: 'generating' }),
      task({ id: 'b', pipelineId: 'p1', nodeId: 'n2', title: 'Upscale pass', status: 'queued', dependsOn: ['a'] }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'pipeline', pipelineId: 'p1' });
    if (items[0].kind === 'pipeline') {
      expect(items[0].nodes.map((n) => n.taskId)).toEqual(['a', 'b']);
    }
  });

  test('a blocked node reports waiting on its upstream task\'s title', () => {
    const items = buildRenderingItems([
      task({ id: 'a', pipelineId: 'p1', title: 'Refs pass', status: 'generating' }),
      task({ id: 'b', pipelineId: 'p1', title: 'Upscale pass', status: 'blocked', dependsOn: ['a'] }),
    ]);
    expect(items[0].kind).toBe('pipeline');
    if (items[0].kind === 'pipeline') {
      const blocked = items[0].nodes.find((n) => n.taskId === 'b');
      expect(blocked?.waitingOn).toBe('Refs pass');
      const notBlocked = items[0].nodes.find((n) => n.taskId === 'a');
      expect(notBlocked?.waitingOn).toBeNull();
    }
  });
});

describe('groupDeliveredTasks', () => {
  test('groups tasks sharing a pipelineId into one pipeline session', () => {
    const groups = groupDeliveredTasks([
      task({ id: 'a', pipelineId: 'p1', status: 'delivered', outputRef: '/a.png', createdAt: '2026-09-01T10:00:00Z' }),
      task({ id: 'b', pipelineId: 'p1', status: 'delivered', outputRef: '/b.png', createdAt: '2026-09-01T10:05:00Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'pipeline', key: 'pipeline:p1' });
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  test('groups tasks without a pipelineId by calendar day + type', () => {
    const groups = groupDeliveredTasks([
      task({ id: 'a', type: 'image', status: 'delivered', outputRef: '/a.png', createdAt: '2026-09-01T10:00:00Z' }),
      task({ id: 'b', type: 'image', status: 'delivered', outputRef: '/b.png', createdAt: '2026-09-01T18:00:00Z' }),
      task({ id: 'c', type: 'video', status: 'delivered', outputRef: '/c.mp4', createdAt: '2026-09-01T10:00:00Z' }),
    ]);
    // same day, different type -> two groups; a and b share a group.
    expect(groups).toHaveLength(2);
    const imageGroup = groups.find((g) => g.tasks.some((t) => t.id === 'a'));
    expect(imageGroup?.tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  test('orders groups newest first', () => {
    const groups = groupDeliveredTasks([
      task({ id: 'old', type: 'image', status: 'delivered', outputRef: '/o.png', createdAt: '2026-08-01T10:00:00Z' }),
      task({ id: 'new', type: 'video', status: 'delivered', outputRef: '/n.mp4', createdAt: '2026-09-01T10:00:00Z' }),
    ]);
    expect(groups[0].tasks[0].id).toBe('new');
    expect(groups[1].tasks[0].id).toBe('old');
  });

  test('non-delivered tasks never appear in any group', () => {
    const groups = groupDeliveredTasks([task({ id: 'a', status: 'queued' })]);
    expect(groups).toEqual([]);
  });
});

describe('taskSpecOrFallback / upscaleSpec', () => {
  test('returns the real spec when the task has one', () => {
    const t = task({ spec: spec({ model: 'kling3_0', prompt: 'a real prompt' }) });
    expect(taskSpecOrFallback(t)).toEqual(t.spec);
  });

  test('degrades a legacy delivered task into a usable spec instead of throwing', () => {
    const t = task({ spec: undefined, outputRef: '/content-media/x.png', model: 'nano_banana_pro' });
    const s = taskSpecOrFallback(t);
    expect(s.model).toBe('nano_banana_pro');
    expect(s.medias).toEqual([{ role: 'image_references', ref: '/content-media/x.png' }]);
  });

  test('upscaleSpec picks the video model for a video output', () => {
    const t = task({ outputRef: '/content-media/x.mp4' });
    expect(upscaleSpec(t).model).toBe('topaz_video');
  });

  test('upscaleSpec picks the image model for an image output', () => {
    const t = task({ outputRef: '/content-media/x.png' });
    expect(upscaleSpec(t).model).toBe('topaz_image_generative');
  });
});

describe('TASK_TYPE_TOOL_KEY', () => {
  test('maps every task type to a real content tool key', () => {
    expect(TASK_TYPE_TOOL_KEY.upscale).toBe('enhance');
    expect(TASK_TYPE_TOOL_KEY['ad-variants']).toBe('ads');
    expect(TASK_TYPE_TOOL_KEY.image).toBe('image');
  });
});

describe('library filter/search', () => {
  function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
    return {
      id: 'asset-1',
      file: 'a.png',
      taskId: 'task-1',
      model: 'nano_banana_pro',
      credits: 2,
      kind: 'image',
      createdAt: '2026-09-01T10:00:00Z',
      ...overrides,
    };
  }

  test('filterMediaAssets filters by kind, campaign, model, and text', () => {
    const tasks = [
      task({ id: 't1', campaignId: 'higgsfield-api-reel', title: 'Money phone reel', spec: spec({ prompt: 'phone in hand' }) }),
      task({ id: 't2', campaignId: 'openai-gpt6-astra-launch', title: 'Astra launch clip' }),
    ];
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const assets = [
      asset({ id: 'a1', taskId: 't1', kind: 'image', model: 'nano_banana_pro' }),
      asset({ id: 'a2', taskId: 't2', kind: 'video', model: 'kling3_0' }),
    ];

    const byKind = filterMediaAssets(assets, { kind: 'video', campaignId: 'all', model: 'all', query: '' }, taskById);
    expect(byKind.map((a) => a.id)).toEqual(['a2']);

    const byCampaign = filterMediaAssets(
      assets,
      { kind: 'all', campaignId: 'higgsfield-api-reel', model: 'all', query: '' },
      taskById,
    );
    expect(byCampaign.map((a) => a.id)).toEqual(['a1']);

    const byModel = filterMediaAssets(assets, { kind: 'all', campaignId: 'all', model: 'kling3_0', query: '' }, taskById);
    expect(byModel.map((a) => a.id)).toEqual(['a2']);

    const byTitleQuery = filterMediaAssets(assets, { kind: 'all', campaignId: 'all', model: 'all', query: 'astra' }, taskById);
    expect(byTitleQuery.map((a) => a.id)).toEqual(['a2']);

    const byPromptQuery = filterMediaAssets(
      assets,
      { kind: 'all', campaignId: 'all', model: 'all', query: 'phone in hand' },
      taskById,
    );
    expect(byPromptQuery.map((a) => a.id)).toEqual(['a1']);
  });

  test('mediaFilterOptions only surfaces values that actually exist', () => {
    const tasks = [task({ id: 't1', campaignId: 'higgsfield-api-reel' })];
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const assets = [asset({ id: 'a1', taskId: 't1', model: 'nano_banana_pro' })];
    const options = mediaFilterOptions(assets, taskById);
    expect(options.models).toEqual(['nano_banana_pro']);
    expect(options.campaignIds).toEqual(['higgsfield-api-reel']);
  });

  test('mediaFilterOptions returns empty lists for an empty manifest', () => {
    const options = mediaFilterOptions([], new Map());
    expect(options).toEqual({ campaignIds: [], models: [] });
  });
});

describe('default filter state', () => {
  test('is the honest "no filter applied" state', () => {
    const filter: MediaFilterState = { kind: 'all', campaignId: 'all', model: 'all', query: '' };
    expect(filter.kind).toBe('all');
  });
});
