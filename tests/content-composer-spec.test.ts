import { describe, expect, test } from 'vitest';
import { findModel } from '@/lib/higgsfield/catalog';
import { findContentTool } from '@/lib/content-schema';
import {
  applyModelChange,
  buildDefaultSpec,
  buildQueueInput,
  removeMedia,
  setIdentity,
  setMedia,
  setParam,
  specFromPartial,
  toggleSkill,
  toolForModel,
} from '@/lib/content-composer-spec';

const nanoBanana = findModel('nano_banana_pro')!;
const kling = findModel('kling3_0')!;
const clipify = findModel('clipify')!;

describe('buildDefaultSpec', () => {
  test('seeds model id, default params, first aspect ratio, and empty medias', () => {
    const spec = buildDefaultSpec(nanoBanana);
    expect(spec.model).toBe('nano_banana_pro');
    expect(spec.medias).toEqual([]);
    expect(spec.identity).toBeNull();
    expect(spec.batch).toBe(1);
    if (nanoBanana.aspectRatios.length > 0) expect(spec.aspectRatio).toBe(nanoBanana.aspectRatios[0]);
  });

  test('carries the tool skill when one is given', () => {
    const thumbTool = findContentTool('thumbnail')!;
    const spec = buildDefaultSpec(nanoBanana, thumbTool);
    expect(spec.skill).toBe('thumbnail-generation');
  });

  test('resolves a video model duration from durations or durationRange', () => {
    const spec = buildDefaultSpec(kling);
    if (kling.durations && kling.durations.length > 0) expect(spec.duration).toBe(kling.durations[0]);
    else if (kling.durationRange) expect(spec.duration).toBe(kling.durationRange.min);
  });
});

describe('applyModelChange', () => {
  test('drops media references for roles the new model does not declare', () => {
    let spec = buildDefaultSpec(nanoBanana);
    spec = setMedia(spec, nanoBanana, 'image_references', { role: 'image_references', ref: '/x.jpg' });
    expect(spec.medias.length).toBeGreaterThan(0);

    const switched = applyModelChange(spec, clipify);
    const validRoles = new Set(clipify.medias.map((m) => m.role));
    expect(switched.medias.every((m) => validRoles.has(m.role as any))).toBe(true);
  });

  test('resets params to the new model defaults', () => {
    const spec = buildDefaultSpec(nanoBanana);
    const switched = applyModelChange(spec, kling);
    expect(switched.model).toBe('kling3_0');
  });

  test('clears identity when the new model does not support the kind carried over', () => {
    const spec = buildDefaultSpec(nanoBanana);
    const withIdentity = setIdentity(spec, nanoBanana, { kind: 'element', id: 'el-1', name: 'identity-1' });
    expect(withIdentity.identity).not.toBeNull();

    const switched = applyModelChange(withIdentity, clipify);
    expect(switched.identity).toBeNull();
  });

  test('snaps aspect ratio to the new model default when the old value is not valid there', () => {
    const spec = buildDefaultSpec(nanoBanana);
    const switched = applyModelChange({ ...spec, aspectRatio: 'not-a-real-ratio' }, kling);
    expect(switched.aspectRatio).toBe(kling.aspectRatios[0] ?? null);
  });
});

describe('specFromPartial', () => {
  test('merges partial fields onto a fresh default for the target model', () => {
    const spec = specFromPartial({ prompt: 'money phone reel cover', batch: 3 }, nanoBanana);
    expect(spec.model).toBe('nano_banana_pro');
    expect(spec.prompt).toBe('money phone reel cover');
    expect(spec.batch).toBe(3);
  });

  test('filters out a carried-over media ref the target model cannot take', () => {
    const spec = specFromPartial(
      { medias: [{ role: 'input_video', ref: '/clip.mp4' }] },
      nanoBanana,
    );
    expect(spec.medias).toEqual([]);
  });
});

describe('toolForModel', () => {
  test('finds the tool whose default model matches exactly', () => {
    const tool = toolForModel(clipify);
    expect(tool?.key).toBe('clips');
  });

  test('falls back to any tool sharing the family when no exact default matches', () => {
    const otherImageModel = findModel('gpt_image_2');
    if (!otherImageModel) return;
    const tool = toolForModel(otherImageModel);
    expect(tool?.family).toBe('image');
  });
});

describe('media slot helpers', () => {
  test('a single-slot role replaces rather than accumulates', () => {
    let spec = buildDefaultSpec(kling);
    const startSlot = kling.medias.find((m) => (m.max ?? 1) <= 1);
    if (!startSlot) return;
    spec = setMedia(spec, kling, startSlot.role, { role: startSlot.role, ref: '/a.jpg' });
    spec = setMedia(spec, kling, startSlot.role, { role: startSlot.role, ref: '/b.jpg' });
    expect(spec.medias.filter((m) => m.role === startSlot.role)).toHaveLength(1);
    expect(spec.medias.find((m) => m.role === startSlot.role)?.ref).toBe('/b.jpg');
  });

  test('a multi-slot role accumulates up to its max and trims the oldest', () => {
    let spec = buildDefaultSpec(nanoBanana);
    const refSlot = nanoBanana.medias.find((m) => m.role === 'image_references');
    if (!refSlot || (refSlot.max ?? 1) <= 1) return;
    const max = refSlot.max!;
    for (let i = 0; i < max + 1; i++) {
      spec = setMedia(spec, nanoBanana, 'image_references', { role: 'image_references', ref: `/ref-${i}.jpg` });
    }
    const refs = spec.medias.filter((m) => m.role === 'image_references');
    expect(refs).toHaveLength(max);
    expect(refs.find((m) => m.ref === '/ref-0.jpg')).toBeUndefined();
  });

  test('removeMedia removes exactly the matching role+ref pair', () => {
    let spec = buildDefaultSpec(nanoBanana);
    spec = setMedia(spec, nanoBanana, 'image_references', { role: 'image_references', ref: '/x.jpg' });
    spec = removeMedia(spec, 'image_references', '/x.jpg');
    expect(spec.medias).toEqual([]);
  });
});

describe('setIdentity', () => {
  test('accepts an identity kind the model supports', () => {
    const spec = buildDefaultSpec(nanoBanana);
    const next = setIdentity(spec, nanoBanana, { kind: 'element', id: 'el-1', name: 'identity-1' });
    expect(next.identity?.id).toBe('el-1');
  });

  test('rejects an identity kind the model does not support, leaving the spec unchanged', () => {
    const spec = buildDefaultSpec(clipify);
    const next = setIdentity(spec, clipify, { kind: 'soul', id: 'soul-1', name: 'identity 1' });
    expect(next.identity).toBeNull();
    expect(next).toEqual(spec);
  });
});

describe('setParam / toggleSkill', () => {
  test('setParam writes one key without disturbing the rest', () => {
    const spec = buildDefaultSpec(nanoBanana);
    const next = setParam(spec, 'custom_flag', true);
    expect(next.params.custom_flag).toBe(true);
  });

  test('toggleSkill flips between the given skill and null', () => {
    const spec = buildDefaultSpec(nanoBanana);
    const on = toggleSkill(spec, 'thumbnail-generation');
    expect(on.skill).toBe('thumbnail-generation');
    const off = toggleSkill(on, 'thumbnail-generation');
    expect(off.skill).toBeNull();
  });
});

describe('buildQueueInput', () => {
  test('assembles and validates the queue POST body', () => {
    const spec = buildDefaultSpec(nanoBanana, findContentTool('image'));
    const input = buildQueueInput('image', 'higgsfield-api-reel', 'Test title', spec);
    expect(input).toEqual({
      toolKey: 'image',
      campaignId: 'higgsfield-api-reel',
      title: 'Test title',
      spec,
    });
  });
});
