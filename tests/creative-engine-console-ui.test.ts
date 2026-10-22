import { describe, expect, test } from 'vitest';
import { CONSOLE_LIMITS, ConsoleControlsSchema, PresetSchema } from '@/lib/creative-engine/schemas';
import { NUMBER_RANGES, clampControls, clampReport, controlsIssue, trimNotice } from '@/lib/creative-engine/console-ui';

describe('CONSOLE_LIMITS drive the schema', () => {
  test.each(['subject', 'action', 'dialogue', 'onScreenText'] as const)('%s accepts the limit and refuses one more', (f) => {
    const max = CONSOLE_LIMITS[f];
    expect(ConsoleControlsSchema.safeParse({ [f]: 'x'.repeat(max) }).success).toBe(true);
    expect(ConsoleControlsSchema.safeParse({ [f]: 'x'.repeat(max + 1) }).success).toBe(false);
  });
  test('preset name', () => {
    const base = { id: 'p', builtin: false, controls: {}, at: '2026-10-08T00:00:00Z' };
    expect(PresetSchema.safeParse({ ...base, name: 'x'.repeat(CONSOLE_LIMITS.presetName) }).success).toBe(true);
    expect(PresetSchema.safeParse({ ...base, name: 'x'.repeat(CONSOLE_LIMITS.presetName + 1) }).success).toBe(false);
  });
});

describe('clampControls', () => {
  test.each(['subject', 'action', 'dialogue', 'onScreenText'] as const)('truncates %s to its limit', (f) => {
    const out = clampControls({ [f]: 'y'.repeat(2000) });
    expect(out[f]).toHaveLength(CONSOLE_LIMITS[f]);
    expect(ConsoleControlsSchema.safeParse(out).success).toBe(true);
  });
  test('leaves text inside the limit alone', () => {
    expect(clampControls({ subject: 'a woman at a desk' })).toEqual({ subject: 'a woman at a desk' });
  });
  test.each(Object.entries(NUMBER_RANGES))('clamps %s into its range', (f, [lo, hi]) => {
    expect(clampControls({ [f]: hi + 50 })[f as 'duration']).toBe(hi);
    expect(clampControls({ [f]: lo - 50 })[f as 'duration']).toBe(lo);
    expect(clampControls({ [f]: lo + 0.4 })[f as 'duration']).toBe(lo);
  });
  test('drops non-finite and wrong-typed values so the previous value stands', () => {
    const out = clampControls({ duration: Number.NaN, variations: Infinity, subject: 42 as unknown as string });
    expect(out).toEqual({});
  });
  test('caps reference lists at the schema maxima', () => {
    const many = Array.from({ length: 50 }, (_, i) => `/r/${i}.jpg`);
    const out = clampControls({ referenceImages: many, referenceVideos: many, referenceAudios: many });
    expect(out.referenceImages).toHaveLength(30);
    expect(out.referenceVideos).toHaveLength(10);
    expect(out.referenceAudios).toHaveLength(10);
  });
  test('every clamped value parses, whatever goes in', () => {
    const wild = { subject: 's'.repeat(999), action: 'a'.repeat(999), dialogue: 'd'.repeat(9999), onScreenText: 'o'.repeat(200), duration: 99, variations: 0, intensity: 9, imperfection: -3, skinRealism: 12, motionCues: 1, lensMm: 400 };
    expect(ConsoleControlsSchema.safeParse(clampControls(wild)).success).toBe(true);
  });
  test('does not touch enums or other keys', () => {
    expect(clampControls({ model: 'seedance-2.0', framing: 'wide' })).toEqual({ model: 'seedance-2.0', framing: 'wide' });
  });
  test('does not mutate its input', () => {
    const input = { dialogue: 'd'.repeat(700) };
    clampControls(input);
    expect(input.dialogue).toHaveLength(700);
  });
});

describe('clampReport and trimNotice', () => {
  test('reports each trimmed text field', () => {
    const { trimmed } = clampReport({ dialogue: 'd'.repeat(812), action: 'a'.repeat(10) });
    expect(trimmed).toEqual([{ field: 'dialogue', from: 812, to: 600 }]);
  });
  test('the dialogue notice names the length and the way out', () => {
    expect(trimNotice([{ field: 'dialogue', from: 812, to: 600 }])).toBe('Script is 812 characters; dialogue trimmed to 600. Pick a beat to send it in parts.');
    expect(trimNotice([{ field: 'action', from: 450, to: 400 }])).toBe('Action is 450 characters; trimmed to 400.');
    expect(trimNotice([])).toBeNull();
  });
});

describe('controlsIssue', () => {
  const issue = (input: Record<string, unknown>) => {
    const r = ConsoleControlsSchema.safeParse(input);
    if (r.success) throw new Error('expected a failure');
    return controlsIssue(r.error);
  };
  test('names the field and its character limit', () => {
    expect(issue({ onScreenText: 'x'.repeat(81) })).toBe('Overlay text is 80 characters max');
    expect(issue({ dialogue: 'x'.repeat(601) })).toBe('Dialogue is 600 characters max');
  });
  test('numbers and lists', () => {
    expect(issue({ duration: 31 })).toBe('Duration is 30 max');
    expect(issue({ motionCues: 2 })).toBe('Motion cues is 3 min');
    expect(issue({ referenceVideos: Array(11).fill('/v.mp4') })).toBe('Reference videos: 10 max');
  });
});
