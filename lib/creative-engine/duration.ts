import type { VideoModel } from '@/lib/creative-engine/schemas';

/**
 * Words ↔ seconds, from the Arcads skill pack's field table: ~2.5 spoken
 * words per second (~150 WPM), always round the duration UP, and every
 * model has its own legal durations. Pure, tested in tests/creative-engine.test.ts.
 */

export const WORDS_PER_SECOND = 2.5;

export const KLING26_DURATIONS = [5, 10] as const;

export type DurationRule =
  | { kind: 'enum'; values: readonly number[] }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'auto'; approx: number };

/**
 * From CreateVideoDto.duration in the Arcads document: "kling-2.6: 5/10.
 * kling-3.0: 3-15. grok-video: 1-15. seedance: 4-12. seedance-2.0: 4-15.
 * seedance-2.5: 4-30. minimax-h3/minimax-h3-max: 5-15. veo31: not
 * applicable." seedance-2.0-mini and happy-horse are not named there:
 * mini inherits seedance-2.0, happy-horse is treated as fixed length.
 */
export const DURATION_RULES: Record<VideoModel, DurationRule> = {
  'seedance-2.0': { kind: 'range', min: 4, max: 15 },
  'seedance-2.0-mini': { kind: 'range', min: 4, max: 15 },
  'seedance-2.5': { kind: 'range', min: 4, max: 30 },
  seedance: { kind: 'range', min: 4, max: 12 },
  veo31: { kind: 'auto', approx: 8 },
  'kling-3.0': { kind: 'range', min: 3, max: 15 },
  'kling-2.6': { kind: 'enum', values: KLING26_DURATIONS },
  'grok-video': { kind: 'range', min: 1, max: 15 },
  'minimax-h3': { kind: 'range', min: 5, max: 15 },
  'minimax-h3-max': { kind: 'range', min: 5, max: 15 },
  'happy-horse': { kind: 'auto', approx: 5 },
};

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Seconds of speech this many words need, rounded up. */
export function secondsForWords(words: number): number {
  return Math.ceil(words / WORDS_PER_SECOND);
}

/** How many words fit in this many seconds. */
export function wordsForSeconds(seconds: number): number {
  return Math.floor(seconds * WORDS_PER_SECOND);
}

/** Snap a wanted duration to what the model accepts; null when the model
 *  has no duration field (Veo) or the words cannot fit any legal value. */
export function legalDuration(model: VideoModel, wantedSeconds: number): number | null {
  const rule = DURATION_RULES[model];
  if (rule.kind === 'auto') return null;
  if (rule.kind === 'range') {
    if (wantedSeconds > rule.max) return null;
    return Math.max(rule.min, Math.min(rule.max, Math.ceil(wantedSeconds)));
  }
  const fit = rule.values.find((v) => v >= wantedSeconds);
  return fit ?? null;
}

/** The whole decision for a script: fits? which duration? split needed? */
export function durationForScript(
  model: VideoModel,
  text: string,
): { words: number; needsSeconds: number; duration: number | null; fits: boolean; note: string } {
  const words = countWords(text);
  const needsSeconds = secondsForWords(words);
  const rule = DURATION_RULES[model];
  if (rule.kind === 'auto') {
    const fits = words <= wordsForSeconds(rule.approx);
    return {
      words,
      needsSeconds,
      duration: null,
      fits,
      note: fits ? `${model} picks its own length (~${rule.approx}s)` : `over ~${wordsForSeconds(rule.approx)} words: ${model} will truncate; split or pick seedance-2.5`,
    };
  }
  const duration = legalDuration(model, needsSeconds);
  if (duration === null) {
    const max = rule.kind === 'range' ? rule.max : rule.values[rule.values.length - 1];
    return { words, needsSeconds, duration: null, fits: false, note: `${words} words need ~${needsSeconds}s; ${model} tops out at ${max}s: split the script` };
  }
  return { words, needsSeconds, duration, fits: true, note: `${words} words ≈ ${needsSeconds}s → ${duration}s on ${model}` };
}
