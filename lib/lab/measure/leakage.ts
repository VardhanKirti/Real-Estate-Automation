/**
 * Outcome cues out of every LLM prompt (04 6.3). A caption that says "this blew up, 2.3M views"
 * would let the dissector read the outcome; every count and outcome phrase becomes "[redacted]".
 */

const NUM = String.raw`\d[\d,.]*\s*[kmb]?`;
const UNITS = 'views|view|likes|like|followers|follower|subs|subscribers|subscriber|comments|comment|shares|share|saves|save|plays|play';

export const OUTCOME_CUE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`${NUM}\+?\s*(?:${UNITS})\b`, 'gi'),
  /\bthis blew up\b/gi,
  /\bblew up\b/gi,
  /\bwent viral\b/gi,
  /\bmillion views\b/gi,
  /\btrending\b/gi,
  /#fyp went\b/gi,
  /\bpart \d+ because you asked\b/gi,
];

/** Strips counts and outcome phrases from a caption before it reaches any LLM. */
export function redactOutcomeCues(caption: string): string {
  let out = caption;
  for (const re of OUTCOME_CUE_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}
