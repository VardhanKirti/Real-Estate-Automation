/**
 * Per-platform negative-risk lexicons (07 7.6.5), matched case-insensitively on word
 * boundaries over spoken, on-screen, CTA and caption text. Pure data plus one matcher.
 */

export const LINKEDIN_BAIT: RegExp[] = [
  /\bagree\s*\?/i, /\bthoughts\s*\?/i, /\bwho else\b/i, /\blike if\b/i, /\brepost if\b/i,
  /\bcomment ["'“]?[A-Z]{2,}["'”]?\b/, /\bcomment (yes|below)\b/i,
  /\bfollow (me )?for more\b/i, /\btag (someone|a friend)\b/i, /\bdrop an? \w+ (below|in the comments)\b/i,
];

export const X_HOSTILITY: RegExp[] = [
  /\b(idiots?|morons?|clowns?|losers?|dumb ?(ass|people)|stupid people)\b/i,
  /\b(ngmi|cope|seethe|cooked)\b/i,
  /\bif you('re| are)? still [^.!?]{1,40}(you('re| are)) (behind|done|ngmi|cooked|lazy|dumb)\b/i,
  /\b(boomers?|normies)\b/i,
];

export const OUTGROUP_SNEER: RegExp[] = [
  /\b(anyone|people|everyone) (who|that) still [^.!?]{1,40}\b(is|are) (wasting|lazy|stupid|dumb|clueless)\b/i,
  /\bstop being (lazy|dumb|stupid)\b/i,
];

/** First match of any pattern across the texts, with the section it came from. */
export function firstRiskMatch(patterns: readonly RegExp[], texts: readonly { text: string; section: number | null }[]): { match: string; section: number | null } | null {
  for (const t of texts) {
    for (const re of patterns) {
      const m = t.text.match(re);
      if (m) return { match: m[0].trim(), section: t.section };
    }
  }
  return null;
}
