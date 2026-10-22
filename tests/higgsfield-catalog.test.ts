import { describe, expect, test } from 'vitest';
import {
  ADVANCED_PARAMS,
  ELEMENT_MODELS,
  HF_MODELS,
  MODEL_FAMILIES,
  ROLE_KIND,
  ROLE_LABELS,
  SOUL_MODELS,
  defaultParams,
  findModel,
  identitySupport,
  modelsByFamily,
  visibleParams,
} from '@/lib/higgsfield/catalog';
import { identityAssets, readHiggsfieldAccount } from '@/lib/higgsfield/account';
import { TaskSpecSchema, resolveQueue, type ProductionTask } from '@/lib/content-schema';

describe('model catalog', () => {
  test('carries a real multi-family catalog', () => {
    expect(HF_MODELS.length).toBeGreaterThan(60);
    for (const family of MODEL_FAMILIES) {
      expect(modelsByFamily(family).length).toBeGreaterThan(0);
    }
  });

  test('every model is structurally sound', () => {
    const ids = new Set<string>();
    for (const m of HF_MODELS) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(m.name.length).toBeGreaterThan(0);
      expect(MODEL_FAMILIES).toContain(m.family);
      expect(['image', 'video', 'audio']).toContain(m.output);
      for (const slot of m.medias) {
        expect(ROLE_LABELS[slot.role]).toBeTruthy();
        expect(ROLE_KIND[slot.role]).toBeTruthy();
      }
      for (const p of m.parameters) {
        expect(['string', 'number', 'bool', 'string_array']).toContain(p.type);
      }
    }
  });

  test('the composer defaults for every tool default model exist', () => {
    for (const id of ['nano_banana_pro', 'kling3_0', 'soul_2', 'clipify', 'topaz_video', 'text2speech_v2', 'ad_multiplier']) {
      expect(findModel(id), id).toBeTruthy();
    }
  });

  test('identity routing mirrors the real MCP rules', () => {
    expect(identitySupport('soul_2')).toBe('soul');
    expect(identitySupport('soul_cinematic')).toBe('soul');
    expect(identitySupport('nano_banana_pro')).toBe('element');
    expect(identitySupport('kling3_0')).toBe('element');
    expect(identitySupport('veo3_1')).toBe('none');
    expect(identitySupport('clipify')).toBe('none');
    // Soul and element sets never overlap.
    for (const id of SOUL_MODELS) expect(ELEMENT_MODELS.has(id)).toBe(false);
  });

  test('param surfacing hides internals and splits advanced', () => {
    const kling = findModel('kling3_0')!;
    const { primary } = visibleParams(kling);
    expect(primary.map((p) => p.name)).toContain('duration');

    const soul = findModel('soul_2')!;
    const soulVisible = [...visibleParams(soul).primary, ...visibleParams(soul).advanced].map((p) => p.name);
    expect(soulVisible).not.toContain('soul_id'); // identity chip owns it

    const cinema = findModel('cinematic_studio_video_v2')!;
    expect(visibleParams(cinema).advanced.map((p) => p.name)).toContain('cfg_scale');
    expect(ADVANCED_PARAMS.has('cfg_scale')).toBe(true);
  });

  test('defaultParams pulls schema defaults only', () => {
    const d = defaultParams(findModel('seedance_2_5')!);
    expect(d.mode).toBe('t2v');
    expect(d.resolution).toBe('720p');
    expect(d).not.toHaveProperty('extension_mode');
  });
});

describe('account snapshot', () => {
  test('returns null when no account snapshot has been synced', () => {
    expect(readHiggsfieldAccount()).toBeNull();
  });

  test('a missing snapshot is an unsynced account, never a crash', () => {
    expect(readHiggsfieldAccount('/nonexistent/account.json')).toBeNull();
  });
});

describe('task spec + dependency resolution', () => {
  const base: Omit<ProductionTask, 'id'> = {
    campaignId: 'higgsfield-api-reel',
    type: 'video',
    title: 't',
    inputs: 'i',
    model: 'kling3_0',
    creditEstimate: 8,
    status: 'queued',
    outputRef: null,
    createdAt: '2026-09-02T00:00:00.000Z',
  };

  test('spec parses with defaults and validates media bindings', () => {
    const spec = TaskSpecSchema.parse({ model: 'kling3_0', prompt: 'a shot' });
    expect(spec.params).toEqual({});
    expect(spec.batch).toBe(1);
    expect(() => TaskSpecSchema.parse({ model: '', prompt: 'x' })).toThrow();
  });

  test('a task waiting on an undelivered upstream reads blocked, never stored', () => {
    const tasks: ProductionTask[] = [
      { ...base, id: 'up' },
      { ...base, id: 'down', dependsOn: ['up'] },
    ];
    const resolved = resolveQueue(tasks, { assets: [] });
    expect(resolved.find((t) => t.id === 'up')!.status).toBe('queued');
    expect(resolved.find((t) => t.id === 'down')!.status).toBe('blocked');
  });

  test('delivering the upstream unblocks the downstream', () => {
    const tasks: ProductionTask[] = [
      { ...base, id: 'up' },
      { ...base, id: 'down', dependsOn: ['up'] },
    ];
    const manifest = {
      assets: [
        { id: 'a1', file: 'up.mp4', taskId: 'up', model: 'kling3_0', credits: 8, kind: 'video' as const, createdAt: '2026-09-02T01:00:00.000Z' },
      ],
    };
    const resolved = resolveQueue(tasks, manifest);
    expect(resolved.find((t) => t.id === 'up')!.status).toBe('delivered');
    expect(resolved.find((t) => t.id === 'down')!.status).toBe('queued');
  });
});
